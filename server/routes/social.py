"""Instagram webhook-u (DM və kommentlər). Admin girişi yoxdur: verify token və X-Hub-Signature-256 ilə qorunur.

Meta tez 200 gözləyir: burada yalnız bazaya yazılır, qaralama (Gemini) cavabdan sonra fonda yazılır.
IG_* dəyişənləri boşdursa söndürülüb: heç nə emal olunmur.
"""
import hmac
import json

from fastapi import APIRouter, BackgroundTasks, HTTPException, Query, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import PlainTextResponse

import settings
from crm import instagram, social_inbox
from db import SessionLocal

router = APIRouter(prefix="/api/webhooks")


@router.get("/instagram")
def instagram_verify(mode: str = Query("", alias="hub.mode"), token: str = Query("", alias="hub.verify_token"),
                     challenge: str = Query("", alias="hub.challenge")):
    if not settings.IG_VERIFY_TOKEN or mode != "subscribe" or not hmac.compare_digest(token, settings.IG_VERIFY_TOKEN):
        raise HTTPException(403, "Verify token yanlışdır")
    return PlainTextResponse(challenge)


def _store(body) -> list[int]:
    bodies = [b for b in (body if isinstance(body, list) else [body]) if isinstance(b, dict)]  # sənəd nümunəsi siyahıdır
    with SessionLocal() as db:
        ids = [item.id for b in bodies for d in instagram.parse(b) if (item := social_inbox.add(db, d))]
        db.commit()
        return ids


@router.post("/instagram")
async def instagram_webhook(request: Request, background: BackgroundTasks):
    if not instagram.enabled():
        return {"ok": True, "disabled": True}
    raw = await request.body()
    if not instagram.verify_signature(raw, request.headers.get("x-hub-signature-256")):
        raise HTTPException(401, "İmza yanlışdır")
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "JSON deyil")
    for item_id in await run_in_threadpool(_store, body):
        background.add_task(social_inbox.draft, item_id)
    for b in (body if isinstance(body, list) else [body]):
        if isinstance(b, dict):
            for thread, mid in instagram.echoes(b):  # sahibkar app-dan yazıbsa bot o söhbətdə susur
                background.add_task(social_inbox.on_echo, thread, mid)
    return {"ok": True}
