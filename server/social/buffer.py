"""Buffer GraphQL müştərisi (https://api.buffer.com, Authorization: Bearer).

Hər sorğu gündəlik sayğacı artırır (`settings` cədvəli, açar `buffer_requests:YYYY-MM-DD`). SOCIAL_DAILY_REQUEST_CAP
keçilibsə sorğu göndərilmir. 429 gələndə müəyyən müddət heç nə göndərilmir (geri çəkilmə).
Qeyd: sorğu sxemi sənədə görə yazılıb, canlı Buffer-ə qarşı hələ yoxlanmayıb (açar yoxdur).
"""
import logging
import time
from datetime import datetime, timezone

import httpx

import settings
from db import SessionLocal, now
from models import Setting
from views import BAKU

log = logging.getLogger("buffer")
URL = "https://api.buffer.com"
DEFAULT_BACKOFF_S = 900
_backoff_until = 0.0  # time.monotonic()


class BufferError(Exception):
    """Buffer sorğusu alınmadı (şəbəkə, MutationError, GraphQL xətası, limit)."""


class BufferCapReached(BufferError):
    pass


class BufferBackoff(BufferError):
    pass


def _today() -> str:
    return now().astimezone(BAKU).date().isoformat()


def requests_today() -> int:
    with SessionLocal() as db:
        row = db.get(Setting, f"buffer_requests:{_today()}")
        return int(row.value) if row else 0


def _count_request() -> None:
    """Sayğacı artırır; limit keçilibsə BufferCapReached. Tək işçi dövr var, ona görə sadə oxu-yaz kifayətdir."""
    key = f"buffer_requests:{_today()}"
    with SessionLocal() as db:
        row = db.get(Setting, key)
        if not row:
            db.add(Setting(key=key, value="0"))
            db.flush()
            row = db.get(Setting, key)
        if int(row.value) >= settings.SOCIAL_DAILY_REQUEST_CAP:
            raise BufferCapReached(f"gündəlik Buffer limiti dolub ({settings.SOCIAL_DAILY_REQUEST_CAP})")
        row.value = str(int(row.value) + 1)
        db.commit()


def _gql(query: str, variables: dict) -> dict:
    global _backoff_until
    if not settings.BUFFER_API_KEY:
        raise BufferError("BUFFER_API_KEY yoxdur")
    if time.monotonic() < _backoff_until:
        raise BufferBackoff("Buffer 429 verib, geri çəkilmə davam edir")
    _count_request()
    try:
        r = httpx.post(URL, json={"query": query, "variables": variables}, timeout=30,
                       headers={"Authorization": f"Bearer {settings.BUFFER_API_KEY}"})
    except httpx.HTTPError as e:
        raise BufferError(f"Buffer şəbəkə xətası: {type(e).__name__}") from e
    if r.status_code == 429:
        try:
            wait = int(r.headers.get("retry-after", ""))
        except ValueError:
            wait = DEFAULT_BACKOFF_S
        _backoff_until = time.monotonic() + wait
        raise BufferBackoff(f"Buffer 429: {wait} saniyə geri çəkilirik")
    if r.status_code >= 400:
        raise BufferError(f"Buffer HTTP {r.status_code}: {r.text[:200]}")
    body = r.json()
    if body.get("errors"):
        raise BufferError("Buffer GraphQL xətası: " + str(body["errors"])[:300])
    return body["data"]


def get_organizations() -> list[dict]:
    data = _gql("query { account { organizations { id name } } }", {})
    return data["account"]["organizations"]


_org = {"id": ""}


def org_id() -> str:
    """BUFFER_ORG_ID; boşdursa və hesabda tək təşkilat varsa, onu tapıb yadda saxlayır."""
    if settings.BUFFER_ORG_ID:
        return settings.BUFFER_ORG_ID
    if not _org["id"]:
        orgs = get_organizations()
        if len(orgs) != 1:
            raise BufferError("Buffer-də bir neçə təşkilat var: BUFFER_ORG_ID lazımdır")
        _org["id"] = orgs[0]["id"]
    return _org["id"]


def get_channels(org_id: str) -> list[dict]:
    data = _gql("query Channels($input: ChannelsInput!) { channels(input: $input) { id service name isQueuePaused } }",
                {"input": {"organizationId": org_id}})
    return data["channels"]


def _metadata(service: str, title: str | None) -> dict:
    if service == "instagram":
        return {"instagram": {"type": "reel", "shouldShareToFeed": True}}
    if service == "youtube":
        return {"youtube": {"title": title or "", "categoryId": "27", "privacy": "public", "madeForKids": False,
                            "notifySubscribers": True}}
    return {service: {}}  # tiktok


CREATE_POST = """mutation CreatePost($input: CreatePostInput!) {
  createPost(input: $input) {
    ... on PostActionSuccess { post { id dueAt } }
    ... on MutationError { message }
  }
}"""


def create_post(channel_id: str, service: str, text: str, video_url: str, due_at: datetime,
                title: str | None = None, thumbnail_offset_ms: int = 1000) -> dict:
    """Buffer-də vaxtlanmış post yaradır, `{id, dueAt}` qaytarır. MutationError olarsa BufferError."""
    due = due_at.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    inp = {"channelId": channel_id, "text": text, "schedulingType": "automatic", "mode": "customScheduled",
           "dueAt": due,
           "assets": [{"video": {"url": video_url, "metadata": {"thumbnailOffset": thumbnail_offset_ms}}}],
           "metadata": _metadata(service, title)}
    res = _gql(CREATE_POST, {"input": inp})["createPost"]
    if "post" not in res:
        raise BufferError("Buffer createPost: " + str(res.get("message") or res)[:300])
    return res["post"]


def get_posts(org_id: str, channel_ids: list[str], since: datetime) -> list[dict]:
    """[{id, status, dueAt, channelId, error}]. `since` UTC-dən sonra vaxtlanmış postlar."""
    q = """query Posts($input: PostsInput!) {
  posts(input: $input, first: 100) { edges { node { id status dueAt channelId error { message } } } }
}"""
    since_s = since.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    data = _gql(q, {"input": {"organizationId": org_id, "filter": {"channelIds": channel_ids,
                                                                     "dueAt": {"start": since_s}}}})
    out = []
    for e in data["posts"]["edges"]:
        n = e["node"]
        err = n.get("error")
        out.append({"id": n["id"], "status": n["status"], "dueAt": n.get("dueAt"), "channelId": n.get("channelId"),
                    "error": err.get("message") if isinstance(err, dict) else err})
    return out
