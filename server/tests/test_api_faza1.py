from datetime import datetime, timedelta, timezone

from test_auth import admin_token, api, bearer, invite_link, token_of  # noqa: F401,I001  (env-i əvvəl qurur)

from sqlalchemy import func, select  # noqa: E402

from db import SessionLocal  # noqa: E402
from models import AuditLog, Block, CashbackLedger, Shoot  # noqa: E402
from views import BAKU, baku_today  # noqa: E402


def iso(dt):
    return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def soon(days=5, hour=10):
    d = datetime.now(timezone.utc) + timedelta(days=days)
    return iso(d.replace(hour=hour, minute=0, second=0, microsecond=0))


def new_client(api, adm, name):
    cid, inv = invite_link(api, adm, name=name)
    tok = api.post("/api/auth/redeem", json={"token": token_of(inv["url"])}).json()["token"]
    return cid, tok


def shoot_body(cid, **over):
    body = {"client_id": cid, "starts_at": soon(), "duration_min": 120, "kind": "shoot", "tag": "podcast",
            "location": "studio", "cameras": 1, "editing": True}
    return {**body, **over}


def make_shoot(api, adm, cid, **over):
    r = api.post("/api/admin/shoots", json=shoot_body(cid, **over), headers=bearer(adm))
    assert r.status_code == 200, r.text
    return r.json()


def test_quote_matches_create(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    q = api.post("/api/admin/shoots/quote", json=shoot_body(cid), headers=bearer(adm)).json()
    s = make_shoot(api, adm, cid)
    assert q["total"] == s["total"] == 24000
    assert (q["base"], q["editing"]) == (14000, 10000)
    assert q["deposit_expected"] == s["deposit_expected"] == 12000
    assert q["first_shoot_bonus"] is True and q["cashback_kind"] == "earn_first" and q["cashback_earn"] == 12000
    assert q["deposit_required"] is False and q["cashback_balance"] == 0
    assert s["client_name"] == "Aysel Məmmədova" and s["payment_line"].startswith("Beh gözlənilir")


def test_quote_errors_map_to_400_and_write_nothing(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    r = api.post("/api/admin/shoots/quote", json=shoot_body(cid, reels_count=3, editing=False), headers=bearer(adm))
    assert r.status_code == 400
    assert api.post("/api/admin/shoots/quote", json=shoot_body(9999), headers=bearer(adm)).status_code == 404
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Shoot)) == 0


def test_deposit_close_client_sees_paid_and_cashback(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid)
    r = api.post(f"/api/admin/shoots/{s['id']}/deposit", json={"amount": 12000}, headers=bearer(adm))
    assert r.status_code == 200 and r.json()["studio_balance"] == 12000
    r = api.post(f"/api/admin/shoots/{s['id']}/close", json={"duration_min": 120, "paid_method": "cash"},
                 headers=bearer(adm))
    assert r.status_code == 200 and r.json()["cashback_earned"] == 12000 and r.json()["status"] == "completed"
    mine = api.get(f"/api/me/shoots/{s['id']}", headers=bearer(tok)).json()
    assert mine["payment_line"] == "Tam ödənib" and mine["cashback_earned"] == 12000
    assert "note" not in mine and "source_note" not in mine
    me = api.get("/api/me", headers=bearer(tok)).json()
    assert me["cashback_balance"] == 12000
    cb = api.get("/api/me/cashback", headers=bearer(tok)).json()
    assert cb["balance"] == 12000 and cb["rows"][0]["kind"] == "earn_first"


def test_package_member_sees_package_shoot_but_not_others(api):
    adm = admin_token(api)
    owner, _ = new_client(api, adm, "Orxan Əliyev")
    member, mtok = new_client(api, adm, "Leyla Hüseynova")
    other, _ = new_client(api, adm, "Kamran Quliyev")
    r = api.post("/api/admin/packages", headers=bearer(adm), json={
        "owner_client_id": owner, "title": "Şirkət", "hours": 10, "cameras": 1,
        "starts_on": baku_today().isoformat(), "member_ids": [member]})
    assert r.status_code == 200, r.text
    pkg = r.json()
    assert pkg["minutes_left"] == 600 and {m["role"] for m in pkg["members"]} == {"owner", "member"}
    in_pkg = make_shoot(api, adm, owner, package_id=pkg["id"], duration_min=60, editing=False, note="gizli")
    private = make_shoot(api, adm, owner, title="Orxanın şəxsi")
    foreign = make_shoot(api, adm, other)
    own = make_shoot(api, adm, member)
    rows = api.get("/api/me/shoots", headers=bearer(mtok)).json()
    ids = {x["id"] for x in rows}
    assert ids == {in_pkg["id"], own["id"]}
    pk = next(x for x in rows if x["id"] == in_pkg["id"])
    assert pk["mine"] is False and pk["who"] == "Orxan" and pk["payment_line"] is None and "note" not in pk
    for hidden in (private, foreign):
        assert api.get(f"/api/me/shoots/{hidden['id']}", headers=bearer(mtok)).status_code == 404
    assert api.get(f"/api/me/shoots/{in_pkg['id']}", headers=bearer(mtok)).status_code == 200
    # paket detalı
    detail = api.get("/api/me/package", headers=bearer(mtok)).json()
    assert detail["minutes_left"] == 600 and detail["owner_name"] == "Orxan Əliyev"
    # paket olmayan müştəri üçün 404
    _, otok = new_client(api, adm, "Nigar Rəhimova")
    assert api.get("/api/me/package", headers=bearer(otok)).status_code == 404
    # sahib çıxarıla bilməz, üzv çıxarıla bilər
    assert api.delete(f"/api/admin/packages/{pkg['id']}/members/{owner}", headers=bearer(adm)).status_code == 400
    assert api.delete(f"/api/admin/packages/{pkg['id']}/members/{member}", headers=bearer(adm)).status_code == 200
    assert api.get(f"/api/me/shoots/{in_pkg['id']}", headers=bearer(mtok)).status_code == 404


def test_cancel_returns_refund(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid)
    api.post(f"/api/admin/shoots/{s['id']}/deposit", json={"amount": 12000}, headers=bearer(adm))
    r = api.post(f"/api/admin/shoots/{s['id']}/cancel", json={}, headers=bearer(adm))
    assert r.status_code == 200
    body = r.json()
    assert (body["refund"], body["retained"], body["window"]) == (12000, 0, "gt24")
    assert body["status"] == "cancelled"
    assert api.post(f"/api/admin/shoots/{s['id']}/refunded", headers=bearer(adm)).json()["refunded_at"]
    assert api.post(f"/api/admin/shoots/{s['id']}/cancel", json={}, headers=bearer(adm)).status_code == 400


def test_rejected_maps_to_400_and_leaves_db_unchanged(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid, editing=False)  # 14000, beh 7000
    api.post(f"/api/admin/shoots/{s['id']}/deposit", json={"amount": 7000}, headers=bearer(adm))
    r = api.post(f"/api/admin/shoots/{s['id']}/close", json={"duration_min": 30}, headers=bearer(adm))
    assert r.status_code == 400 and "artıq ödəniləndən azdır" in r.json()["detail"]
    after = api.get(f"/api/admin/shoots/{s['id']}", headers=bearer(adm)).json()
    assert after["status"] == "confirmed" and after["duration_min"] == 120 and after["total"] == 14000
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(CashbackLedger)) == 0
    assert api.post("/api/admin/shoots/999/close", json={"duration_min": 60}, headers=bearer(adm)).status_code == 404


def test_client_token_cannot_use_admin_shoots(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    params = {"from": soon(0), "to": soon(9)}
    assert api.get("/api/admin/shoots", params=params, headers=bearer(tok)).status_code == 401
    assert api.post("/api/admin/shoots", json=shoot_body(cid), headers=bearer(tok)).status_code == 401
    assert api.get("/api/admin/dashboard", headers=bearer(tok)).status_code == 401
    assert api.get("/api/me/home", headers=bearer(adm)).status_code == 401
    assert api.get("/api/me/shoots").status_code == 401


def test_list_shoots_range_and_order(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    late = make_shoot(api, adm, cid, starts_at=soon(6))
    early = make_shoot(api, adm, cid, starts_at=soon(3))
    make_shoot(api, adm, cid, starts_at=soon(20))
    rows = api.get("/api/admin/shoots", params={"from": soon(1), "to": soon(10)}, headers=bearer(adm)).json()
    assert [r["id"] for r in rows] == [early["id"], late["id"]]


def test_dashboard_counts(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    pending = make_shoot(api, adm, cid)
    noon = datetime(*baku_today().timetuple()[:3], 12, tzinfo=BAKU)
    today = make_shoot(api, adm, cid, starts_at=iso(noon), duration_min=60, editing=False)
    api.post(f"/api/admin/shoots/{today['id']}/deposit/waive", headers=bearer(adm))
    past = make_shoot(api, adm, cid, starts_at=iso(datetime.now(timezone.utc) - timedelta(hours=5)), duration_min=60)
    done = make_shoot(api, adm, cid, starts_at=soon(2))
    api.post(f"/api/admin/shoots/{done['id']}/close", json={"duration_min": 120, "paid_method": "card"},
             headers=bearer(adm))
    d = api.get("/api/admin/dashboard", headers=bearer(adm)).json()
    pending_ids = [x["id"] for x in d["deposit_pending"]]
    assert pending["id"] in pending_ids and today["id"] not in pending_ids and done["id"] not in pending_ids
    today_ids = [x["id"] for x in d["today"]]  # «past» saatdan asılı olaraq bu günə düşə bilər
    assert today["id"] in today_ids and pending["id"] not in today_ids and done["id"] not in today_ids
    api.post(f"/api/admin/shoots/{today['id']}/close", json={"duration_min": 60, "paid_method": "cash"},
             headers=bearer(adm))  # günün çəkilişi saatdan asılı olaraq «bağlanmamış» ola bilər
    d = api.get("/api/admin/dashboard", headers=bearer(adm)).json()
    assert d["unclosed_count"] == 1 and d["awaiting_material_count"] == 1
    assert past["id"] in pending_ids


def test_production_materials_and_notifications(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid)
    api.post(f"/api/admin/shoots/{s['id']}/close", json={"duration_min": 120, "paid_method": "cash"},
             headers=bearer(adm))
    r = api.patch(f"/api/admin/shoots/{s['id']}/production", json={"production": "ready", "delivery_on": "2026-12-01"},
                  headers=bearer(adm))
    assert r.json()["production"] == "ready"
    bad = api.post(f"/api/admin/shoots/{s['id']}/materials", json={"title": "x", "drive_url": "http://x.az"},
                   headers=bearer(adm))
    assert bad.status_code == 422
    m = api.post(f"/api/admin/shoots/{s['id']}/materials",
                 json={"title": "Video", "drive_url": "https://drive.google.com/x"}, headers=bearer(adm)).json()
    mats = api.get("/api/me/materials", headers=bearer(tok)).json()
    assert mats[0]["materials"][0]["title"] == "Video"
    assert api.delete(f"/api/admin/materials/{m['id']}", headers=bearer(adm)).status_code == 200
    assert api.get("/api/me/materials", headers=bearer(tok)).json() == []
    home = api.get("/api/me/home", headers=bearer(tok)).json()
    assert home["unread_notifications"] == 3 and home["next_shoot"] is None and home["package"] is None
    assert api.post("/api/me/notifications/read", headers=bearer(tok)).status_code == 200
    assert api.get("/api/me/home", headers=bearer(tok)).json()["unread_notifications"] == 0
    assert len(api.get("/api/me/notifications", headers=bearer(tok)).json()) == 3


def test_manual_cashback_and_client_detail(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    r = api.post(f"/api/admin/clients/{cid}/cashback", json={"amount": 5000, "note": "Köhnə"}, headers=bearer(adm))
    assert r.json() == {"balance": 5000}
    assert api.post(f"/api/admin/clients/{cid}/cashback", json={"amount": -9000, "note": ""},
                    headers=bearer(adm)).status_code == 400
    make_shoot(api, adm, cid)
    d = api.get(f"/api/admin/clients/{cid}", headers=bearer(adm)).json()
    assert d["cashback_balance"] == 5000 and d["cashback_rows"][0]["kind"] == "manual"
    assert d["deposit_required"] is False and len(d["shoots"]) == 1 and d["packages"] == []
    assert api.get("/api/admin/clients/9999", headers=bearer(adm)).status_code == 404


def test_client_sees_cashback_forecast(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    s1 = make_shoot(api, adm, cid)
    s2 = make_shoot(api, adm, cid, starts_at=soon(days=9))
    assert api.get(f"/api/me/shoots/{s1['id']}", headers=bearer(tok)).json()["cashback_expected"] == \
        {"amount": 12000, "first_shoot": True}
    api.post(f"/api/admin/shoots/{s1['id']}/close", json={"duration_min": 120, "paid_method": "cash"},
             headers=bearer(adm))
    assert api.get(f"/api/me/shoots/{s1['id']}", headers=bearer(tok)).json()["cashback_expected"] is None
    assert api.get(f"/api/me/shoots/{s2['id']}", headers=bearer(tok)).json()["cashback_expected"] == \
        {"amount": 2400, "first_shoot": False}


def test_cancel_quote_matches_cancel_and_writes_nothing(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid)
    api.post(f"/api/admin/shoots/{s['id']}/deposit", json={"amount": 12000}, headers=bearer(adm))
    near = {"requested_at": iso(datetime.now(timezone.utc) + timedelta(days=4, hours=20))}  # çəkilişə <24 saat
    q = api.post(f"/api/admin/shoots/{s['id']}/cancel/quote", json=near, headers=bearer(adm))
    assert q.status_code == 200, q.text
    assert (q.json()["window"], q.json()["retained"], q.json()["refund"]) == ("lt24", 12000, 0)
    with SessionLocal() as db:
        assert db.get(Shoot, s["id"]).status == "confirmed"
        assert db.scalar(select(func.count()).select_from(AuditLog).where(AuditLog.action == "cancel")) == 0
    assert api.get(f"/api/admin/shoots/{s['id']}", headers=bearer(adm)).json()["status"] == "confirmed"
    r = api.post(f"/api/admin/shoots/{s['id']}/cancel", json=near, headers=bearer(adm)).json()
    assert {k: r[k] for k in ("window", "retained", "refund", "cashback_return")} == \
        {k: q.json()[k] for k in ("window", "retained", "refund", "cashback_return")}
    assert api.post(f"/api/admin/shoots/{s['id']}/cancel/quote", json={}, headers=bearer(adm)).status_code == 400


def test_clients_list_has_balance_package_last_shoot(api):
    adm = admin_token(api)
    owner, _ = new_client(api, adm, "Orxan Əliyev")
    member, _ = new_client(api, adm, "Leyla Hüseynova")
    lone, _ = new_client(api, adm, "Kamran Quliyev")
    pkg = api.post("/api/admin/packages", headers=bearer(adm), json={
        "owner_client_id": owner, "title": "Şirkət", "hours": 5, "cameras": 1,
        "starts_on": baku_today().isoformat(), "member_ids": [member], "used_minutes": 60}).json()
    api.post(f"/api/admin/clients/{lone}/cashback", json={"amount": 500}, headers=bearer(adm))
    past = make_shoot(api, adm, lone, starts_at=soon(days=-2))
    rows = {r["id"]: r for r in api.get("/api/admin/clients", headers=bearer(adm)).json()}
    assert rows[owner]["package"] == rows[member]["package"] == {"title": "Şirkət", "minutes_left": 240}
    assert rows[lone]["package"] is None and rows[lone]["cashback_balance"] == 500
    assert rows[lone]["last_shoot_at"].startswith(past["starts_at"][:10])
    assert rows[owner]["last_shoot_at"] is None and rows[owner]["cashback_balance"] == 0
    assert pkg["minutes_left"] == 240


def test_package_quote_and_member_audit(api):
    adm = admin_token(api)
    q = api.get("/api/admin/packages/quote?hours=10&cameras=2", headers=bearer(adm))
    assert q.status_code == 200 and q.json() == {"price": 96000, "months": 4}
    for bad in ("hours=7&cameras=1", "hours=10&cameras=5"):
        assert api.get(f"/api/admin/packages/quote?{bad}", headers=bearer(adm)).status_code == 400
    owner, _ = new_client(api, adm, "Orxan Əliyev")
    member, _ = new_client(api, adm, "Leyla Hüseynova")
    pkg = api.post("/api/admin/packages", headers=bearer(adm), json={
        "owner_client_id": owner, "title": "Şirkət", "hours": 5, "cameras": 1,
        "starts_on": baku_today().isoformat()}).json()
    for _ in range(2):  # təkrar əlavə audit yazmır
        api.post(f"/api/admin/packages/{pkg['id']}/members", json={"client_id": member}, headers=bearer(adm))
    api.delete(f"/api/admin/packages/{pkg['id']}/members/{member}", headers=bearer(adm))
    with SessionLocal() as db:
        acts = db.scalars(select(AuditLog).where(AuditLog.entity == "package", AuditLog.action.like("member_%"))
                          .order_by(AuditLog.id)).all()
        assert [(a.action, a.entity_id, a.after) for a in acts] == [
            ("member_add", pkg["id"], {"client_id": member}), ("member_remove", pkg["id"], {"client_id": member})]
        assert acts[0].admin_id is not None


def test_blocks_crud_and_range(api):
    adm = admin_token(api)
    start = soon(days=3, hour=16)
    end = soon(days=3, hour=18)
    r = api.post("/api/admin/blocks", json={"starts_at": start, "ends_at": end, "reason": " Texniki iş "},
                 headers=bearer(adm))
    assert r.status_code == 200 and r.json()["reason"] == "Texniki iş"
    bid = r.json()["id"]
    bad = api.post("/api/admin/blocks", json={"starts_at": end, "ends_at": start}, headers=bearer(adm))
    assert bad.status_code == 400
    day = datetime.now(timezone.utc) + timedelta(days=3)
    inside = f"from={iso(day.replace(hour=0))}&to={iso(day.replace(hour=23))}"
    assert [b["id"] for b in api.get(f"/api/admin/blocks?{inside}", headers=bearer(adm)).json()] == [bid]
    outside = f"from={soon(days=3, hour=18)}&to={soon(days=3, hour=20)}"  # kənar toxunuş overlap sayılmır
    assert api.get(f"/api/admin/blocks?{outside}", headers=bearer(adm)).json() == []
    # bloklanmış vaxta çəkiliş yenə yaradıla bilər (yalnız göstəriş)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    make_shoot(api, adm, cid, starts_at=soon(days=3, hour=16))
    assert api.delete(f"/api/admin/blocks/{bid}", headers=bearer(adm)).status_code == 200
    assert api.delete(f"/api/admin/blocks/{bid}", headers=bearer(adm)).status_code == 404
    with SessionLocal() as db:
        assert db.scalar(select(func.count()).select_from(Block)) == 0


def test_new_admin_routes_need_admin(api):
    adm = admin_token(api)
    _, tok = new_client(api, adm, "Aysel Məmmədova")
    for method, path in (("get", "/api/admin/packages/quote?hours=5&cameras=1"), ("delete", "/api/admin/blocks/1"),
                         ("post", "/api/admin/shoots/1/cancel/quote")):
        r = getattr(api, method)(path, headers=bearer(tok)) if method != "post" else api.post(path, json={}, headers=bearer(tok))
        assert r.status_code in (401, 403)


def test_studio_rent_earns_cashback(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Videoqraf Elnur")
    rent = make_shoot(api, adm, cid, kind="studio_rent", cameras=0, editing=False, duration_min=120)
    assert rent["total"] == 10000 and rent["cameras"] == 0
    r = api.post(f"/api/admin/shoots/{rent['id']}/close", json={"duration_min": 120, "paid_method": "cash"},
                 headers=bearer(adm))
    assert r.json()["cashback_earned"] == 5000  # ilk çəkiliş bonusu: 50%


def test_discount_flows_to_deposit_and_close(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid, kind="reels_pack", duration_min=45, discount=5000, discount_note="dost qiyməti")
    assert (s["total"], s["discount"], s["deposit_expected"]) == (10000, 5000, 5000)
    mine = api.get(f"/api/me/shoots/{s['id']}", headers=bearer(tok)).json()
    assert mine["discount"] == 5000 and "discount_note" not in mine
    r = api.post(f"/api/admin/shoots/{s['id']}/close", json={"duration_min": 45, "discount": 7000,
                                                            "paid_method": "card"}, headers=bearer(adm)).json()
    assert r["total"] == 8000 and r["cashback_earned"] == 4000  # ilk çəkiliş: 50%


def test_buffers_produce_conflict_warning(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    first = make_shoot(api, adm, cid, starts_at=soon(hour=6), duration_min=60)  # 10:00 Bakı, yığışdırma standartda 0
    assert first["prep_min"] == 15 and first["wrap_min"] == 0
    clash = make_shoot(api, adm, cid, starts_at=soon(hour=7), duration_min=60)  # 11:00, hazırlıq 10:45-dən
    assert [c["id"] for c in clash["conflicts"]] == [first["id"]]
    # 13:00, buffer yoxdur: əvvəlkinin yığışdırması 12:30-da bitir
    ok = make_shoot(api, adm, cid, starts_at=soon(hour=9), duration_min=60, prep_min=0, wrap_min=0)
    assert ok["conflicts"] == []
    q = api.post("/api/admin/shoots/quote", json=shoot_body(cid, starts_at=soon(hour=12)), headers=bearer(adm)).json()
    assert q["conflicts"] == []


def test_edit_client_writes_audit(api):
    from models import AuditLog
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    r = api.patch(f"/api/admin/clients/{cid}", json={"full_name": "Aysel Məmmədli", "phone": "050 111 22 33"},
                  headers=bearer(adm))
    assert r.status_code == 200 and r.json()["full_name"] == "Aysel Məmmədli"
    assert api.patch("/api/admin/clients/9999", json={"phone": "1"}, headers=bearer(adm)).status_code == 404
    with SessionLocal() as db:
        row = db.scalar(select(AuditLog).where(AuditLog.entity == "client"))
        assert row.before["full_name"] == "Aysel Məmmədova" and row.after["phone"] == "050 111 22 33"
