import asyncio
from contextlib import asynccontextmanager

import logging

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text

import alerts
import push
import settings
from auth import ensure_admin
from db import SessionLocal
from routes import admin, admin_growth, admin_shoots, admin_social, ai as ai_routes, client, public, webhooks
from crm import worker as crm_worker
from social import worker as social_worker


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with SessionLocal() as db:
        ensure_admin(db)
    alerts.notify("start", "server başladı (deploy və ya çökmədən sonra yenidən başlama)")
    tasks = [asyncio.create_task(push.loop()), asyncio.create_task(social_worker.loop()),
             asyncio.create_task(crm_worker.loop())] if settings.SCHEDULER else []
    yield
    for task in tasks:
        task.cancel()


app = FastAPI(title="Y Pod App", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=86400,
)


@app.exception_handler(Exception)
async def unhandled(request: Request, exc: Exception):
    logging.getLogger("app").exception("gözlənilməz xəta: %s %s", request.method, request.url.path)
    alerts.notify(f"500:{request.url.path}:{type(exc).__name__}",
                  f"server xətası {request.method} {request.url.path}: {type(exc).__name__}: {str(exc)[:300]}")
    return JSONResponse({"detail": "Xəta baş verdi."}, status_code=500)


app.include_router(public.router)
app.include_router(client.router)
app.include_router(admin.router)
app.include_router(admin_shoots.router)
app.include_router(admin_growth.router)
app.include_router(admin_social.router)
app.include_router(ai_routes.router)
app.include_router(webhooks.router)


@app.get("/api/health")
def health():
    try:
        with SessionLocal() as db:
            db.execute(text("SELECT 1"))
    except Exception as e:
        alerts.notify("db", f"baza əlçatmazdır: {type(e).__name__}")
        return JSONResponse({"ok": False}, status_code=503)
    return {"ok": True}
