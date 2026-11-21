"""Telegram «✍️ Cavabımı yaz»: sahibkarın cavabını gözləyən xəbərdəki düymə (callback `o:w:{wa|ig}:{ref}`) → «bu mesaja reply
yazın» (force_reply) → sahibkarın xam cavabı (mətn və ya səs) → AI səliqəyə salır → kart (`o:{id}:b|h|g|r|x`) → göndəriş.
- `b` göndər, AI davam etsin (söhbət bot rejimində); `h` göndər, AI sussun (WA: `human`; IG: `friends.set_ig` — «dost» qeydi,
  `/dostlar`-dan geri qaytarılır, IG-də başqa susdurma mexanizmi yoxdur); `r` xam mətni göndər (rejim paneldəki kimi: `owner`).
- WA-da göndəriş panel ilə eynidir (`chat.send_out(..., "panel")` + `turns.owner_wrote`), IG-də `instagram.send_dm`.
- Karta reply yazmaq = yeni göstərişlə yenidən (🔄 kimi, ümumi limit `tg.MAX_REGENERATE`).
Callback data ≤ 64 bayt: IG thread uzundursa `o:w:ig:i{SocialItem.id}`. Webhook: `routes/webhooks.py`.
"""
import json
import logging

from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session as DB

import ai
import alerts
import settings
import tgtopics
from crm import chat, events, kapso, tg, voice
from db import SessionLocal, aware, now
from models import Lead, OwnerReply, SocialItem, WaContact, WaConversation

log = logging.getLogger("owner-reply")

LABEL = "✍️ Cavabımı yaz"
OWNER_NOTE = ("\n\nİNDİ MÜŞTƏRİYƏ CAVAB YAZMIRSAN. Söhbətin sonunda «SAHİBKARIN XAM CAVABI» var: bu, sahibkarın müştəriyə xam "
              "cavabıdır. Müştəriyə gedəcək səliqəli mesaja çevir: müştərinin dilində, Y Pod tonu, qısa; mənanı və rəqəmləri "
              "dəyişmə, yeni fakt, qiymət və ya vəd əlavə etmə; sahibkarın qiyməti yuxarıdakından fərqlidirsə sahibkarınkını "
              "saxla. Yuxarıdakı JSON sxemini istifadə etmə, yalnız bu formatda qaytar: {\"reply\": \"...\"}")
SENT_LABEL = {"b": "AI davam edir", "h": "AI susur", "r": "xam mətn"}


def _dm_items(thread: str):
    return select(SocialItem).where(SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.thread_id == thread)


def button(db: DB, channel: str, ref, label: str = LABEL) -> dict:
    """«✍️ Cavabımı yaz» düyməsi. Uzun IG thread_id üçün qısa açar (`i{SocialItem.id}`)."""
    data = f"o:w:{channel}:{ref}"
    if len(data.encode()) > 64:
        item_id = db.scalar(_dm_items(str(ref)).with_only_columns(SocialItem.id).order_by(SocialItem.id.desc()).limit(1))
        data = f"o:w:ig:i{item_id}"
    return {"text": label, "callback_data": data}


def markup(db: DB, channel: str, ref) -> dict:
    return {"inline_keyboard": [[button(db, channel, ref)]]}


def _answer(cq: dict, text: str, alert: bool = False) -> None:
    tg._call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": text[:190], "show_alert": alert})


def _edit(chat_id, message_id, text: str, reply_markup: dict | None = None) -> None:
    if chat_id and message_id:
        tg._call("editMessageText", {"chat_id": chat_id, "message_id": int(message_id), "text": text[:4000],
                                     **({"reply_markup": reply_markup} if reply_markup else {})})


def _resolve(db: DB, channel: str, key: str) -> tuple[str, str] | None:
    """(ref, ad) və ya None (söhbət tapılmadı)."""
    if channel == "wa":
        conv = db.get(WaConversation, int(key)) if key.isdigit() else None
        if not conv:
            return None
        contact = db.get(WaContact, conv.contact_id)
        return str(conv.id), contact.name or contact.phone or "Naməlum"
    if key[:1] == "i" and key[1:].isdigit():  # uzun thread üçün qısa açar
        item = db.get(SocialItem, int(key[1:]))
        key = item.thread_id if item else ""
    item = db.scalar(_dm_items(key).order_by(SocialItem.id.desc()).limit(1)) if key else None
    if not item:
        return None
    author = db.scalar(_dm_items(key).where(SocialItem.author != "").with_only_columns(SocialItem.author)
                       .order_by(SocialItem.id.desc()).limit(1))
    return key, f"@{author}" if author else "Instagram"


def _card_buttons(rec: OwnerReply) -> dict:
    return {"inline_keyboard": [[{"text": "✅ Göndər · AI davam etsin", "callback_data": f"o:{rec.id}:b"}],
                                [{"text": "✅ Göndər · AI sussun", "callback_data": f"o:{rec.id}:h"}],
                                [{"text": "🔄 Yenidən", "callback_data": f"o:{rec.id}:g"},
                                 {"text": "📝 Xam mətni göndər", "callback_data": f"o:{rec.id}:r"}],
                                [{"text": "✖️ Ləğv", "callback_data": f"o:{rec.id}:x"}]]}


def _open(db: DB, cq: dict, channel: str, key: str) -> str:
    found = _resolve(db, channel, key)
    if not found:
        _answer(cq, "Söhbət tapılmadı")
        return "ignored"
    ref, name = found
    for old in db.scalars(select(OwnerReply).where(OwnerReply.channel == channel, OwnerReply.ref == ref,
                                                   OwnerReply.status.in_(("await", "ready")))):
        old.status = "cancelled"
    rec = OwnerReply(channel=channel, ref=ref, name=name[:120], status="await")
    db.add(rec)
    where = tgtopics.dest("action")
    res = tg._call("sendMessage", {**where, "reply_markup": {"force_reply": True},
                                   "text": f"✍️ {name} üçün cavabınızı bu mesaja reply kimi yazın "
                                           "(xam yaza bilərsiniz, səliqəyə salıb sizə göstərəcəm)"})
    mid = ((res or {}).get("result") or {}).get("message_id")
    if mid:
        rec.prompt_message_id, rec.tg_chat_id = str(mid), str(where["chat_id"])
    db.commit()
    _answer(cq, "Cavabınızı reply yazın")
    return "prompt"


def handle_callback(db: DB, cq: dict) -> str:
    """`o:w:{ch}:{ref}` (✍️ Cavabımı yaz) və `o:{id}:b|h|g|r|x`. Qaytarır: ignored | prompt | resolved | sent | cancelled |
    error | limit | owner_compose (yeni variantı webhook fonda yazdırır: `process`)."""
    parts = str(cq.get("data", "")).split(":")
    if len(parts) == 4 and parts[:2] == ["o", "w"] and parts[2] in ("wa", "ig"):
        return _open(db, cq, parts[2], parts[3])
    if len(parts) != 3 or parts[0] != "o" or not parts[1].isdigit() or parts[2] not in ("b", "h", "g", "r", "x"):
        return "ignored"
    msg = cq.get("message") or {}
    chat_id, message_id = (msg.get("chat") or {}).get("id"), msg.get("message_id")
    rec = db.get(OwnerReply, int(parts[1]))
    if not rec:
        _answer(cq, "Cavab tapılmadı")
        return "ignored"
    action = parts[2]
    if rec.status not in ("await", "ready") or (action != "x" and rec.status != "ready"):
        _answer(cq, "artıq həll olunub")
        return "resolved"
    if action == "x":
        rec.status = "cancelled"
        db.commit()
        _edit(chat_id, message_id, "✖️ Ləğv edildi")
        _answer(cq, "Ləğv edildi")
        return "cancelled"
    if action == "g":
        if rec.regen_count >= tg.MAX_REGENERATE:
            _answer(cq, tg.LIMIT_TEXT, alert=True)
            return "limit"
        _answer(cq, "Yenidən yazılır…")
        return "owner_compose"
    return _deliver(db, cq, rec, action, chat_id, message_id)


def _send_wa(db: DB, rec: OwnerReply, text: str, mode: str) -> None:
    """Paneldəki kimi (`inbox/{id}/send`): source «panel» + `turns.owner_wrote`; sonra seçilən rejim."""
    from crm import turns

    conv = db.get(WaConversation, int(rec.ref))
    chat.send_out(db, conv, text, "panel")
    turns.owner_wrote(db, conv)  # gözləyən qaralamalar rədd, wait açarı təmizlənir, rejim owner
    target = {"b": "bot", "h": "human"}.get(mode)
    if target and conv.mode != target:
        events.mode_changed(db, events.WA, conv.id, conv.mode, target)
        conv.mode = target


def _send_ig(db: DB, rec: OwnerReply, text: str, mode: str) -> None:
    from crm import friends, instagram, social_inbox, social_tg

    thread = rec.ref
    last = db.scalar(_dm_items(thread).with_only_columns(SocialItem.created_at).order_by(SocialItem.created_at.desc()).limit(1))
    if not last or now() - aware(last) > instagram.WINDOW:
        raise social_inbox.WindowClosed("son müştəri mesajından 24 saat keçib, Instagram cavaba icazə vermir")
    mid = instagram.send_dm(thread, text)
    if mid:
        social_inbox._sent_mids.append(mid)  # echo-su «sahibkar yazdı» sayılmasın
    social_inbox.owner_wrote(db, thread)
    for item in db.scalars(_dm_items(thread).where(SocialItem.status == "pending")):
        item.status, item.auto_at, item.decided_at = "rejected", None, now()
        social_tg.close(item, "✍️ Siz özünüz yazdınız (Telegram)")
    if mode == "b":
        social_inbox.draft_approved(db, thread)
    elif mode == "h":
        friends.set_ig(db, thread, True)


def _deliver(db: DB, cq: dict, rec: OwnerReply, mode: str, chat_id, message_id) -> str:
    from crm import social_inbox

    text = rec.raw if mode == "r" else rec.text
    try:
        (_send_wa if rec.channel == "wa" else _send_ig)(db, rec, text, mode)
    except (kapso.KapsoError, *social_inbox.SEND_ERRORS) as e:
        db.rollback()
        why = kapso.window_closed_text() if getattr(e, "code", None) == kapso.WINDOW_CLOSED else (getattr(e, "message", None) or str(e))
        _answer(cq, f"Göndərilmədi: {why}", alert=True)
        _edit(chat_id, message_id, f"⚠️ Göndərilmədi: {why}\n\n{text[:3000]}",
              {"inline_keyboard": [[{"text": "✖️ Ləğv", "callback_data": f"o:{rec.id}:x"}]]})
        return "error"
    rec.status = "sent"
    events.system(db, rec.channel, rec.ref, "owner_reply", f"Cavab Telegram-dan göndərildi · {SENT_LABEL[mode]}", mode=mode)
    db.commit()
    _edit(chat_id, message_id, f"✅ Göndərildi ({SENT_LABEL[mode]})\n\n{text[:3000]}")
    _answer(cq, "✅ Göndərildi")
    return "sent"


# --- sahibkarın reply-ı ---

def handle_reply(db: DB, msg: dict) -> tuple[str, int] | None:
    """Sahibkar «bu mesaja reply yazın» sorğusuna (xam cavab) və ya səliqəli variant kartına (yeni göstəriş) cavab yazdı.
    None: bu bizim mesaj deyil (adi qaralama məntiqinə keçir). Qaytarır: (compose | limit, id); `compose`-də webhook fonda
    `process(id, mətn, səs_file_id)` çağırır."""
    chat_id = (msg.get("chat") or {}).get("id")
    reply_to = (msg.get("reply_to_message") or {}).get("message_id")
    if not tgtopics.chat_allowed(chat_id) or not reply_to:
        return None
    if not ((msg.get("text") or "").strip() or (msg.get("voice") or msg.get("audio"))):
        return None
    mid = str(reply_to)
    rec = db.scalar(select(OwnerReply).where(
        OwnerReply.tg_chat_id == str(chat_id),
        or_(and_(OwnerReply.status == "await", OwnerReply.prompt_message_id == mid),
            and_(OwnerReply.status == "ready", OwnerReply.tg_message_id == mid))).order_by(OwnerReply.id.desc()))
    if not rec:
        return None
    if rec.status == "ready" and rec.regen_count >= tg.MAX_REGENERATE:
        tg._call("sendMessage", {**tgtopics.dest("action"), "text": tg.LIMIT_TEXT})
        return "limit", rec.id
    return "compose", rec.id


def _transcribe(db: DB, file_id: str) -> str:
    """Telegram səsli mesajı → mətn (Gemini, `voice.text_from_url`); alınmasa ""."""
    path = (((tg._call("getFile", {"file_id": file_id}) or {}).get("result")) or {}).get("file_path")
    if not path:
        return ""
    return voice.text_from_url(db, f"https://api.telegram.org/file/bot{settings.TG_BOT_TOKEN}/{path}")


def process(rec_id: int, text: str | None = None, file_id: str | None = None) -> str:
    """Fon işi: xam cavabı (və ya yeni göstərişi; mətn yoxdursa sadəcə yenidən) səliqəyə salıb kartı göstərir. Xəta atmır."""
    try:
        with SessionLocal() as db:
            rec = db.get(OwnerReply, rec_id)
            if not rec or rec.status not in ("await", "ready"):
                return "skip"
            text = (text or "").strip()
            if file_id and not text:
                text = _transcribe(db, file_id)
                if not text:
                    tg._call("sendMessage", {**tgtopics.dest("action"), "text": "Səsi mətnə çevirə bilmədim, yazılı göndərin."})
                    return "voice_failed"
            instruction = None
            if rec.status == "await":
                rec.raw = text
            else:
                rec.regen_count += 1
                instruction = text or None
            return _compose(db, rec, instruction)
    except Exception as e:
        log.exception("cavabımı yaz xətası (%s)", rec_id)
        alerts.notify("owner-reply-crash", f"«Cavabımı yaz» xətası: {type(e).__name__}: {str(e)[:200]}", topic="action")
        return "error"


def _context(db: DB, rec: OwnerReply) -> tuple[str, list[tuple[str, str]]]:
    from crm import bot, customer_card, social_inbox

    if rec.channel == "wa":
        conv = db.get(WaConversation, int(rec.ref))
        lead = db.get(Lead, conv.lead_id) if conv.lead_id else None
        system = bot.build_system(db, now(), first_message=False, lead=lead,
                                  customer=customer_card.build(db, db.get(WaContact, conv.contact_id)))
        return system, bot._history(db, conv)
    item = db.scalar(_dm_items(rec.ref).order_by(SocialItem.id.desc()).limit(1))
    return bot.build_system(db, now(), first_message=False), social_inbox._history(db, item)


def _parse(raw: str) -> str:
    try:
        data = json.loads(raw)
    except ValueError:
        return ""
    reply = data.get("reply") if isinstance(data, dict) else None
    return reply.strip() if isinstance(reply, str) else ""


def _compose(db: DB, rec: OwnerReply, instruction: str | None) -> str:
    from crm import bot

    system, history = _context(db, rec)
    extra = f"SAHİBKARIN XAM CAVABI: {rec.raw}"
    if rec.text:  # yenidən: əvvəlki variant bəyənilməyib
        extra += f"\n\nƏvvəlki variant bəyənilmədi: {rec.text}\nSAHİBKARIN GÖSTƏRİŞİ: {instruction or 'başqa cür yaz'}"
    reply = ""
    try:
        out = ai.generate(system + OWNER_NOTE, bot.contents_from(history + [("user", extra)]), max_tokens=800, json_mode=True)
        ai.count_usage(db, "owner_reply", *out["usage"])
        reply = _parse(ai.text_of(out["content"]))
    except ai.AiError:
        log.warning("cavabımı yaz: AI cavab vermədi (%s)", rec.id)
    rec.text = bot.layout(bot.polish(reply)) if reply else rec.raw
    rec.status = "ready"
    db.commit()
    head = "✍️ Səliqəli variant" if reply else "⚠️ AI səliqəyə sala bilmədi, xam mətn"
    body = f"{head} ({rec.name}):\n\n{rec.text[:2500]}" + (f"\n\nXam mətniniz: {rec.raw[:800]}" if reply else "")
    if rec.tg_message_id:  # yenidən: eyni kart yenilənir
        _edit(rec.tg_chat_id, rec.tg_message_id, body, _card_buttons(rec))
    else:
        where = tgtopics.dest("action")
        res = tg._call("sendMessage", {**where, "text": body[:4000], "reply_markup": _card_buttons(rec)})
        mid = ((res or {}).get("result") or {}).get("message_id")
        if mid:
            rec.tg_message_id, rec.tg_chat_id = str(mid), str(where["chat_id"])
            db.commit()
    return "ready" if reply else "ready:raw"
