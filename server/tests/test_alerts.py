import os
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["SCHEDULER"] = "0"

import alerts  # noqa: E402
import settings  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402


class SyncThread:
    def __init__(self, target, args, daemon):
        self.target, self.args = target, args

    def start(self):
        self.target(*self.args)


@pytest.fixture()
def sent(monkeypatch):
    out = []
    monkeypatch.setattr(settings, "TG_BOT_TOKEN", "t")
    monkeypatch.setattr(settings, "TG_CHAT_ID", "1")
    monkeypatch.setattr(alerts.threading, "Thread", SyncThread)
    monkeypatch.setattr(alerts, "_post", out.append)
    monkeypatch.setattr(alerts, "_last", {})
    return out


def test_disabled_without_config(monkeypatch):
    monkeypatch.setattr(settings, "TG_BOT_TOKEN", "")
    assert alerts.notify("k", "x") is False


def test_dedupe_same_key(sent):
    assert alerts.notify("k", "bir") is True
    assert alerts.notify("k", "iki") is False
    assert alerts.notify("başqa", "üç") is True
    assert sent == ["Y Pod: bir", "Y Pod: üç"]


def test_unhandled_error_alerts_and_returns_500(sent):
    @app.get("/api/__boom")
    def boom():
        raise RuntimeError("partladı")

    r = TestClient(app, raise_server_exceptions=False).get("/api/__boom")
    assert r.status_code == 500 and r.json() == {"detail": "Xəta baş verdi."}
    assert len(sent) == 1 and "RuntimeError: partladı" in sent[0] and "/api/__boom" in sent[0]
