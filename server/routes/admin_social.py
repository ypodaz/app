from datetime import date, datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import settings
from auth import current_admin
from db import get_db, now
from models import MediaAsset, SocialPost
from social import buffer, facebook, schedule, worker
from views import BAKU, iso, utc

router = APIRouter(prefix="/api/admin/social", dependencies=[Depends(current_admin)])


def post_out(p: SocialPost, a: MediaAsset) -> dict:
    return {"id": p.id, "platform": p.platform, "scheduled_at": iso(p.scheduled_at), "text": p.text, "title": p.title,
            "status": p.status, "external_id": p.external_id, "error": p.error, "attempts": p.attempts,
            "media": {"id": a.id, "number": a.number, "day": a.day, "slot": a.slot, "title": a.title,
                      "file_name": a.file_name, "public_url": a.public_url, "cover_offset_ms": a.cover_offset_ms,
                      "duration_s": a.duration_s}}


def day_start_utc(d: date) -> datetime:
    return datetime.combine(d, datetime.min.time(), tzinfo=BAKU).astimezone(timezone.utc)


@router.get("/posts")
def list_posts(from_: date | None = Query(default=None, alias="from"), to: date | None = None, db: DB = Depends(get_db)):
    q = select(SocialPost, MediaAsset).join(MediaAsset, MediaAsset.id == SocialPost.media_asset_id)
    if from_:
        q = q.where(SocialPost.scheduled_at >= day_start_utc(from_))
    if to:  # «to» günü də daxildir
        q = q.where(SocialPost.scheduled_at < day_start_utc(to + timedelta(days=1)))
    rows = db.execute(q.order_by(SocialPost.scheduled_at, SocialPost.platform)).all()
    return [post_out(p, a) for p, a in rows]


class ImportItem(BaseModel):
    number: int
    day: int = Field(ge=1)
    slot: Literal["seher", "axsam"]
    title: str
    file_name: str
    public_url: str | None = None
    duration_s: float | None = None
    instagram: str = Field(min_length=1)
    tiktok: str = Field(min_length=1)
    youtube_title: str = Field(min_length=1)
    youtube_description: str = Field(min_length=1)


class ImportIn(BaseModel):
    start_date: date
    items: list[ImportItem] = Field(max_length=200)


@router.post("/import")
def import_posts(body: ImportIn, db: DB = Depends(get_db)):
    return schedule.import_items(db, body.start_date, [i.model_dump() for i in body.items])


class PostPatch(BaseModel):
    scheduled_at: datetime | None = None
    text: str | None = Field(default=None, min_length=1)
    title: str | None = Field(default=None, max_length=200)
    status: Literal["cancelled"] | None = None


@router.patch("/posts/{post_id}")
def patch_post(post_id: int, body: PostPatch, db: DB = Depends(get_db)):
    p = db.get(SocialPost, post_id)
    if not p:
        raise HTTPException(404, "Post tapılmadı")
    if p.status != "planned":  # queued Buffer-dədir: burada dəyişmək onunla ayrılığa salar
        raise HTTPException(409, "Yalnız planlanmış post dəyişdirilə bilər")
    if body.scheduled_at:
        p.scheduled_at = utc(body.scheduled_at)
    if body.text is not None:
        p.text = body.text
    if body.title is not None:
        p.title = body.title
    if body.status:
        p.status = body.status
    db.commit()
    return post_out(p, db.get(MediaAsset, p.media_asset_id))


class MediaPatch(BaseModel):
    public_url: str | None = Field(default=None, max_length=500, pattern=r"^https://")
    cover_offset_ms: int | None = Field(default=None, ge=0, le=600000)


@router.patch("/media/{media_id}")
def patch_media(media_id: int, body: MediaPatch, db: DB = Depends(get_db)):
    a = db.get(MediaAsset, media_id)
    if not a:
        raise HTTPException(404, "Video tapılmadı")
    if body.public_url is not None:
        a.public_url = body.public_url
    if body.cover_offset_ms is not None:
        a.cover_offset_ms = body.cover_offset_ms
    db.commit()
    return {"id": a.id, "public_url": a.public_url, "cover_offset_ms": a.cover_offset_ms}


@router.get("/status")
def status(db: DB = Depends(get_db)):
    channels = None
    if settings.BUFFER_API_KEY:
        try:
            channels = [{"id": c["id"], "service": c["service"], "name": c["name"],
                         "queue_paused": c.get("isQueuePaused")} for c in buffer.get_channels(buffer.org_id())]
        except buffer.BufferError as e:
            channels = {"error": str(e)}
    if facebook.enabled() and (channels is None or isinstance(channels, list)):
        channels = (channels or []) + [{"id": settings.FB_PAGE_ID, "service": "facebook", "name": "Facebook Səhifə",
                                        "queue_paused": None}]
    nxt = db.execute(select(SocialPost, MediaAsset).join(MediaAsset, MediaAsset.id == SocialPost.media_asset_id)
                     .where(SocialPost.status.in_(("planned", "queued")), SocialPost.scheduled_at > now())
                     .order_by(SocialPost.scheduled_at, SocialPost.platform).limit(5)).all()
    errs = db.execute(select(SocialPost, MediaAsset).join(MediaAsset, MediaAsset.id == SocialPost.media_asset_id)
                      .where(SocialPost.status == "error").order_by(SocialPost.updated_at.desc()).limit(5)).all()
    return {"queue_enabled": worker.queue_enabled(db), "channels": channels,
            "requests_today": buffer.requests_today(), "request_cap": settings.SOCIAL_DAILY_REQUEST_CAP,
            "next_posts": [post_out(p, a) for p, a in nxt], "recent_errors": [post_out(p, a) for p, a in errs]}


class QueueIn(BaseModel):
    enabled: bool


@router.post("/queue")
def set_queue(body: QueueIn, db: DB = Depends(get_db)):
    worker.set_queue_enabled(db, body.enabled)
    return {"queue_enabled": body.enabled}


@router.post("/sync")
def sync(db: DB = Depends(get_db)):
    try:
        return worker.sync_status(db)
    except buffer.BufferError as e:
        raise HTTPException(502, str(e))
