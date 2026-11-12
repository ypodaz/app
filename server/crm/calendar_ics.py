"""Apple Calendar «Public Calendar» ICS-i: hadisələr botun boş saat hesabında məşğul vaxt sayılır.
Hadisə adı/təsviri saxlanmır və loglanmır, yalnız vaxt aralığı. Link gizlidir — logda yoxdur."""
import logging
import threading
import time
from datetime import datetime, timedelta

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
# hər mənbənin öz keşi var: "main" (Y Pod) və "personal" (şəxsi)
_caches: dict = {k: {"cal": None, "at": 0.0, "fail": -1e9} for k in ("main", "personal")}
_cache = _caches["main"]


def _load(name: str = "main"):
    """Mənbənin təqvimini qaytarır (keşdən və ya şəbəkədən); alınmırsa None. Xəta yuxarı çıxmır."""
    url = (settings.APPLE_CAL_ICS_URL if name == "main" else settings.APPLE_CAL_ICS_URL_PERSONAL).strip()
    if not url:
        return None
    cache = _caches[name]
    with _lock:
        age = time.monotonic() - cache["at"]
        if cache["cal"] is not None and age < TTL:
            return cache["cal"]
        if time.monotonic() - cache["fail"] < RETRY:
            return cache["cal"] if age < STALE_MAX else None
        try:
            r = httpx.get("https://" + url[len("webcal://"):] if url.startswith("webcal://") else url,
                          timeout=10, follow_redirects=True)
            r.raise_for_status()
            cache["cal"], cache["at"] = icalendar.Calendar.from_ical(r.content), time.monotonic()
        except Exception as e:  # noqa: BLE001 — URL və cavab mətni loga düşməsin, yalnız xəta növü
            log.warning("ICS təqvimi yüklənmədi (%s: %s)", name, type(e).__name__)
            cache["fail"] = time.monotonic()
            if age >= STALE_MAX:
                cache["cal"] = None
        return cache["cal"]


def _dt(v: datetime) -> datetime:
    """Qurşaqsız (floating) vaxt Bakı vaxtı sayılır."""
    return v.replace(tzinfo=BAKU) if v.tzinfo is None else aware(v)


def _events(name: str, start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """Bir mənbənin məşğul aralıqları. Y Pod təqvimində bütün günlük və TRANSPARENT sayılmır;
    şəxsi təqvimdə bütün günlük hadisə günü Bakı vaxtı ilə 00:00–24:00 tutur (DTEND eksklüzivdir).
    Hər ikisində CANCELLED sayılmır."""
    cal = _load(name)
    if cal is None:
        return []
    out = []
    for ev in recurring_ical_events.of(cal).between(start, end):
        if str(ev.get("STATUS", "")).upper() == "CANCELLED":
            continue
        a, b = ev.start, ev.end
        if not isinstance(a, datetime):
            if name == "main":
                continue
            # iCloud TRANSP ötürmür, ona görə şəxsi all-day TRANSP-a baxılmır
            a = datetime(a.year, a.month, a.day, tzinfo=BAKU)
            b = datetime(b.year, b.month, b.day, tzinfo=BAKU) if b else a + timedelta(days=1)
        else:
            if str(ev.get("TRANSP", "")).upper() == "TRANSPARENT":
                continue
            a = _dt(a)
            b = _dt(b) if isinstance(b, datetime) else a
        if b > a:
            out.append((a, b))
    return out


def busy(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """[start, end) ilə kəsişən məşğul aralıqlar (iki mənbə birləşir); URL boşdursa və ya yükləmə alınmırsa []."""
    out = []
    for name in ("main", "personal"):
        try:
            out += _events(name, start, end)
        except Exception as e:  # noqa: BLE001 — biri alınmasa digəri işləyir
            log.warning("ICS təqvimi emal edilmədi (%s: %s)", name, type(e).__name__)
    return out


def titled(start: datetime, end: datetime) -> list[tuple[datetime, datetime, str]]:
    """Y Pod təqviminin [start, end) ilə kəsişən vaxtlı hadisələri başlığı ilə (gündəlik «təqvim / app» müqayisəsi üçün).
    Başlıq yalnız sahibkarın Telegram hesabatına gedir, loglanmır. Alınmasa []."""
    cal = _load("main")
    if cal is None:
        return []
    out = []
    try:
        for ev in recurring_ical_events.of(cal).between(start, end):
            a, b = ev.start, ev.end
            if not isinstance(a, datetime) or str(ev.get("STATUS", "")).upper() == "CANCELLED":
                continue
            a = _dt(a)
            b = _dt(b) if isinstance(b, datetime) else a
            out.append((a, b, " ".join(str(ev.get("SUMMARY", "")).split())))
    except Exception as e:  # noqa: BLE001
        log.warning("ICS başlıqları emal edilmədi (%s)", type(e).__name__)
        return []
    return sorted(out)
