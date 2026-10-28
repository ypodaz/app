"""AI: müştərinin dəstəkçisi və adminin səsli köməkçisi (Gemini)."""

from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import ai
import assistant
import settings
from auth import current_admin, current_client
from db import get_db
from models import Admin, AiMessage, Client
from views import iso

router = APIRouter(prefix="/api")

AUDIO_MIME = ("audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav", "audio/aac", "audio/x-m4a")


class AskIn(BaseModel):
    text: str = Field(min_length=1, max_length=ai.MAX_QUESTION)


class Turn(BaseModel):
    role: Literal["user", "model"]
    text: str = Field(max_length=4000)


class AssistantIn(BaseModel):
    text: str = Field(default="", max_length=2000)
    audio: Optional[str] = Field(default=None, max_length=4_000_000)  # base64, ~3 MB / ~2 dəq
    mime: Optional[str] = None
    history: list[Turn] = Field(default_factory=list, max_length=20)


def _fail(e: ai.AiError):
    limited = any(w in str(e) for w in ("limit", "tez-tez", "bağlıdır"))
    raise HTTPException(429 if limited else 503, str(e))


@router.get("/me/ai")
def client_history(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    rows = db.scalars(select(AiMessage).where(AiMessage.client_id == client.id)
                      .order_by(AiMessage.id.desc()).limit(40)).all()
    return {"enabled": bool(settings.GEMINI_API_KEY),
            "remaining": ai.remaining(db, f"client:{client.id}", settings.AI_DAILY_CLIENT_LIMIT),
            "messages": [{"role": m.role, "text": m.text, "created_at": iso(m.created_at)} for m in reversed(rows)]}


@router.post("/me/ai")
def client_ask(body: AskIn, client: Client = Depends(current_client), db: DB = Depends(get_db)):
    subject = f"client:{client.id}"
    question = body.text.strip()
    try:
        ai.check_limits(db, subject, settings.AI_DAILY_CLIENT_LIMIT)
        last = db.scalars(select(AiMessage).where(AiMessage.client_id == client.id)
                          .order_by(AiMessage.id.desc()).limit(10)).all()
        text, wa, usage = ai.client_reply(db, client, [(m.role, m.text) for m in reversed(last)], question)
    except ai.AiError as e:
        _fail(e)
    db.add_all([AiMessage(client_id=client.id, role="user", text=question),
                AiMessage(client_id=client.id, role="model", text=text)])
    ai.count_usage(db, subject, *usage)
    db.commit()
    return {"text": text, "whatsapp": wa,
            "remaining": ai.remaining(db, subject, settings.AI_DAILY_CLIENT_LIMIT)}


@router.post("/admin/assistant")
def admin_assistant(body: AssistantIn, admin: Admin = Depends(current_admin), db: DB = Depends(get_db)):
    if not body.text.strip() and not body.audio:
        raise HTTPException(422, "Əmr boşdur")
    audio = None
    if body.audio:
        mime = (body.mime or "").split(";")[0].strip().lower()
        if mime not in AUDIO_MIME:
            raise HTTPException(422, "Bu səs formatı dəstəklənmir")
        audio = (mime, body.audio)
    subject = f"admin:{admin.id}"
    try:
        ai.check_limits(db, subject, settings.AI_DAILY_ADMIN_LIMIT)
        out = assistant.run(db, [t.model_dump() for t in body.history], body.text.strip(), audio)
    except ai.AiError as e:
        _fail(e)
    ai.count_usage(db, subject, *out["usage"])
    db.commit()
    return {"reply": out["reply"], "proposals": out["proposals"],
            "remaining": ai.remaining(db, subject, settings.AI_DAILY_ADMIN_LIMIT)}
