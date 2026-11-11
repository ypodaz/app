"""YouTube Data API v3: kanalın yeni kommentlərini 15 dəqiqədən bir yoxlayır, cavabı Telegram təsdiqindən sonra yazır.

Kvota (gündəlik 10 000 vahid): commentThreads.list = 1 vahid (gündə 96 sorğu), comments.insert = 50 vahid.
YT_* dəyişənlərindən biri boşdursa söndürülüb: heç bir sorğu getmir.
"""
import asyncio
import logging
import time
from datetime import datetime

import httpx
from sqlalchemy.orm import Session as DB

import alerts
import settings
from crm import conf
from db import SessionLocal, aware, now

log = logging.getLogger("youtube")
TOKEN_URL = "https://oauth2.googleapis.com/token"
API = "https://www.googleapis.com/youtube/v3"
INTERVAL = 15 * 60
LAST_KEY = "yt_last_seen"
_token: dict = {"value": "", "until": 0.0}


class YtError(Exception):
    pass


def enabled() -> bool:
    return bool(settings.YT_CLIENT_ID and settings.YT_CLIENT_SECRET and settings.YT_REFRESH_TOKEN
                and settings.YT_CHANNEL_ID)


def _check(r) -> dict:
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400:
        err = data.get("error")
        msg = err.get("message") if isinstance(err, dict) else (data.get("error_description") or err)
        raise YtError(str(msg or f"HTTP {r.status_code}")[:300])
    return data


def access_token() -> str:
    """Refresh token ilə qısa ömürlü access token; bitməsinə 1 dəqiqə qalana qədər keşdə saxlanır."""
    if not enabled():
        raise YtError("YouTube qoşulmayıb")
    if _token["value"] and time.monotonic() < _token["until"]:
        return _token["value"]
    try:
        r = httpx.post(TOKEN_URL, data={"client_id": settings.YT_CLIENT_ID, "client_secret": settings.YT_CLIENT_SECRET,
                                        "refresh_token": settings.YT_REFRESH_TOKEN, "grant_type": "refresh_token"},
                       timeout=15)
    except httpx.HTTPError as e:
        raise YtError(f"Google cavab vermədi ({type(e).__name__})") from e
    data = _check(r)
    _token["value"] = data["access_token"]
    _token["until"] = time.monotonic() + int(data.get("expires_in", 3600)) - 60
    return _token["value"]


def _auth() -> dict:
    return {"Authorization": f"Bearer {access_token()}"}


def list_threads() -> list[dict]:
    try:
        r = httpx.get(f"{API}/commentThreads", headers=_auth(), timeout=15, params={
            "part": "snippet", "allThreadsRelatedToChannelId": settings.YT_CHANNEL_ID, "order": "time",
            "maxResults": 50, "textFormat": "plainText"})
    except httpx.HTTPError as e:
        raise YtError(f"YouTube cavab vermədi ({type(e).__name__})") from e
    return _check(r).get("items") or []


def insert_reply(parent_id: str, text: str) -> str:
    try:
        r = httpx.post(f"{API}/comments", params={"part": "snippet"}, headers=_auth(), timeout=15,
                       json={"snippet": {"parentId": parent_id, "textOriginal": text}})
    except httpx.HTTPError as e:
        raise YtError(f"YouTube cavab vermədi ({type(e).__name__})") from e
    return str(_check(r).get("id") or "")


def _published(s: str) -> datetime:
    return aware(datetime.fromisoformat(s.replace("Z", "+00:00")))


def poll(db: DB) -> list[int]:
    """Son baxılandan yeni top-level kommentləri SocialItem kimi yazır, id-lərini qaytarır.
    İlk işə salınmada köhnə kommentlər götürülmür: yalnız başlanğıc vaxtı yadda saxlanır."""
    from crm import social_inbox  # dövri import olmasın

    if not enabled():
        return []
    last_raw = conf.get(db, LAST_KEY)
    if not last_raw:
        conf.put(db, LAST_KEY, now().isoformat())
        db.commit()
        return []
    last = aware(datetime.fromisoformat(last_raw))
    newest, ids = last, []
    for th in list_threads():
        sn = th.get("snippet") or {}
        top = sn.get("topLevelComment") or {}
        c = top.get("snippet") or {}
        try:
            t = _published(c.get("publishedAt") or "")
        except ValueError:
            continue
        if t <= last:
            continue
        newest = max(newest, t)
        if (c.get("authorChannelId") or {}).get("value") == settings.YT_CHANNEL_ID or sn.get("canReply") is False:
            continue  # öz kommentimiz və ya cavab bağlıdır
        text = c.get("textOriginal") or c.get("textDisplay") or ""
        item = social_inbox.add(db, {"channel": "youtube", "kind": "comment", "external_id": str(top.get("id") or ""),
                                     "thread_id": str(sn.get("videoId") or ""), "parent_id": str(top.get("id") or ""),
                                     "author": str(c.get("authorDisplayName") or "")[:120], "text": text,
                                     "created_at": t})
        if item:
            ids.append(item.id)
    conf.put(db, LAST_KEY, newest.isoformat())
    db.commit()
    return ids


def tick() -> None:
    from crm import social_inbox

    if not enabled():
        return
    try:
        with SessionLocal() as db:
            ids = poll(db)
    except YtError as e:  # məs. refresh token ləğv olunub: sahibkara bir dəfə deyirik, hər 15 dəqiqədə yox
        if not _token.get("alerted"):
            _token["alerted"] = True
            alerts.notify("youtube-poll", f"YouTube kommentləri oxunmur: {e}")
        return
    _token["alerted"] = False
    for item_id in ids:
        social_inbox.draft(item_id)


async def loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:  # dövr heç vaxt dayanmamalıdır
            log.exception("YouTube dövrü")
        await asyncio.sleep(INTERVAL)
