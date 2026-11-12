"""Instagram API (Instagram Login): webhook imzası, hadisələrin oxunması, DM və komment cavabı göndərişi.

IG_ACCESS_TOKEN, IG_APP_SECRET və IG_USER_ID yoxdursa söndürülüb: heç bir sorğu getmir.

Token ~60 gün yaşayır. `refresh` həftədə bir yeniləyir və yenisini `settings` cədvəlində saxlayır; Railway-dəki
IG_ACCESS_TOKEN ilk dəyər və ehtiyatdır. Sahibkar Railway-də tokeni dəyişsə, bazadakı köhnə nüsxə işlənmir.
"""
import hashlib
import hmac
import logging
from datetime import datetime, timedelta, timezone

import httpx
from sqlalchemy.orm import Session as DB

import alerts
import settings
from crm import conf
from db import SessionLocal, aware, now

log = logging.getLogger("instagram")
GRAPH = "https://graph.instagram.com/v24.0"
REFRESH_URL = "https://graph.instagram.com/refresh_access_token"
WINDOW = timedelta(hours=24)  # DM-ə yalnız son müştəri mesajından 24 saat ərzində cavab vermək olar
REFRESH_EVERY = timedelta(days=7)
TOKEN_KEY, SOURCE_KEY, REFRESHED_KEY = "ig_token", "ig_token_source", "ig_token_refreshed_at"
_state = {"alerted": False}


class IgError(Exception):
    pass


def enabled() -> bool:
    return bool(settings.IG_ACCESS_TOKEN and settings.IG_APP_SECRET and settings.IG_USER_ID)


def _source() -> str:
    """Railway tokeninin barmaq izi: dəyişibsə bazadakı yenilənmiş token ona aid deyil."""
    return hashlib.sha256(settings.IG_ACCESS_TOKEN.encode()).hexdigest()[:16]


def token(db: DB | None = None) -> str:
    if db is None:
        with SessionLocal() as s:
            return token(s)
    saved = conf.get(db, TOKEN_KEY)
    if saved and conf.get(db, SOURCE_KEY) == _source():
        return saved
    return settings.IG_ACCESS_TOKEN


def refresh(db: DB) -> bool:
    """Son yeniləmədən 7 gün keçibsə tokeni yeniləyir. True: yeni token yazıldı."""
    if not enabled():
        return False
    if conf.get(db, SOURCE_KEY) != _source():
        # ilk dəfə və ya sahibkar Railway-də yeni token yazıb: o təzədir (Meta 24 saatdan gənc tokeni yeniləmir)
        conf.put(db, SOURCE_KEY, _source())
        conf.put(db, TOKEN_KEY, "")
        conf.put(db, REFRESHED_KEY, now().isoformat())
        db.commit()
        return False
    last = conf.get(db, REFRESHED_KEY)
    if last and now() - aware(datetime.fromisoformat(last)) < REFRESH_EVERY:
        return False
    try:
        r = httpx.get(REFRESH_URL, params={"grant_type": "ig_refresh_token", "access_token": token(db)}, timeout=15)
        data = r.json()
        new = data.get("access_token") if r.status_code < 400 else None
        err = str((data.get("error") or {}).get("message") or f"HTTP {r.status_code}")[:200]
    except Exception as e:  # şəbəkə və ya JSON xətası
        new, err = None, f"cavab yoxdur ({type(e).__name__})"
    if not new:
        log.warning("Instagram tokeni yenilənmədi: %s", err)
        if not _state["alerted"]:
            _state["alerted"] = True
            alerts.notify("ig-token", f"Instagram tokeni yenilənmədi: {err}. Bitəndə DM və komment cavabları "
                                      "dayanacaq; Meta-da yeni token alıb Railway-də IG_ACCESS_TOKEN-i dəyişin.")
        return False
    _state["alerted"] = False
    conf.put(db, TOKEN_KEY, new)
    conf.put(db, REFRESHED_KEY, now().isoformat())
    db.commit()
    return True


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
        r = httpx.post(GRAPH + path, headers={"Authorization": f"Bearer {token()}"}, timeout=15, **kw)
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
