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
STRICT_MAX = 900  # busy_strict: son uğurlu yükləmə 15 dəqiqədən köhnədirsə yenidən yüklənir

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


class CalendarUnavailable(Exception):
    """busy_strict: təqvim təzə oxuna bilmədi (avtomatik rezerv bu halda saat tutmur)."""


def _load_strict(name: str):
    """Mənbənin təqvimi, ən çoxu STRICT_MAX köhnə; lazımsa yenidən yükləyir. Alınmasa CalendarUnavailable (köhnə keşə düşmür).
    Şəxsi təqvimin URL-i boşdursa None (qurulmayıb); Y Pod təqvimi qurulmayıbsa xəta."""
    url = (settings.APPLE_CAL_ICS_URL if name == "main" else settings.APPLE_CAL_ICS_URL_PERSONAL).strip()
    if not url:
        if name == "main":
            raise CalendarUnavailable("Y Pod təqvimi qurulmayıb")
        return None
    cache = _caches[name]
    with _lock:
        if cache["cal"] is not None and time.monotonic() - cache["at"] < STRICT_MAX:
            return cache["cal"]
        try:
            r = httpx.get("https://" + url[len("webcal://"):] if url.startswith("webcal://") else url,
                          timeout=10, follow_redirects=True)
            r.raise_for_status()
            cache["cal"], cache["at"] = icalendar.Calendar.from_ical(r.content), time.monotonic()
        except Exception as e:  # noqa: BLE001 — URL və cavab mətni loga düşməsin
            log.warning("ICS təqvimi təzə yüklənmədi (%s: %s)", name, type(e).__name__)
            raise CalendarUnavailable(type(e).__name__) from e
        return cache["cal"]


def _dt(v: datetime) -> datetime:
    """Qurşaqsız (floating) vaxt Bakı vaxtı sayılır."""
    return v.replace(tzinfo=BAKU) if v.tzinfo is None else aware(v)


def _events(name: str, start: datetime, end: datetime, cal=None, strict: bool = False) -> list[tuple[datetime, datetime]]:
    """Bir mənbənin məşğul aralıqları. Y Pod təqvimində bütün günlük və TRANSPARENT sayılmır;
    şəxsi təqvimdə bütün günlük hadisə günü Bakı vaxtı ilə 00:00–24:00 tutur (DTEND eksklüzivdir).
    Hər ikisində CANCELLED sayılmır. strict: Y Pod təqvimində də bütün günlük hadisə məşğuldur (busy_strict)."""
    cal = cal if cal is not None else _load(name)
    if cal is None:
        return []
    out = []
    for ev in recurring_ical_events.of(cal).between(start, end):
        if str(ev.get("STATUS", "")).upper() == "CANCELLED":
            continue
        a, b = ev.start, ev.end
        if not isinstance(a, datetime):
            if name == "main" and not strict:
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


def busy_strict(start: datetime, end: datetime) -> list[tuple[datetime, datetime]]:
    """busy() kimi, amma avtomatik rezerv üçün ciddi: təqvimlər ən çoxu 15 dəqiqə köhnə olmalıdır (lazımsa yenidən yüklənir),
    alınmasa və ya emal olunmasa CalendarUnavailable (boş siyahı «boşdur» demək olmasın); bütün günlük hadisələr də məşğuldur."""
    out = []
    for name in ("main", "personal"):
        cal = _load_strict(name)
        if cal is None:
            continue
        try:
            out += _events(name, start, end, cal=cal, strict=True)
        except Exception as e:  # noqa: BLE001
            log.warning("ICS təqvimi emal edilmədi (%s: %s)", name, type(e).__name__)
            raise CalendarUnavailable(type(e).__name__) from e
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


def detailed(start: datetime, end: datetime) -> list[dict] | None:
    """Y Pod təqviminin [start, end) ilə kəsişən vaxtlı hadisələri, çəkilişi avtomatik yaratmaq üçün (crm/calendar_sync.py):
    uid (təkrarlanan hadisədə + təkrar nömrəsi), start, end, title, desc. Yükləmə və ya emal alınmasa None
    (boş siyahıdan fərqli: «hadisə yoxdur» demək deyil). Başlıq və təsvir loglanmır."""
    cal = _load("main")
    if cal is None:
        return None
    out = []
    try:
        for ev in recurring_ical_events.of(cal).between(start, end):
            a, b = ev.start, ev.end
            if not isinstance(a, datetime) or str(ev.get("STATUS", "")).upper() == "CANCELLED":
                continue
            a = _dt(a)
            b = _dt(b) if isinstance(b, datetime) else a
            uid = str(ev.get("UID", "")).strip()
            if not uid:
                continue
            rid = ev.get("RECURRENCE-ID")
            if rid is not None:
                uid += "#" + (_dt(rid.dt).isoformat() if isinstance(rid.dt, datetime) else str(rid.dt))
            elif ev.get("RRULE") is not None:
                uid += "#" + a.isoformat()
            out.append({"uid": uid[:255], "start": a, "end": b, "title": " ".join(str(ev.get("SUMMARY", "")).split()),
                        "desc": " ".join(str(ev.get("DESCRIPTION", "")).split())})
    except Exception as e:  # noqa: BLE001
        log.warning("ICS hadisələri emal edilmədi (%s)", type(e).__name__)
        return None
    return sorted(out, key=lambda e: e["start"])
