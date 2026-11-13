"""Kapso (WhatsApp) və Telegram webhook-ları. Admin girişi yoxdur: imza / secret başlığı ilə qorunur.

Kapso 10 saniyədən tez 200 gözləyir: burada yalnız bazaya yazılır, bot (Gemini) cavabdan sonra fonda işləyir.
"""
import hashlib
import hmac
import json
import logging
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, BackgroundTasks, Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DB

import alerts
import settings
import tgtopics
from crm import bot, calendar_sync, chat, conf, contacts, friends, kapso, social_tg, tg, todo, turns
from db import SessionLocal, aware, get_db, now
from models import KnownContact, WaContact, WaConversation, WaMessage, WebhookEvent

log = logging.getLogger("webhooks")
router = APIRouter(prefix="/api/webhooks")

WINDOW = timedelta(hours=24)
MEDIA_LABEL = {"image": "[şəkil]", "video": "[video]", "document": "[sənəd]"}
STATUS_RANK = {"sent": 1, "delivered": 2, "read": 3}


# --- köməkçilər ---

def _origin(ev: dict, msg: dict) -> str:
    return str((msg.get("kapso") or {}).get("origin") or msg.get("origin") or ev.get("origin") or "")


def _msg_time(msg: dict) -> datetime:
    try:
        return datetime.fromtimestamp(int(msg.get("timestamp")), timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return now()


def extract_text(msg: dict) -> tuple[str, str | None]:
    """(mətn, transkript). Mətn: text.body; səs üçün transkript; media üçün [şəkil]/[video]/[sənəd] + caption."""
    typ = str(msg.get("type") or "")
    kap = msg.get("kapso") or {}
    transcript = (kap.get("transcript") or {}).get("text") if isinstance(kap.get("transcript"), dict) else None
    if typ == "text":
        return str((msg.get("text") or {}).get("body") or ""), None
    if typ == "audio":
        return (transcript or "[audio]"), transcript
    if typ in MEDIA_LABEL:
        caption = (msg.get(typ) or {}).get("caption") or ""
        return (MEDIA_LABEL[typ] + (" " + caption if caption else "")), None
    return f"[{typ or 'naməlum'}]", None


def find_contact(db: DB, conversation: dict, create: bool = True) -> WaContact | None:
    phone = chat.digits(conversation.get("phone_number")) or None
    bsuid = conversation.get("business_scoped_user_id") or None
    name = (conversation.get("contact_name") or "").strip()
    if not name and phone:  # WhatsApp profil adı boşdursa sahibkarın telefonundakı «… Y Pod» adı
        known = db.get(KnownContact, contacts.normalize(phone))
        if known and known.kind == "customer":
            name = known.full_name or known.first_name
    c = None
    if phone:
        c = db.scalar(select(WaContact).where(WaContact.phone == phone))
    if not c and bsuid:
        c = db.scalar(select(WaContact).where(WaContact.bsuid == bsuid))
    if not c:
        if not create or not (phone or bsuid):
            return None
        c = WaContact(phone=phone, bsuid=bsuid, name=name[:120])
        db.add(c)
        db.flush()
        return c
    if phone and not c.phone:
        c.phone = phone
    if bsuid and not c.bsuid and not db.scalar(select(WaContact.id).where(WaContact.bsuid == bsuid)):
        c.bsuid = bsuid
    if name and not c.name:
        c.name = name[:120]
    return c


def find_conversation(db: DB, conversation: dict, contact: WaContact) -> WaConversation:
    kid = str(conversation.get("id") or "") or None
    if kid:
        conv = db.scalar(select(WaConversation).where(WaConversation.kapso_conversation_id == kid))
    else:  # Kapso id verməyibsə kontaktın son söhbəti
        conv = db.scalar(select(WaConversation).where(WaConversation.contact_id == contact.id)
                         .order_by(WaConversation.id.desc()).limit(1))
    if not conv:
        conv = WaConversation(contact_id=contact.id, kapso_conversation_id=kid)
        db.add(conv)
        db.flush()
    return conv


def _touch(conv: WaConversation, t: datetime) -> None:
    if not conv.last_message_at or aware(conv.last_message_at) < t:
        conv.last_message_at = t


# --- hadisələr ---

def on_received(db: DB, ev: dict, bot_convs: list[int]) -> None:
    msg, conversation = ev.get("message") or {}, ev.get("conversation") or {}
    wamid = msg.get("id")
    contact = find_contact(db, conversation)
    if not contact or not wamid:
        log.warning("received: kontakt və ya wamid yoxdur")
        return
    if db.scalar(select(WaMessage.id).where(WaMessage.wamid == wamid)):
        return  # təkrar
    conv = find_conversation(db, conversation, contact)
    text, transcript = extract_text(msg)
    t = _msg_time(msg)
    history = _origin(ev, msg) == "history_sync"
    if not history:
        # WhatsApp vaxtı göndərilmə anıdır: bot bu arada cavab yazıbsa, mesaj o cavabdan SONRA sayılır (cavabsız qalmasın).
        # 2026-11-13: «Salam»a cavab 2 s gec yazıldı, 9 s sonrakı əsl mesaj «son mesaj bizimdir» deyə cavabsız qaldı.
        newest = db.scalar(select(func.max(WaMessage.created_at)).where(
            WaMessage.conversation_id == conv.id, WaMessage.direction == "out", WaMessage.source != "history"))
        if newest and aware(newest) >= aware(t):
            t = aware(newest) + timedelta(milliseconds=1)
    # history_sync idxalında bizim köhnə mesajlarımız da gəlir: istiqamət kapso.direction-dan götürülür
    outbound = history and (msg.get("kapso") or {}).get("direction") == "outbound"
    db.add(WaMessage(conversation_id=conv.id, wamid=wamid, direction="out" if outbound else "in",
                     source="history" if history else "customer",
                     type=str(msg.get("type") or "text")[:16], text=text, transcript=transcript,
                     media_url=((msg.get("kapso") or {}).get("media_url") or None), raw=ev, created_at=t))
    _touch(conv, t)
    if history:
        return  # sayğaca düşmür, bot cavab vermir, pəncərəni yeniləmir
    conv.last_inbound_at = t
    conv.window_expires_at = t + WINDOW
    conv.unread = (conv.unread or 0) + 1
    kapso.count_message(db)
    if conv.id not in bot_convs:
        bot_convs.append(conv.id)


def on_sent(db: DB, ev: dict) -> None:
    msg, conversation = ev.get("message") or {}, ev.get("conversation") or {}
    wamid = msg.get("id")
    if not wamid:
        return
    existing = db.scalar(select(WaMessage).where(WaMessage.wamid == wamid))
    origin = _origin(ev, msg)
    if origin == "business_app" and not existing:
        contact = find_contact(db, conversation)
        if not contact:
            return
        conv = find_conversation(db, conversation, contact)
        text, transcript = extract_text(msg)
        t = _msg_time(msg)
        db.add(WaMessage(conversation_id=conv.id, wamid=wamid, direction="out", source="phone",
                         type=str(msg.get("type") or "text")[:16], text=text, transcript=transcript, status="sent",
                         media_url=((msg.get("kapso") or {}).get("media_url") or None), raw=ev, created_at=t))
        _touch(conv, t)
        turns.owner_wrote(db, conv)  # söhbəti sahibkar aparır: bot qaralama yazır, 1 saatdan sonra özü göndərir
        kapso.count_message(db)
    elif existing:
        _set_status(existing, "sent")  # bizim göndərdiyimiz (cloud_api): yalnız status


def _set_status(m: WaMessage, status: str) -> None:
    if status == "failed" or STATUS_RANK.get(status, 0) > STATUS_RANK.get(m.status or "", 0):
        m.status = status


def on_status(db: DB, name: str, ev: dict) -> None:
    msg = ev.get("message") or {}
    m = db.scalar(select(WaMessage).where(WaMessage.wamid == msg.get("id"))) if msg.get("id") else None
    if not m:
        return
    status = name.rsplit(".", 1)[-1]
    _set_status(m, status)
    if status != "failed":
        return
    errs = msg.get("errors") or ev.get("errors") or (msg.get("kapso") or {}).get("errors") or []
    err = errs[0] if errs and isinstance(errs[0], dict) else {}
    code = str(err.get("code") or "")
    text = str(err.get("message") or err.get("title") or "naməlum xəta")[:300]
    m.raw = {**(m.raw or {}), "error": {"code": code, "message": text}}
    why = kapso.window_closed_text() if code == kapso.WINDOW_CLOSED else text
    alerts.notify(f"kapso-failed:{m.wamid}", f"WhatsApp mesajı çatmadı (söhbət {m.conversation_id}): {why}")


def on_identity_changed(db: DB, ev: dict) -> None:
    data = ev.get("contact") or ev.get("conversation") or {}
    phone = chat.digits(data.get("phone_number")) or None
    bsuid = data.get("business_scoped_user_id") or None
    c = find_contact(db, {"phone_number": phone, "business_scoped_user_id": bsuid}, create=False)
    if not c:
        return
    if phone and not db.scalar(select(WaContact.id).where(WaContact.phone == phone, WaContact.id != c.id)):
        c.phone = phone
    if bsuid and not db.scalar(select(WaContact.id).where(WaContact.bsuid == bsuid, WaContact.id != c.id)):
        c.bsuid = bsuid


def process(raw: bytes, headers) -> list[int]:
    """Gövdəni işləyir. Qaytarır: bot üçün planlanacaq söhbət id-ləri. Xəta atsa heç nə saxlanmır (500)."""
    key = headers.get("x-idempotency-key") or hashlib.sha256(raw).hexdigest()
    with SessionLocal() as db:
        if db.scalar(select(WebhookEvent.id).where(WebhookEvent.provider == "kapso",
                                                   WebhookEvent.idempotency_key == key[:128])):
            return []
        try:
            body = json.loads(raw)
        except ValueError:
            raise HTTPException(400, "JSON deyil")
        header_name = headers.get("x-webhook-event") or ""
        batch = str(headers.get("x-webhook-batch", "")).lower() == "true" or body.get("batch") is True
        if batch:
            items = [(i.get("event") or i.get("type") or header_name, i) for i in (body.get("data") or [])
                     if isinstance(i, dict)]
        else:
            items = [(header_name or body.get("type") or body.get("event") or "", body)]
        pid = next((i.get("phone_number_id") for _, i in items if i.get("phone_number_id")), None)
        if pid and not settings.KAPSO_PHONE_NUMBER_ID and conf.get(db, "kapso_phone_number_id") != pid:
            conf.put(db, "kapso_phone_number_id", str(pid))
        bot_convs: list[int] = []
        for name, ev in items:
            try:
                with db.begin_nested():
                    _dispatch(db, name, ev, bot_convs)
            except Exception:  # noqa: BLE001 — bir xarab hadisə bütün batch-ı 500-ə salmasın
                log.exception("kapso hadisəsi emal olunmadı: %s", name)
                alerts.notify("kapso-event-error", f"WhatsApp hadisəsi emal olunmadı ({name}), loglara baxın")
        db.add(WebhookEvent(provider="kapso", idempotency_key=key[:128]))  # yalnız uğurlu emaldan sonra
        try:
            db.commit()
        except IntegrityError:  # eyni hadisə paralel ikinci dəfə gəldi: artıq yazılıb
            db.rollback()
            return []
        return bot_convs


def _dispatch(db: DB, name: str, ev: dict, bot_convs: list[int]) -> None:
    if name == "whatsapp.message.received":
        on_received(db, ev, bot_convs)
    elif name == "whatsapp.message.sent":
        on_sent(db, ev)
    elif name in ("whatsapp.message.delivered", "whatsapp.message.read", "whatsapp.message.failed"):
        on_status(db, name, ev)
    elif name == "whatsapp.contact.identity_changed":
        on_identity_changed(db, ev)
    else:
        log.info("kapso hadisəsi (yalnız log): %s", name)


@router.post("/kapso")
async def kapso_webhook(request: Request, background: BackgroundTasks):
    raw = await request.body()
    if not settings.KAPSO_WEBHOOK_SECRET:
        raise HTTPException(503, "Webhook secret qurulmayıb")
    if not kapso.verify_signature(raw, request.headers.get("x-webhook-signature")):
        raise HTTPException(401, "İmza yanlışdır")
    for cid in await run_in_threadpool(process, raw, request.headers):
        background.add_task(bot.handle, cid)  # hər söhbət üçün bir dəfə
    return {"ok": True}


@router.post("/telegram")
def telegram_webhook(update: dict, background: BackgroundTasks,
                     x_telegram_bot_api_secret_token: str | None = Header(default=None), db: DB = Depends(get_db)):
    if not settings.TG_WEBHOOK_SECRET:
        raise HTTPException(503, "Webhook secret qurulmayıb")
    if not hmac.compare_digest(x_telegram_bot_api_secret_token or "", settings.TG_WEBHOOK_SECRET):
        raise HTTPException(401, "Secret yanlışdır")
    cq, msg = update.get("callback_query"), update.get("message")
    text = ((msg or {}).get("text") or "").strip()
    cmd = text.split()[0].split("@")[0].lower() if text.startswith("/") else ""  # «/isler@bot» da işləsin
    if cq:
        result = tg.handle_callback(db, cq)
        if result == "regenerate":  # Gemini bir neçə saniyə çəkir: Telegram-a dərhal cavab, yeni qaralama fonda
            background.add_task(bot.regenerate, int(str(cq["data"]).split(":")[1]))
    elif msg and cmd == "/qur":  # mövzu qrupunun qurulması
        result = tgtopics.setup(db, msg, tg._call)
    elif msg and cmd == "/komment":  # komment rejimi: avto | qaralama
        result = social_tg.comment_command(db, msg)
    elif msg and cmd == "/isler":  # açıq işlər
        result = todo.list_command(db, msg)
    elif msg and cmd == "/dostlar":  # botun yazmadığı dostlar
        result = friends.list_command(db, msg)
    elif msg and (result := calendar_sync.phone_reply(db, msg)):  # «telefon nömrəsini yazın» cavabı
        pass
    elif msg and (result := todo.topic_message(db, msg)):  # 📋 mövzusuna yazılan iş (qaralama məntiqinə düşməsin)
        pass
    elif msg:
        result, draft_id = tg.handle_reply(db, msg)
        if result == "regenerate":
            background.add_task(bot.regenerate, draft_id, (msg.get("text") or "").strip()[:500])
    else:
        result = "ignored"
    return {"ok": True, "result": result}
