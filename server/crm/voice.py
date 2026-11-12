"""Səsli mesaj → mətn. Əsas yol Gemini-dir (azərbaycancanı yaxşı tanıyır, sahibkarın qərarı 2026-11-12):
səs faylı yüklənir və Gemini ilə mətnə çevrilir. Alınmasa Kapso-nun transkripti (varsa) qalır, o da yoxdursa
mesaj «[audio]» olur və bot müştəridən qısa yazmağı xahiş edir (prompt). Heç vaxt xəta atmır.
"""
import base64
import logging
from urllib.parse import urlparse

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import ai
import settings
from models import WaMessage

log = logging.getLogger("voice")

PLACEHOLDER = "[audio]"
MAX_BYTES = 8_000_000  # ~8 dəqiqəlik səsli mesaj
KAPSO_HOST = "api.kapso.ai"  # Kapso açarı yalnız bu ünvana göndərilir
SYSTEM = ("Bu səsli mesajı danışıldığı dildə (çox vaxt azərbaycanca, bəzən rusca, türkcə və ya ingiliscə) "
          "olduğu kimi mətnə çevir. Yalnız mətni qaytar: izah, tərcümə, dırnaq yoxdur. Danışıq yoxdursa boş qaytar.")


def _download(url: str) -> tuple[bytes, str] | None:
    headers = {}
    if urlparse(url).hostname == KAPSO_HOST and settings.KAPSO_API_KEY:
        headers["X-API-Key"] = settings.KAPSO_API_KEY
    try:
        r = httpx.get(url, headers=headers, timeout=30, follow_redirects=True)
    except httpx.HTTPError:
        log.warning("səs faylı yüklənmədi (şəbəkə)")
        return None
    if r.status_code != 200 or not r.content or len(r.content) > MAX_BYTES:
        log.warning("səs faylı yüklənmədi: HTTP %s, %s bayt", r.status_code, len(r.content or b""))
        return None
    mime = (r.headers.get("content-type") or "audio/ogg").split(";")[0].strip()
    if mime == "video/mp4":  # Instagram səsli mesajı mp4 (AAC) kimi gələ bilər
        mime = "audio/mp4"
    return r.content, (mime if mime.startswith("audio/") else "audio/ogg")


def text_from_url(db: DB, url: str | None) -> str:
    """Səs faylının linki → mətn; alınmasa "" (WhatsApp və Instagram DM üçün ortaq). Xəta atmır."""
    if not (url and settings.GEMINI_API_KEY):
        return ""
    got = _download(url)
    if not got:
        return ""
    data, mime = got
    try:
        out = ai.generate(SYSTEM, [{"role": "user", "parts": [
            {"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}}]}], max_tokens=1500)
    except ai.AiError:
        log.warning("səs mətnə çevrilmədi (Gemini)")
        return ""
    ai.count_usage(db, "voice", *out["usage"])
    return ai.text_of(out["content"]).strip()[:4000]


def transcribe(db: DB, m: WaMessage) -> bool:
    """Mesajı yerində yeniləyir (text, transcript). Qaytarır: alındımı. Commit çağıran tərəfindədir."""
    text = text_from_url(db, m.media_url)
    if not text:
        return False
    m.text = m.transcript = text
    return True


TRIED = "voice_tried"  # raw-da işarə: bu mesaj Gemini-yə bir dəfə göndərilib (təkrar xərc olmur)


def fill_missing(db: DB, conversation_id: int, limit: int = 3) -> int:
    """Müştərinin son səsli mesajlarını (Kapso transkripti olsa da) Gemini ilə mətnə çevirir.
    Hər mesaj bir dəfə sınanır. Qaytarır: neçəsi alındı."""
    rows = db.scalars(select(WaMessage).where(
        WaMessage.conversation_id == conversation_id, WaMessage.source == "customer", WaMessage.type == "audio")
        .order_by(WaMessage.id.desc()).limit(limit)).all()
    rows = [m for m in rows if not (m.raw or {}).get(TRIED)]
    done = 0
    for m in rows:
        done += transcribe(db, m)
        m.raw = {**(m.raw or {}), TRIED: True}
    if rows:
        db.commit()
    return done
