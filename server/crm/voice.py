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
          "olduğu kimi mətnə çevir. Yalnız mətni qaytar: izah, tərcümə, dırnaq yoxdur. Danışıq yoxdursa və ya sözlər aydın eşidilmirsə, təxmin etmə, boş qaytar.")


IMAGE_LABEL = "[şəkil]"  # routes/webhooks.MEDIA_LABEL və crm/instagram ilə eyni
IMAGE_SYSTEM = ("Müştəri studiyaya (podkast/video çəkilişi) bu şəkli göndərib. Azərbaycanca 1–2 qısa cümlə ilə nə "
                "göründüyünü yaz; şəkildə yazı varsa, onu olduğu kimi əlavə et. Yalnız təsviri qaytar. Şəkil "
                "aydın deyilsə, təxmin etmə, boş qaytar.")


def _download(url: str, kind: str = "audio") -> tuple[bytes, str] | None:
    headers = {}
    if urlparse(url).hostname == KAPSO_HOST and settings.KAPSO_API_KEY:
        headers["X-API-Key"] = settings.KAPSO_API_KEY
    try:
        r = httpx.get(url, headers=headers, timeout=30, follow_redirects=True)
    except httpx.HTTPError:
        log.warning("%s faylı yüklənmədi (şəbəkə)", kind)
        return None
    if r.status_code != 200 or not r.content or len(r.content) > MAX_BYTES:
        log.warning("%s faylı yüklənmədi: HTTP %s, %s bayt", kind, r.status_code, len(r.content or b""))
        return None
    mime = (r.headers.get("content-type") or "").split(";")[0].strip()
    if kind == "image":
        return r.content, (mime if mime.startswith("image/") else "image/jpeg")
    if mime == "video/mp4":  # Instagram səsli mesajı mp4 (AAC) kimi gələ bilər
        mime = "audio/mp4"
    return r.content, (mime if mime.startswith("audio/") else "audio/ogg")


def _gemini(db: DB, url: str | None, kind: str, system: str) -> str:
    """Media linki → Gemini mətni; alınmasa "". Xəta atmır."""
    if not (url and settings.GEMINI_API_KEY):
        return ""
    got = _download(url, kind)
    if not got:
        return ""
    data, mime = got
    try:
        out = ai.generate(system, [{"role": "user", "parts": [
            {"inlineData": {"mimeType": mime, "data": base64.b64encode(data).decode()}}]}], max_tokens=1500)
    except ai.AiError:
        log.warning("%s oxunmadı (Gemini)", kind)
        return ""
    ai.count_usage(db, "voice" if kind == "audio" else "image", *out["usage"])
    return ai.text_of(out["content"]).strip()[:4000]


def text_from_url(db: DB, url: str | None) -> str:
    """Səs faylının linki → mətn; alınmasa "" (WhatsApp və Instagram DM üçün ortaq)."""
    return _gemini(db, url, "audio", SYSTEM)


def image_text(db: DB, url: str | None) -> str:
    """Şəklin linki → qısa təsvir; alınmasa "" (WhatsApp və Instagram DM üçün ortaq)."""
    return _gemini(db, url, "image", IMAGE_SYSTEM)[:600]


def image_label(desc: str) -> str:
    return f"[şəkil: {desc}]" if desc else IMAGE_LABEL


def transcribe(db: DB, m: WaMessage) -> bool:
    """Mesajı yerində yeniləyir (text, transcript). Qaytarır: alındımı. Commit çağıran tərəfindədir."""
    text = text_from_url(db, m.media_url)
    if not text:
        return False
    m.text = m.transcript = text
    return True


TRIED = "voice_tried"  # raw-da işarə: bu mesaj Gemini-yə bir dəfə göndərilib (təkrar xərc olmur)


def fill_missing(db: DB, conversation_id: int, limit: int = 3) -> int:
    """Müştərinin son səsli mesajlarını (Kapso transkripti olsa da) mətnə çevirir, şəkillərini təsvir edir (Gemini).
    Hər mesaj bir dəfə sınanır. Qaytarır: neçəsi alındı."""
    rows = db.scalars(select(WaMessage).where(
        WaMessage.conversation_id == conversation_id, WaMessage.source == "customer",
        WaMessage.type.in_(("audio", "image"))).order_by(WaMessage.id.desc()).limit(limit)).all()
    rows = [m for m in rows if not (m.raw or {}).get(TRIED)]
    done = 0
    for m in rows:
        if m.type == "image":
            desc = image_text(db, m.media_url)
            if desc:
                m.text = image_label(desc) + (m.text or "")[len(IMAGE_LABEL):] if (m.text or "").startswith(
                    IMAGE_LABEL) else f"{image_label(desc)} {m.text or ''}".strip()
            done += bool(desc)
        else:
            done += transcribe(db, m)
        m.raw = {**(m.raw or {}), TRIED: True}
    if rows:
        db.commit()
    return done
