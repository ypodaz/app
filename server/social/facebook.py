"""Facebook Səhifə Reels müştərisi (Graph API v27.0, Page access token).

Üç addım: start → rupload (hostlanmış URL-dən) → finish (SCHEDULED). Status ayrıca `get_status` ilə yoxlanır.
"""
from datetime import datetime, timedelta, timezone

import httpx

import settings
from db import now

GRAPH = "https://graph.facebook.com/v27.0"
RUPLOAD = "https://rupload.facebook.com/video-upload/v27.0"
MIN_AHEAD = timedelta(minutes=11)  # Meta: vaxt ən azı 10 dəqiqə sonra olmalıdır


class FacebookError(Exception):
    """Facebook sorğusu alınmadı (şəbəkə, Meta xətası, çatışmayan sahə)."""


def enabled() -> bool:
    return bool(settings.FB_PAGE_ID and settings.FB_PAGE_TOKEN)


def _json(r: httpx.Response) -> dict:
    try:
        body = r.json()
    except ValueError:
        body = {}
    if r.status_code >= 400 or (isinstance(body, dict) and body.get("error")):
        err = body.get("error") if isinstance(body, dict) else None
        msg = err.get("message") if isinstance(err, dict) else None
        raise FacebookError(f"Facebook: {msg or f'HTTP {r.status_code}'}"[:300])
    return body


def _call(method, url: str, **kw) -> dict:
    try:
        return _json(method(url, timeout=30, **kw))
    except httpx.HTTPError as e:
        raise FacebookError(f"Facebook şəbəkə xətası: {type(e).__name__}") from e


def schedule_reel(video_url: str, description: str, due_at: datetime) -> str:
    """Reel-i vaxtlayır, video_id qaytarır."""
    if due_at.astimezone(timezone.utc) - now() < MIN_AHEAD:
        raise FacebookError("vaxt çox yaxındır")
    token = settings.FB_PAGE_TOKEN
    url = f"{GRAPH}/{settings.FB_PAGE_ID}/video_reels"
    video_id = _call(httpx.post, url, data={"upload_phase": "start", "access_token": token}).get("video_id")
    if not video_id:
        raise FacebookError("Facebook: video_id gəlmədi")
    up = _call(httpx.post, f"{RUPLOAD}/{video_id}", headers={"Authorization": f"OAuth {token}", "file_url": video_url})
    if not up.get("success"):
        raise FacebookError("Facebook: video yüklənmədi")
    fin = _call(httpx.post, url, data={
        "access_token": token, "video_id": video_id, "upload_phase": "finish", "video_state": "SCHEDULED",
        "scheduled_publish_time": int(due_at.timestamp()), "description": description})
    if not fin.get("success"):
        raise FacebookError("Facebook: reel vaxtlanmadı")
    return video_id


def get_status(video_id: str) -> tuple[str, str | None]:
    """("published" | "error" | "pending", xəta mətni)."""
    data = _call(httpx.get, f"{GRAPH}/{video_id}", params={"fields": "status", "access_token": settings.FB_PAGE_TOKEN})
    st = data.get("status") or {}
    proc, pub = st.get("processing_phase") or {}, st.get("publishing_phase") or {}
    if pub.get("publish_status") == "published":
        return "published", None
    if st.get("video_status") in ("error", "expired", "upload_failed") or pub.get("publish_status") == "error" \
            or proc.get("status") == "error":
        err = (pub.get("error") if pub.get("publish_status") == "error" else None) or proc.get("error") or pub.get("error")
        msg = err.get("message") if isinstance(err, dict) else None
        return "error", msg or f"Facebook video statusu: {st.get('video_status')}"
    return "pending", None
