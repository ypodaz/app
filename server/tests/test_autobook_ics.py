"""Avtomatik rezerv: təqvim (ICS) ciddi oxunur (calendar_ics.busy_strict) və check ona əsaslanır."""
from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from test_crm_calendar import PERSONAL, W0, W1, ics, net  # noqa: F401,I001

from datetime import date, datetime  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

import settings  # noqa: E402
from crm import autobook, calendar_ics  # noqa: E402
from db import SessionLocal  # noqa: E402
from views import BAKU  # noqa: E402

TODAY = date(2026, 11, 20)


def at(day, hh):
    return datetime(2026, 11, day, hh, tzinfo=BAKU)


def test_check_calendar_event_conflicts(api, net):
    net["body"] = ics("DTSTART:20261124T080000Z\r\nDTEND:20261124T090000Z")  # Bakı 12:00–13:00
    with SessionLocal() as db:
        assert autobook.check(db, datetime(2026, 11, 24, 13, 59, tzinfo=BAKU), 60, TODAY) == (False, "conflict")  # bufer: 13:00 + 60 dəq
        assert autobook.check(db, at(24, 14), 60, TODAY)[0]


def test_all_day_event_in_main_calendar_is_busy_strict_only(api, net):
    net["body"] = ics("DTSTART;VALUE=DATE:20261124\r\nDTEND;VALUE=DATE:20261125")
    assert calendar_ics.busy(W0, W1) == []  # köhnə busy() dəyişməyib
    with SessionLocal() as db:
        assert autobook.check(db, at(24, 12), 60, TODAY) == (False, "conflict")
        assert autobook.check(db, at(25, 12), 60, TODAY)[0]


def test_unavailable_when_refresh_fails_even_with_old_cache(api, net, monkeypatch):
    clock = [1000.0]
    monkeypatch.setattr(calendar_ics.time, "monotonic", lambda: clock[0])
    assert calendar_ics.busy_strict(W0, W1) == []  # yükləndi
    net["error"] = httpx.ConnectError("x")
    clock[0] += 800  # 15 dəqiqədən az: keş təzədir
    assert calendar_ics.busy_strict(W0, W1) == []
    clock[0] += 200  # 15 dəqiqədən çox: yenidən yüklənməlidir, alınmır
    with pytest.raises(calendar_ics.CalendarUnavailable):
        calendar_ics.busy_strict(W0, W1)
    with SessionLocal() as db:
        assert autobook.check(db, at(24, 12), 60, TODAY) == (False, "calendar")
    assert calendar_ics.busy(W0, W1) == []  # adi busy() köhnə keşlə susmağa davam edir


def test_main_url_missing_is_unavailable(api, net, monkeypatch):
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL", "")
    with pytest.raises(calendar_ics.CalendarUnavailable):
        calendar_ics.busy_strict(W0, W1)


def test_personal_calendar_failure_is_unavailable(api, net, monkeypatch):
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL_PERSONAL", PERSONAL)
    net["personal_error"] = httpx.ConnectError("x")
    with pytest.raises(calendar_ics.CalendarUnavailable):
        calendar_ics.busy_strict(W0, W1)
