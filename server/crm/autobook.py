"""Avtomatik rezerv: müştəri konkret gün və saat deyəndə bot saatı 24 saatlıq tutur (`Block` + `BookingHold`), kart məlumatını
göndərir, sahibkara Telegram kartı gedir. Qəbz (şəkil/sənəd) gələndə kart yenilənir; sahibkar ✅ basanda çəkiliş yaranır,
❌ basanda və ya qəbz 24 saat gəlməsə saat boşalır. Qaydalar: tarix ≥ bu gün + 2 gün, 08:00–22:00, çəkilişin ətrafında ±60 dəq boş,
beh 50%. Yalnız WhatsApp və Instagram DM. Ayarlar `settings` cədvəlində: `auto_booking`, `booking_card_text`, `booking_address_text`.
"""
import logging
import threading
from datetime import date, datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import booking
import money
import settings
import tgtopics
from ai import WD
from crm import calendar_ics, chat, conf, contacts, instagram, kapso, slots, tg
from db import aware, now
from models import BookingHold, Block, Lead, LeadEvent, Shoot, WaConversation, WaMessage
from views import BAKU, utc

log = logging.getLogger("autobook")

HOLD_HOURS = 24
MIN_DAYS = 2  # tarix ≥ bu gün (Bakı) + 2 təqvim günü
BUFFER = timedelta(minutes=60)  # tutulan saatın hər iki tərəfində boş olmalıdır
RECEIPT_LABELS = ("[şəkil", "[sənəd]")  # qəbz: bot.FILE_LABELS-dəki «[video]» qəbz sayılmır
SERVICE_NAME = {"reels_pack": "Reels paketi", "single_reel": "Tək Reels", "shoot": "Podkast çəkilişi"}
RECEIPT_REPLY = "Qəbzi aldıq, komanda yoxlayıb təsdiqləyəcək 🙏"
SEND_ERRORS = (kapso.KapsoError, instagram.IgError)

_lock = threading.Lock()  # yoxlama + yazma: eyni saata iki söhbət eyni anda düşməsin


def enabled(db: DB) -> bool:
    """Ayar açıqdır və kart məlumatı yazılıb (kartsız rezerv mənasızdır)."""
    on = (conf.get(db, "auto_booking", "false") or "").strip().lower() == "true"
    return on and bool((conf.get(db, "booking_card_text", "") or "").strip())


def quote(booking: dict, lead: Lead | None) -> dict | None:
    """Botun `booking` sahəsini çəkiliş sahələrinə və qiymətə çevirir; qiymət hesablanmırsa None."""
    service = booking.get("service")
    if service == "reels":
        kind, tag, minutes, cameras, editing, label = "reels_pack", "reels", 60, 1, False, None
    elif service == "tek_reels":
        kind, tag, minutes, cameras, editing, label = "single_reel", "reels", 30, 1, False, None
    elif service == "podkast":
        cameras = booking.get("cameras") or (lead.cameras if lead else None) or 1
        minutes = round((booking.get("hours") or 1) * 60)
        kind, tag, editing, label = "shoot", "podcast", bool(lead and lead.editing is True), None
    else:
        return None
    try:
        p = money.price(kind=kind, location="studio", cameras=cameras, duration_min=minutes, editing=editing)
    except ValueError:
        return None
    total = money.fmt(p.total)
    if kind == "reels_pack":
        label = f"Reels paketi: 1 saat çəkiliş və 5 hazır Reels, montaj daxil — {total}."
    elif kind == "single_reel":
        label = f"Tək Reels (çəkiliş və montaj) — {total}."
    else:
        label = f"Podkast çəkilişi: {money.fmt_hours(minutes)}, {cameras} kamera{', montaj daxil' if editing else ''} — {total}."
    return {"kind": kind, "tag": tag, "duration_min": minutes, "cameras": cameras, "editing": editing, "reels_count": 0,
            "total": p.total, "deposit": money.deposit_expected(p.total, 0, False), "label": label}


def check(db: DB, start: datetime, duration_min: int, today: date, ignore_block: int | None = None) -> tuple[bool, str]:
    """(uyğundur?, səbəb): too_soon | hours | calendar | conflict | ok. `ignore_block`: müştərinin öz köhnə tutduğu saat."""
    s = aware(start).astimezone(BAKU)
    e = s + timedelta(minutes=duration_min)
    if s.date() < today + timedelta(days=MIN_DAYS):
        return False, "too_soon"
    if s < s.replace(hour=slots.OPEN_H, minute=0) or e > s.replace(hour=slots.CLOSE_H, minute=0):
        return False, "hours"
    lo, hi = s - BUFFER, e + BUFFER
    try:
        spans = calendar_ics.busy_strict(lo, hi)
    except calendar_ics.CalendarUnavailable:
        return False, "calendar"
    # bazaya və sorğulara UTC (SQLite qurşağı saxlamır)
    for sh in db.scalars(select(Shoot).where(Shoot.status == "confirmed", Shoot.starts_at < utc(hi) + timedelta(hours=6),
                                             Shoot.starts_at > utc(lo) - timedelta(hours=12))):
        spans.append(booking.busy_span(sh))
    q = select(Block).where(Block.starts_at < utc(hi), Block.ends_at > utc(lo))
    if ignore_block:
        q = q.where(Block.id != ignore_block)
    spans += [(aware(b.starts_at), aware(b.ends_at)) for b in db.scalars(q)]
    if any(a < hi and lo < b for a, b in spans):
        return False, "conflict"
    return True, "ok"


def alternatives(db: DB, day: date, duration_min: int, n: int = 3, today: date | None = None,
                 ignore_block: int | None = None) -> list[datetime]:
    """`day` və sonrakı 2 gündə (hamısı ≥ bu gün + 2) 08:00–22:00, 30 dəqiqə addımla `check` keçən ilk n başlanğıc."""
    today = today or aware(now()).astimezone(BAKU).date()
    out: list[datetime] = []
    for i in range(3):
        d = day + timedelta(days=i)
        if d < today + timedelta(days=MIN_DAYS):
            continue
        cur = datetime(d.year, d.month, d.day, slots.OPEN_H, tzinfo=BAKU)
        last = datetime(d.year, d.month, d.day, slots.CLOSE_H, tzinfo=BAKU) - timedelta(minutes=duration_min)
        while cur <= last:
            ok, why = check(db, cur, duration_min, today, ignore_block)
            if why == "calendar":  # təqvim oxunmur: hər addımda 10 san. gözləməyək
                return []
            if ok:
                out.append(cur)
                if len(out) == n:
                    return out
            cur += timedelta(minutes=30)
    return out


# --- yazılar ---

def _day(dt: datetime) -> str:
    b = aware(dt).astimezone(BAKU)
    return f"{WD[b.weekday()]} {b:%d.%m}"


def _link(hold: BookingHold) -> str:
    return chat.panel_link(int(hold.ref)) if hold.channel == "wa" else f"{settings.APP_URL}admin/#inbox/ig/{hold.ref}"


def pending_hold(db: DB, channel: str, ref: str) -> BookingHold | None:
    return db.scalar(select(BookingHold).where(BookingHold.channel == channel, BookingHold.ref == str(ref),
                                               BookingHold.status == "pending").order_by(BookingHold.id.desc()).limit(1))


def wa_receipt(db: DB, hold: BookingHold) -> bool:
    """Saat tutulandan sonra müştəri şəkil/sənəd göndərib (ardınca «göndərdim» yazsa da tanınır)."""
    q = select(WaMessage.text).where(WaMessage.conversation_id == int(hold.ref), WaMessage.source == "customer",
                                     WaMessage.created_at > hold.created_at)
    return any((t or "").startswith(RECEIPT_LABELS) for t in db.scalars(q))


def log_text(db: DB, sent: list[str]) -> str:
    """Telegram qeydi üçün: kart mətni yazılmır."""
    card = (conf.get(db, "booking_card_text", "") or "").strip()
    return "\n\n".join("💳 [kart məlumatı]" if card and m.strip() == card else m for m in sent)


def _release(db: DB, hold: BookingHold, status: str) -> None:
    """Tutulan saatı buraxır: status dəyişir, `Block` silinir (commit çağıran tərəfindədir)."""
    hold.status = status
    block_id, hold.block_id = hold.block_id, None
    db.flush()
    if block_id and (block := db.get(Block, block_id)):
        db.delete(block)


def send(db: DB, channel: str, ref: str, text: str) -> None:
    """Müştəriyə bir mesaj (WA: pəncərə bağlıdırsa KapsoError; IG: IgError). Mesaj bölünmür."""
    if channel == "wa":
        chat.send_out(db, db.get(WaConversation, int(ref)), text, "bot")
        return
    from crm import social_inbox  # dövri import olmasın: social_inbox → bot → autobook
    mid = instagram.send_dm(ref, text)
    if mid:
        social_inbox._sent_mids.append(mid)  # echo-su «sahibkar yazdı» sayılmasın


def to_wait(db: DB, hold: BookingHold) -> None:
    """Qəbzdən sonra söhbət komandanın yoxlamasını gözləyir (asan suala bot yenə cavab verir)."""
    if hold.channel == "wa":
        from crm import turns
        turns.to_wait(db, db.get(WaConversation, int(hold.ref)), now())
    else:
        from crm import social_inbox
        social_inbox.to_wait(db, hold.ref, now())


def advance_lead(db: DB, lead: Lead | None) -> None:
    """Saat tutulub: lead mərhələsi `beh` (yalnız irəli)."""
    if lead and lead.stage in ("yeni", "maraqlanir", "tarix"):
        db.add(LeadEvent(lead_id=lead.id, kind="stage", data={"from": lead.stage, "to": "beh", "by": "bot"}))
        lead.stage = "beh"


def _card(hold: BookingHold, head: str, foot: str) -> str:
    s = aware(hold.starts_at).astimezone(BAKU)
    e = s + timedelta(minutes=hold.duration_min)
    lines = [head, f"{hold.name}, {hold.phone or 'telefonsuz'}",
             f"{_day(s)} {s:%H:%M}–{e:%H:%M}, {SERVICE_NAME.get(hold.kind, hold.kind)}, {money.fmt(hold.total)} "
             f"(beh {money.fmt(hold.deposit)})", foot, _link(hold)]
    return "\n".join(x for x in lines if x)


def _buttons(hold: BookingHold) -> dict:
    return {"inline_keyboard": [[{"text": "✅ Təsdiqlə", "callback_data": f"b:{hold.id}:c"},
                                 {"text": "❌ Ləğv et", "callback_data": f"b:{hold.id}:x"}]]}


def _send_card(db: DB, hold: BookingHold, head: str, foot: str) -> None:
    """Kartı «🔴 Cavab lazımdır» mövzusuna göndərir, message_id hold-a yazılır."""
    where = tgtopics.dest("action")
    res = tg._call("sendMessage", {**where, "text": _card(hold, head, foot), "disable_web_page_preview": True,
                                   "reply_markup": _buttons(hold)})
    mid = ((res or {}).get("result") or {}).get("message_id")
    if mid:
        hold.tg_message_id, hold.tg_chat_id = str(mid), str(where["chat_id"])


def _edit(chat_id, message_id, text: str) -> None:
    """Kartın mətni dəyişir, düymələr silinir."""
    if chat_id and message_id:
        tg._call("editMessageText", {"chat_id": chat_id, "message_id": int(message_id), "text": text[:4000],
                                     "disable_web_page_preview": True})


def _answer(cq: dict, text: str, alert: bool = False) -> None:
    tg._call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": text[:190], "show_alert": alert})


def _messages(db: DB, hold: BookingHold, q: dict) -> list[str]:
    s = aware(hold.starts_at).astimezone(BAKU)
    out = [f"{_day(s)} saat {s:%H:%M} sizin üçün boşdur 🙏\n{q['label']}",
           f"Rezervasiya üçün 50% ön ödəniş: {money.fmt(hold.deposit)}. Kart məlumatı:",
           conf.get(db, "booking_card_text", "") or ""]
    if (conf.get(db, "booking_address_text", "") or "").strip():
        out.append(conf.get(db, "booking_address_text"))
    out.append("Ödənişi etdikdən sonra qəbzi bura göndərərsiniz zəhmət olmasa, cədvələ qeyd edək.")
    return out


def _start(booking: dict) -> datetime | None:
    try:
        return datetime.fromisoformat(f"{booking['date']}T{booking['start']}").replace(tzinfo=BAKU)
    except (KeyError, ValueError, TypeError):
        return None


def try_hold(db: DB, *, channel: str, ref: str, lead: Lead | None, name: str, phone: str | None, booking: dict,
             now_dt: datetime) -> dict:
    """Saatı yoxlayıb tutur. {"ok": True, "hold", "messages"} və ya {"ok": False, "reason", "messages"} (conflict-də alternativ
    mətni; digər səbəblərdə və ya alternativ yoxdursa boş: köhnə yol, komanda baxır). Müştəridə pending hold varsa, yenisi uğurlu
    olanda köhnə ləğv edilir. Mesajları göndərmək çağıranın işidir."""
    q, start = quote(booking, lead), _start(booking)
    if not q or not start:
        return {"ok": False, "reason": "quote", "messages": []}
    today = aware(now_dt).astimezone(BAKU).date()
    with _lock:
        old = pending_hold(db, channel, ref)
        ignore = old.block_id if old else None
        ok, why = check(db, start, q["duration_min"], today, ignore)
        if not ok:
            alts = alternatives(db, start.date(), q["duration_min"], today=today, ignore_block=ignore) if why == "conflict" else []
            text = ("Bu saat artıq doludur. Yaxın boş saatlar: "
                    + ", ".join(f"{a:%d.%m} saat {a:%H:%M}" for a in alts) + ". Hansı sizə uyğundur?") if alts else None
            return {"ok": False, "reason": why, "messages": [text] if text else []}
        block = Block(starts_at=utc(start), ends_at=utc(start) + timedelta(minutes=q["duration_min"]),
                      reason=f"⏳ Bot rezervi: {name}"[:255])
        db.add(block)
        db.flush()
        hold = BookingHold(channel=channel, ref=str(ref), lead_id=lead.id if lead else None, block_id=block.id,
                           name=name[:120], phone=phone, starts_at=utc(start), duration_min=q["duration_min"],
                           kind=q["kind"], tag=q["tag"], cameras=q["cameras"], editing=q["editing"],
                           reels_count=q["reels_count"], total=q["total"], deposit=q["deposit"], status="pending",
                           hold_until=utc(now_dt) + timedelta(hours=HOLD_HOURS))
        db.add(hold)
        if old:
            _release(db, old, "cancelled")
        db.commit()
    if old:
        _edit(old.tg_chat_id, old.tg_message_id, _card(old, "❌ Ləğv edildi (müştəri başqa saat seçdi)", ""))
    _send_card(db, hold, "📅 Bot saatı tutdu, qəbz gözlənilir", f"{HOLD_HOURS} saat ərzində qəbz gəlməsə boşalacaq")
    db.commit()
    return {"ok": True, "hold": hold, "messages": _messages(db, hold, q)}


def discard(db: DB, hold: BookingHold, why: str) -> None:
    """Mesajlar müştəriyə getmədi: saat boşaldılır, kart bağlanır."""
    _release(db, hold, "cancelled")
    db.commit()
    _edit(hold.tg_chat_id, hold.tg_message_id, _card(hold, f"❌ Ləğv edildi ({why})", ""))


def receipt(db: DB, hold: BookingHold) -> None:
    """Müştəri qəbz göndərdi: status `receipt`, müştəriyə təşəkkür, Telegram-da yeni kart (köhnəsi bağlanır), söhbət gözləyir.
    Commit çağıran tərəfindədir."""
    hold.status = "receipt"
    try:
        send(db, hold.channel, hold.ref, RECEIPT_REPLY)
    except SEND_ERRORS as e:
        log.warning("qəbz cavabı getmədi (hold %s): %s", hold.id, type(e).__name__)
    _edit(hold.tg_chat_id, hold.tg_message_id, _card(hold, "🧾 Qəbz gəldi (yeni kart aşağıdadır)", ""))
    _send_card(db, hold, "🧾 Qəbz gəldi", "Qəbzi yoxlayın, sonra təsdiqləyin")
    to_wait(db, hold)


def handle_callback(db: DB, cq: dict) -> str:
    """`b:{id}:c` (✅ Təsdiqlə) və `b:{id}:x` (❌ Ləğv et). Qaytarır: ignored | resolved | confirmed | cancelled | error."""
    parts = str(cq.get("data", "")).split(":")
    if len(parts) != 3 or parts[0] != "b" or parts[2] not in ("c", "x") or not parts[1].isdigit():
        return "ignored"
    msg = cq.get("message") or {}
    chat_id, message_id = (msg.get("chat") or {}).get("id"), msg.get("message_id")  # basılan kart (qəbz kartı da ola bilər)
    hold = db.get(BookingHold, int(parts[1]))
    if not hold:
        _answer(cq, "Rezerv tapılmadı")
        return "ignored"
    if hold.status not in ("pending", "receipt"):
        _answer(cq, "artıq həll olunub")
        return "resolved"
    if parts[2] == "x":
        _release(db, hold, "cancelled")
        db.commit()
        _edit(chat_id, message_id, _card(hold, "❌ Ləğv edildi", ""))
        _answer(cq, "Ləğv edildi")
        return "cancelled"
    paid = hold.status == "receipt"
    lead = db.get(Lead, hold.lead_id) if hold.lead_id else None
    try:
        client = contacts.ensure_client(db, hold.name, hold.phone,
                                        "WhatsApp müştərisi" if hold.channel == "wa" else "Instagram müştərisi")
        _release(db, hold, "confirmed")  # tutulan saatın yerini çəkiliş tutur
        db.flush()
        s = booking.create_shoot(db, None, client_id=client.id, starts_at=aware(hold.starts_at), duration_min=hold.duration_min,
                                 kind=hold.kind, tag=hold.tag, location="studio", cameras=hold.cameras, editing=hold.editing,
                                 reels_count=hold.reels_count, source_note="bot", prep_min=15, wrap_min=0)
        if paid:
            booking.receive_deposit(db, None, s, hold.deposit)
    except booking.Rejected as e:
        db.rollback()
        _answer(cq, f"Təsdiqlənmədi: {e}", alert=True)
        return "error"
    hold.shoot_id = s.id
    if lead and lead.stage not in ("geldi", "itirildi"):
        db.add(LeadEvent(lead_id=lead.id, kind="confirmed", data={"shoot_id": s.id, "client_id": client.id,
                                                                  "from": lead.stage, "by": "bot"}))
        lead.shoot_id, lead.stage = lead.shoot_id or s.id, "tesdiq"
    db.commit()
    b = aware(hold.starts_at).astimezone(BAKU)
    note = ""
    try:
        send(db, hold.channel, hold.ref, f"Rezervasiyanız təsdiqləndi: {_day(b)} saat {b:%H:%M}. Gözləyirik 😊")
        db.commit()
    except SEND_ERRORS as e:
        db.rollback()
        why = kapso.window_closed_text() if getattr(e, "code", None) == kapso.WINDOW_CLOSED else str(getattr(e, "message", e))
        note = f"\n⚠️ Müştəriyə yazılmadı ({why[:150]}), özünüz yazın"
    _edit(chat_id, message_id, _card(hold, "✅ Təsdiqləndi", "") + note)
    _answer(cq, "Təsdiqləndi")
    return "confirmed"


def expire_due(db: DB, t: datetime) -> int:
    """Qəbz gəlməyən (status pending) və vaxtı keçən saatları boşaldır; sahibkara xəbər gedir."""
    n = 0
    for hold in db.scalars(select(BookingHold).where(BookingHold.status == "pending", BookingHold.hold_until < utc(t))
                           .order_by(BookingHold.id)).all():
        _release(db, hold, "expired")
        db.commit()
        _edit(hold.tg_chat_id, hold.tg_message_id, _card(hold, "⌛ Vaxtı bitdi", ""))
        s = aware(hold.starts_at).astimezone(BAKU)
        tg._call("sendMessage", {**tgtopics.dest("action"),
                                 "text": f"⌛ Qəbz gəlmədi, {_day(s)} saat {s:%H:%M} boşaldı: {hold.name}"})
        n += 1
    return n
