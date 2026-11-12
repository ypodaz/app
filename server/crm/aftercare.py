"""Çəkilişdən sonra: gündəlik «📋 Montaj növbəsi» və rəy sorğusu kartları (Telegram).

Montaj növbəsi: bağlanmış (`completed`), montajlı (`editing`), hələ təhvil verilməmiş (`production != ready`) çəkilişlər.
Hər çəkilişə «✅ Təhvil verildi» düyməsi (`m:{shoot_id}:r`) → `production=ready`, `delivered_at`.

Rəy sorğusu: montajlıda təhvildən 2 gün, montajsızda çəkilişdən 3 gün sonra hazır mətn + wa.me düyməsi. Sahibkar
özü göndərir (pulsuz; Cloud API ilə 24 saatdan kənar yazmaq pullu şablon tələb edir). Bir çəkilişə bir dəfə; son
30 gündə sorğu gedən müştəriyə yenisi getmir (daimi müştəri hər həftə eyni sualı almasın).
"""
from datetime import date, datetime, timedelta
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import booking
import tgtopics
from crm import conf, contacts
from crm.tg import _call
from db import aware, now
from models import Client, Material, Shoot
from views import BAKU

HOUR = 10  # Bakı vaxtı: səhər bir dəfə
AFTER_DELIVERY, AFTER_SHOOT = timedelta(days=2), timedelta(days=3)
MAX_AGE = timedelta(days=14)  # köhnə çəkilişlərə sorğu getmir (ilk işə düşəndə arxiv yığılmasın)
REPEAT_GAP = timedelta(days=30)
MAX_BUTTONS = 20
TAGS = {"podcast": "podkast", "reels": "Reels"}


def _local(t: datetime) -> datetime:
    return aware(t).astimezone(BAKU)


def _first(full: str | None) -> str:
    return (full or "").split(" ")[0]


def _label(s: Shoot) -> str:
    return TAGS.get(s.tag, "çəkiliş")


# --- montaj növbəsi ---

def queue(db: DB) -> list[Shoot]:
    rows = db.scalars(select(Shoot).where(Shoot.status == "completed", Shoot.editing.is_(True),
                                          Shoot.production != "ready")).all()
    return sorted(rows, key=lambda s: (s.delivery_on is None, s.delivery_on or date.max, aware(s.starts_at)))


def _queue_line(i: int, s: Shoot, client: Client | None, today: date) -> str:
    parts = [f"{i}. {client.full_name if client else '?'}", _label(s), f"çəkiliş {_local(s.starts_at):%d.%m}"]
    if s.reels_count:
        parts.append(f"{s.reels_count} Reels")
    if s.delivery_on:
        late = (today - s.delivery_on).days
        due = f"təhvil {s.delivery_on:%d.%m}"
        if late > 0:
            due += f" ⚠️ {late} gün gecikir"
        elif late == 0:
            due += " (bu gün)"
        parts.append(due)
    else:
        parts.append("təhvil tarixi yoxdur")
    return " · ".join(parts)


def queue_message(db: DB, today: date) -> tuple[str, dict | None]:
    shoots = queue(db)
    if not shoots:
        return "📋 Montaj növbəsi boşdur ✅", None
    clients = {c.id: c for c in db.scalars(select(Client).where(Client.id.in_({s.client_id for s in shoots})))}
    lines = [f"📋 Montaj növbəsi ({len(shoots)})", ""]
    lines += [_queue_line(i, s, clients.get(s.client_id), today) for i, s in enumerate(shoots, 1)]
    lines += ["", "Təhvil verəndə düyməyə basın. Material linkini app-a paneldən əlavə edin."]
    rows = [[{"text": f"✅ {i}. {_first(clients[s.client_id].full_name if s.client_id in clients else '')} — "
                      "təhvil verildi", "callback_data": f"m:{s.id}:r"}]
            for i, s in enumerate(shoots[:MAX_BUTTONS], 1)]
    return "\n".join(lines)[:4000], {"inline_keyboard": rows}


def send_queue(db: DB, today: date) -> bool:
    if not queue(db):
        return False  # boş növbə hər gün yazılmasın
    text, kb = queue_message(db, today)
    _call("sendMessage", {**tgtopics.dest("tasks"), "text": text, "reply_markup": kb})
    return True


def mark_delivered(db: DB, s: Shoot) -> bool:
    """Qaytarır: müştəriyə app bildirişi getdimi. Bildiriş yalnız app-da material linki varsa gedir (boş səhifə açılmasın)."""
    s.production, s.delivered_at = "ready", now()
    has_materials = bool(db.scalar(select(Material.id).where(Material.shoot_id == s.id).limit(1)))
    if has_materials:
        booking._notify(db, s.client_id, "materials_ready", shoot_id=s.id)
    return has_materials


def handle_callback(db: DB, cq: dict) -> str:
    """`m:{shoot_id}:r`. Qaytarır: delivered | resolved | ignored."""
    parts = str(cq.get("data", "")).split(":")
    msg = cq.get("message") or {}
    if len(parts) != 3 or parts[2] != "r" or not parts[1].isdigit():
        return "ignored"
    s = db.get(Shoot, int(parts[1]))
    if not s:
        _call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": "Çəkiliş tapılmadı"})
        return "ignored"
    if s.production == "ready":
        result, note, alert = "resolved", "artıq təhvil verilib", False
    else:
        notified = mark_delivered(db, s)
        db.commit()
        result, alert = "delivered", not notified
        note = "✅ Təhvil qeyd olundu" + ("" if notified else ". App-da material linki yoxdur: müştəriyə bildiriş getmədi")
    _call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": note[:190], "show_alert": alert})
    text, kb = queue_message(db, _local(now()).date())
    payload = {"chat_id": msg["chat"]["id"], "message_id": msg.get("message_id"), "text": text}
    if kb:
        payload["reply_markup"] = kb
    _call("editMessageText", payload)
    return result


# --- rəy sorğusu ---

def feedback_text(s: Shoot, client: Client) -> str:
    name = _first(client.full_name)
    ask = "Videolarınız artıq əlinizdədir, necə alındı?" if s.editing else "Çəkilişiniz necə keçdi?"
    return (f"Salam{', ' + name if name else ''}! Y Pod-dan yazırıq. {ask} Nəyi bəyəndiniz, nəyi daha yaxşı edə "
            "bilərdik? Bir-iki cümlə yazsanız, bizə çox kömək olar 🙏")


def feedback_due(db: DB, t: datetime) -> list[Shoot]:
    today = _local(t).date()
    rows = db.scalars(select(Shoot).where(Shoot.status == "completed", Shoot.feedback_asked_at.is_(None),
                                          Shoot.starts_at >= t - MAX_AGE - timedelta(days=60))
                      .order_by(Shoot.starts_at)).all()
    out, seen = [], set()
    for s in rows:
        if s.editing:
            if s.production != "ready" or not s.delivered_at:
                continue
            base, wait = aware(s.delivered_at), AFTER_DELIVERY
        else:
            base, wait = aware(s.starts_at), AFTER_SHOOT
        if _local(base).date() + wait > today or base < t - MAX_AGE - wait:
            continue
        if s.client_id in seen or db.scalar(select(Shoot.id).where(
                Shoot.client_id == s.client_id, Shoot.feedback_asked_at >= t - REPEAT_GAP).limit(1)):
            continue  # bu müştəriyə yaxında sorğu gedib (və ya bu gün gedir)
        seen.add(s.client_id)
        out.append(s)
    return out


def send_feedback(db: DB, s: Shoot) -> None:
    client = db.get(Client, s.client_id)
    text = feedback_text(s, client)
    when = f"çəkiliş {_local(s.starts_at):%d.%m}"
    if s.editing and s.delivered_at:
        when += f", montaj təhvil {_local(s.delivered_at):%d.%m}"
    phone = contacts.normalize(client.phone)
    body = (f"⭐ Rəy sorğusu\n{client.full_name} · {_label(s)} · {when}\n\nHazır mətn:\n{text}\n\n"
            + ("Düyməyə basın: WhatsApp hazır mətnlə açılacaq, istəsəniz dəyişib göndərin."
               if phone else "Müştərinin telefonu yoxdur: mətni əl ilə göndərin."))
    payload = {**tgtopics.dest("tasks"), "text": body[:4000], "disable_web_page_preview": True}
    if phone:
        payload["reply_markup"] = {"inline_keyboard": [[{"text": "💬 WhatsApp-da aç",
                                                         "url": f"https://wa.me/{phone}?text={quote(text)}"}]]}
    _call("sendMessage", payload)
    s.feedback_asked_at = now()


# --- gündəlik dövr ---

def enabled(db: DB) -> bool:
    return (conf.get(db, "aftercare_enabled", "true") or "").strip().lower() != "false"


def due(db: DB, t: datetime) -> bool:
    local = _local(t)
    return local.hour >= HOUR and conf.get(db, "aftercare_last") != local.date().isoformat() and enabled(db)


def run(db: DB, t: datetime) -> int:
    """Növbə + sorğu kartları. Qaytarır: göndərilən sorğu sayı."""
    send_queue(db, _local(t).date())
    asked = feedback_due(db, t)
    for s in asked:
        send_feedback(db, s)
    conf.put(db, "aftercare_last", _local(t).date().isoformat())
    db.commit()
    return len(asked)
