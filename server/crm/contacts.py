"""Sahibkarın telefon kontaktları: xarici və şəxsi nömrələrdə bot yazmır, söhbət sahibkara keçir."""
import re

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

from auth import new_card_code
from crm import chat
from models import Client, KnownContact, WaContact


def normalize(phone: str | None) -> str:
    """WaContact.phone formatı (yalnız rəqəmlər, ölkə kodu ilə): +994 50 111 22 33, 00994…, 0501112233, 501112233
    → 994501112233. Xarici nömrə rəqəmlərə çevrilir, başqa dəyişmir."""
    d = re.sub(r"\D", "", phone or "")
    if d.startswith("00"):
        d = d[2:]
    if len(d) == 10 and d.startswith("0"):
        d = "994" + d[1:]
    elif len(d) == 9:
        d = "994" + d
    elif len(d) == 13 and d.startswith("9940"):  # +994 (050) … yazılışı
        d = "994" + d[4:]
    return d


def lookup(db: DB, phone: str | None) -> KnownContact | None:
    p = normalize(phone)
    return db.get(KnownContact, p) if p else None


def route(contact: WaContact, known: KnownContact | None) -> str | None:
    """None: bot normal işləyir; foreign: 994 ilə başlamayan nömrə; personal: kontaktda var, amma «Y Pod» deyil.
    Telefonu olmayan (yalnız bsuid) kontakta qayda tətbiq olunmur."""
    phone = normalize(contact.phone)
    if not phone:
        return None
    if not phone.startswith("994"):
        return "foreign"
    if known and known.kind == "personal":
        return "personal"
    return None


def find_client(db: DB, phone: str | None) -> Client | None:
    """Telefonun son 9 rəqəmi ilə müştəri (nömrə formatı fərqli yazılsa da)."""
    tail = chat.digits(phone)[-9:]
    if len(tail) < 7:
        return None
    return next((c for c in db.scalars(select(Client).where(Client.phone != "")) if chat.digits(c.phone)[-9:] == tail), None)


def ensure_client(db: DB, name: str | None, phone: str | None, fallback: str = "WhatsApp müştərisi") -> Client:
    """Telefona görə müştərini tapır, yoxdursa yaradır (flush edir, commit çağıran tərəfindədir)."""
    client = find_client(db, phone)
    if not client:
        name = (name or "").strip()
        client = Client(full_name=name if len(name) >= 2 else fallback, phone=chat.digits(phone),
                        card_code=new_card_code())
        db.add(client)
        db.flush()
    return client
