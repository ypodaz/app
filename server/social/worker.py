"""Paylaşım dövrü: Buffer növbəsini doldurur və statusları yoxlayır (push.loop kimi, SCHEDULER bayrağı ilə).

Hər 15 dəqiqədə növbə doldurma, hər 2 saatda status sinxronu. `social_queue_enabled` ayarı true deyilsə heç nə göndərilmir.
"""
import asyncio
import logging
import time
from datetime import timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import alerts
import settings
from db import SessionLocal, aware, now
from models import MediaAsset, Setting, SocialPost
from social import buffer, facebook
from social.schedule import ENABLED_PLATFORMS

log = logging.getLogger("social")
INTERVAL = 15 * 60
SYNC_EVERY = 2 * 3600
QUEUE_MAX = 10  # hər kanalda Buffer növbəsində ən çox
LOOKAHEAD = timedelta(days=5)
FILL_BATCH = 5
LATE_AFTER = timedelta(minutes=45)
MAX_ATTEMPTS = 3
CHANNEL_TTL = 24 * 3600

_channels: dict = {"at": 0.0, "map": {}}
_last_sync = 0.0


def queue_enabled(db: DB) -> bool:
    row = db.get(Setting, "social_queue_enabled")
    return bool(row) and row.value.strip().lower() == "true"


def set_queue_enabled(db: DB, enabled: bool) -> None:
    row = db.get(Setting, "social_queue_enabled")
    if row:
        row.value = "true" if enabled else "false"
    else:
        db.add(Setting(key="social_queue_enabled", value="true" if enabled else "false"))
    db.commit()


def channel_map(force: bool = False) -> dict[str, str]:
    """service → Buffer kanal id; 24 saat keşlənir."""
    if force or not _channels["map"] or time.monotonic() - _channels["at"] > CHANNEL_TTL:
        chans = buffer.get_channels(settings.BUFFER_ORG_ID)
        _channels["map"] = {c["service"]: c["id"] for c in chans}
        _channels["at"] = time.monotonic()
    return _channels["map"]


def _fail(post: SocialPost, msg: str) -> None:
    post.attempts += 1
    post.error = msg[:500]
    if post.attempts >= MAX_ATTEMPTS:
        post.status = "error"
        alerts.notify(f"social-error:{post.id}", f"paylaşım göndərilmədi ({post.platform}, post {post.id}): {msg[:200]}")


def _due_posts(db: DB, platform: str, t) -> list[SocialPost]:
    """Platformanın növbədə yeri varsa, ən yaxın 5 günün planlı postları."""
    # Növbə sayı yerli bazadan: Buffer-ə yazan yalnız biziksə, əlavə sorğu limiti yeməyə ehtiyac yoxdur.
    queued = db.scalar(select(func.count()).select_from(SocialPost)
                       .where(SocialPost.platform == platform, SocialPost.status == "queued")) or 0
    room = min(QUEUE_MAX - queued, FILL_BATCH)
    if room <= 0:
        return []
    return db.scalars(select(SocialPost).where(
        SocialPost.platform == platform, SocialPost.status == "planned", SocialPost.external_id.is_(None),
        SocialPost.scheduled_at > t, SocialPost.scheduled_at <= t + LOOKAHEAD,
    ).order_by(SocialPost.scheduled_at).limit(room)).all()


def _fill_facebook(db: DB, t) -> int:
    sent = 0
    for post in _due_posts(db, "facebook", t):
        asset = db.get(MediaAsset, post.media_asset_id)
        if not asset.public_url:
            log.warning("post %s atlandı: video %s üçün public_url yoxdur", post.id, asset.number)
            continue
        try:
            video_id = facebook.schedule_reel(asset.public_url, post.text, aware(post.scheduled_at))
        except facebook.FacebookError as e:
            _fail(post, str(e))
            db.commit()
            continue
        post.status, post.external_id, post.error = "queued", video_id, None
        db.commit()
        sent += 1
    return sent


def fill_queue(db: DB) -> int:
    """Hər kanalda növbə QUEUE_MAX-dan azdırsa, ən yaxın 5 günün planlı postlarını Buffer-ə və Facebook-a göndərir."""
    t = now()
    sent = 0
    if facebook.enabled():
        sent += _fill_facebook(db, t)
    if not settings.BUFFER_API_KEY:
        log.warning("BUFFER_API_KEY yoxdur: Buffer platformaları atlandı")
        return sent
    chans = channel_map()
    for platform in ENABLED_PLATFORMS:
        channel_id = chans.get(platform)
        if not channel_id:
            log.warning("Buffer-də %s kanalı tapılmadı", platform)
            continue
        for post in _due_posts(db, platform, t):
            asset = db.get(MediaAsset, post.media_asset_id)
            if not asset.public_url:
                log.warning("post %s atlandı: video %s üçün public_url yoxdur", post.id, asset.number)
                continue
            try:
                res = buffer.create_post(channel_id, platform, post.text, asset.public_url, aware(post.scheduled_at),
                                         title=post.title, thumbnail_offset_ms=asset.cover_offset_ms)
            except (buffer.BufferCapReached, buffer.BufferBackoff):
                db.commit()
                return sent  # limit və ya geri çəkilmə: bu dövrdə daha göndərmirik, post «planned» qalır
            except buffer.BufferError as e:
                _fail(post, str(e))
                db.commit()
                continue
            post.status, post.external_id, post.error = "queued", res["id"], None
            db.commit()  # hər postdan sonra: yarıda kəsilsə də göndərilən itməsin
            sent += 1
    return sent


def _late_alert_once(db: DB, post: SocialPost) -> None:
    key = f"social_late:{post.id}"
    if db.get(Setting, key):
        return
    db.add(Setting(key=key, value="1"))
    alerts.notify(key, f"{post.platform} postu vaxtında çıxmayıb (post {post.id}, planlanan {aware(post.scheduled_at):%d.%m %H:%M} UTC)")


def sync_status(db: DB) -> dict:
    """Buffer və Facebook statuslarını bazaya köçürür; xətanı və gecikməni Telegram-a xəbər verir."""
    t = now()
    queued = db.scalars(select(SocialPost).where(SocialPost.status == "queued")).all()
    out = {"published": 0, "error": 0, "late": 0}
    if not queued:
        return out

    def late(post: SocialPost) -> None:
        if aware(post.scheduled_at) + LATE_AFTER < t:
            _late_alert_once(db, post)
            out["late"] += 1

    fb = [p for p in queued if p.platform == "facebook"]
    for post in fb:
        try:
            state, msg = facebook.get_status(post.external_id)
        except facebook.FacebookError as e:
            log.warning("Facebook status yoxlanmadı (post %s): %s", post.id, e)
            continue
        if state == "published":
            post.status, post.error = "published", None
            out["published"] += 1
        elif state == "error":
            post.status = "error"
            post.error = (msg or "Facebook xətası")[:500]
            alerts.notify(f"social-error:{post.id}", f"Facebook paylaşım xətası (post {post.id}): {post.error[:200]}")
            out["error"] += 1
        else:
            late(post)
    rest = [p for p in queued if p.platform != "facebook"]
    if rest:
        remote = {p["id"]: p for p in buffer.get_posts(settings.BUFFER_ORG_ID, list(channel_map().values()),
                                                       t - timedelta(days=7))}
        for post in rest:
            info = remote.get(post.external_id)
            status = info["status"] if info else None
            if status == "sent":
                post.status, post.error = "published", None
                out["published"] += 1
            elif status == "error":
                post.status = "error"
                post.error = (info.get("error") or "Buffer xətası")[:500]
                alerts.notify(f"social-error:{post.id}", f"Buffer paylaşım xətası ({post.platform}, post {post.id}): {post.error[:200]}")
                out["error"] += 1
            else:
                late(post)
    db.commit()
    return out


def tick() -> None:
    global _last_sync
    with SessionLocal() as db:
        if not queue_enabled(db):
            return
        try:
            fill_queue(db)
        except Exception:  # doldurma yıxılsa da sinxron işləsin
            log.exception("növbə doldurma")
        if time.monotonic() - _last_sync >= SYNC_EVERY:
            _last_sync = time.monotonic()
            try:
                sync_status(db)
            except Exception:
                log.exception("status sinxronu")


async def loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:  # dövr heç vaxt dayanmamalıdır
            log.exception("paylaşım dövrü")
        await asyncio.sleep(INTERVAL)
