"""Paylaşım dövrü: Buffer növbəsini doldurur və statusları yoxlayır (push.loop kimi, SCHEDULER bayrağı ilə).

Hər 15 dəqiqədə növbə doldurma; status sinxronu yalnız vaxtı keçmiş növbədə post olanda (ən çoxu saatda bir);
hər 3 saatda Buffer kanalının ayrılıb-ayrılmadığı yoxlanır (ayrılsa Telegram, qayıdanda bu günün xətalı postları təkrar).
Son yoxlama vaxtları və kanal xəritəsi bazada saxlanır ki, server yenidən başlayanda Buffer-ə əlavə sorğu getməsin
(gündəlik limit, SOCIAL_DAILY_REQUEST_CAP). `social_queue_enabled` ayarı true deyilsə heç nə göndərilmir.
"""
import asyncio
import json
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
from views import BAKU

log = logging.getLogger("social")
INTERVAL = 15 * 60
SYNC_EVERY = 3600
QUEUE_MAX = 10  # hər kanalda Buffer növbəsində ən çox
LOOKAHEAD = timedelta(days=5)
FILL_BATCH = 5
LATE_AFTER = timedelta(minutes=45)
MAX_ATTEMPTS = 3
CHANNEL_TTL = 24 * 3600
CHANNEL_CHECK_EVERY = 3 * 3600
CHANNELS_KEY = "buffer_channels"

_channels: dict = {"at": 0.0, "map": {}}


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


def _save_channels(chans: list[dict]) -> None:
    """Kanal xəritəsi yaddaşda və bazada (server yenidən başlayanda Buffer-ə sorğu getməsin)."""
    _channels["map"] = {c["service"]: c["id"] for c in chans}
    _channels["at"] = time.time()
    with SessionLocal() as db:
        row = db.get(Setting, CHANNELS_KEY)
        value = json.dumps({"at": _channels["at"], "map": _channels["map"]})
        if row:
            row.value = value
        else:
            db.add(Setting(key=CHANNELS_KEY, value=value))
        db.commit()


def channel_map(force: bool = False) -> dict[str, str]:
    """service → Buffer kanal id; 24 saat keşlənir (yaddaşda, yoxdursa bazada)."""
    if not force and not _channels["map"]:
        with SessionLocal() as db:
            row = db.get(Setting, CHANNELS_KEY)
        try:
            saved = json.loads(row.value) if row else {}
        except ValueError:
            saved = {}
        if saved.get("map"):
            _channels["map"], _channels["at"] = saved["map"], float(saved.get("at") or 0)
    if force or not _channels["map"] or time.time() - _channels["at"] > CHANNEL_TTL:
        _save_channels(buffer.get_channels(buffer.org_id()))
    return _channels["map"]


def _due(db: DB, key: str, every: int) -> bool:
    """Bazadakı son vaxtdan `every` saniyə keçibsə vaxtı yeniləyib True (deploy-dan sonra da yadda qalır)."""
    row = db.get(Setting, key)
    try:
        last = float(row.value) if row else 0.0
    except ValueError:
        last = 0.0
    if time.time() - last < every:
        return False
    if row:
        row.value = str(time.time())
    else:
        db.add(Setting(key=key, value=str(time.time())))
    db.commit()
    return True


def _queued_due(db: DB) -> bool:
    """Növbədə vaxtı keçmiş post var (yalnız onda statusu soruşmağa dəyər)."""
    return bool(db.scalar(select(func.count()).select_from(SocialPost).where(
        SocialPost.status == "queued", SocialPost.scheduled_at <= now())))


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
        remote = {p["id"]: p for p in buffer.get_posts(buffer.org_id(), list(channel_map().values()),
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


def retry_today(db: DB, service: str, channel_id: str) -> int:
    """Bu günün (Bakı) xətalı postlarını yenidən göndərir: Buffer-də varsa shareNow, yoxdursa yeni post."""
    t = now()
    day = t.astimezone(BAKU).date()
    posts = [p for p in db.scalars(select(SocialPost).where(
        SocialPost.platform == service, SocialPost.status == "error", SocialPost.scheduled_at <= t,
    ).order_by(SocialPost.scheduled_at)).all() if aware(p.scheduled_at).astimezone(BAKU).date() == day]
    sent = 0
    for post in posts:
        asset = db.get(MediaAsset, post.media_asset_id)
        if not asset.public_url:
            log.warning("post %s təkrarda atlandı: video %s üçün public_url yoxdur", post.id, asset.number)
            continue
        try:
            if post.external_id:
                buffer.share_now(post.external_id, service, post.text, asset.public_url, title=post.title,
                                 thumbnail_offset_ms=asset.cover_offset_ms)
            else:
                res = buffer.create_post(channel_id, service, post.text, asset.public_url, t + timedelta(minutes=2),
                                         title=post.title, thumbnail_offset_ms=asset.cover_offset_ms)
                post.external_id = res["id"]
        except (buffer.BufferCapReached, buffer.BufferBackoff):
            db.commit()
            break
        except buffer.BufferError as e:
            log.warning("post %s təkrar göndərilmədi: %s", post.id, e)
            continue
        post.status, post.error, post.attempts = "queued", None, 0
        db.commit()
        sent += 1
    return sent


def check_channels(db: DB) -> dict:
    """Buffer kanalı ayrılıbsa Telegram-a xəbər verir; yenidən qoşulanda bu günün xətalı postlarını təkrar göndərir."""
    out = {"disconnected": [], "reconnected": []}
    try:
        chans = buffer.get_channels(buffer.org_id())
    except buffer.BufferError as e:
        log.warning("Buffer kanal yoxlaması alınmadı: %s", e)
        return out
    _save_channels(chans)
    for c in chans:
        service = c["service"]
        if service not in ENABLED_PLATFORMS:
            continue
        key = f"buffer_disconnected:{service}"
        row = db.get(Setting, key)
        if c.get("isDisconnected") and not row:
            db.add(Setting(key=key, value=now().isoformat()))
            db.commit()
            alerts.notify(f"buffer-disc:{service}",
                          f"⚠️ Buffer-də {service} kanalı ayrılıb (çox vaxt Facebook/Instagram parolu dəyişəndə olur). "
                          "Buffer → Channels → Refresh edin. Qoşulana qədər bu kanalın postları çıxmayacaq.",
                          topic="action")
            out["disconnected"].append(service)
        elif not c.get("isDisconnected") and row:
            db.delete(row)
            db.commit()
            try:
                sync_status(db)  # xətalı postlar «error» kimi işarələnsin
            except buffer.BufferError as e:
                log.warning("kanal qayıdandan sonra status sinxronu alınmadı: %s", e)
            n = retry_today(db, service, c["id"])
            msg = (f"Bu günün {n} postu yenidən göndərildi." if n else "Yenidən göndərilməli post yoxdur.")
            alerts.notify(f"buffer-back:{service}:{now().astimezone(BAKU).date().isoformat()}",
                          f"✅ Buffer-də {service} yenidən qoşuldu. {msg}", topic="action")
            out["reconnected"].append(service)
    return out


def tick() -> None:
    with SessionLocal() as db:
        if not queue_enabled(db):
            return
        try:
            fill_queue(db)
        except Exception:  # doldurma yıxılsa da sinxron işləsin
            log.exception("növbə doldurma")
        if _due(db, "buffer_last_channel_check", CHANNEL_CHECK_EVERY):
            try:
                check_channels(db)
            except Exception:
                log.exception("kanal yoxlaması")
        if _queued_due(db) and _due(db, "buffer_last_sync", SYNC_EVERY):
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
