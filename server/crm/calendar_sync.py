"""Apple təqvimi → app: sahibkar «Y Pod» təqviminə hadisə yazanda çəkiliş avtomatik yaranır (10 dəqiqədən bir).

- Yalnız gələcək 60 gün, «Y Pod» təqviminin bütün hadisələri (başlıqda «Y Pod» lazım deyil).
- Sub-icarəçinin və şəxsi hadisələr (settings.CALENDAR_SUBLET_RE / CALENDAR_PERSONAL_RE) çəkiliş yox, blok olur; vaxtı dəyişəndə
  blok da dəyişir, hadisə 2 oxunuşda yoxdursa gələcək blok silinir. Tanınmayan hadisənin kartında «🔒 Şahinin» düyməsi var.
- Hadisə UID ilə bir çəkilişə bağlanır (`Shoot.calendar_uid`); ±60 dəq içində app-da çəkiliş varsa təkrar yaranmır, bağlanır.
- Müştəri əmin tanınanda (başlıq/təsvirdə telefon, və ya ad tək müştəriyə uyğundur) çəkiliş «Təsdiqləndi», beh istənmədən
  yaranır; sahibkara «↩️ Geri al» düyməli xəbər gedir. Tanınmayanda bir dəfə kart: namizədlər, «➕ Yeni müştəri», «🚫 Çəkiliş deyil».
- Hadisənin vaxtı dəyişsə çəkiliş yenilənir (müştəriyə xəbər getmir), toqquşma olsa yalnız Telegram qeydi.
- Hadisə ardıcıl 2 uğurlu oxunuşda yoxdursa sahibkardan soruşulur; özbaşına ləğv yoxdur.
- ICS yüklənmirsə heç nə edilmir. Başlıqlar loglanmır, yalnız sahibkarın Telegram-ına gedir.

Telegram callback_data (`k:`): u (geri al), c (namizəd müştəri), p (namizəd telefon), n (yeni müştəri), x (çəkiliş deyil),
b (Şahinin bloku), d (ləğv et), s (saxla). Sahibkarın telefon cavabı: `phone_reply`.
"""
import asyncio
import logging
import re
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import booking
import money
import tgtopics
from auth import new_card_code
from crm import calendar_ics
from crm import calendar_import as ci
from crm.contacts import normalize
from crm.tg import _call
from crm.todo import is_owner
from db import SessionLocal, aware, now
from models import Block, CalendarLink, Client, KnownContact, Notification, Shoot
from views import BAKU

log = logging.getLogger("calendar-sync")
INTERVAL = 600
HORIZON = timedelta(days=60)
NEAR = timedelta(minutes=60)
MISSING_ASK = 2  # ardıcıl neçə uğurlu oxunuşda yoxdursa soruşulur
MAX_CANDIDATES = 3
PHONE_RE = re.compile(r"\+?\d[\d\s\-()]{7,}\d")
SERVICE = {"podcast": "Podkast", "reels": "Reels", "other": "Çəkiliş"}


def _when(dt: datetime) -> str:
    return aware(dt).astimezone(BAKU).strftime("%d.%m %H:%M")


def _send(text: str, buttons: list[list[dict]] | None = None) -> str | None:
    payload = {**tgtopics.dest("action"), "text": text[:4000]}
    if buttons:
        payload["reply_markup"] = {"inline_keyboard": buttons}
    mid = ((_call("sendMessage", payload) or {}).get("result") or {}).get("message_id")
    return str(mid) if mid else None


def phone_in(*texts: str) -> str | None:
    for text in texts:
        for m in PHONE_RE.finditer(text or ""):
            n = normalize(m.group())
            if (n.startswith("994") and len(n) == 12) or (not n.startswith("994") and 10 <= len(n) <= 15):
                return n
    return None


def name_from_title(title: str) -> str:
    """Başlığın əvvəlindəki ad (orijinal hərflərlə): rəqəm və ya xidmət sözünə qədər, ən çoxu 3 söz."""
    words = []
    for w in ci.OWN_RE.sub("", title or "").split():
        f = ci.fold(w)
        stop = not f or f in ci.FILLER or any(ch.isdigit() for ch in w)
        if stop and words:
            break
        if not stop:
            words.append(w)
        if len(words) == 3:
            break
    return " ".join(words) or "Təqvim müştərisi"


def _by_phone(db: DB, phone: str) -> Client | None:
    for c in db.scalars(select(Client).where(Client.phone != "")):
        if normalize(c.phone) == phone:
            return c
    return None


def _new_client(db: DB, name: str, phone: str) -> Client:
    c = Client(full_name=name[:120], phone=phone, card_code=new_card_code())
    db.add(c)
    db.flush()
    return c


def _first_names(db: DB) -> list[tuple[str, str]]:
    return [(ci.fold(re.sub(r"y\s*-?\s*pod", " ", k.first_name, flags=re.I)), k.phone)
            for k in db.scalars(select(KnownContact).where(KnownContact.kind == "customer"))]


def recognise(db: DB, title: str, desc: str) -> Client | None:
    """Əmin tanınma: telefon (başlıq/təsvir; müştəri yoxdursa yaradılır) və ya ad tək müştəriyə uyğun."""
    phone = phone_in(title, desc)
    if phone:
        return _by_phone(db, phone) or _new_client(db, name_from_title(title), phone)
    tokens = ci.parse(title)["name_tokens"]
    idx = [(ci.fold(c.full_name), str(c.id)) for c in db.scalars(select(Client))]
    cid, _ = ci.match(tokens, [(n, i) for n, i in idx if n])
    return db.get(Client, int(cid)) if cid else None


def candidates(db: DB, title: str) -> list[tuple[str, str]]:
    """Kart üçün ≤3 namizəd: (düymə mətni, callback_data hissəsi). Əvvəl app müştəriləri, sonra «Y Pod» kontaktları."""
    tokens = ci.parse(title)["name_tokens"]
    if not tokens:
        return []
    first = tokens[0]
    out, phones = [], set()
    clients = [c for c in db.scalars(select(Client)) if first in ci.fold(c.full_name).split()
               or any(w.startswith(first) for w in ci.fold(c.full_name).split()) and len(first) >= 3]
    clients.sort(key=lambda c: (ci.fold(c.full_name).split()[:1] != [first], c.id))
    for c in clients[:MAX_CANDIDATES]:
        out.append((f"👤 {c.full_name}", f"c:{{id}}:{c.id}"))
        phones.add(normalize(c.phone))
    for name, phone in _first_names(db):
        if len(out) >= MAX_CANDIDATES:
            break
        if name == first and phone not in phones:
            out.append((f"📇 {name.capitalize()} …{phone[-4:]}", f"p:{{id}}:{phone}"))
            phones.add(phone)
    return out


def _create(db: DB, link: CalendarLink, client: Client) -> tuple[Shoot, list[dict]]:
    """Normal rezervasiya yolu ilə təsdiqlənmiş çəkiliş, beh istənmir. Qiymət başlıqdakı AZN-dən aşağıdırsa fərq endirim kimi."""
    info = ci.parse(link.title)
    s = booking.create_shoot(db, None, client_id=client.id, starts_at=link.starts_at, duration_min=link.duration_min,
                             kind=info["kind"], tag=info["tag"], location="studio", cameras=info["cameras"],
                             editing=False, title=link.title[:120], source_note="calendar")
    stated = (info["price"] or 0) * money.AZN
    if 0 < stated < s.total:
        s.discount, s.discount_note = s.total - stated, "Təqvim başlığındakı qiymət"
        booking._apply_price(s, booking._price(db, s, None))
        s.deposit_expected = money.deposit_expected(s.total, s.cashback_used, False)
    s.calendar_uid = link.uid
    booking.waive_deposit(db, None, s)
    link.state, link.missing, link.asked_deleted = "linked", 0, False
    db.flush()
    found = booking.conflicts(db, starts_at=s.starts_at, duration_min=s.duration_min, prep_min=s.prep_min,
                              wrap_min=s.wrap_min, exclude_id=s.id)
    return s, found


def _service(s: Shoot) -> str:
    if s.kind == "studio_rent":
        return "Studiya icarəsi"
    return f"{SERVICE.get(s.tag, 'Çəkiliş')}, {s.cameras} kamera"


def _announce(db: DB, link: CalendarLink, client: Client) -> Shoot:
    s, found = _create(db, link, client)
    text = f"📅 Təqvimdən çəkiliş yaradıldı · {client.full_name}, {_when(s.starts_at)} · {_service(s)}"
    if found:
        text += "\n⚠️ Bu vaxt başqa çəkiliş və ya blokla üst-üstə düşür"
    _send(text, [[{"text": "↩️ Geri al", "callback_data": f"k:u:{link.id}"}]])
    return s


def _card(db: DB, link: CalendarLink) -> bool:
    rows = candidates(db, link.title)
    kb = [[{"text": label, "callback_data": "k:" + data.format(id=link.id)}] for label, data in rows]
    kb.append([{"text": "➕ Yeni müştəri", "callback_data": f"k:n:{link.id}"}])
    kb.append([{"text": "🔒 Şahinin (blok)", "callback_data": f"k:b:{link.id}"}])
    kb.append([{"text": "🚫 Çəkiliş deyil", "callback_data": f"k:x:{link.id}"}])
    return bool(_send(f"📅 Təqvimdə yeni çəkiliş: {link.title}, {_when(link.starts_at)} — kimdir?", kb))


def _block_of(db: DB, link: CalendarLink) -> Block | None:
    """Hadisənin bloku: blokda hadisə id-si saxlanmır, ona görə əvvəlki başlama vaxtı ilə tapılır."""
    return db.scalar(select(Block).where(Block.starts_at == link.starts_at).order_by(Block.id))


def _make_block(db: DB, link: CalendarLink, ends_at: datetime, reason: str) -> None:
    if not _block_of(db, link):
        db.add(Block(starts_at=link.starts_at, ends_at=ends_at, reason=reason))
    link.state = "block"


def _new_event(db: DB, ev: dict) -> None:
    dur = ci.round_duration((ev["end"] - ev["start"]).total_seconds() / 60)
    reason = ci.block_reason(ev["title"])
    if reason:
        link = CalendarLink(uid=ev["uid"], state="block", title=ev["title"][:200], starts_at=ev["start"], duration_min=dur)
        db.add(link)
        _make_block(db, link, ev["end"], reason)
        return
    near = next((s for s in db.scalars(select(Shoot).where(
        Shoot.status != "cancelled", Shoot.calendar_uid.is_(None),
        Shoot.starts_at >= ev["start"] - NEAR - timedelta(minutes=1), Shoot.starts_at <= ev["start"] + NEAR + timedelta(minutes=1)))
        if abs(aware(s.starts_at) - ev["start"]) <= NEAR), None)
    link = CalendarLink(uid=ev["uid"], state="card", title=ev["title"][:200], starts_at=ev["start"], duration_min=dur)
    db.add(link)
    db.flush()
    if near:
        near.calendar_uid, link.state = ev["uid"], "linked"
        return
    client = recognise(db, ev["title"], ev["desc"])
    if client:
        _announce(db, link, client)
        return
    if _card(db, link):
        return
    db.rollback()  # Telegram alınmadı: növbəti dövrdə təkrar cəhd


def _drop_notifications(db: DB, shoot_id: int) -> None:
    for obj in list(db.new):
        if isinstance(obj, Notification) and (obj.payload or {}).get("shoot_id") == shoot_id:
            db.expunge(obj)


def _changed(db: DB, link: CalendarLink, s: Shoot, ev: dict, dur: int) -> None:
    if s.status != "confirmed" or aware(s.starts_at) <= now():
        return
    found = booking.conflicts(db, starts_at=ev["start"], duration_min=dur, prep_min=s.prep_min, wrap_min=s.wrap_min,
                              exclude_id=s.id)
    why = "başqa çəkiliş və ya blokla üst-üstə düşür" if found else None
    if not found:
        try:
            booking.edit_shoot(db, None, s, starts_at=ev["start"], duration_min=dur, kind=s.kind, tag=s.tag,
                               location=s.location, cameras=s.cameras, editing=s.editing, reels_count=s.reels_count,
                               address=s.address, title=s.title, note=s.note, discount=s.discount,
                               discount_note=s.discount_note, prep_min=s.prep_min, wrap_min=s.wrap_min,
                               extras=s.extras or [])
            _drop_notifications(db, s.id)  # müştəriyə xəbər getmir
            return
        except booking.Rejected as e:
            why = str(e)
    name = db.get(Client, s.client_id).full_name
    _send(f"⚠️ Təqvimdə vaxt dəyişdi, çəkiliş dəyişmədi: {name}, {_when(s.starts_at)} → {_when(ev['start'])}. {why}")


def _seen(db: DB, link: CalendarLink, ev: dict) -> None:
    dur = ci.round_duration((ev["end"] - ev["start"]).total_seconds() / 60)
    link.missing, link.asked_deleted = 0, False
    if link.state == "block" and (aware(link.starts_at) != ev["start"] or link.duration_min != dur):
        b = _block_of(db, link)
        if b:
            b.starts_at, b.ends_at = ev["start"], ev["end"]
    if link.state == "linked" and (aware(link.starts_at) != ev["start"] or link.duration_min != dur):
        s = db.scalar(select(Shoot).where(Shoot.calendar_uid == link.uid))
        if s:
            _changed(db, link, s, ev, dur)
    if link.state != "ignored":
        link.starts_at, link.duration_min = ev["start"], dur
    link.title = ev["title"][:200]


def _absent(db: DB, link: CalendarLink) -> None:
    link.missing += 1
    if link.state == "block":
        if link.missing >= MISSING_ASK and aware(link.starts_at) > now():
            b = _block_of(db, link)
            if b:
                db.delete(b)
            link.state = "ignored"
        return
    s = db.scalar(select(Shoot).where(Shoot.calendar_uid == link.uid))
    if link.missing < MISSING_ASK or link.asked_deleted or not s or s.status != "confirmed" \
            or aware(s.starts_at) <= now():
        return
    link.asked_deleted = True
    name = db.get(Client, s.client_id).full_name
    _send(f"Təqvimdən silindi: {name}, {aware(s.starts_at).astimezone(BAKU):%d.%m} — ləğv edilsin?",
          [[{"text": "Ləğv et", "callback_data": f"k:d:{link.id}"}, {"text": "Saxla", "callback_data": f"k:s:{link.id}"}]])


def run(db: DB, t: datetime | None = None) -> int:
    """Bir sinxronizasiya dövrü. Qaytarır: işlənən hadisə sayı (ICS alınmasa 0, heç nə dəyişmir)."""
    t = t or now()
    events = calendar_ics.detailed(t, t + HORIZON)
    if events is None:
        return 0
    own = {e["uid"]: e for e in events}
    links = {l.uid: l for l in db.scalars(select(CalendarLink))}
    for uid, ev in own.items():
        try:
            link = links.get(uid)
            if link is None:
                if ev["start"] > t:
                    _new_event(db, ev)
            elif link.state != "ignored":
                _seen(db, link, ev)
            db.commit()
        except Exception as e:  # noqa: BLE001 — bir hadisənin xətası qalanlarını saxlamasın; başlıq loga düşmür
            db.rollback()
            log.warning("təqvim hadisəsi emal edilmədi (%s)", type(e).__name__)
    for uid, link in links.items():
        if uid in own or link.state not in ("linked", "block") or aware(link.starts_at) > t + HORIZON - timedelta(days=1):
            continue
        try:
            _absent(db, link)
            db.commit()
        except Exception as e:  # noqa: BLE001
            db.rollback()
            log.warning("təqvim hadisəsi emal edilmədi (%s)", type(e).__name__)
    return len(own)


# --- Telegram düymələri ---

def _answer(cq: dict, text: str, alert: bool = False) -> None:
    _call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": text[:190], "show_alert": alert})


def _edit(cq: dict, text: str) -> None:
    msg = cq.get("message") or {}
    _call("editMessageText", {"chat_id": msg["chat"]["id"], "message_id": msg.get("message_id"), "text": text[:4000]})


def _resolve(db: DB, cq: dict, link: CalendarLink, client: Client) -> str:
    s = _announce(db, link, client)
    db.commit()
    _answer(cq, "✅ Çəkiliş yaradıldı")
    _edit(cq, f"✅ {client.full_name}, {_when(s.starts_at)} · {_service(s)}")
    return "created"


def _undo(db: DB, cq: dict, link: CalendarLink) -> str:
    s = db.scalar(select(Shoot).where(Shoot.calendar_uid == link.uid))
    if not s or s.status != "confirmed" or aware(s.starts_at) <= now() or s.deposit_received_at or s.cashback_used:
        _answer(cq, "Artıq geri alına bilməz", True)
        return "resolved"
    for n in db.scalars(select(Notification).where(Notification.client_id == s.client_id,
                                                   Notification.pushed_at.is_(None))):
        if (n.payload or {}).get("shoot_id") == s.id:
            db.delete(n)
    db.delete(s)
    link.state = "ignored"
    db.commit()
    _answer(cq, "↩️ Geri alındı")
    _edit(cq, f"↩️ Geri alındı: {link.title}, {_when(link.starts_at)}")
    return "undone"


def _cancel(db: DB, cq: dict, link: CalendarLink, do: bool) -> str:
    s = db.scalar(select(Shoot).where(Shoot.calendar_uid == link.uid))
    if not s or s.status != "confirmed":
        _answer(cq, "artıq həll olunub")
        return "resolved"
    if not do:
        _answer(cq, "Saxlanıldı")
        _edit(cq, f"Saxlanıldı: {_when(s.starts_at)}")
        return "kept"
    booking.cancel_shoot(db, None, s, now())
    db.commit()
    _answer(cq, "Ləğv edildi")
    _edit(cq, f"Ləğv edildi: {_when(s.starts_at)}")
    return "cancelled"


def handle_callback(db: DB, cq: dict) -> str:
    """`k:{əməl}:{link_id}[:{arg}]`. Qaytarır: ignored | resolved | created | undone | cancelled | kept | asking."""
    msg = cq.get("message") or {}
    parts = str(cq.get("data", "")).split(":")
    if len(parts) < 3 or not parts[2].isdigit() or not is_owner({**msg, "from": cq.get("from")}):
        return "ignored"
    act, link = parts[1], db.get(CalendarLink, int(parts[2]))
    if not link:
        _answer(cq, "Hadisə tapılmadı")
        return "ignored"
    if act == "u":
        return _undo(db, cq, link)
    if act in ("d", "s"):
        return _cancel(db, cq, link, act == "d")
    if link.state not in ("card", "asking"):
        _answer(cq, "artıq həll olunub")
        return "resolved"
    if act == "b":
        _make_block(db, link, aware(link.starts_at) + timedelta(minutes=link.duration_min), ci.SUBLET)
        db.commit()
        _answer(cq, "🔒 Blok yazıldı")
        _edit(cq, f"🔒 Şahinin (blok): {link.title}, {_when(link.starts_at)}")
        return "blocked"
    if act == "x":
        link.state = "ignored"
        db.commit()
        _answer(cq, "🚫 Çəkiliş deyil")
        _edit(cq, f"🚫 Çəkiliş deyil: {link.title}, {_when(link.starts_at)}")
        return "ignored_event"
    if act == "c" and len(parts) == 4 and parts[3].isdigit() and (c := db.get(Client, int(parts[3]))):
        return _resolve(db, cq, link, c)
    if act == "p" and len(parts) == 4:
        c = _by_phone(db, parts[3])
        if not c:
            known = db.get(KnownContact, parts[3])
            name = ci.fold(re.sub(r"y\s*-?\s*pod", " ", known.first_name, flags=re.I)).title() if known else ""
            c = _new_client(db, (name + " " + name_from_title(link.title).split(" ", 1)[-1]).strip()
                            if name else name_from_title(link.title), parts[3])
        return _resolve(db, cq, link, c)
    if act == "n":
        first = ci.parse(link.title)["name_tokens"][:1]
        phones = {p for n, p in _first_names(db) if first and n == first[0]}
        if len(phones) == 1:
            phone = phones.pop()
            return _resolve(db, cq, link, _by_phone(db, phone) or _new_client(db, name_from_title(link.title), phone))
        link.state = "asking"
        link.ask_message_id = _send(f"📞 {name_from_title(link.title)} üçün telefon nömrəsini bu mesaja cavab olaraq yazın")
        db.commit()
        _answer(cq, "Nömrəni yazın")
        return "asking"
    _answer(cq, "Naməlum əməl")
    return "ignored"


def phone_reply(db: DB, msg: dict) -> str | None:
    """Sahibkar «telefon nömrəsini yazın» mesajına cavab verir. None: bu bizim mesaj deyil."""
    reply_to = str((msg.get("reply_to_message") or {}).get("message_id") or "")
    if not reply_to or not msg.get("text"):
        return None
    link = db.scalar(select(CalendarLink).where(CalendarLink.ask_message_id == reply_to,
                                                CalendarLink.state == "asking"))
    if not link or not is_owner(msg):
        return None
    phone = phone_in(msg["text"])
    if not phone:
        _call("sendMessage", {"chat_id": msg["chat"]["id"], "reply_to_message_id": msg.get("message_id"),
                              **({"message_thread_id": msg["message_thread_id"]} if msg.get("message_thread_id") else {}),
                              "text": "Nömrə tanınmadı, yenidən yazın (məs. 050 111 22 33)"})
        return "calendar_bad_phone"
    _announce(db, link, _by_phone(db, phone) or _new_client(db, name_from_title(link.title), phone))
    db.commit()
    return "calendar_created"


def tick() -> None:
    with SessionLocal() as db:
        run(db)


async def loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:  # dövr heç vaxt dayanmamalıdır
            log.exception("təqvim sinxronu")
        await asyncio.sleep(INTERVAL)
