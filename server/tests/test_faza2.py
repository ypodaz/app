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


def edit_body(s, **over):
    keys = ("starts_at", "duration_min", "kind", "tag", "location", "cameras", "editing", "reels_count", "discount",
            "prep_min", "wrap_min")
    return {**{k: s[k] for k in keys}, **over}


def test_edit_shoot_reprices_keeps_deposit_and_notifies(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Zərifə Abbasova")
    s = make_shoot(api, adm, cid)  # 2 saat, 1 kamera, montaj: 240
    api.post(f"/api/admin/shoots/{s['id']}/deposit", json={"amount": 12000}, headers=bearer(adm))
    q = api.post(f"/api/admin/shoots/quote?exclude_id={s['id']}", json={**edit_body(s, duration_min=60, editing=False),
                 "client_id": cid}, headers=bearer(adm)).json()
    assert q["total"] == 7000 and q["conflicts"] == []
    # beh (120) yeni məbləğdən (70) çoxdur → rədd, heç nə dəyişmir
    r = api.patch(f"/api/admin/shoots/{s['id']}", json=edit_body(s, duration_min=60, editing=False), headers=bearer(adm))
    assert r.status_code == 400 and "beh" in r.json()["detail"]
    r = api.patch(f"/api/admin/shoots/{s['id']}", json=edit_body(s, duration_min=180, cameras=2, discount=5000),
                  headers=bearer(adm))
    assert r.status_code == 200, r.text
    e = r.json()
    assert e["total"] == 36000 + 10000 - 5000 and e["deposit_amount"] == 12000 and e["deposit_expected"] == 20500
    assert e["studio_balance"] == 41000 - 12000 and e["conflicts"] == []
    types = [n["type"] for n in api.get("/api/me/notifications", headers=bearer(tok)).json()]
    assert types[0] == "shoot_updated"
    # vaxt dəyişəndə «vaxt dəyişdi» bildirişi, 24 saat qaydası tətbiq olunmur
    later = iso(datetime.fromisoformat(e["starts_at"].replace("Z", "+00:00")) + timedelta(hours=3))
    r = api.patch(f"/api/admin/shoots/{s['id']}", json=edit_body(e, starts_at=later), headers=bearer(adm))
    assert r.status_code == 200 and r.json()["rescheduled_lt24"] is False
    assert api.get("/api/me/notifications", headers=bearer(tok)).json()[0]["type"] == "shoot_rescheduled"
    with SessionLocal() as db:
        from models import AuditLog
        log = db.scalars(select(AuditLog).where(AuditLog.action == "edit").order_by(AuditLog.id)).all()
        assert log[0].before["cameras"] == 1 and log[0].after["cameras"] == 2


def test_edit_closed_shoot_rejected(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Zərifə Abbasova")
    s = make_shoot(api, adm, cid)
    api.post(f"/api/admin/shoots/{s['id']}/close", json={"duration_min": 120, "paid_method": "cash"}, headers=bearer(adm))
    r = api.patch(f"/api/admin/shoots/{s['id']}", json=edit_body(s, duration_min=60), headers=bearer(adm))
    assert r.status_code == 400


def test_ping_and_app_usage(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    new_client(api, adm, "Leyla Həsənova")
    api.post("/api/admin/clients", json={"full_name": "Qoşulmayan"}, headers=bearer(adm))
    assert api.post("/api/me/ping", json={"standalone": True, "permission": "denied"}, headers=bearer(tok)).status_code == 200
    api.post("/api/me/ping", json={"standalone": False, "permission": "granted"}, headers=bearer(tok))  # Safari-dən
    api.post("/api/me/push", json=SUB, headers=bearer(tok))
    u = api.get("/api/admin/dashboard", headers=bearer(adm)).json()["app_usage"]
    assert u == {"clients": 3, "joined": 2, "home_screen": 1, "push_on": 1, "active_7d": 1}
    c = next(x for x in api.get("/api/admin/clients", headers=bearer(adm)).json() if x["id"] == cid)
    assert c["app_standalone"] is True and c["push_permission"] == "granted" and c["app_seen_at"]
    assert api.post("/api/me/ping", json={"standalone": True, "permission": "x"}, headers=bearer(tok)).status_code == 422
