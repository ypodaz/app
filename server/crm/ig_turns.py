"""Instagram DM üçün bot ↔ sahibkar növbəsi: WhatsApp ilə eyni qaydalar (izah və sabitlər `crm/turns.py`-dədir).

Rejim `social_inbox.ig_mode`-dadır (`bot` | `owner` | `wait`), qaralamanın taymeri `SocialItem.auto_at`-dadır.
Burada yalnız fon dövrləri var: 1 saatdan sonra qaralamanı göndərmək, `wait` xatırlatması, 12:00 siyahısı.
Komment və YouTube bundan asılı deyil. Dövrləri `turns.tick` işə salır.
"""
import logging
from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import tgtopics
from crm import conf, events, friends, social_inbox, social_tg, tg, turns
from db import aware
from models import Setting, SocialItem
from views import BAKU

log = logging.getLogger("crm-turns")


def _who(db: DB, thread: str) -> str:
    author = db.scalar(select(SocialItem.author).where(
        SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.thread_id == thread,
        SocialItem.author != "").order_by(SocialItem.id.desc()).limit(1))
    return f"@{author}" if author else f"IGSID {thread}"


def auto_send_due(db: DB, t: datetime) -> int:
    """Vaxtı çatan DM qaralamaları (gündüz, 1 saat toxunulmayıb) göndərilir. Gecəyə düşən: yalnız asan cavab."""
    n = 0
    items = db.scalars(select(SocialItem).where(
        SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.status == "pending",
        SocialItem.auto_at.is_not(None), SocialItem.auto_at <= t).order_by(SocialItem.id)).all()
    for item in items:
        asan = bool((item.model_output or {}).get("asan"))
        if (social_inbox.ig_mode(db, item.thread_id) not in ("owner", "wait")
                or social_inbox.owner_since(db, item.thread_id, item.created_at)
                or (turns.is_night(t) and not asan) or friends.is_ig_friend(db, item.thread_id)):
            item.auto_at = None  # sahibkarı gözləyir (gecə — 12:00 xatırlatmasına düşür)
            db.commit()
            continue
        try:
            social_inbox.send(db, item)
        except social_inbox.SEND_ERRORS as e:
            db.rollback()
            item = db.get(SocialItem, item.id)
            item.auto_at = None
            db.commit()
            log.warning("avtomatik DM qaralaması getmədi (item %s): %s", item.id, e)
            continue
        item.auto_at = None
        events.auto_sent(db, events.IG, item.thread_id)
        db.commit()
        social_tg.close(item, "⏱ 1 saat toxunulmadı, bot özü göndərdi")
        n += 1
    return n


def remind_waiting(db: DB, t: datetime) -> int:
    """`wait` söhbətində 30 dəqiqə cavab yoxdursa bir xatırlatma (gecə gözləyir, səhər 08:00-da gedir)."""
    if turns.is_night(t):
        return 0
    n = 0
    rows = db.scalars(select(Setting).where(Setting.key.like("ig_mode:%"), Setting.value == "wait")).all()
    for row in rows:
        thread = row.key[len("ig_mode:"):]
        wkey, rkey = f"ig_wait:{thread}"[:64], f"ig_wait_rem:{thread}"[:64]
        since_s = conf.get(db, wkey) or ""
        if not since_s:
            conf.put(db, wkey, aware(t).isoformat())
            db.commit()
            continue
        since = datetime.fromisoformat(since_s)
        if t - since < turns.WAIT_REMIND or conf.get(db, rkey) == since_s:
            continue
        conf.put(db, rkey, since_s)
        db.commit()
        last = db.scalar(select(SocialItem.text).where(
            SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.thread_id == thread)
            .order_by(SocialItem.id.desc()).limit(1))
        mins = int((t - since).total_seconds() // 60)
        events.reminded(db, events.IG, thread, mins)
        db.commit()
        tg._call("sendMessage", {**tgtopics.dest("action"), "disable_web_page_preview": True,
                                 "text": f"⏳ Instagram müştərisi {mins} dəqiqədir cavab gözləyir (bot komandaya ötürüb)\n"
                                         f"{_who(db, thread)}\nSon mesaj: {(last or '-')[:500]}"})
        n += 1
    return n


def noon_reminder(db: DB, t: datetime) -> int:
    """12:00-da bir dəfə: gecədən qalan, sahibkarı gözləyən Instagram DM qaralamalarının siyahısı."""
    local = aware(t).astimezone(BAKU)
    if local.hour < turns.NOON or conf.get(db, "ig_turns_noon_last") == local.date().isoformat():
        return 0
    conf.put(db, "ig_turns_noon_last", local.date().isoformat())
    db.commit()
    rows = [it for it in db.scalars(select(SocialItem).where(
        SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.status == "pending",
        SocialItem.auto_at.is_(None), SocialItem.created_at <= t - turns.OWNER_WAIT).order_by(SocialItem.id))
        if social_inbox.ig_mode(db, it.thread_id) in ("owner", "wait")]
    if not rows:
        return 0
    lines = [f"🌙 Gecədən qalan, sizi gözləyən Instagram qaralamaları: {len(rows)}"]
    for it in rows[:15]:
        lines.append(f"• {_who(db, it.thread_id)}: {(it.draft_text or '')[:120]}")
    tg._call("sendMessage", {**tgtopics.dest("action"), "text": "\n".join(lines)[:4000]})
    return len(rows)
