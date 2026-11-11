"""Kapso (WhatsApp Cloud API vasitəçisi) müştərisi, webhook imzası və aylıq mesaj sayğacı.

Sayğac `settings` cədvəlindədir (açar `kapso_msgs:YYYY-MM`, Bakı ayı). Free planda 2000 mesaj var, gələn və gedən
hamısı sayılır; 1600 və 1900-də Telegram xəbərdarlığı bir dəfə gedir.
"""
import hmac
import logging
from hashlib import sha256

import httpx
from sqlalchemy.orm import Session as DB

import alerts
import settings
from crm import conf
from db import now
from views import BAKU

log = logging.getLogger("kapso")
URL = "https://api.kapso.ai/meta/whatsapp/v24.0/{phone_number_id}/messages"
WINDOW_CLOSED = "131047"  # 24 saatlıq pəncərə bağlıdır
MONTH_LIMIT = 2000
ALERT_AT = (1600, 1900)


class KapsoError(Exception):
    def __init__(self, code: str | int | None, message: str):
        super().__init__(message)
        self.code = str(code) if code is not None else ""
        self.message = message


def window_closed_text() -> str:
    return "24 saat keçib, şablon lazımdır"


def send_text(phone_number_id: str, *, to: str | None = None, recipient: str | None = None, text: str) -> str:
    """Mətn mesajı göndərir, wamid qaytarır. Telefon yoxdursa (yalnız BSUID) `to` əvəzinə `recipient` gedir."""
    if not settings.KAPSO_API_KEY:
        raise KapsoError(None, "WhatsApp hələ qoşulmayıb (Kapso açarı yoxdur)")
    if not phone_number_id:
        raise KapsoError(None, "WhatsApp nömrəsi Kapso-da tapılmadı")
    body = {"messaging_product": "whatsapp", "type": "text", "text": {"body": text}}
    if to:
        body["to"] = to
    elif recipient:
        body["recipient"] = recipient
    else:
        raise KapsoError(None, "alıcı yoxdur")
    try:
        r = httpx.post(URL.format(phone_number_id=phone_number_id), json=body, timeout=20,
                       headers={"X-API-Key": settings.KAPSO_API_KEY})
    except httpx.HTTPError as e:
        raise KapsoError(None, f"Kapso şəbəkə xətası: {type(e).__name__}") from e
    try:
        data = r.json()
    except ValueError:
        data = {}
    if r.status_code >= 400 or (isinstance(data, dict) and data.get("error")):
        err = data.get("error") if isinstance(data, dict) else None
        err = err if isinstance(err, dict) else {}
        raise KapsoError(err.get("code"), str(err.get("message") or f"Kapso HTTP {r.status_code}")[:300])
    try:
        return data["messages"][0]["id"]
    except (KeyError, IndexError, TypeError) as e:
        raise KapsoError(None, "Kapso cavabında wamid yoxdur") from e


def verify_signature(raw_body: bytes, signature_header: str | None) -> bool:
    """HMAC-SHA256 hex, prefikssiz."""
    if not settings.KAPSO_WEBHOOK_SECRET or not signature_header:
        return False
    expected = hmac.new(settings.KAPSO_WEBHOOK_SECRET.encode(), raw_body, sha256).hexdigest()
    return hmac.compare_digest(expected, signature_header.strip().lower())


# --- aylıq sayğac ---

def _month() -> str:
    return now().astimezone(BAKU).strftime("%Y-%m")


def month_count(db: DB) -> int:
    return int(conf.get(db, f"kapso_msgs:{_month()}", "0") or 0)


def count_message(db: DB) -> int:
    """Sayğacı artırır (commit çağıran tərəfindədir); 1600 və 1900-ü keçəndə bir dəfə xəbərdarlıq edir."""
    month = _month()
    n = month_count(db) + 1
    conf.put(db, f"kapso_msgs:{month}", str(n))
    for th in ALERT_AT:
        flag = f"kapso_alert:{month}:{th}"
        if n >= th and not conf.get(db, flag):
            conf.put(db, flag, "1")
            alerts.notify(flag, f"Kapso aylıq mesaj sayğacı {n}/{MONTH_LIMIT} (həd {th} keçildi)")
    return n
