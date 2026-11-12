from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import Resp, crm_env  # noqa: F401,I001

from datetime import datetime, timedelta, timezone  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

import settings  # noqa: E402
from crm import conf, ig_stats, worker  # noqa: E402
from db import SessionLocal  # noqa: E402

BAKU = timezone(timedelta(hours=4))
MONDAY = datetime(2026, 11, 16, 10, 5, tzinfo=BAKU)  # ötən həftə: 09.11–15.11


def _media(caption, day, views, reach=0):
    return {"id": caption, "caption": caption, "media_product_type": "REELS", "permalink": f"https://ig/{caption}",
            "timestamp": f"2026-11-{day:02d}T08:00:00+0000",
            "insights": {"data": [{"name": "views", "values": [{"value": views}]},
                                  {"name": "reach", "values": [{"value": reach}]},
                                  {"name": "saved", "values": [{"value": 2}]}]}}


@pytest.fixture()
def ig(api, crm_env, monkeypatch):  # noqa: F811
    for k, v in {"IG_ACCESS_TOKEN": "tok", "IG_APP_SECRET": "s", "IG_USER_ID": "1"}.items():
        monkeypatch.setattr(settings, k, v)
    st = {"calls": [], "error": None}

    def fake_get(url, params=None, **kw):
        st["calls"].append((url, params))
        if st["error"]:
            return Resp(400, {"error": {"message": st["error"]}})
        if url.endswith("/me/insights"):
            cur = params["since"] >= int(datetime(2026, 11, 9, tzinfo=BAKU).timestamp())
            vals = {"reach": 1200, "views": 5000} if cur else {"reach": 1000, "views": 5000}
            return Resp(200, {"data": [{"name": m, "total_value": {"value": vals.get(m, 7)}}
                                       for m in params["metric"].split(",")]})
        if url.endswith("/me/media"):
            return Resp(200, {"data": [_media("Birinci", 10, 900, 600), _media("Ikinci", 11, 300),
                                       _media("Ucuncu", 12, 1500), _media("Dorduncu", 14, 50),
                                       _media("Kohne", 5, 9999)]})
        if url.endswith("/me"):
            return Resp(200, {"followers_count": 1530})
        raise AssertionError(url)

    monkeypatch.setattr(httpx, "get", fake_get)
    return st


def test_week_bounds_is_previous_monday_to_monday():
    since, until = ig_stats.week_bounds(MONDAY)
    assert (since.isoformat(), until.isoformat()) == ("2026-11-09T00:00:00+04:00", "2026-11-16T00:00:00+04:00")
    since2, _ = ig_stats.week_bounds(datetime(2026, 11, 15, 23, tzinfo=BAKU))  # bazar: həftə hələ bitməyib
    assert since2.isoformat().startswith("2026-11-02")


def test_due_only_monday_after_ten_once(ig):
    with SessionLocal() as db:
        assert not ig_stats.due(db, MONDAY - timedelta(minutes=10))
        assert not ig_stats.due(db, MONDAY + timedelta(days=1))
        assert ig_stats.due(db, MONDAY)
        assert ig_stats.send(db, MONDAY) is True
        assert not ig_stats.due(db, MONDAY + timedelta(hours=3))
        conf.put(db, "ig_weekly_enabled", "false")
        assert not ig_stats.due(db, MONDAY + timedelta(days=7))


def test_due_off_without_instagram(api, monkeypatch):  # noqa: F811
    monkeypatch.setattr(settings, "IG_ACCESS_TOKEN", "")
    with SessionLocal() as db:
        assert not ig_stats.due(db, MONDAY)


def test_report_text(ig, crm_env):  # noqa: F811
    with SessionLocal() as db:
        conf.put(db, "ig_followers_week", "1500")
        assert ig_stats.send(db, MONDAY) is True
        assert conf.get(db, "ig_followers_week") == "1530"
    text = crm_env.tg("sendMessage")[0]["text"]
    assert text.startswith("📈 Instagram həftəsi, 09.11–15.11")
    assert "İzləyici: 1 530 (+30 həftədə)" in text
    assert "Əhatə (unikal hesab): 1 200 (ötən həftə 1 000, +20%)" in text
    assert "Baxış: 5 000 (ötən həftə 5 000, +0%)" in text
    lines = text.splitlines()
    top = lines.index("Paylaşımlar: 4. Ən çox baxılan:")
    assert lines[top + 1].startswith("• Ucuncu — 1 500 baxış")
    assert lines[top + 2].startswith("• Birinci — 900 baxış, 600 əhatə")
    assert lines[-2] == "Ən az baxılan:" and lines[-1].startswith("• Dorduncu — 50 baxış")
    assert "Kohne" not in text


def test_error_goes_to_server_topic_and_marks_day(ig, crm_env):  # noqa: F811
    ig["error"] = "Invalid OAuth access token"
    with SessionLocal() as db:
        assert ig_stats.send(db, MONDAY) is False
        assert not ig_stats.due(db, MONDAY + timedelta(hours=1))
    sent = crm_env.tg("sendMessage")
    assert len(sent) == 1 and "alınmadı: Invalid OAuth" in sent[0]["text"]


def test_worker_run_survives_ig_stats_error(api, monkeypatch):  # noqa: F811
    def boom(db, t):
        raise RuntimeError("x")
    monkeypatch.setattr(ig_stats, "due", lambda db, t: True)
    monkeypatch.setattr(ig_stats, "send", boom)
    with SessionLocal() as db:
        assert worker.run(db) == 0
