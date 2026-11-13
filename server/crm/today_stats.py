"""«Bu gün» ekranının altlığı: bot özü apardı (01-bu-gun.md, 99 «Bu gün (01)»).
Tərif: bu gün (Asia/Baku, 00:00-dan) botun müştəriyə yazdığı (WhatsApp + Instagram DM, komment yox) və həmin gün
sahibkara ötürülməyən söhbətlərin sayı. Ötürmə = `conversation_events`-də bu gün `handoff` və ya rejimi `wait`/`owner`-a
keçirən `mode` sətri."""
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

from models import ConversationEvent, SocialItem, WaMessage
from views import baku_today, day_bounds

WA, IG = "wa", "ig"


def bot_handled_today(db: DB) -> int:
    start, end = day_bounds(baku_today())
    replied = {(WA, str(c)) for c in db.scalars(select(WaMessage.conversation_id).where(
        WaMessage.direction == "out", WaMessage.source == "bot",
        WaMessage.created_at >= start, WaMessage.created_at < end))}
    replied |= {(IG, t) for t in db.scalars(select(SocialItem.thread_id).where(
        SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.status == "sent",
        SocialItem.decided_at >= start, SocialItem.decided_at < end))}
    if not replied:
        return 0
    handed = set()
    for e in db.scalars(select(ConversationEvent).where(
            ConversationEvent.kind == "system", ConversationEvent.created_at >= start, ConversationEvent.created_at < end)):
        code = (e.meta or {}).get("code")
        if code == "handoff" or (code == "mode" and (e.meta or {}).get("mode") in ("wait", "owner", "human")):
            handed.add((e.channel, e.ref))
    return len(replied - handed)
