"""Instagram DM/komment və YouTube kommenti: AI qaralaması (WhatsApp botunun təlimatı + kanal qeydi) və göndəriş.

Müştəriyə heç nə avtomatik getmir: qaralama Telegram-a düymələrlə gedir (social_tg), göndəriş sahibkar təsdiqindən sonradır.
"""
import logging

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DB

import ai
import alerts
from ai import AiError
from crm import bot, instagram, social_tg, youtube
from db import SessionLocal, aware, now
from models import SocialItem

log = logging.getLogger("bot")
HISTORY = 10
DM_NOTE = ("\n\nKANAL: Bu, Instagram DM-dir, WhatsApp-dakı kimi cavab ver. Rezerv və qiymət detalları üçün müştərini "
           "WhatsApp-a dəvət edə bilərsən.")
COMMENT_NOTE = ("\n\nKANAL: Bu, {where} ictimai kommentdir. 1–2 qısa, isti cümlə yaz, qiymət yazma, ətraflı məlumat üçün "
                "DM-ə və ya WhatsApp-a dəvət et. Komment spam, təhqir və ya mənasızdırsa reply boş qaytar, handoff = true, "
                "handoff_reason = «diger». Lead sahələri null qalır.")
WHERE = {"instagram": "Instagram-da", "youtube": "YouTube-da"}


class WindowClosed(Exception):
    pass


SEND_ERRORS = (instagram.IgError, youtube.YtError, WindowClosed)


def add(db: DB, data: dict) -> SocialItem | None:
    """Yeni item yazır (flush); external_id artıq varsa (təkrar webhook) None."""
    if not data.get("external_id") or db.scalar(select(SocialItem.id).where(SocialItem.external_id == data["external_id"])):
        return None
    item = SocialItem(**{**data, "text": str(data.get("text") or "")[:4000]})
    try:
        with db.begin_nested():
            db.add(item)
            db.flush()
    except IntegrityError:  # eyni hadisə paralel gəldi
        return None
    return item


def _history(db: DB, item: SocialItem) -> list[tuple[str, str]]:
    """DM: thread-in son 10 item-i (müştəri mətni + göndərilmiş cavabımız). Komment: yalnız özü."""
    if item.kind != "dm":
        return [("user", item.text)]
    rows = db.scalars(select(SocialItem).where(SocialItem.channel == item.channel, SocialItem.kind == "dm",
                                               SocialItem.thread_id == item.thread_id, SocialItem.id <= item.id)
                      .order_by(SocialItem.id.desc()).limit(HISTORY)).all()
    out = []
    for r in reversed(rows):
        out.append(("user", r.text))
        if r.status == "sent" and r.draft_text:
            out.append(("model", r.draft_text))
    return out


def draft(item_id: int, avoid: str | None = None) -> str:
    """Fon işi: qaralama yazır və Telegram-a göndərir. Nəticə kodunu qaytarır; heç vaxt xəta atmır."""
    try:
        with SessionLocal() as db:
            item = db.get(SocialItem, item_id)
            outcome = _draft(db, item, avoid) if item else "skip:no_item"
            log.info("sosial item %s: %s", item_id, outcome)
            return outcome
    except Exception as e:
        log.exception("sosial qaralama xətası (item %s)", item_id)
        alerts.notify("social-crash", f"sosial qaralama xətası (item {item_id}): {type(e).__name__}: {str(e)[:200]}")
        return "error"


def _draft(db: DB, item: SocialItem, avoid: str | None) -> str:
    if item.status != "pending":
        return "skip:decided"
    if item.kind == "dm":
        newer = db.scalar(select(SocialItem.id).where(SocialItem.channel == item.channel, SocialItem.kind == "dm",
                                                      SocialItem.thread_id == item.thread_id,
                                                      SocialItem.id > item.id).limit(1))
        if newer:  # ardıcıl bir neçə mesaj: yalnız sonuncuya bütün kontekstlə cavab yazılır
            item.status, item.decided_at = "ignored", now()
            db.commit()
            return "skip:newer"
        first = not db.scalar(select(SocialItem.id).where(SocialItem.channel == item.channel, SocialItem.kind == "dm",
                                                          SocialItem.thread_id == item.thread_id,
                                                          SocialItem.status == "sent").limit(1))
        note = DM_NOTE
    else:
        first, note = False, COMMENT_NOTE.format(where=WHERE.get(item.channel, ""))
    system = bot.build_system(db, now(), first_message=first) + note
    if avoid:
        system += (f"\n\nSAHİBKAR ƏVVƏLKİ QARALAMANI BƏYƏNMƏDİ: «{avoid[:1500]}». Başqa cür yaz: fərqli başlanğıc və "
                   "ifadələr. Faktlar və qaydalar eyni qalır.")
    regen = (item.model_output or {}).get("regen", 0)
    try:
        res, usage, problem = bot.converse(system, bot.contents_from(_history(db, item)))
    except AiError as e:
        item.status, item.model_output, item.decided_at = "ignored", {"error": str(e)[:300], "regen": regen}, now()
        db.commit()
        alerts.notify(f"social-ai:{item.id}", f"AI cavab vermədi ({item.channel} {item.kind}), özünüz baxın: "
                                              f"{item.text[:300]}")
        return "ai_error"
    ai.count_usage(db, "bot", *usage)
    reply = "" if problem else res["reply"]
    item.model_output = {**res, "problem": problem, "regen": regen}
    if not reply:
        item.status, item.decided_at = "ignored", now()
        db.commit()
        if item.kind == "dm" or problem:  # DM cavabsız qalmasın; spam komment üçün xəbər getmir
            alerts.notify(f"social-empty:{item.id}", f"{social_tg.title(item)}: qaralama yazılmadı "
                                                     f"({problem or res.get('handoff_reason') or 'boş cavab'}), "
                                                     f"özünüz baxın: {item.text[:300]}")
        return "ignored"
    item.draft_text = reply
    db.commit()
    if item.kind == "dm":  # köhnə cavabsız qaralamalar artıq lazım deyil
        for old in db.scalars(select(SocialItem).where(SocialItem.channel == item.channel, SocialItem.kind == "dm",
                                                       SocialItem.thread_id == item.thread_id,
                                                       SocialItem.id < item.id, SocialItem.status == "pending")):
            old.status, old.decided_at = "ignored", now()
            social_tg.close(old, "⏭ Yeni mesaj gəldi, qaralama aşağıdadır")
    social_tg.send(item)
    db.commit()
    return "draft"


def send(db: DB, item: SocialItem) -> None:
    """Qaralamanı göndərir və statusu `sent` edir (commit çağıran tərəfindədir). SEND_ERRORS qalxa bilər."""
    text = item.draft_text or ""
    if item.channel == "instagram" and item.kind == "dm":
        last = db.scalar(select(SocialItem.created_at).where(
            SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.thread_id == item.thread_id)
            .order_by(SocialItem.created_at.desc()).limit(1))
        if not last or now() - aware(last) > instagram.WINDOW:
            raise WindowClosed("son müştəri mesajından 24 saat keçib, Instagram cavaba icazə vermir")
        instagram.send_dm(item.thread_id, text)
    elif item.channel == "instagram":
        instagram.reply_comment(item.parent_id or item.external_id, text)
    else:
        youtube.insert_reply(item.parent_id or item.external_id, text)
    item.status, item.decided_at = "sent", now()
