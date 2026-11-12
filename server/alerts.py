"""Sahibkara Telegram xəbərdarlığı: server xətası, bildiriş dövrü xətası, DB əlçatmazlığı, yenidən başlama.

TG_BOT_TOKEN və TG_CHAT_ID yoxdursa heç nə etmir. Eyni açar 10 dəqiqədə bir dəfə göndərilir.
Göndəriş ayrıca thread-dədir — sorğunu gözlətmir, xətası heç vaxt yuxarı çıxmır.
"""
import logging
import threading
import time

import httpx

import settings
import tgtopics

log = logging.getLogger("alerts")
DEDUPE_SEC = 600
_last: dict[str, float] = {}
_lock = threading.Lock()


def _post(text: str, topic: str = "server") -> None:
    try:
        httpx.post(f"https://api.telegram.org/bot{settings.TG_BOT_TOKEN}/sendMessage",
                   json={**tgtopics.dest(topic), "text": text[:3500]}, timeout=10)
    except Exception:
        log.warning("telegram xəbərdarlığı göndərilmədi")


def notify(key: str, text: str, topic: str = "server") -> bool:
    """True: göndərişə verildi; False: konfiqurasiya yoxdur və ya təkrardır. `topic`: tgtopics.TOPICS açarı."""
    if not (settings.TG_BOT_TOKEN and settings.TG_CHAT_ID):
        return False
    now = time.monotonic()
    with _lock:
        if now - _last.get(key, -DEDUPE_SEC) < DEDUPE_SEC:
            return False
        _last[key] = now
    threading.Thread(target=_post, args=("Y Pod: " + text, topic), daemon=True).start()
    return True
