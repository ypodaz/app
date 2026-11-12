"""Telegram: Instagram/YouTube qaralamaları (✅ Göndər / 🔄 Yenidən yaz / ✖️ Rədd), callback_data `x:{id}:s|g|r`."""
import threading

import settings
from crm.tg import MAX_REGENERATE, _call
from db import now
from models import SocialItem

TITLES = {("instagram", "dm"): "📸 Instagram DM", ("instagram", "comment"): "📸 Instagram komment",
          ("youtube", "comment"): "▶️ YouTube komment"}


def title(item: SocialItem) -> str:
    return TITLES.get((item.channel, item.kind), f"{item.channel} {item.kind}")


def _body(item: SocialItem) -> str:
    who = item.author or (f"IGSID {item.thread_id}" if item.kind == "dm" else "naməlum")
    label = "Cavab" if item.status == "sent" else "Qaralama"
    return f"{title(item)}\n{who}\n\nMüştəri: {item.text[:700]}\n\n{label}:\n{(item.draft_text or '')[:2000]}"


def _buttons(item: SocialItem) -> dict:
    return {"inline_keyboard": [[{"text": "✅ Göndər", "callback_data": f"x:{item.id}:s"},
                                 {"text": "🔄 Yenidən yaz", "callback_data": f"x:{item.id}:g"},
                                 {"text": "✖️ Rədd", "callback_data": f"x:{item.id}:r"}]]}


def send(item: SocialItem) -> str | None:
    """Qaralamanı düymələrlə göndərir, tg_message_id saxlayır (commit çağıran tərəfindədir)."""
    res = _call("sendMessage", {"chat_id": settings.TG_CHAT_ID, "text": _body(item), "reply_markup": _buttons(item)})
    mid = ((res or {}).get("result") or {}).get("message_id")
    if mid:
        item.tg_message_id = str(mid)
    return str(mid) if mid else None


def auto_log(item: SocialItem, head: str = "🤖 Avtomatik cavab getdi") -> None:
    """Avtomatik göndərilən cavab: düyməsiz qeyd (sahibkar nə yazıldığını görsün)."""
    _call("sendMessage", {"chat_id": settings.TG_CHAT_ID, "text": f"{head}\n\n{_body(item)}"[:4000]})


def lead_card(text: str, wa_url: str) -> None:
    """Instagram-dan nömrə gələndə: müştəri kartı + WhatsApp-dan yazmaq üçün hazır link."""
    _call("sendMessage", {"chat_id": settings.TG_CHAT_ID, "text": text[:4000], "disable_web_page_preview": True,
                          "reply_markup": {"inline_keyboard": [[{"text": "💬 WhatsApp-dan yaz", "url": wa_url}]]}})


def close(item: SocialItem, head: str) -> None:
    """Köhnə Telegram mesajını düyməsiz yeniləyir."""
    if item.tg_message_id:
        _call("editMessageText", {"chat_id": settings.TG_CHAT_ID, "message_id": int(item.tg_message_id),
                                  "text": f"{head}\n\n{_body(item)}"[:4000]})


def _background(fn, *args) -> None:  # testlərdə sinxron əvəz olunur
    threading.Thread(target=fn, args=args, daemon=True).start()


def handle_callback(db, cq: dict) -> str:
    """Qaytarır: ignored | resolved | sent | rejected | error | limit | social_regenerate (yeni qaralama fonda yazılır).
    `regenerate` qaytarmırıq: onu webhook WhatsApp qaralaması kimi başa düşərdi."""
    from crm import social_inbox  # dövri import olmasın

    parts = str(cq.get("data", "")).split(":")
    if len(parts) != 3 or parts[2] not in ("s", "r", "g") or not parts[1].isdigit():
        return "ignored"
    cq_id = cq.get("id")
    msg = cq.get("message") or {}
    chat_id, message_id = (msg.get("chat") or {}).get("id"), msg.get("message_id")
    item = db.get(SocialItem, int(parts[1]))
    if not item:
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "Qaralama tapılmadı"})
        return "ignored"
    if item.status != "pending":
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "artıq həll olunub"})
        return "resolved"
    action = parts[2]
    if action == "r":
        item.status, item.decided_at = "rejected", now()
        db.commit()
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "✖️ Rədd edildi"})
        _call("editMessageText", {"chat_id": chat_id, "message_id": message_id, "text": f"✖️ Rədd edildi\n\n{_body(item)}"})
        return "rejected"
    if action == "g":
        regen = (item.model_output or {}).get("regen", 0)
        if regen >= MAX_REGENERATE:
            _call("answerCallbackQuery", {"callback_query_id": cq_id, "show_alert": True,
                                          "text": f"Yenidən yazma limiti ({MAX_REGENERATE}) bitib."})
            return "limit"
        item.model_output = {**(item.model_output or {}), "regen": regen + 1}
        db.commit()
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "Yenidən yazılır…"})
        _call("editMessageText", {"chat_id": chat_id, "message_id": message_id, "text": f"🔄 Yenidən yazılır…\n\n{_body(item)}"})
        _background(social_inbox.draft, item.id, item.draft_text)
        return "social_regenerate"
    try:
        social_inbox.send(db, item)
    except social_inbox.SEND_ERRORS as e:
        db.rollback()
        why = str(e)[:300]
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": f"Göndərilmədi: {why}"[:190], "show_alert": True})
        _call("editMessageText", {"chat_id": chat_id, "message_id": message_id,
                                  "text": f"⚠️ Göndərilmədi: {why}\n\n{_body(item)}",
                                  "reply_markup": {"inline_keyboard": [[
                                      {"text": "✖️ Rədd", "callback_data": f"x:{item.id}:r"}]]}})
        return "error"
    db.commit()
    _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "✅ Göndərildi"})
    _call("editMessageText", {"chat_id": chat_id, "message_id": message_id, "text": f"✅ Göndərildi\n\n{_body(item)}"})
    return "sent"
