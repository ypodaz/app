"""Söhbət tarixçəsi (02 #17, #19; 03 §Q9 S5): daxili qeyd və sistem sətirləri. Müştəriyə heç vaxt getmir.
Yazanlar commit etmir: çağıran tərəf (route, bot, növbə dövrü) commit edir."""
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

from crm import chat
from db import now
from models import Client, ConversationEvent, Lead, WaContact, WaConversation
from views import iso

WA, IG = "wa", "ig"
NOTE, SYSTEM = "note", "system"

# 00 §3.6 (ekranda mətn). Açarlar həm sənəd kodlarını, həm də bot promptunun kodlarını (bot_prompt.py) əhatə edir.
REASON_LABEL = {
    "rezerv": "Müştəri saat seçdi, təsdiqləyin", "sikayet": "Şikayət edir", "korporativ": "Korporativ sorğu",
    "endirim": "10%-dən çox endirim istəyir", "movcud_sifaris": "Mövcud sifariş",
    "bilinmir": "Bot cavabı bilmir", "insan": "İnsanla danışmaq istəyir", "insan_istedi": "İnsanla danışmaq istəyir",
    "mexfi": "Məxfi məlumat", "mexfilik": "Məxfi məlumat", "is": "İş yazışması", "is_yazismasi": "İş yazışması",
    "emekdasliq": "Əməkdaşlıq təklifi", "filtr": "Bot cavab yaza bilmədi", "fayl": "Fayl göndərildi", "diger": "Digər",
}
MODE_LABEL = {"bot": "Bot aparır", "owner": "Siz yazdınız", "wait": "Komandaya ötürülüb", "human": "Bot susur"}


def reason_label(code: str | None) -> str:
    return REASON_LABEL.get((code or "").strip().lower(), (code or "").strip() or "Digər")


def _tail(phone: str | None) -> str:
    return chat.digits(phone)[-9:]


def wa_links(db: DB, conv: WaConversation) -> tuple[int | None, int | None]:
    """WA söhbətinin bağlı olduğu (client_id, lead_id): müştəri telefonun son 9 rəqəmi ilə tapılır (Inbox `_client_card` kimi)."""
    lead = db.get(Lead, conv.lead_id) if conv.lead_id else None
    ct = db.get(WaContact, conv.contact_id)
    tail = _tail((lead.phone if lead else "") or (ct.phone if ct else ""))
    cid = None
    if len(tail) >= 7:
        cid = next((c.id for c in db.scalars(select(Client).where(Client.phone != "")) if _tail(c.phone) == tail), None)
    return cid, lead.id if lead else None


def add(db: DB, channel: str, ref: str | int, kind: str, text: str, meta: dict | None = None, at: datetime | None = None,
        client_id: int | None = None, lead_id: int | None = None) -> ConversationEvent:
    e = ConversationEvent(channel=channel, ref=str(ref)[:64], kind=kind, text=text, meta=meta, client_id=client_id,
                          lead_id=lead_id, created_at=at or now())
    db.add(e)
    return e


def note(db: DB, channel: str, ref: str | int, text: str, client_id: int | None = None,
         lead_id: int | None = None) -> ConversationEvent:
    return add(db, channel, ref, NOTE, text, {"author": "Siz"}, client_id=client_id, lead_id=lead_id)


def system(db: DB, channel: str, ref: str | int, code: str, text: str, **meta) -> ConversationEvent:
    return add(db, channel, ref, SYSTEM, text, {"code": code, **meta})


def handoff(db: DB, channel: str, ref: str | int, reason: str | None) -> None:
    """«Bot söhbəti komandaya ötürdü» + «Bot niyə ötürdü: <səbəb>» (S5)."""
    system(db, channel, ref, "handoff", "Bot söhbəti komandaya ötürdü")
    system(db, channel, ref, "handoff_reason", f"Bot niyə ötürdü: {reason_label(reason)}", reason=reason)


def mode_changed(db: DB, channel: str, ref: str | int, old: str, new: str) -> None:
    """«Rejim: <ad>» (S5 təklifi). Eyni rejimə keçid yazılmır."""
    if old != new:
        system(db, channel, ref, "mode", f"Rejim: {MODE_LABEL.get(new, new)}", mode=new, was=old)


def friend_changed(db: DB, channel: str, ref: str | int, friend: bool) -> None:
    system(db, channel, ref, "friend", "Dostdur · bot yazmır" if friend else "Bot yenə yazır", friend=friend)


def auto_sent(db: DB, channel: str, ref: str | int) -> None:
    system(db, channel, ref, "auto_sent", "Bot özü göndərdi")


def reminded(db: DB, channel: str, ref: str | int, mins: int) -> None:
    system(db, channel, ref, "reminded", f"Xatırlatma göndərildi · {mins} dəq", mins=mins)


def out(e: ConversationEvent) -> dict:
    return {"id": e.id, "kind": e.kind, "text": e.text, "meta": e.meta, "created_at": iso(e.created_at)}


def listing(db: DB, channel: str, ref: str | int) -> list[dict]:
    rows = db.scalars(select(ConversationEvent).where(ConversationEvent.channel == channel,
                                                      ConversationEvent.ref == str(ref))
                      .order_by(ConversationEvent.created_at, ConversationEvent.id)).all()
    return [out(e) for e in rows]
