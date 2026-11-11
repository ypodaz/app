"""Gündəlik Telegram hesabatı: Bakı vaxtı 21:00-dan sonra gündə bir dəfə, sahibkara bot fəaliyyətinin xülasəsi."""
from collections import Counter
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import settings
from crm import conf, tg
from db import aware
from models import BotDraft, LeadEvent, WaConversation, WaMessage
from views import BAKU

HOUR = 21
SAMPLES = 3
STATUSES = (("sent", "göndərildi"), ("edited", "dəyişdirilib göndərildi"), ("rejected", "rədd"),
            ("pending", "gözləyir"))


def _in(col, since, until):
    return (col >= since, col < until)


def build(db: DB, since: datetime, until: datetime) -> str | None:
    convs = db.scalar(select(func.count()).select_from(WaConversation).where(
        *_in(WaConversation.created_at, since, until)))
    msgs = db.scalar(select(func.count()).select_from(WaMessage).where(
        WaMessage.direction == "in", WaMessage.source == "customer", *_in(WaMessage.created_at, since, until)))
    drafts = db.scalars(select(BotDraft).where(*_in(BotDraft.created_at, since, until)).order_by(BotDraft.id)).all()
    if not (convs or msgs or drafts):
        return None
    lines = [f"📊 Bot hesabatı, {aware(until).astimezone(BAKU):%d.%m}", "",
             f"Yeni söhbət: {convs}", f"Müştəridən mesaj: {msgs}"]
    if drafts:
        by = Counter(d.status for d in drafts)
        lines.append(f"Bot qaralamaları: {len(drafts)} (" + ", ".join(
            f"{label} {by[st]}" for st, label in STATUSES if by[st]) + ")")
        handoff = Counter(d.reason[8:] for d in drafts if (d.reason or "").startswith("handoff:"))
        if handoff:
            lines.append(f"Komandaya ötürülüb: {sum(handoff.values())} (" + ", ".join(
                f"{k} {v}" for k, v in handoff.most_common()) + ")")
        other = Counter(d.reason for d in drafts if d.reason in ("follow-up", "xatırlatma", tg.REGEN_REASON))
        if other:
            lines.append("Digər: " + ", ".join(f"{k} {v}" for k, v in other.items()))
    stages = Counter((e.data or {}).get("to") for e in db.scalars(select(LeadEvent).where(
        LeadEvent.kind == "stage", *_in(LeadEvent.created_at, since, until))))
    stages.pop(None, None)
    if stages:
        lines.append("Mərhələ irəliləyişi: " + ", ".join(f"{k} {v}" for k, v in stages.most_common()))
    edited = [d for d in drafts if d.status == "edited" and (d.model_output or {}).get("reply")]
    if edited:
        lines += ["", "Düzəlişlər:"]
        lines += [f"Bot: {d.model_output['reply'][:160]} → Siz: {d.text[:160]}" for d in edited[:SAMPLES]]
    return "\n".join(lines)


def due(db: DB, t: datetime) -> bool:
    local = aware(t).astimezone(BAKU)
    return (local.hour >= HOUR and conf.get(db, "digest_last") != local.date().isoformat()
            and (conf.get(db, "digest_enabled", "true") or "").strip().lower() != "false")


def send(db: DB, t: datetime) -> bool:
    local = aware(t).astimezone(BAKU)
    text = build(db, local.replace(hour=0, minute=0, second=0, microsecond=0), t)
    if text:
        tg._call("sendMessage", {"chat_id": settings.TG_CHAT_ID, "text": text})
    conf.put(db, "digest_last", local.date().isoformat())  # fəaliyyət olmasa da: saatda bir yoxlanmasın
    db.commit()
    return bool(text)
