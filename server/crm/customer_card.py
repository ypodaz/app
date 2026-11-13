"""Müştəri kartı: kontaktda «Y Pod» qeydi, app bazasındakı bağlanmış çəkilişlər, köhnə WhatsApp yazışması.
Bot sistem təlimatına `{customer}` kimi, Telegram qaralamasına `customer_short` kimi düşür."""
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

from crm import contacts
from db import aware
from models import Client, Shoot, WaContact, WaConversation, WaMessage
from views import BAKU

KINDS = {"reels_pack": "Reels paketi", "studio_rent": "öz kamerası ilə studiya", "single_reel": "Tək Reels"}
TAGS = {"podcast": "podkast", "reels": "Reels", "other": "digər çəkiliş"}


def _facts(db: DB, contact: WaContact):
    """(KnownContact | None, bağlanmış çəkilişlər [yenidən köhnəyə], son köhnə yazışmanın vaxtı | None)."""
    phone = contacts.normalize(contact.phone)
    known = contacts.lookup(db, phone) if phone else None
    shoots = []
    if phone:
        ids = [cid for cid, p in db.execute(select(Client.id, Client.phone).where(Client.phone != ""))
               if contacts.normalize(p) == phone]
        if ids:  # yalnız baş tutub bağlanmış çəkilişlər: ləğv, gəlmədi, hələ təsdiqli olanlar sayılmır
            shoots = db.scalars(select(Shoot).where(Shoot.client_id.in_(ids), Shoot.status == "completed")
                                .order_by(Shoot.starts_at.desc())).all()
    last_history = db.scalar(select(func.max(WaMessage.created_at)).join(
        WaConversation, WaConversation.id == WaMessage.conversation_id).where(
        WaConversation.contact_id == contact.id, WaMessage.source == "history"))
    return known, shoots, last_history


def _baku(dt):
    return aware(dt).astimezone(BAKU)


def _kind(s: Shoot) -> str:
    return KINDS.get(s.kind) or TAGS.get(s.tag, s.tag)


def build(db: DB, contact: WaContact) -> str:
    known, shoots, last_history = _facts(db, contact)
    lines = []
    if known and known.kind == "customer":
        lines.append("Köhnə müştəridir (kontaktda Y Pod kimi qeydlidir)."
                     + (f" Adı: {known.first_name}" if known.first_name else ""))
    if shoots:
        s = shoots[0]
        parts = [f"{_baku(s.starts_at):%Y-%m-%d}", _kind(s)] + ([f"{s.cameras} kamera"] if s.cameras else [])
        lines.append(f"Bizdə {len(shoots)} çəkilişi olub, sonuncu: {', '.join(parts)}")
    if last_history:
        lines.append(f"Əvvəlki yazışma var (son: {_baku(last_history):%Y-%m-%d})")
    return "\n".join(lines)


def short(db: DB, contact: WaContact) -> str:
    """Telegram başlığı üçün: «köhnə müştəri · 3 çəkiliş · son 2026-08»; yeni müştəri üçün ""."""
    known, shoots, last_history = _facts(db, contact)
    parts = (["köhnə müştəri"] if (known and known.kind == "customer") or shoots else []) + (
        [f"{len(shoots)} çəkiliş", f"son {_baku(shoots[0].starts_at):%Y-%m}"] if shoots else [])
    if last_history:
        parts.append("köhnə yazışma var")
    return " · ".join(parts)
