"""routes/calendar_feed.py: app çəkilişlərinin ICS feed-i (token, süzgəc, ləğv, bloklar, admin linki)."""
from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402

import settings  # noqa: E402
from auth import new_card_code  # noqa: E402
from crm import calendar_import  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import Block, CalendarLink, Client, Shoot  # noqa: E402
from routes import calendar_feed  # noqa: E402

TOKEN = "t" * 40


@pytest.fixture
def feed_on(monkeypatch):
    monkeypatch.setattr(settings, "CALENDAR_FEED_TOKEN", TOKEN)
    monkeypatch.setattr(settings, "CALENDAR_PERSONAL_LABEL", "Testşəxsi blok")


def mk_shoot(start, *, name="Nümunə Müştəri", status="confirmed", **kw):
    with SessionLocal() as db:
        c = Client(full_name=name, phone="", card_code=new_card_code())
        db.add(c)
        db.flush()
        s = Shoot(client_id=c.id, kind="shoot", tag="podcast", location="studio", starts_at=start, duration_min=90,
                  cameras=2, status=status, **kw)
        db.add(s)
        db.commit()
        return s.id


def get_feed(api, token=TOKEN):
    return api.get(f"/api/calendar/{token}.ics")


def test_feed_closed_without_token_or_with_wrong_token(api, monkeypatch):
    monkeypatch.setattr(settings, "CALENDAR_FEED_TOKEN", "")
    assert get_feed(api).status_code == 404
    monkeypatch.setattr(settings, "CALENDAR_FEED_TOKEN", TOKEN)
    assert get_feed(api, "x" * 40).status_code == 404


def test_feed_has_app_shoots_only(api, feed_on):
    t = now()
    own = mk_shoot(t + timedelta(days=2), name="Testa Müştəri")
    cancelled = mk_shoot(t + timedelta(days=3), status="cancelled")
    mk_shoot(t + timedelta(days=4), calendar_uid="abc@icloud")  # Apple təqvimindən: artıq orada var
    mk_shoot(t + timedelta(days=5), source_note="calendar")
    mk_shoot(t - timedelta(days=5), source_note="calendar-archive")
    old = mk_shoot(t - timedelta(days=40))  # 30 gündən köhnə
    r = get_feed(api)
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert body.startswith("BEGIN:VCALENDAR\r\n") and body.endswith("END:VCALENDAR\r\n")
    assert body.count("BEGIN:VEVENT") == 2
    assert f"UID:shoot-{own}@ypod" in body and f"UID:shoot-{cancelled}@ypod" in body
    assert f"shoot-{old}@ypod" not in body
    assert "SUMMARY:Testa M. · Çəkiliş" in body
    ev = body.split(f"UID:shoot-{cancelled}@ypod")[1].split("END:VEVENT")[0]
    assert "STATUS:CANCELLED" in ev


def test_event_times_are_utc_and_end_uses_duration(api, feed_on):
    mk_shoot(datetime(2030, 1, 10, 6, 0, tzinfo=timezone.utc))  # Bakı 10:00; app vaxtı UTC ilə yazır (views.utc)
    body = get_feed(api).text
    assert "DTSTART:20300110T060000Z" in body and "DTEND:20300110T073000Z" in body


def test_blocks_from_app_only(api, feed_on):
    t = now()
    with SessionLocal() as db:
        db.add_all([
            Block(starts_at=t + timedelta(days=1), ends_at=t + timedelta(days=1, hours=2), reason="Təmir"),
            Block(starts_at=t + timedelta(days=2), ends_at=t + timedelta(days=2, hours=2), reason=calendar_import.SUBLET),
            Block(starts_at=t + timedelta(days=3), ends_at=t + timedelta(days=3, hours=2), reason="Testşəxsi blok"),
            Block(starts_at=t + timedelta(days=4), ends_at=t + timedelta(days=4, hours=2), reason="Təqvimdən"),
            CalendarLink(uid="b1@icloud", state="block", title="x", starts_at=t + timedelta(days=4)),
        ])
        db.commit()
    body = get_feed(api).text
    assert body.count("BEGIN:VEVENT") == 1
    assert "SUMMARY:🔒 Təmir" in body


def test_long_lines_are_folded_and_text_escaped():
    parts = calendar_feed._fold("DESCRIPTION:" + calendar_feed._esc("ə" * 60 + ", ; \\"))
    assert len(parts) > 1
    assert all(len(p.encode()) <= 75 for p in parts)
    assert all(p.startswith(" ") for p in parts[1:])
    assert "".join(p[1:] if i else p for i, p in enumerate(parts)).endswith("\\, \\; \\\\")


def test_admin_link(api, monkeypatch):
    tok = admin_token(api)
    monkeypatch.setattr(settings, "CALENDAR_FEED_TOKEN", "")
    assert api.get("/api/admin/calendar-feed", headers=bearer(tok)).json() == {"enabled": False, "path": None}
    monkeypatch.setattr(settings, "CALENDAR_FEED_TOKEN", TOKEN)
    assert api.get("/api/admin/calendar-feed", headers=bearer(tok)).json() == {
        "enabled": True, "path": f"/calendar/{TOKEN}.ics"}
    assert api.get("/api/admin/calendar-feed").status_code == 401
