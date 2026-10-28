from datetime import date, datetime, timedelta, timezone

from test_api_faza1 import iso, make_shoot, new_client  # noqa: F401,I001  (env-i əvvəl qurur)
from test_auth import admin_token, api, bearer  # noqa: F401,I001

from sqlalchemy import select  # noqa: E402

import growth  # noqa: E402
import push  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import CashbackLedger, Client, Material, Notification, Setting, Shoot  # noqa: E402
from views import baku_today  # noqa: E402

PROFILE = {"profession": "Psixoloq", "workplace": "Mind Clinic", "instagram": "@aysel.psy", "birthday": "1990-05-14"}


def close(api, adm, s):
    r = api.post(f"/api/admin/shoots/{s['id']}/close", json={"duration_min": s["duration_min"], "paid_method": "cash"},
                 headers=bearer(adm))
    assert r.status_code == 200, r.text
    return r.json()


def backdate(shoot_id, days):
    with SessionLocal() as db:
        db.get(Shoot, shoot_id).starts_at = datetime.now(timezone.utc) - timedelta(days=days)
        db.commit()


def slot(days):
    d = datetime.now(timezone.utc) + timedelta(days=days)
    return iso(d.replace(hour=8, minute=0, second=0, microsecond=0))


def ledger(cid, kind):
    with SessionLocal() as db:
        return [r.amount for r in db.scalars(select(CashbackLedger).where(CashbackLedger.client_id == cid,
                                                                            CashbackLedger.kind == kind))]


def add_material(shoot_id):
    with SessionLocal() as db:
        db.add(Material(shoot_id=shoot_id, title="Video", drive_url="https://drive.example/x",
                        created_at=datetime.now(timezone.utc) - timedelta(days=2)))
        db.commit()


def enable(**over):
    with SessionLocal() as db:
        cfg = growth.load_settings(db)
        cfg["send_hour"] = 0
        for k in ("winback", "cashback", "birthday", "review"):
            cfg[k]["enabled"] = True
        cfg["review"]["url"] = "https://g.page/r/ypod"
        for k, v in over.items():
            cfg[k].update(v)
        growth.save_settings(db, cfg)
        db.commit()


def test_profile_bonus_once_only_when_complete(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    r = api.patch("/api/me/profile", json={"profession": "Psixoloq"}, headers=bearer(tok)).json()
    assert r["granted"] == 0 and not r["complete"]
    r = api.patch("/api/me/profile", json=PROFILE, headers=bearer(tok)).json()
    assert r["granted"] == 500 and r["complete"] and r["instagram"] == "aysel.psy"
    # boşaldıb yenidən doldurmaq ikinci bonus vermir
    api.patch("/api/me/profile", json={"workplace": ""}, headers=bearer(tok))
    r = api.patch("/api/me/profile", json={"workplace": "Klinika"}, headers=bearer(tok)).json()
    assert r["granted"] == 0 and ledger(cid, "profile_bonus") == [500]
    assert api.patch("/api/me/profile", json={"birthday": "1800-01-01"}, headers=bearer(tok)).status_code == 422
    with SessionLocal() as db:
        n = db.scalar(select(Notification).where(Notification.type == "bonus"))
        assert push.message(db, n)["title"] == "Profil bonusu"


def test_admin_fills_profile_no_bonus_tags_and_referrer(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    ref, _ = new_client(api, adm, "Leyla Hüseynova")
    t = api.post("/api/admin/tags", json={"name": "VIP"}, headers=bearer(adm)).json()
    assert api.post("/api/admin/tags", json={"name": "vip"}, headers=bearer(adm)).status_code == 409
    r = api.patch(f"/api/admin/clients/{cid}", json={**PROFILE, "tag_ids": [t["id"]], "referred_by_id": ref,
                                                    "source": "referral"}, headers=bearer(adm))
    assert r.status_code == 200, r.text
    c = r.json()
    assert c["tags"] == [{"id": t["id"], "name": "VIP"}] and c["referred_by"]["full_name"] == "Leyla Hüseynova"
    assert c["profile_complete"] and ledger(cid, "profile_bonus") == []  # admin doldurursa bonus yoxdur
    assert api.patch(f"/api/admin/clients/{cid}", json={"referred_by_id": cid}, headers=bearer(adm)).status_code == 422
    assert api.get("/api/admin/tags", headers=bearer(adm)).json()[0]["count"] == 1
    lst = {x["id"]: x for x in api.get("/api/admin/clients", headers=bearer(adm)).json()}
    assert lst[cid]["tags"][0]["name"] == "VIP" and lst[cid]["profession"] == "Psixoloq"
    api.delete(f"/api/admin/tags/{t['id']}", headers=bearer(adm))
    assert all(x["tags"] == [] for x in api.get("/api/admin/clients", headers=bearer(adm)).json())


def test_referral_reward_on_first_close_both_sides(api):
    adm = admin_token(api)
    host, htok = new_client(api, adm, "Leyla Hüseynova")
    code = api.get("/api/me/referral", headers=bearer(htok)).json()["code"]
    assert len(code) == 6
    friend, _ = new_client(api, adm, "Aysel Məmmədova")
    found = api.get(f"/api/admin/referrals/{code.lower()}", headers=bearer(adm)).json()
    api.patch(f"/api/admin/clients/{friend}", json={"referred_by_id": found["id"]}, headers=bearer(adm))
    close(api, adm, make_shoot(api, adm, friend))
    assert ledger(host, "referral") == [2000] and ledger(friend, "referral") == [2000]
    close(api, adm, make_shoot(api, adm, friend, starts_at=slot(8), duration_min=60))
    assert ledger(host, "referral") == [2000]  # yalnız ilk bağlanışda
    inv = api.get("/api/me/referral", headers=bearer(htok)).json()
    assert inv["invited"] == [{"name": "Aysel", "rewarded": True}]
    r = api.patch(f"/api/admin/clients/{friend}", json={"referred_by_id": 0}, headers=bearer(adm))
    assert r.status_code == 409  # bonus verilibsə dəvət edən dəyişmir


def test_segments_and_campaign_respects_opt_out(api):
    adm = admin_token(api)
    a, atok = new_client(api, adm, "Aysel Məmmədova")
    b, btok = new_client(api, adm, "Leyla Hüseynova")
    c, _ = new_client(api, adm, "Kamran Quliyev")
    api.patch("/api/me/profile", json={"profession": "Psixoloq"}, headers=bearer(atok))
    api.patch("/api/me/profile", json={"profession": "psixoloq-terapevt", "marketing_opt_in": False},
              headers=bearer(btok))
    close(api, adm, make_shoot(api, adm, c, tag="reels"))
    pv = api.post("/api/admin/segments/preview", json={"professions": ["psixoloq"]}, headers=bearer(adm)).json()
    assert (pv["count"], pv["opted_out"]) == (1, 1) and pv["sample"][0]["id"] == a
    pv = api.post("/api/admin/segments/preview", json={"services": ["reels"]}, headers=bearer(adm)).json()
    assert [x["id"] for x in pv["sample"]] == [c]
    r = api.post("/api/admin/campaigns", headers=bearer(adm), json={
        "title": "{name}, yeni təklif", "body": "Psixoloqlar üçün endirim", "filters": {"professions": ["psixoloq"]}})
    assert r.status_code == 200, r.text
    camp = r.json()
    assert camp["recipients"] == 1
    assert api.get(f"/api/me/campaigns/{camp['id']}", headers=bearer(btok)).status_code == 404  # opt-out
    mine = api.get(f"/api/me/campaigns/{camp['id']}", headers=bearer(atok)).json()
    assert mine["title"] == "Aysel, yeni təklif"
    full = api.get(f"/api/admin/campaigns/{camp['id']}", headers=bearer(adm)).json()
    assert full["opened"] == 1 and full["list"][0]["opened_at"]
    with SessionLocal() as db:
        n = db.scalar(select(Notification).where(Notification.type == "campaign"))
        assert push.message(db, n)["url"] == f"#/offer/{camp['id']}"
    empty = api.post("/api/admin/campaigns", headers=bearer(adm), json={
        "title": "Heç kim", "body": "yoxdur", "filters": {"professions": ["astronavt"]}})
    assert empty.status_code == 422


def test_presets_package_candidates_and_podcast_no_reels(api):
    adm = admin_token(api)
    a, _ = new_client(api, adm, "Aysel Məmmədova")
    b, _ = new_client(api, adm, "Leyla Hüseynova")
    for i in range(3):
        s = make_shoot(api, adm, a, duration_min=60, starts_at=slot(3 + i))
        close(api, adm, s)
        backdate(s["id"], 10 + i)
    close(api, adm, make_shoot(api, adm, b, starts_at=slot(10)))
    close(api, adm, make_shoot(api, adm, a, tag="reels", starts_at=slot(12)))
    with SessionLocal() as db:
        assert [c.id for c in growth.segment(db, {"preset": "package_candidates"})] == [a]
        assert [c.id for c in growth.segment(db, {"preset": "podcast_no_reels"})] == [b]


def test_run_daily_automations(api):
    adm = admin_token(api)
    old, _ = new_client(api, adm, "Aysel Məmmədova")
    bday, btok = new_client(api, adm, "Leyla Hüseynova")
    s = make_shoot(api, adm, old)
    close(api, adm, s)  # ilk çəkiliş keşbeki 120 AZN → keşbek xatırlatması da düşür
    backdate(s["id"], 90)
    add_material(s["id"])
    today = baku_today()
    api.patch("/api/me/profile", json={"birthday": f"1995-{today.month:02d}-{today.day:02d}",
                                       "marketing_opt_in": False}, headers=bearer(btok))
    enable()
    with SessionLocal() as db:
        sent = growth.run_daily(db)
        db.commit()
    # gündə bir müştəriyə bir avtomatik mesaj: əvvəl winback
    assert sent == {"winback": 1}
    assert ledger(bday, "birthday") == [1000]  # hədiyyə opt-out olana da yazılır, mesaj getmir
    with SessionLocal() as db:
        assert growth.run_daily(db) == {}  # gündə bir dəfə
        assert growth.run_daily(db, force=True) == {"cashback": 1}  # növbəti gün
        assert growth.run_daily(db, force=True) == {}  # 7 gündə 2 limit dolub: rəy xahişi gözləyir
        db.commit()
        assert db.get(Client, bday).birthday_year == today.year
        rows = db.scalars(select(Notification).where(Notification.client_id == old, Notification.type == "campaign"))
        msgs = {n.payload["title"]: n.payload["body"] for n in rows}
    assert set(msgs) == {"Yeni çəkiliş vaxtıdır?", "Keşbekiniz sizi gözləyir"}
    assert "darıxdıq" not in " ".join(msgs.values()) and "Aysel," in msgs["Yeni çəkiliş vaxtıdır?"]
    assert "120" in msgs["Keşbekiniz sizi gözləyir"]
    assert ledger(bday, "birthday") == [1000]


def test_birthday_feb29_and_review_once(api):
    assert growth._is_birthday(date(1992, 2, 29), date(2027, 2, 28))
    assert not growth._is_birthday(date(1992, 2, 29), date(2028, 2, 28))
    assert growth._is_birthday(date(1992, 2, 29), date(2028, 2, 29))
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid)
    close(api, adm, s)
    add_material(s["id"])
    enable(winback={"enabled": False}, cashback={"enabled": False})
    with SessionLocal() as db:
        assert growth.run_daily(db) == {"review": 1}
        assert growth.run_daily(db, force=True) == {}  # bir dəfə soruşulur
        db.commit()


def test_automations_settings_api(api):
    adm = admin_token(api)
    cfg = api.get("/api/admin/automations", headers=bearer(adm)).json()
    assert cfg["winback"]["enabled"] is False and "darıxdıq" not in cfg["winback"]["body"]
    cfg["review"]["enabled"] = True
    assert api.patch("/api/admin/automations", json=cfg, headers=bearer(adm)).status_code == 422  # link yoxdur
    cfg["review"]["url"] = "https://g.page/r/ypod"
    cfg["winback"]["days"] = 45
    r = api.patch("/api/admin/automations", json=cfg, headers=bearer(adm)).json()
    assert r["winback"]["days"] == 45 and r["review"]["enabled"]
    with SessionLocal() as db:
        assert db.get(Setting, "automations") is not None


def test_free_slots(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    day = baku_today() + timedelta(days=4)
    # Bakı 13:00–15:00 (UTC 09:00), hazırlıq 15 dəq → 12:45-dən məşğul
    make_shoot(api, adm, cid, starts_at=f"{day.isoformat()}T09:00:00Z")
    slots = api.get("/api/admin/free-slots", params={"day": day.isoformat()}, headers=bearer(adm)).json()
    assert slots == [{"start": "10:00", "end": "12:45"}, {"start": "15:00", "end": "21:00"}]


def test_report_growth(api):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    api.patch("/api/me/profile", json={**PROFILE, "source": "instagram"}, headers=bearer(tok))
    s = make_shoot(api, adm, cid)
    close(api, adm, s)
    month = f"{baku_today():%Y-%m}"
    g = api.get("/api/admin/report", params={"month": month}, headers=bearer(adm)).json()
    assert g["growth"]["new_clients"] == 1 and g["growth"]["by_source"] == {"instagram": 1}
    assert g["cashback"]["bonuses"] == 500
