from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

import settings
from auth import ensure_admin
from db import SessionLocal
from routes import admin, admin_shoots, client, public


@asynccontextmanager
async def lifespan(_app: FastAPI):
    with SessionLocal() as db:
        ensure_admin(db)
    yield


app = FastAPI(title="Y Pod App", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.ALLOWED_ORIGINS,
    allow_methods=["GET", "POST", "PATCH", "DELETE"],
    allow_headers=["Authorization", "Content-Type"],
    max_age=86400,
)
app.include_router(public.router)
app.include_router(client.router)
app.include_router(admin.router)
app.include_router(admin_shoots.router)


@app.get("/api/health")
def health():
    return {"ok": True}
