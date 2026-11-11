"""Saatlıq CRM dövrü: follow-up. Yalnız QARALAMA yaradır (`auto` rejimdə də): müştəriyə avtomatik heç nə getmir.

Şərt: lead `maraqlanir`/`tarix` mərhələsindədir, son müştəri mesajı 20–23 saat əvvəldir, ondan sonra bizdən mesaj
yoxdur, söhbət `bot` rejimindədir və bu lead üçün follow-up hələ yaradılmayıb.
"""
import asyncio
import logging
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import ai
from ai import AiError
from crm import bot, chat, tg
from db import SessionLocal, aware, now
from models import BotDraft, Lead, LeadEvent, WaContact, WaConversation, WaMessage

log = logging.getLogger("crm-worker")
INTERVAL = 3600
MIN_AGE, MAX_AGE = timedelta(hours=20), timedelta(hours=23)
NOTE = ("\n\nBu müştəri təxminən 20 saatdır cavab yazmır. Ona bir qısa, mehriban xatırlatma yaz (təzyiq etmə, "
        "yeni qiymət və ya vədlər vermə, 1–2 cümlə). Cavab formatı eyni JSON.")


def due_conversations(db: DB) -> list[WaConversation]:
    t = now()
    convs = db.scalars(select(WaConversation).where(
        WaConversation.mode == "bot", WaConversation.lead_id.is_not(None),
        WaConversation.last_inbound_at <= t - MIN_AGE, WaConversation.last_inbound_at >= t - MAX_AGE)).all()
    out = []
    for c in convs:
        lead = db.get(Lead, c.lead_id)
        contact = db.get(WaContact, c.contact_id)
        if not lead or lead.stage not in ("maraqlanir", "tarix") or contact.excluded:
            continue
        if db.scalar(select(WaMessage.id).where(WaMessage.conversation_id == c.id, WaMessage.direction == "out",
                                                WaMessage.created_at > c.last_inbound_at).limit(1)):
            continue  # bizdən artıq yazılıb
        if db.scalar(select(LeadEvent.id).where(LeadEvent.lead_id == lead.id, LeadEvent.kind == "followup").limit(1)):
            continue
        if not chat.window_open(c):
            continue
        out.append(c)
    return out


def make_followup(db: DB, conv: WaConversation) -> BotDraft | None:
    lead = db.get(Lead, conv.lead_id)
    contents = bot.contents_from(bot._history(db, conv))
    if not contents or contents[-1]["role"] != "user":
        return None
    system = bot.build_system(db, now(), first_message=False, lead=lead) + NOTE
    try:
        res, usage, problem = bot.converse(system, contents)
    except AiError:
        log.warning("follow-up üçün AI cavab vermədi (söhbət %s)", conv.id)
        return None
    ai.count_usage(db, "bot", *usage)
    if problem or not res["reply"]:
        return None
    draft = BotDraft(conversation_id=conv.id, text=res["reply"], reason="follow-up", model_output=res)
    db.add(draft)
    db.add(LeadEvent(lead_id=lead.id, kind="followup", data={"conversation_id": conv.id}))
    db.commit()
    tg.send_draft(db, draft)
    db.commit()
    return draft


def run(db: DB) -> int:
    n = 0
    for conv in due_conversations(db):
        if bot.skip_reason(db, conv, db.get(WaContact, conv.contact_id)):  # bot söndürülüb, susdurulub və s.
            continue
        if make_followup(db, conv):
            n += 1
    return n


def tick() -> None:
    with SessionLocal() as db:
        run(db)


async def loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:  # dövr heç vaxt dayanmamalıdır
            log.exception("CRM dövrü")
        await asyncio.sleep(INTERVAL)
