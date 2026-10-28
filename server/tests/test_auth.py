import os
import sys
from datetime import timedelta
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///./test.db"
os.environ["ADMIN_LOGIN"] = "yashar"
os.environ["SCHEDULER"] = "0"

from argon2 import PasswordHasher  # noqa: E402

os.environ["ADMIN_PASSWORD_HASH"] = PasswordHasher().hash("duzgun-parol-123")

import auth  # noqa: E402
import settings  # noqa: E402
from db import Base, SessionLocal, engine, now  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from main import app  # noqa: E402
from models import Invite, PairCode  # noqa: E402


@pytest.fixture()
def api():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    auth._hits.clear()
    with TestClient(app) as c:
        yield c
    engine.dispose()
    Path("test.db").unlink(missing_ok=True)


def bearer(token):
    return {"Authorization": f"Bearer {token}"}


def admin_token(api):
    r = api.post("/api/admin/login", json={"login": "yashar", "password": "duzgun-parol-123"})
    assert r.status_code == 200
    return r.json()["token"]


def invite_link(api, adm, name="Aysel Məmmədova", phone="055 530 35 32"):
    cid = api.post("/api/admin/clients", json={"full_name": name, "phone": phone}, headers=bearer(adm)).json()["id"]
    r = api.post(f"/api/admin/clients/{cid}/invite", headers=bearer(adm)).json()
    return cid, r


def token_of(url):
    return url.split("?i=")[1]


def test_invite_redeem_and_me(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    assert inv["url"].startswith(settings.APP_URL + "?i=")
    assert inv["whatsapp_url"].startswith("https://wa.me/994555303532?text=")
    r = api.post("/api/auth/redeem", json={"token": token_of(inv["url"])})
    assert r.status_code == 200
    body = r.json()
    assert len(body["pair_code"]) == 6
    me = api.get("/api/me", headers=bearer(body["token"])).json()
    assert me["full_name"] == "Aysel Məmmədova" and me["card_code"]


def test_invite_is_single_use(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    assert api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).status_code == 200
    assert api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).status_code == 400


def test_expired_invite_rejected(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    with SessionLocal() as db:
        for i in db.query(Invite):
            i.expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).status_code == 400


def test_pair_code_gives_new_session_once(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    code = api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).json()["pair_code"]
    r = api.post("/api/auth/pair", json={"code": code})
    assert r.status_code == 200
    assert api.get("/api/me", headers=bearer(r.json()["token"])).status_code == 200
    assert api.post("/api/auth/pair", json={"code": code}).status_code == 400


def test_expired_pair_code_rejected(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    code = api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).json()["pair_code"]
    with SessionLocal() as db:
        for p in db.query(PairCode):
            p.expires_at = now() - timedelta(seconds=1)
        db.commit()
    assert api.post("/api/auth/pair", json={"code": code}).status_code == 400


def test_new_pair_code_invalidates_previous(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    body = api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).json()
    fresh = api.post("/api/me/pair-code", headers=bearer(body["token"])).json()["pair_code"]
    if fresh != body["pair_code"]:
        assert api.post("/api/auth/pair", json={"code": body["pair_code"]}).status_code == 400
    assert api.post("/api/auth/pair", json={"code": fresh}).status_code == 200


def test_new_invite_revokes_old_sessions_and_links(api):
    adm = admin_token(api)
    cid, inv1 = invite_link(api, adm)
    old = api.post("/api/auth/redeem", json={"token": token_of(inv1["url"])}).json()["token"]
    inv_unused = api.post(f"/api/admin/clients/{cid}/invite", headers=bearer(adm)).json()
    api.post(f"/api/admin/clients/{cid}/invite", headers=bearer(adm))
    assert api.get("/api/me", headers=bearer(old)).status_code == 401
    assert api.post("/api/auth/redeem", json={"token": token_of(inv_unused["url"])}).status_code == 400


def test_pair_code_rate_limited(api):
    for _ in range(10):
        api.post("/api/auth/pair", json={"code": "000000"})
    assert api.post("/api/auth/pair", json={"code": "000000"}).status_code == 429


def test_admin_lockout_after_five_fails(api):
    for _ in range(5):
        assert api.post("/api/admin/login", json={"login": "yashar", "password": "sehv"}).status_code == 400
    r = api.post("/api/admin/login", json={"login": "yashar", "password": "duzgun-parol-123"})
    assert r.status_code == 423


def test_client_token_cannot_use_admin_api(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    tok = api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).json()["token"]
    assert api.get("/api/admin/clients", headers=bearer(tok)).status_code == 401
    assert api.get("/api/me", headers=bearer(adm)).status_code == 401
    assert api.get("/api/admin/clients").status_code == 401


def test_admin_finds_client_by_card(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    tok = api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).json()["token"]
    card = api.get("/api/me", headers=bearer(tok)).json()["card_code"]
    r = api.get(f"/api/admin/cards/{card}", headers=bearer(adm))
    assert r.status_code == 200 and r.json()["activated"] is True
    assert api.get("/api/admin/cards/yoxdur", headers=bearer(adm)).status_code == 404


def test_logout_ends_session(api):
    adm = admin_token(api)
    _, inv = invite_link(api, adm)
    tok = api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).json()["token"]
    assert api.post("/api/me/logout", headers=bearer(tok)).status_code == 200
    assert api.get("/api/me", headers=bearer(tok)).status_code == 401


def test_changed_admin_login_renames_single_admin(api, monkeypatch):
    from models import Admin
    old = admin_token(api)
    monkeypatch.setattr(settings, "ADMIN_LOGIN", "yeni-login")
    with SessionLocal() as db:
        auth.ensure_admin(db)
        assert [a.login for a in db.query(Admin).all()] == ["yeni-login"]
    assert api.post("/api/admin/login", json={"login": "yashar", "password": "duzgun-parol-123"}).status_code == 400
    assert api.post("/api/admin/login", json={"login": "yeni-login", "password": "duzgun-parol-123"}).status_code == 200
    assert api.get("/api/admin/whoami", headers=bearer(old)).status_code == 401
