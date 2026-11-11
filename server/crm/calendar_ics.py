"""Apple Calendar «Public Calendar» ICS-i: hadisələr botun boş saat hesabında məşğul vaxt sayılır.
Hadisə adı/təsviri saxlanmır və loglanmır, yalnız vaxt aralığı. Link gizlidir — logda yoxdur."""
import logging
import threading
import time
from datetime import datetime

import httpx
import icalendar
import recurring_ical_events

import settings
from db import aware
from views import BAKU

log = logging.getLogger(__name__)

TTL = 600  # keş 10 dəqiqə
STALE_MAX = 24 * 3600  # yükləmə uğursuz olsa köhnə keş 24 saata qədər işlənir
RETRY = 60  # uğursuzluqdan sonra 60 san. təkrar sorğu yoxdur (bot hər mesajda 10 san. gözləməsin)

_lock = threading.Lock()
_cache: dict = {"cal": None, "at": 0.0, "fail": -1e9}


def _load():
    """Təqvimi qaytarır (keşdən və ya şəbəkədən); alınmırsa None. Xəta yuxarı çıxmır."""
    url = settings.APPLE_CAL_ICS_URL.strip()
    if not url:
        return None
    with _lock:
        age = time.monotonic() - _cache["at"]
        if _cache["cal"] is not None and age < TTL:
            return _cache["cal"]
        if time.monotonic() - _cache["fail"] < RETRY:
            return _cache["cal"] if age < STALE_MAX else None
        try:
            r = httpx.get("https://" + url[len("webcal://"):] if url.startswith("webcal://") else url,
                          timeout=10, follow_redirects=True)
            r.raise_for_status()
            _cache["cal"], _cache["at"] = icalendar.Calendar.from_ical(r.content), time.monotonic()
        except Exception as e:  # noqa: BLE001 — URL və cavab mətni loga düşməsin, yalnız xəta növü
            log.warning("ICS təqvimi yüklənmədi (%s)", type(e).__name__)
            _cache["fail"] = time.monotonic()
            if age >= STALE_MAX:
                _cache["cal"] = None
        return _cache["cal"]


def _dt(v: datetime) -> datetime:
    """Qurşaqsız (floating) vaxt Bakı vaxtı sayılır."""
    return v.replace(tzinfo=BAKU) if v.tzinfo is None else aware(v)


def busy(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """[start, end) ilə kəsişən məşğul aralıqlar; URL boşdursa və ya yükləmə alınmırsa []."""
    try:
        cal = _load()
        if cal is None:
            return []
        out = []
        for ev in recurring_ical_events.of(cal).between(start, end):
            a, b = ev.start, ev.end
            # Bütün günlük hadisələr (ad günü, xatırlatma) məşğul SAYILMIR: DTSTART yalnız tarixdir
            if not isinstance(a, datetime):
                continue
            # «Boş» kimi işarələnmiş və ləğv edilmiş hadisələr də sayılmır
            if str(ev.get("TRANSP", "")).upper() == "TRANSPARENT" or str(ev.get("STATUS", "")).upper() == "CANCELLED":
                continue
            a = _dt(a)
            b = _dt(b) if isinstance(b, datetime) else a
            if b > a:
                out.append((a, b))
        return out
    except Exception as e:  # noqa: BLE001
        log.warning("ICS təqvimi emal edilmədi (%s)", type(e).__name__)
        return []
