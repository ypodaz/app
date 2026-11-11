"""Instagram API (Instagram Login): webhook imzası, hadisələrin oxunması, DM və komment cavabı göndərişi.

IG_ACCESS_TOKEN, IG_APP_SECRET və IG_USER_ID yoxdursa söndürülüb: heç bir sorğu getmir.
"""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

import httpx

import settings
from db import now

GRAPH = "https://graph.instagram.com/v24.0"
WINDOW = timedelta(hours=24)  # DM-ə yalnız son müştəri mesajından 24 saat ərzində cavab vermək olar


class IgError(Exception):
    pass


def enabled() -> bool:
    return bool(settings.IG_ACCESS_TOKEN and settings.IG_APP_SECRET and settings.IG_USER_ID)


def verify_signature(raw: bytes, header: str | None) -> bool:
    """`X-Hub-Signature-256: sha256=<hex>` — gövdənin IG_APP_SECRET ilə HMAC-SHA256-sı."""
    if not settings.IG_APP_SECRET or not header or not header.startswith("sha256="):
        return False
    expected = hmac.new(settings.IG_APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, header[7:])


def _time(ms) -> datetime:
    try:
        return datetime.fromtimestamp(int(ms) / 1000, timezone.utc)
    except (TypeError, ValueError, OverflowError, OSError):
        return now()


def parse(body: dict) -> list[dict]:
    """Webhook gövdəsi → SocialItem sahələri. Echo, öz mesajımız/kommentimiz və mətnsiz mesaj atılır."""
    me = str(settings.IG_USER_ID)
    out = []
    for entry in body.get("entry") or []:
        for m in entry.get("messaging") or []:
            msg, sender = m.get("message") or {}, str((m.get("sender") or {}).get("id") or "")
            if msg.get("is_echo") or not sender or sender == me or not msg.get("mid") or not (msg.get("text") or "").strip():
                continue
            out.append({"channel": "instagram", "kind": "dm", "external_id": str(msg["mid"]), "thread_id": sender,
                        "parent_id": None, "author": "", "text": msg["text"], "created_at": _time(m.get("timestamp"))})
        # sənəddə komment həm `changes[]` içində, həm də birbaşa entry-də (field/value) göstərilir
        changes = entry.get("changes") or ([entry] if entry.get("field") else [])
        for ch in changes:
            v = ch.get("value") or {}
            frm = v.get("from") or {}
            if ch.get("field") != "comments" or not v.get("id") or str(frm.get("id") or "") == me:
                continue
            if not (v.get("text") or "").strip():
                continue
            out.append({"channel": "instagram", "kind": "comment", "external_id": str(v["id"]),
                        "thread_id": str((v.get("media") or {}).get("id") or ""),
                        "parent_id": str(v.get("parent_id") or v["id"]),  # cavab üst kommentin altına yazılır
                        "author": str(frm.get("username") or "")[:120], "text": v["text"],
                        "created_at": _time((entry.get("time") or 0) * 1000) if entry.get("time") else now()})
    return out


def _post(path: str, **kw) -> dict:
    if not enabled():
        raise IgError("Instagram qoşulmayıb")
    try:
        r = httpx.post(GRAPH + path, headers={"Authorization": f"Bearer {settings.IG_ACCESS_TOKEN}"}, timeout=15, **kw)
        data = r.json()
    except Exception as e:  # şəbəkə və ya JSON xətası
        raise IgError(f"Instagram cavab vermədi ({type(e).__name__})") from e
    if r.status_code >= 400 or "error" in data:
        raise IgError(str((data.get("error") or {}).get("message") or f"HTTP {r.status_code}")[:300])
    return data


def send_dm(igsid: str, text: str) -> str:
    data = _post("/me/messages", json={"recipient": {"id": igsid}, "message": {"text": text}})
    return str(data.get("message_id") or "")


def reply_comment(comment_id: str, text: str) -> str:
    return str(_post(f"/{comment_id}/replies", data={"message": text}).get("id") or "")
