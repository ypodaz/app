"""Bot ↔ sahibkar növbəsi: avtomatik cavab alan (yeni müştəri) WhatsApp söhbətlərində kim yazır.

Söhbətin vəziyyəti `WaConversation.mode`-dadır:
- `bot`   — bot özü cavab verir.
- `owner` — sahibkar telefondan və ya paneldən yazıb, söhbəti o aparır. Botun cavabı qaralamaya düşür.
            Gündüz (08:00–22:00) 1 saat ərzində qaralamaya toxunulmasa və sahibkar yazmasa, bot özü göndərir.
            Gecə bot öz başına qərar vermir: yalnız «asan» cavab (qiymət, ünvan, saat, nə daxildir) dərhal gedir,
            qalanı sahibkarı gözləyir; saat 12:00-da gecədən qalan qaralamalar xatırladılır.
- `wait`  — bot cavab verə bilmədiyi sualı komandaya ötürüb, sahibkarı gözləyir. Asan suala yenə cavab verir,
            qalanı qaralamadır (avtomatik getmir). 30 dəqiqədən sonra bir xatırlatma (gecə — səhər 08:00-da).
- `human` — xarici/şəxsi nömrə (route) və ya AI xətası: bot yazmır (köhnə qayda).
Keçidlər: sahibkar yazdı → owner; sahibkar qaralamanı təsdiqlədi → bot; handoff → wait.
Köhnə müştərilər (`new_auto`-da) bundan asılı deyil: onlara həmişə yalnız qaralama gedir.
"""
import asyncio
import logging
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

from crm import chat, conf, kapso, tg
import tgtopics
from db import SessionLocal, aware, now
from models import BotDraft, WaContact, WaConversation, WaMessage
from views import BAKU

log = logging.getLogger("crm-turns")
NIGHT_FROM, NIGHT_TO = 22, 8  # Bakı vaxtı
OWNER_WAIT = timedelta(hours=1)
WAIT_REMIND = timedelta(minutes=30)
NOON = 12
INTERVAL = 300
OWNER_SOURCES = ("phone", "panel")


def is_night(t: datetime) -> bool:
    h = aware(t).astimezone(BAKU).hour
    return h >= NIGHT_FROM or h < NIGHT_TO


def plan(conv: WaConversation, res: dict, t: datetime) -> tuple[bool, datetime | None]:
    """Avtomatik cavab alan söhbətdə botun cavabı: (dərhal göndərilsin?, qaralamanın avtomatik göndəriş vaxtı)."""
    if conv.mode == "owner":
        if is_night(t):
            return bool(res.get("asan")), None
        return False, t + OWNER_WAIT
    if conv.mode == "wait":
        return bool(res.get("asan")), None
    return True, None


def _clear_wait(db: DB, conv_id: int) -> None:
    conf.put(db, f"wait_since:{conv_id}", "")


def owner_wrote(db: DB, conv: WaConversation) -> None:
    """Sahibkar telefondan və ya paneldən yazdı: söhbəti o aparır, gözləyən qaralamalar köhnəlib."""
    if conv.mode != "human":
        conv.mode = "owner"
    _clear_wait(db, conv.id)
    chat.reject_pending(db, conv.id, "sahibkar özü yazdı")


def draft_approved(db: DB, conv: WaConversation) -> None:
    """Sahibkar qaralamanı təsdiqlədi: bot söhbəti yenidən özü aparır."""
    if conv.mode in ("owner", "wait"):
        conv.mode = "bot"
        _clear_wait(db, conv.id)


def to_wait(db: DB, conv: WaConversation, t: datetime) -> None:
    if conv.mode == "human":
        return
    if conv.mode != "wait" or not conf.get(db, f"wait_since:{conv.id}"):
        conf.put(db, f"wait_since:{conv.id}", aware(t).isoformat())
    conv.mode = "wait"


def _owner_since(db: DB, conv_id: int, since: datetime) -> bool:
    return bool(db.scalar(select(WaMessage.id).where(
        WaMessage.conversation_id == conv_id, WaMessage.source.in_(OWNER_SOURCES),
        WaMessage.created_at > since).limit(1)))


def _edit_card(draft: BotDraft, text: str) -> None:
    if draft.telegram_message_id and draft.telegram_chat_id:
        tg._call("editMessageText", {"chat_id": draft.telegram_chat_id, "message_id": int(draft.telegram_message_id),
                                     "text": text[:4000]})


def auto_send_due(db: DB, t: datetime) -> int:
    """Vaxtı çatan qaralamalar (gündüz, 1 saat toxunulmayıb) göndərilir. Gecəyə düşən: yalnız asan cavab."""
    n = 0
    drafts = db.scalars(select(BotDraft).where(BotDraft.status == "pending", BotDraft.auto_at.is_not(None),
                                               BotDraft.auto_at <= t).order_by(BotDraft.id)).all()
    for d in drafts:
        conv = db.get(WaConversation, d.conversation_id)
        asan = bool((d.model_output or {}).get("asan"))
        if (not conv or conv.mode not in ("owner", "wait") or _owner_since(db, conv.id, d.created_at)
                or (is_night(t) and not asan) or db.get(WaContact, conv.contact_id).excluded):
            d.auto_at = None  # sahibkarı gözləyir (gecə — 12:00 xatırlatmasına düşür)
            db.commit()
            continue
        try:
            chat.send_bot_reply(db, conv, d.text)
        except kapso.KapsoError as e:
            db.rollback()
            d = db.get(BotDraft, d.id)
            d.auto_at = None
            db.commit()
            log.warning("avtomatik qaralama getmədi (söhbət %s): %s", conv.id, e.message)
            continue
        d.status, d.decided_at, d.auto_at = "auto", t, None
        db.commit()
        _edit_card(d, f"⏱ 1 saat toxunulmadı, bot özü göndərdi\n\n{d.text[:3000]}")
        n += 1
    return n


def remind_waiting(db: DB, t: datetime) -> int:
    """`wait` söhbətində 30 dəqiqə cavab yoxdursa bir xatırlatma (gecə gözləyir, səhər 08:00-da gedir)."""
    if is_night(t):
        return 0
    n = 0
    for conv in db.scalars(select(WaConversation).where(WaConversation.mode == "wait")).all():
        since_s = conf.get(db, f"wait_since:{conv.id}") or ""
        if not since_s:
            conf.put(db, f"wait_since:{conv.id}", aware(t).isoformat())
            db.commit()
            continue
        since = datetime.fromisoformat(since_s)
        if t - since < WAIT_REMIND or conf.get(db, f"wait_rem:{conv.id}") == since_s:
            continue
        conf.put(db, f"wait_rem:{conv.id}", since_s)
        db.commit()
        contact = db.get(WaContact, conv.contact_id)
        last = chat.last_message(db, conv.id, "customer")
        mins = int((t - since).total_seconds() // 60)
        tg._call("sendMessage", {**tgtopics.dest("action"), "disable_web_page_preview": True,
                                 "text": f"⏳ Müştəri {mins} dəqiqədir cavab gözləyir (bot komandaya ötürüb)\n"
                                         f"{contact.name or 'Naməlum'} ({contact.phone or 'telefonsuz'})\n"
                                         f"Son mesaj: {(last.text if last else '-')[:500]}\n{chat.panel_link(conv.id)}"})
        n += 1
    return n


def noon_reminder(db: DB, t: datetime) -> int:
    """12:00-da bir dəfə: gecədən qalan, sahibkarı gözləyən qaralamaların siyahısı."""
    local = aware(t).astimezone(BAKU)
    if local.hour < NOON or conf.get(db, "turns_noon_last") == local.date().isoformat():
        return 0
    conf.put(db, "turns_noon_last", local.date().isoformat())
    db.commit()
    rows = db.execute(select(BotDraft, WaConversation).join(WaConversation, WaConversation.id == BotDraft.conversation_id)
                      .where(BotDraft.status == "pending", BotDraft.auto_at.is_(None),
                             WaConversation.mode.in_(("owner", "wait")), BotDraft.created_at <= t - OWNER_WAIT)
                      .order_by(BotDraft.id)).all()
    if not rows:
        return 0
    lines = [f"🌙 Gecədən qalan, sizi gözləyən qaralamalar: {len(rows)}"]
    for d, conv in rows[:15]:
        contact = db.get(WaContact, conv.contact_id)
        lines.append(f"• {contact.name or 'Naməlum'} ({contact.phone or '-'}): {d.text[:120]}")
    tg._call("sendMessage", {**tgtopics.dest("action"), "text": "\n".join(lines)[:4000]})
    return len(rows)


def waiting_lines(db: DB) -> list[str]:
    """Gündəlik hesabat üçün: komandaya ötürülüb cavab gözləyən söhbətlər."""
    out = []
    for conv in db.scalars(select(WaConversation).where(WaConversation.mode == "wait")).all():
        contact = db.get(WaContact, conv.contact_id)
        out.append(f"• {contact.name or 'Naməlum'} ({contact.phone or '-'}) {chat.panel_link(conv.id)}")
    return out


def tick() -> None:
    with SessionLocal() as db:
        t = now()
        for fn in (auto_send_due, remind_waiting, noon_reminder):
            try:
                fn(db, t)
            except Exception:  # biri o birini dayandırmasın
                db.rollback()
                log.exception("növbə dövrü: %s", fn.__name__)


async def loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:
            log.exception("növbə dövrü")
        await asyncio.sleep(INTERVAL)
