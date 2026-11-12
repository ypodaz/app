from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import Resp, crm_env  # noqa: F401,I001

from datetime import timedelta  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402

import alerts  # noqa: E402
import settings  # noqa: E402
from crm import conf, instagram  # noqa: E402
from db import SessionLocal, now  # noqa: E402


@pytest.fixture()
def ig(api, crm_env, monkeypatch):  # noqa: F811  (api cədvəlləri yaradır)
    for k, v in {"IG_ACCESS_TOKEN": "env-tok", "IG_APP_SECRET": "s", "IG_USER_ID": "1"}.items():
        monkeypatch.setattr(settings, k, v)
    monkeypatch.setattr(instagram, "_state", {"alerted": False})
    st = {"calls": [], "resp": Resp(200, {"access_token": "new-tok", "token_type": "bearer", "expires_in": 5184000}),
          "alerts": []}

    def fake_get(url, **kw):
        st["calls"].append((url, kw))
        return st["resp"]

    def fake_post(url, **kw):
        st["calls"].append((url, kw))
        return Resp(200, {"id": "c9"})

    monkeypatch.setattr(httpx, "get", fake_get)
    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(alerts, "notify", lambda key, text, topic="server": st["alerts"].append((key, text)) or True)
    return st


def age(db, days):
    conf.put(db, instagram.REFRESHED_KEY, (now() - timedelta(days=days)).isoformat())
    db.commit()


def test_first_run_only_records(ig):
    with SessionLocal() as db:
        assert instagram.refresh(db) is False
        assert ig["calls"] == []  # təzə tokeni Meta 24 saatdan əvvəl yeniləmir
        assert instagram.token(db) == "env-tok"


def test_refresh_after_week(ig):
    with SessionLocal() as db:
        instagram.refresh(db)
        age(db, 8)
        assert instagram.refresh(db) is True
        [(url, kw)] = ig["calls"]
        assert url == "https://graph.instagram.com/refresh_access_token"
        assert kw["params"] == {"grant_type": "ig_refresh_token", "access_token": "env-tok"}
        assert instagram.token(db) == "new-tok"
        assert instagram.refresh(db) is False and len(ig["calls"]) == 1  # bir həftə keçməyib
    instagram.reply_comment("c1", "Təşəkkürlər!")
    assert ig["calls"][-1][1]["headers"]["Authorization"] == "Bearer new-tok"


def test_next_refresh_uses_saved_token(ig):
    with SessionLocal() as db:
        instagram.refresh(db)
        age(db, 8)
        instagram.refresh(db)
        age(db, 8)
        ig["resp"] = Resp(200, {"access_token": "newer-tok"})
        assert instagram.refresh(db) is True
        assert ig["calls"][-1][1]["params"]["access_token"] == "new-tok"
        assert instagram.token(db) == "newer-tok"


def test_owner_replaces_env_token(ig, monkeypatch):
    with SessionLocal() as db:
        instagram.refresh(db)
        age(db, 8)
        instagram.refresh(db)
        monkeypatch.setattr(settings, "IG_ACCESS_TOKEN", "owner-new")
        assert instagram.token(db) == "owner-new"  # bazadakı köhnə nüsxə başqa tokendəndir
        n = len(ig["calls"])
        assert instagram.refresh(db) is False and len(ig["calls"]) == n  # yeni token təzədir, yeniləmə yoxdur
        assert instagram.token(db) == "owner-new"


def test_failure_alerts_once_and_keeps_token(ig):
    ig["resp"] = Resp(400, {"error": {"message": "Error validating access token"}})
    with SessionLocal() as db:
        instagram.refresh(db)
        age(db, 8)
        assert instagram.refresh(db) is False
        assert instagram.refresh(db) is False  # növbəti saat yenə cəhd edir
        assert len(ig["calls"]) == 2
        assert len(ig["alerts"]) == 1 and "Error validating access token" in ig["alerts"][0][1]
        assert instagram.token(db) == "env-tok"
        ig["resp"] = Resp(200, {"access_token": "new-tok"})
        assert instagram.refresh(db) is True and instagram._state["alerted"] is False


def test_disabled_does_nothing(ig, monkeypatch):
    monkeypatch.setattr(settings, "IG_USER_ID", "")
    with SessionLocal() as db:
        assert instagram.refresh(db) is False
        assert conf.get(db, instagram.SOURCE_KEY) is None
