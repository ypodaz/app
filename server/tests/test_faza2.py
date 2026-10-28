from datetime import datetime, timedelta, timezone

from test_api_faza1 import iso, make_shoot, new_client  # noqa: F401,I001  (env-i əvvəl qurur)
from test_auth import admin_token, api, bearer  # noqa: F401,I001

from sqlalchemy import select  # noqa: E402

import push  # noqa: E402
import settings  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import Notification, PushSubscription, Shoot  # noqa: E402
from views import BAKU  # noqa: E402

SUB = {"endpoint": "https://push.example/abc123", "p256dh": "B" * 20, "auth": "a" * 8}


def test_push_subscribe_and_send(api, monkeypatch):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    assert api.get("/api/me/push", headers=bearer(tok)).json() == {"public_key": "", "subscribed": False}
    assert api.post("/api/me/push", json=SUB, headers=bearer(tok)).status_code == 200
    assert api.post("/api/me/push", json=SUB, headers=bearer(tok)).status_code == 200  # təkrar abunə dublikat etmir
    assert api.get("/api/me/push", params={"endpoint": SUB["endpoint"]}, headers=bearer(tok)).json()["subscribed"]
    s = make_shoot(api, adm, cid)
    sent = []
    monkeypatch.setattr(settings, "VAPID_PRIVATE_KEY", "x")
    monkeypatch.setattr(push, "_send", lambda sub, data: sent.append(data) or True)
    with SessionLocal() as db:
        assert push.send_pending(db) == 1
        assert push.send_pending(db) == 0
    assert sent[0]["title"] == "Yeni çəkiliş" and sent[0]["url"] == f"#/shoots/{s['id']}"
    # abunə itibsə silinir
    api.post(f"/api/admin/shoots/{s['id']}/deposit", json={"amount": 12000}, headers=bearer(adm))
    monkeypatch.setattr(push, "_send", lambda sub, data: False)
    with SessionLocal() as db:
        push.send_pending(db)
        assert db.scalar(select(PushSubscription)) is None


def test_reminder_once_and_not_for_last_minute(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    t = datetime.now(timezone.utc).replace(second=0, microsecond=0)
    s1 = make_shoot(api, adm, cid, starts_at=iso(t + timedelta(hours=20)))
    s2 = make_shoot(api, adm, cid, starts_at=iso(t + timedelta(hours=2)))
    make_shoot(api, adm, cid, starts_at=iso(t + timedelta(hours=30)))
    with SessionLocal() as db:
        push.make_reminders(db)
        push.make_reminders(db)
        rem = db.scalars(select(Notification).where(Notification.type == "shoot_reminder")).all()
        assert [n.payload["shoot_id"] for n in rem] == [s1["id"]]
        assert db.get(Shoot, s2["id"]).reminded_at is not None
        assert push.message(db, rem[0])["title"] == "Sabah çəkilişiniz var"


def test_materials_ready_notifies_once(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid)
    for _ in range(2):
        api.patch(f"/api/admin/shoots/{s['id']}/production", json={"production": "ready"}, headers=bearer(adm))
    types = [n["type"] for n in api.get("/api/me/notifications", headers=bearer(tok)).json()]
    assert types.count("materials_ready") == 1


def test_monthly_report(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid, discount=4000)  # 240 − 40 = 200
    api.post(f"/api/admin/shoots/{s['id']}/deposit", json={"amount": 10000}, headers=bearer(adm))
    api.post(f"/api/admin/shoots/{s['id']}/close", json={"duration_min": 120, "paid_method": "cash"},
             headers=bearer(adm))
    month = datetime.fromisoformat(s["starts_at"].replace("Z", "+00:00")).astimezone(BAKU).strftime("%Y-%m")
    r = api.get("/api/admin/report", params={"month": month}, headers=bearer(adm)).json()
    assert r["shoots"]["completed"] == 1 and r["shoots"]["revenue"] == 20000 and r["shoots"]["discounts"] == 4000
    now_m = datetime.now(BAKU).strftime("%Y-%m")
    cb = api.get("/api/admin/report", params={"month": now_m}, headers=bearer(adm)).json()["cashback"]
    assert cb["earned"] == 10000 and cb["liability"] == 10000  # keşbek bağlama günü yazılır
    assert r["shoots"]["by_kind"]["shoot"] == {"count": 1, "minutes": 120, "total": 20000}
    assert api.get("/api/admin/report", params={"month": "2026-13"}, headers=bearer(adm)).status_code == 422
