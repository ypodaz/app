"""Söhbət əməliyyatları: göndəriş (bot, panel, Telegram düyməsi), qaralama qərarı. Commit çağıran tərəfindədir."""
import random
import re
import time
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import settings
from crm import conf, kapso
from db import aware, now
from models import BotDraft, WaContact, WaConversation, WaMessage


def digits(v: str | None) -> str:
    return re.sub(r"\D", "", v or "")


def window_open(conv: WaConversation) -> bool:
    return bool(conv.window_expires_at) and aware(conv.window_expires_at) > now()


def phone_number_id(db: DB) -> str:
    """Env-də yoxdursa, webhook-dan öyrənilmiş dəyər."""
    return settings.KAPSO_PHONE_NUMBER_ID or conf.get(db, "kapso_phone_number_id", "") or ""


def send_out(db: DB, conv: WaConversation, text: str, source: str) -> WaMessage:
    """Müştəriyə mətn göndərir və `out` mesajı kimi saxlayır. Pəncərə bağlıdırsa KapsoError(131047) atır."""
    if not window_open(conv):
        raise kapso.KapsoError(kapso.WINDOW_CLOSED, kapso.window_closed_text())
    contact = db.get(WaContact, conv.contact_id)
    wamid = kapso.send_text(phone_number_id(db), to=contact.phone or None,
                            recipient=None if contact.phone else contact.bsuid, text=text)
    t = now()
    msg = WaMessage(conversation_id=conv.id, wamid=wamid, direction="out", source=source, type="text", text=text,
                    status="sent", created_at=t)
    db.add(msg)
    conv.last_message_at = t
    kapso.count_message(db)
    return msg


PAUSE = (1.5, 2.5)  # iki mesaj arasında gözləmə (san.); testdə (0, 0)


def _sleep():
    time.sleep(random.uniform(*PAUSE))


def split_reply(text: str) -> list[str]:
    """Son boş sətirdən əvvəlki hər şey 1-ci mesaj, son abzas 2-ci; boş hissə olsa tək mesaj."""
    head, sep, tail = text.strip().rpartition("\n\n")
    head, tail = head.strip(), tail.strip()
    return [head, tail] if sep and head and tail else [text.strip()]


def send_bot_reply(db: DB, conv: WaConversation, text: str, source: str = "bot") -> list[WaMessage]:
    """Bot cavabını ən çoxu 2 WhatsApp mesajı kimi göndərir. İkincidə KapsoError olsa istisna qalxır,
    birinci mesaj sessiyada qalır (commit çağıran tərəfindədir)."""
    out = []
    parts = split_reply(text)
    for i, part in enumerate(parts):
        if i:
            _sleep()
        try:
            out.append(send_out(db, conv, part, source))
        except kapso.KapsoError as e:
            if out:  # birinci hissə artıq müştəridədir: qeydini saxla, təkrar getməsin
                db.commit()
            e.remaining = "\n\n".join(parts[i:])
            raise
    return out


class AlreadyDecided(Exception):
    pass


def decide_draft(db: DB, draft: BotDraft, action: str, text: str | None = None) -> BotDraft:
    """action: send | reject. `send`-də mətn dəyişibsə status `edited`, orijinal `model_output`-da qalır.
    Göndərmə xətasında (KapsoError) qaralama `pending` qalır."""
    if draft.status != "pending":
        raise AlreadyDecided()
    if action == "reject":
        draft.status, draft.decided_at = "rejected", now()
        return draft
    final = (text if text is not None else draft.text).strip()
    conv = db.get(WaConversation, draft.conversation_id)
    try:
        send_bot_reply(db, conv, final)
    except kapso.KapsoError as e:
        if e.remaining != final:  # yarısı getdi: qaralamada yalnız qalan hissə qalsın
            draft.text = e.remaining
            db.commit()
        raise
    draft.status = "edited" if final != draft.text.strip() else "sent"
    if draft.status == "edited":
        draft.text = final  # orijinal `model_output["reply"]`-da qalır
    draft.decided_at = now()
    return draft


def reject_pending(db: DB, conversation_id: int, reason: str) -> int:
    drafts = db.scalars(select(BotDraft).where(BotDraft.conversation_id == conversation_id,
                                               BotDraft.status == "pending")).all()
    for d in drafts:
        d.status, d.reason, d.decided_at = "rejected", reason, now()
    return len(drafts)


def last_message(db: DB, conversation_id: int, source: str | None = None) -> WaMessage | None:
    q = select(WaMessage).where(WaMessage.conversation_id == conversation_id)
    if source:
        q = q.where(WaMessage.source == source)
    return db.scalar(q.order_by(WaMessage.created_at.desc(), WaMessage.id.desc()).limit(1))



def panel_link(conversation_id: int) -> str:
    return f"{settings.APP_URL}admin/#inbox/{conversation_id}"
