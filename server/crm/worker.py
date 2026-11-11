"""Saatlıq CRM dövrü: follow-up. Yalnız QARALAMA yaradır (`auto` rejimdə də): müştəriyə avtomatik heç nə getmir.

Şərt: lead `maraqlanir`/`tarix` mərhələsindədir, son müştəri mesajı 20–23 saat əvvəldir, ondan sonra bizdən mesaj
yoxdur, söhbət `bot` rejimindədir və bu lead üçün follow-up hələ yaradılmayıb.
"""
import asyncio
import logging
import re
from datetime import timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import ai
from ai import AiError
from crm import bot, chat, conf, digest, tg
from db import SessionLocal, aware, now
from models import BotDraft, Lead, LeadEvent, WaContact, WaConversation, WaMessage
from views import BAKU

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


# --- qiymətdən sonra susma: bir xatırlatma qaralaması ---
# Şərt: son mesaj bizimdir (bot və ya telefon) və qiymət var, müştəri 3+ saatdır susur, pəncərənin bağlanmasına
# 1 saatdan çox var, Bakı vaxtı 09:00–21:00, lead `yeni`/`maraqlanir`, bu susma üçün xatırlatma hələ yoxdur.
PRICE_AFTER = timedelta(hours=3)
WINDOW_MARGIN = timedelta(hours=1)
PRICE_RE = re.compile(r"\d\s*(azn|manat)", re.I)
REMIND = "xatırlatma"
PRICE_NOTE = ("\n\nXATIRLATMA: müştəriyə qiymət demisən, o, təxminən 3 saatdır cavab yazmır. Bir dəfə qısa, mehriban "
              "xatırlatma yaz: sualı varsa kömək edə biləcəyini və ya uyğun gün olsa saatı saxlaya biləcəyini de. "
              "Təzyiq, yeni qiymət, endirim, saxta təcililik yoxdur. 1–2 cümlə, handoff = false. Cavab formatı eyni JSON.")


def _daytime(t) -> bool:
    return 9 <= aware(t).astimezone(BAKU).hour < 21


def price_due(db: DB) -> list[WaConversation]:
    t = now()
    if not _daytime(t) or not conf.bot_enabled(db):
        return []
    convs = db.scalars(select(WaConversation).where(
        WaConversation.mode == "bot", WaConversation.lead_id.is_not(None),
        WaConversation.window_expires_at > t + WINDOW_MARGIN)).all()
    out = []
    for c in convs:
        lead, contact = db.get(Lead, c.lead_id), db.get(WaContact, c.contact_id)
        if not lead or lead.stage not in ("yeni", "maraqlanir") or contact.excluded:
            continue
        if contact.bot_muted_until and aware(contact.bot_muted_until) > t:
            continue
        last = chat.last_message(db, c.id)
        if (not last or last.direction != "out" or aware(last.created_at) > t - PRICE_AFTER
                or not PRICE_RE.search(last.text or "")):
            continue
        since = c.last_inbound_at or last.created_at
        if db.scalar(select(BotDraft.id).where(BotDraft.conversation_id == c.id, BotDraft.reason == REMIND,
                                               BotDraft.created_at > since).limit(1)):
            continue
        out.append(c)
    return out


def make_price_followup(db: DB, conv: WaConversation) -> BotDraft | None:
    lead = db.get(Lead, conv.lead_id)
    contents = bot.contents_from(bot._history(db, conv) + [("user", "(Müştəri bu mesajdan sonra cavab yazmayıb.)")])
    system = bot.build_system(db, now(), first_message=False, lead=lead) + PRICE_NOTE
    try:
        res, usage, problem = bot.converse(system, contents)
    except AiError:
        log.warning("xatırlatma üçün AI cavab vermədi (söhbət %s)", conv.id)
        return None
    ai.count_usage(db, "bot", *usage)
    if problem or not res["reply"]:
        return None
    draft = BotDraft(conversation_id=conv.id, text=res["reply"], reason=REMIND, model_output=res)
    db.add(draft)
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
    for conv in price_due(db):
        if make_price_followup(db, conv):
            n += 1
    try:
        if digest.due(db, now()):
            digest.send(db, now())
    except Exception:  # hesabat xətası dövrü dayandırmasın
        db.rollback()
        log.exception("gündəlik hesabat")
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
