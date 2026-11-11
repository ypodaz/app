"""Telegram: qaralama düymələri (✅ Göndər / ✖️ Rədd) və callback emalı. Xəbərdarlıqlar üçün alerts.py var."""
import logging

import httpx
from sqlalchemy.orm import Session as DB

import settings
from crm import chat, kapso
from models import BotDraft, WaContact, WaConversation

log = logging.getLogger("tg")


def _call(method: str, payload: dict) -> dict | None:
    """Telegram Bot API; konfiqurasiya yoxdursa və ya xəta olsa None (heç vaxt xəta atmır)."""
    if not (settings.TG_BOT_TOKEN and settings.TG_CHAT_ID):
        return None
    try:
        r = httpx.post(f"https://api.telegram.org/bot{settings.TG_BOT_TOKEN}/{method}", json=payload, timeout=10)
        return r.json()
    except Exception:
        log.warning("telegram %s alınmadı", method)
        return None


def send_draft(db: DB, draft: BotDraft) -> str | None:
    """Qaralamanı düymələrlə TG_CHAT_ID-yə göndərir, telegram_message_id saxlayır (commit çağıran tərəfindədir)."""
    conv = db.get(WaConversation, draft.conversation_id)
    contact = db.get(WaContact, conv.contact_id)
    last = chat.last_message(db, conv.id, "customer")
    head = f"{contact.name or 'Naməlum'} ({contact.phone or 'telefonsuz'})"
    if draft.reason:
        head += f"\n[{draft.reason}]"
    text = f"💬 {head}\n\nMüştəri: {(last.text if last else '-')[:700]}\n\nQaralama:\n{draft.text[:2000]}"
    res = _call("sendMessage", {
        "chat_id": settings.TG_CHAT_ID, "text": text,
        "reply_markup": {"inline_keyboard": [[{"text": "✅ Göndər", "callback_data": f"d:{draft.id}:s"},
                                              {"text": "✖️ Rədd", "callback_data": f"d:{draft.id}:r"}]]}})
    mid = ((res or {}).get("result") or {}).get("message_id")
    if mid:
        draft.telegram_message_id = str(mid)
    return str(mid) if mid else None


def handle_callback(db: DB, cq: dict) -> str:
    """callback_query-ni icra edir. Qaytarır: ignored | sent | rejected | resolved | error."""
    msg = cq.get("message") or {}
    if str((msg.get("chat") or {}).get("id")) != str(settings.TG_CHAT_ID):
        return "ignored"
    parts = str(cq.get("data", "")).split(":")
    if len(parts) != 3 or parts[0] != "d" or parts[2] not in ("s", "r") or not parts[1].isdigit():
        return "ignored"
    cq_id, chat_id, message_id = cq.get("id"), msg["chat"]["id"], msg.get("message_id")
    draft = db.get(BotDraft, int(parts[1]))
    if not draft:
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "Qaralama tapılmadı"})
        return "ignored"
    try:
        chat.decide_draft(db, draft, "send" if parts[2] == "s" else "reject")
    except chat.AlreadyDecided:
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "artıq həll olunub"})
        return "resolved"
    except kapso.KapsoError as e:
        db.rollback()
        why = kapso.window_closed_text() if e.code == kapso.WINDOW_CLOSED else e.message
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": f"Göndərilmədi: {why}"[:190],
                                      "show_alert": True})
        _call("editMessageText", {"chat_id": chat_id, "message_id": message_id,
                                  "text": f"⚠️ Göndərilmədi: {why}\n\nQaralama:\n{draft.text[:3000]}",
                                  "reply_markup": {"inline_keyboard": [[
                                      {"text": "✖️ Rədd", "callback_data": f"d:{draft.id}:r"}]]}})
        return "error"
    db.commit()
    done = "✅ Göndərildi" if draft.status in ("sent", "edited") else "✖️ Rədd edildi"
    _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": done})
    _call("editMessageText", {"chat_id": chat_id, "message_id": message_id, "text": f"{done}\n\n{draft.text[:3000]}"})
    return "sent" if draft.status in ("sent", "edited") else "rejected"
