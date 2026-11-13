"""Telegram: qaralama düymələri (✅ Göndər / 🔄 Yenidən yaz / ✖️ Rədd) və callback emalı. Xəbərdarlıqlar üçün alerts.py var."""
import logging

import httpx
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import settings
import tgtopics
from crm import chat, kapso
from db import now
from models import BotDraft, WaContact, WaConversation

log = logging.getLogger("tg")

MAX_REGENERATE = 3  # bir müştəri mesajına ən çoxu neçə dəfə yenidən yazmaq olar (Gemini xərci)
REGEN_REASON = "yenidən yaz"


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


def friends_button(contact_id: int) -> dict:
    from crm import friends  # dövri import olmasın: friends tg-ni işlədir
    return friends.wa_button(contact_id)


def customer_button(contact_id: int) -> dict:
    from crm import friends
    return friends.customer_button(contact_id)


def send_draft(db: DB, draft: BotDraft) -> str | None:
    """Qaralamanı düymələrlə TG_CHAT_ID-yə göndərir, telegram_message_id saxlayır (commit çağıran tərəfindədir)."""
    conv = db.get(WaConversation, draft.conversation_id)
    contact = db.get(WaContact, conv.contact_id)
    last = chat.last_message(db, conv.id, "customer")
    head = f"{contact.name or 'Naməlum'} ({contact.phone or 'telefonsuz'})"
    card = (draft.model_output or {}).get("customer_short")
    if card:
        head += f"\n👤 {card}"
    if draft.reason:
        head += f"\n[{draft.reason}]"
    text = f"💬 {head}\n\nMüştəri: {(last.text if last else '-')[:700]}\n\nQaralama:\n{draft.text[:2000]}"
    if len(chat.split_reply(draft.text)) > 1:
        text += "\n\n✂️ 2 mesaj kimi gedəcək"  # müştəriyə getmir
    if draft.auto_at:
        text += "\n⏱ 1 saat ərzində toxunmasanız və yazmasanız, bot özü göndərəcək"
    elif conv.mode in ("owner", "wait") and draft.status == "pending":
        text += "\n🌙 Siz baxana qədər gözləyir" if conv.mode == "owner" else "\n⏳ Komandaya ötürülüb, sizin cavabınızı gözləyir"
    where = tgtopics.dest("action")
    res = _call("sendMessage", {
        **where, "text": text,
        "reply_markup": {"inline_keyboard": [[{"text": "✅ Göndər", "callback_data": f"d:{draft.id}:s"},
                                              {"text": "🔄 Yenidən yaz", "callback_data": f"d:{draft.id}:g"},
                                              {"text": "✖️ Rədd", "callback_data": f"d:{draft.id}:r"}],
                                             [friends_button(contact.id)]]}})
    mid = ((res or {}).get("result") or {}).get("message_id")
    if mid:
        draft.telegram_message_id, draft.telegram_chat_id = str(mid), str(where["chat_id"])
    return str(mid) if mid else None


def handle_callback(db: DB, cq: dict) -> str:
    """callback_query-ni icra edir. Qaytarır: ignored | sent | rejected | resolved | error | regenerate | limit.
    `regenerate`-də yeni cavabı çağıran (webhook) fon işi kimi işə salır (`bot.regenerate`)."""
    msg = cq.get("message") or {}
    if not tgtopics.chat_allowed((msg.get("chat") or {}).get("id")):
        return "ignored"
    if str(cq.get("data", "")).startswith("x:"):  # Instagram/YouTube qaralamaları
        from crm import social_tg
        return social_tg.handle_callback(db, cq)
    if str(cq.get("data", "")).startswith("m:"):  # montaj növbəsi: «✅ Təhvil verildi»
        from crm import aftercare
        return aftercare.handle_callback(db, cq)
    if str(cq.get("data", "")).startswith("f:"):  # dostlar: «🙅 Dostdur, bot yazmasın» / «✅ Bot yazsın»
        from crm import friends
        return friends.handle_callback(db, cq)
    if str(cq.get("data", "")).startswith("k:"):  # Apple təqvimi: kimdir / geri al / ləğv et
        from crm import calendar_sync
        return calendar_sync.handle_callback(db, cq)
    if str(cq.get("data", "")).startswith("t:"):  # to-do: «☑️ Bitdi»
        from crm import todo
        return todo.handle_callback(db, cq)
    parts = str(cq.get("data", "")).split(":")
    if len(parts) != 3 or parts[0] != "d" or parts[2] not in ("s", "r", "g") or not parts[1].isdigit():
        return "ignored"
    cq_id, chat_id, message_id = cq.get("id"), msg["chat"]["id"], msg.get("message_id")
    draft = db.get(BotDraft, int(parts[1]))
    if not draft:
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "Qaralama tapılmadı"})
        return "ignored"
    if parts[2] == "g":
        return _regenerate(db, draft, cq_id, chat_id, message_id)
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


LIMIT_TEXT = f"Bu mesaj üçün yenidən yazma limiti ({MAX_REGENERATE}) bitib. Paneldən özünüz yazın və ya göndərin."


def _start_regenerate(db: DB, draft: BotDraft) -> str:
    """Qaralamanı «yenidən yaz» səbəbi ilə rədd edir. Qaytarır: resolved | limit | regenerate."""
    if draft.status != "pending":
        return "resolved"
    last = chat.last_message(db, draft.conversation_id, "customer")
    since = last.created_at if last else draft.created_at
    used = db.scalar(select(func.count()).select_from(BotDraft).where(
        BotDraft.conversation_id == draft.conversation_id, BotDraft.reason == REGEN_REASON,
        BotDraft.created_at >= since))
    if used >= MAX_REGENERATE:
        return "limit"
    draft.status, draft.reason, draft.decided_at = "rejected", REGEN_REASON, now()
    db.commit()
    return "regenerate"


def _regenerate(db: DB, draft: BotDraft, cq_id, chat_id, message_id) -> str:
    result = _start_regenerate(db, draft)
    if result == "resolved":
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "artıq həll olunub"})
    elif result == "limit":
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "show_alert": True, "text": LIMIT_TEXT})
    else:
        _call("answerCallbackQuery", {"callback_query_id": cq_id, "text": "Yenidən yazılır…"})
        _call("editMessageText", {"chat_id": chat_id, "message_id": message_id,
                                  "text": f"🔄 Yenidən yazılır…\n\n{draft.text[:3000]}"})
    return result


def handle_reply(db: DB, msg: dict) -> tuple[str, int | None]:
    """Sahibkar qaralama mesajına cavab olaraq göstəriş yazır («qısa yaz»). Qaytarır: (nəticə, draft_id).
    Nəticə: ignored | resolved | limit | regenerate. `regenerate`-də yeni qaralamanı çağıran fonda yazdırır."""
    chat_id = (msg.get("chat") or {}).get("id")
    if not tgtopics.chat_allowed(chat_id):
        return "ignored", None
    text = (msg.get("text") or "").strip()
    replied = msg.get("reply_to_message") or {}
    reply_to = replied.get("message_id")
    if not text or not reply_to:
        return "ignored", None
    # mövzuda adi mesajın reply_to_message-i mövzunun açılış mesajıdır: bu, qaralamaya cavab deyil
    if replied.get("forum_topic_created") or (msg.get("message_thread_id") and reply_to == msg["message_thread_id"]):
        return "ignored", None
    same_chat = BotDraft.telegram_chat_id == str(chat_id)
    if str(chat_id) == str(settings.TG_CHAT_ID):  # chat_id-si olmayan köhnə sətirlər şəxsi çatdadır
        same_chat = same_chat | BotDraft.telegram_chat_id.is_(None)
    draft = db.scalar(select(BotDraft).where(BotDraft.telegram_message_id == str(reply_to), same_chat)
                      .order_by(BotDraft.id.desc()))
    if not draft:
        return "ignored", None
    result = _start_regenerate(db, draft)
    if result == "regenerate":
        _call("editMessageText", {"chat_id": chat_id, "message_id": reply_to,
                                  "text": f"🔄 Göstərişlə yenidən yazılır: «{text[:300]}»\n\n{draft.text[:3000]}"})
    else:
        thread = {"message_thread_id": msg["message_thread_id"]} if msg.get("message_thread_id") else {}
        _call("sendMessage", {"chat_id": chat_id, **thread, "reply_to_message_id": msg.get("message_id"),
                              "text": "Bu qaralama artıq həll olunub." if result == "resolved" else LIMIT_TEXT})
    return result, draft.id


def auto_log(db: DB, conv: WaConversation, text: str) -> None:
    """WhatsApp-da botun təsdiqsiz göndərdiyi cavab: «🤖 Bot özü cavabladı» mövzusuna düyməsiz qeyd.
    Yalnız mövzu qrupu qurulubsa (əks halda şəxsi çat hər cavabla dolardı)."""
    if not tgtopics.has_group():
        return
    contact = db.get(WaContact, conv.contact_id)
    last = chat.last_message(db, conv.id, "customer")
    _call("sendMessage", {**tgtopics.dest("auto"), "disable_web_page_preview": True,
                          "text": (f"🤖 WhatsApp: {contact.name or 'Naməlum'} ({contact.phone or 'telefonsuz'})\n\n"
                                   f"Müştəri: {(last.text if last else '-')[:700]}\n\nBot: {text[:2500]}")})
