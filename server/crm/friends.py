"""Dostlar: sahibkarın şəxsi tanışları Y Pod nömrəsinə və ya Instagram-a yazır, bot onlara cavab yazmamalıdır.

Telegram düymələri (callback_data `f:{kanal}:{id}:{off|on}`):
- WhatsApp qaralamasında «🙅 Dostdur, bot yazmasın» → `WaContact.excluded = True`, gözləyən qaralamalar rədd olunur.
- Instagram DM qaralamasında eyni düymə → `ig_friend:<thread>` qeydi, gözləyən qaralamalar rədd olunur.
- «👤 Şəxsi kontakt» xəbərində «✅ Müştəridir, bot yazsın» → kontakt açılır, söhbət bota qayıdır.
- `/dostlar` — siyahı, hər biri üçün «✅ Bot yazsın».
"""
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

from crm import chat, conf
from crm.tg import _call
from crm.todo import _thread, is_owner
from db import now
from models import Setting, SocialItem, WaContact, WaConversation

LIST_MAX = 30


def _ig_key(thread: str) -> str:
    return f"ig_friend:{thread}"[:64]


def is_ig_friend(db: DB, thread: str) -> bool:
    return conf.get(db, _ig_key(thread)) == "1"


def wa_button(contact_id: int) -> dict:
    return {"text": "🙅 Dostdur, bot yazmasın", "callback_data": f"f:w:{contact_id}:off"}


def ig_button(thread: str) -> dict | None:
    data = f"f:i:{thread}:off"
    return {"text": "🙅 Dostdur, bot yazmasın", "callback_data": data} if len(data.encode()) <= 64 else None


def customer_button(contact_id: int) -> dict:
    return {"text": "✅ Müştəridir, bot yazsın", "callback_data": f"f:w:{contact_id}:on"}


def set_wa(db: DB, contact: WaContact, friend: bool) -> None:
    contact.excluded = friend
    for conv in db.scalars(select(WaConversation).where(WaConversation.contact_id == contact.id)).all():
        if friend:
            chat.reject_pending(db, conv.id, "dostdur, bot yazmır")
        elif conv.mode == "human":  # şəxsi kontakt kimi ötürülmüşdü: sahibkar «müştəridir» dedi
            conv.mode = "bot"


def set_ig(db: DB, thread: str, friend: bool) -> None:
    conf.put(db, _ig_key(thread), "1" if friend else "")
    if friend:
        for item in db.scalars(select(SocialItem).where(SocialItem.channel == "instagram", SocialItem.kind == "dm",
                                                        SocialItem.thread_id == thread,
                                                        SocialItem.status == "pending")).all():
            item.status, item.decided_at = "rejected", now()


def handle_callback(db: DB, cq: dict) -> str:
    """Qaytarır: ignored | friend | customer."""
    parts = str(cq.get("data", "")).split(":")
    if len(parts) != 4 or parts[1] not in ("w", "i") or parts[3] not in ("off", "on"):
        return "ignored"
    friend = parts[3] == "off"
    cq_id, msg = cq.get("id"), cq.get("message") or {}
    if parts[1] == "w":
        contact = db.get(WaContact, int(parts[2])) if parts[2].isdigit() else None
        if not contact:
            _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "Kontakt tapılmadı"})
            return "ignored"
        set_wa(db, contact, friend)
        who, back = contact.name or contact.phone or "kontakt", f"f:w:{contact.id}:{'on' if friend else 'off'}"
    else:
        set_ig(db, parts[2], friend)
        who, back = "Instagram yazışması", f"f:i:{parts[2]}:{'on' if friend else 'off'}"
    db.commit()
    done = f"🙅 {who}: bot yazmayacaq" if friend else f"✅ {who}: bot yazacaq"
    _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": done[:190]})
    if msg.get("message_id"):  # kart yerində qalır, düymə əksinə dəyişir (səhv basılsa geri qaytarmaq olsun)
        label = "✅ Bot yazsın" if friend else "🙅 Dostdur, bot yazmasın"
        _call("editMessageText", {"chat_id": msg["chat"]["id"], "message_id": msg["message_id"],
                                  "text": f"{done}\n\n{(msg.get('text') or '')[:3500]}",
                                  "reply_markup": {"inline_keyboard": [[{"text": label, "callback_data": back}]]}})
    return "friend" if friend else "customer"


def list_command(db: DB, msg: dict) -> str:
    """`/dostlar`: botun yazmadığı kontaktlar, hər birinə «✅ Bot yazsın». Qaytarır: not_owner | ok."""
    if not is_owner(msg):
        return "not_owner"
    rows = []
    for c in db.scalars(select(WaContact).where(WaContact.excluded.is_(True)).order_by(WaContact.id)).all():
        rows.append([{"text": f"✅ {c.name or c.phone or c.id} — bot yazsın", "callback_data": f"f:w:{c.id}:on"}])
    for s in db.scalars(select(Setting).where(Setting.key.like("ig_friend:%"), Setting.value == "1")).all():
        thread = s.key.split(":", 1)[1]
        rows.append([{"text": f"✅ Instagram {thread[-6:]} — bot yazsın", "callback_data": f"f:i:{thread}:on"}])
    text = (f"🙅 Bot yazmayan dostlar: {len(rows)}" + (f" (ilk {LIST_MAX})" if len(rows) > LIST_MAX else "")
            if rows else "🙅 Dost siyahısı boşdur. Qaralamadakı «🙅 Dostdur, bot yazmasın» düyməsi ilə əlavə olunur.")
    payload = {"chat_id": msg["chat"]["id"], **_thread(msg), "text": text}
    if rows:
        payload["reply_markup"] = {"inline_keyboard": rows[:LIST_MAX]}
    _call("sendMessage", payload)
    return "ok"
