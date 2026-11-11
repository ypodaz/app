from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)

from datetime import datetime, timezone  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

import settings  # noqa: E402
from crm import calendar_ics, slots  # noqa: E402
from db import SessionLocal  # noqa: E402
from views import BAKU  # noqa: E402

URL = "https://p01-caldav.icloud.com/published/2/GIZLI-TOKEN"
PERSONAL = "https://p01-caldav.icloud.com/published/2/SEXSI-TOKEN"


def ics(*events):
    return ("BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//test//EN\r\n" + "".join(
        f"BEGIN:VEVENT\r\nUID:u{i}\r\nDTSTAMP:20261101T000000Z\r\nSUMMARY:Gizli ad\r\n{e}\r\nEND:VEVENT\r\n"
        for i, e in enumerate(events)) + "END:VCALENDAR\r\n").encode()


@pytest.fixture(autouse=True)
def net(monkeypatch):
    """Keş sıfırlanır, URL təyin olunur; httpx.get əvəz olunur (real sorğu yoxdur)."""
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL", URL)
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL_PERSONAL", "")
    for c in calendar_ics._caches.values():
        c.update(cal=None, at=0.0, fail=-1e9)
    calls = []
    state = {"body": ics(), "error": None, "personal": ics(), "personal_error": None}

    def fake_get(url, **kw):
        calls.append((url, kw))
        personal = url == PERSONAL
        if state["personal_error" if personal else "error"]:
            raise state["personal_error" if personal else "error"]
        return httpx.Response(200, content=state["personal" if personal else "body"], request=httpx.Request("GET", url))

    monkeypatch.setattr(calendar_ics.httpx, "get", fake_get)
    state["calls"] = calls
    return state


W0, W1 = datetime(2026, 11, 11, tzinfo=BAKU), datetime(2026, 11, 25, tzinfo=BAKU)


def test_regular_event_is_busy_and_subtracted_in_free_text(net, api):
    net["body"] = ics("DTSTART:20261112T100000Z\r\nDTEND:20261112T120000Z")  # Bakı 14:00–16:00
    assert calendar_ics.busy(W0, W1) == [(datetime(2026, 11, 12, 10, tzinfo=timezone.utc),
                                          datetime(2026, 11, 12, 12, tzinfo=timezone.utc))]
    now_dt = datetime(2026, 11, 11, 5, 0, tzinfo=timezone.utc)
    with SessionLocal() as db:
        lines = slots.free_text(db, now_dt).splitlines()
    assert lines[1] == "Cümə axşamı 12.11: 08:00–14:00, 16:00–22:00"


def test_all_day_transparent_and_cancelled_ignored(net):
    net["body"] = ics("DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113",
                      "DTSTART:20261112T100000Z\r\nDTEND:20261112T120000Z\r\nTRANSP:TRANSPARENT",
                      "DTSTART:20261112T100000Z\r\nDTEND:20261112T120000Z\r\nSTATUS:CANCELLED")
    assert calendar_ics.busy(W0, W1) == []


def test_weekly_rrule_with_exdate(net):
    net["body"] = ics("DTSTART:20261112T100000Z\r\nDTEND:20261112T110000Z\r\nRRULE:FREQ=WEEKLY\r\n"
                      "EXDATE:20261119T100000Z")
    w1 = datetime(2026, 12, 4, tzinfo=BAKU)
    assert [a.day for a, _ in calendar_ics.busy(W0, w1)] == [12, 26, 3]  # 19-u EXDATE çıxarıb


def test_floating_time_is_baku(net):
    net["body"] = ics("DTSTART:20261112T140000\r\nDTEND:20261112T150000")
    (a, b), = calendar_ics.busy(W0, W1)
    assert a == datetime(2026, 11, 12, 14, tzinfo=BAKU) and b == datetime(2026, 11, 12, 15, tzinfo=BAKU)


def test_empty_url_makes_no_request(net, monkeypatch):
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL", "")
    assert calendar_ics.busy(W0, W1) == [] and net["calls"] == []


def test_webcal_becomes_https_and_cache_used(net, monkeypatch):
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL", "webcal://p01.icloud.com/published/x")
    calendar_ics.busy(W0, W1)
    calendar_ics.busy(W0, W1)
    (url, kw), = net["calls"]  # ikinci çağırış keşdən
    assert url == "https://p01.icloud.com/published/x" and kw["timeout"] == 10 and kw["follow_redirects"] is True


def test_network_error_uses_stale_cache_else_empty_and_no_url_in_log(net, caplog):
    net["error"] = httpx.ConnectError(f"boom {URL}")
    assert calendar_ics.busy(W0, W1) == []  # keş yoxdur
    assert URL not in caplog.text and "GIZLI" not in caplog.text and "ConnectError" in caplog.text
    # əvvəl uğurlu yükləmə, sonra TTL bitir və şəbəkə düşür → köhnə keş
    net["error"] = None
    net["body"] = ics("DTSTART:20261112T100000Z\r\nDTEND:20261112T120000Z")
    calendar_ics._cache["fail"] = -1e9
    assert len(calendar_ics.busy(W0, W1)) == 1
    calendar_ics._cache["at"] -= calendar_ics.TTL + 1
    net["error"] = httpx.ConnectError("boom")
    assert len(calendar_ics.busy(W0, W1)) == 1
    calendar_ics._cache["at"] -= calendar_ics.STALE_MAX  # 24 saatdan köhnə keş atılır
    calendar_ics._cache["fail"] = -1e9
    assert calendar_ics.busy(W0, W1) == []


def test_personal_merges_with_main_and_all_day_blocks_full_baku_days(net, monkeypatch):
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL_PERSONAL", PERSONAL)
    net["body"] = ics("DTSTART:20261112T100000Z\r\nDTEND:20261112T120000Z",
                      "DTSTART;VALUE=DATE:20261114\r\nDTEND;VALUE=DATE:20261115")  # Y Pod all-day sayılmır
    # iki günlük all-day (DTEND eksklüzivdir) + TRANSPARENT olsa da atılmır; CANCELLED atılır
    net["personal"] = ics("DTSTART;VALUE=DATE:20261116\r\nDTEND;VALUE=DATE:20261118\r\nTRANSP:TRANSPARENT",
                          "DTSTART;VALUE=DATE:20261120\r\nDTEND;VALUE=DATE:20261121\r\nSTATUS:CANCELLED")
    got = sorted(calendar_ics.busy(W0, W1))
    assert got == [(datetime(2026, 11, 12, 10, tzinfo=timezone.utc), datetime(2026, 11, 12, 12, tzinfo=timezone.utc)),
                   (datetime(2026, 11, 16, tzinfo=BAKU), datetime(2026, 11, 18, tzinfo=BAKU))]


def test_personal_all_day_closes_day_in_free_text(net, api, monkeypatch):
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL_PERSONAL", PERSONAL)
    net["personal"] = ics("DTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113")
    now_dt = datetime(2026, 11, 11, 5, 0, tzinfo=timezone.utc)
    with SessionLocal() as db:
        text = slots.free_text(db, now_dt)
    assert "12.11" not in text


def test_one_source_failing_does_not_break_other(net, monkeypatch, caplog):
    monkeypatch.setattr(settings, "APPLE_CAL_ICS_URL_PERSONAL", PERSONAL)
    net["error"] = httpx.ConnectError(f"boom {URL}")
    net["personal"] = ics("DTSTART;VALUE=DATE:20261116\r\nDTEND;VALUE=DATE:20261117")
    assert calendar_ics.busy(W0, W1) == [(datetime(2026, 11, 16, tzinfo=BAKU), datetime(2026, 11, 17, tzinfo=BAKU))]
    assert "GIZLI" not in caplog.text and "SEXSI" not in caplog.text
    # tərsinə: şəxsi düşür, əsas işləyir
    net["error"], net["personal_error"] = None, httpx.ConnectError("boom")
    calendar_ics._caches["main"]["fail"] = calendar_ics._caches["personal"]["at"] = -1e9
    net["body"] = ics("DTSTART:20261112T100000Z\r\nDTEND:20261112T120000Z")
    assert len(calendar_ics.busy(W0, W1)) == 1
