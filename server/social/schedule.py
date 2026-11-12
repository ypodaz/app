"""Təqvim generatoru: gündə bir paylaşım, axşam 20:00 (Bakı vaxtı; sahibkarın qərarı, 2026-11-13).

Kontent planı hələ «gün N səhər/axşam» kimi yazılır: hər slot ayrıca günə düşür, səhər və axşam videoları növbələşir
(gün 1 səhər → 1-ci gün, gün 1 axşam → 2-ci gün, gün 2 səhər → 3-cü gün…). Videosu olmayan slot boş qalır,
növbəti videolar sürüşmür (hər video öz gününə düşür). Mövcud təqvimi köçürmək: scripts/social_reschedule.py.
"""
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

from models import MediaAsset, SocialPost
from social import facebook
from views import BAKU

POST_TIME = time(20, 0)
SLOT_ORDER = {"seher": 0, "axsam": 1}
ENABLED_PLATFORMS = ("instagram", "tiktok", "youtube")  # Buffer platformaları


def active_platforms() -> tuple:
    """Buffer platformaları + Facebook (açarlar qoyulubsa)."""
    return ENABLED_PLATFORMS + ("facebook",) if facebook.enabled() else ENABLED_PLATFORMS


def slot_utc(start: date, day: int, slot: str) -> datetime:
    """`day` 1-dən başlayır: gün 1 səhər = start tarixi, gün 1 axşam = növbəti gün (hər gün 20:00)."""
    local = datetime.combine(start + timedelta(days=(day - 1) * 2 + SLOT_ORDER[slot]), POST_TIME, tzinfo=BAKU)
    return local.astimezone(timezone.utc)


def platform_text(item: dict, platform: str) -> tuple[str, str | None]:
    """(mətn, başlıq). Facebook mətni Instagram ilə eynidir."""
    if platform == "youtube":
        return item["youtube_description"], item["youtube_title"]
    if platform == "tiktok":
        return item["tiktok"], None
    return item["instagram"], None


def generate(videos: list[dict], start: date, platforms=None) -> list[dict]:
    """videos: [{number, day, slot}] → [{number, platform, scheduled_at}] (vaxta görə sıralı)."""
    platforms = platforms or active_platforms()
    out = [{"number": v["number"], "platform": p, "scheduled_at": slot_utc(start, v["day"], v["slot"])}
           for v in videos for p in platforms]
    return sorted(out, key=lambda r: (r["scheduled_at"], r["number"], r["platform"]))


def import_items(db: DB, start: date, items: list[dict], platforms=None) -> dict:
    """Manifest elementlərini bazaya yazır. Mövcud post təkrar yaradılmır (media_asset_id + platform)."""
    platforms = platforms or active_platforms()
    created = skipped = 0
    for it in items:
        asset = db.scalar(select(MediaAsset).where(MediaAsset.number == it["number"]))
        if not asset:
            asset = MediaAsset(number=it["number"], day=it["day"], slot=it["slot"], title=it["title"],
                               file_name=it["file_name"])
            db.add(asset)
        # URL və müddət sonradan da gələ bilər; paneldən əl ilə qoyulmuş URL boşla əzilmir
        if it.get("public_url"):
            asset.public_url = it["public_url"]
        if it.get("duration_s") is not None:
            asset.duration_s = it["duration_s"]
        db.flush()
        for row in generate([it], start, platforms):
            if db.scalar(select(SocialPost.id).where(SocialPost.media_asset_id == asset.id,
                                                     SocialPost.platform == row["platform"])):
                skipped += 1
                continue
            text, title = platform_text(it, row["platform"])
            db.add(SocialPost(media_asset_id=asset.id, platform=row["platform"], scheduled_at=row["scheduled_at"],
                              text=text, title=title, status="planned"))
            created += 1
    db.commit()
    return {"created": created, "skipped": skipped}
