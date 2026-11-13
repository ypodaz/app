"""Yalnız oxu admin endpoint-ləri: qoşulma statusu, qiymət cədvəli, çəkilişdə telefon, hesabat müqayisəsi."""
from test_api_faza1 import make_shoot, new_client  # noqa: F401,I001  (env-i əvvəl qurur)
from test_auth import admin_token, api, bearer  # noqa: F401,I001

from datetime import datetime, timedelta  # noqa: E402

import money  # noqa: E402
import settings  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import Shoot  # noqa: E402
from views import BAKU, utc  # noqa: E402


def test_connections_only_booleans(api, monkeypatch):
    adm = admin_token(api)
    monkeypatch.setattr(settings, "TG_BOT_TOKEN", "gizli-test-deyer")
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    r = api.get("/api/admin/connections", headers=bearer(adm))
    assert r.status_code == 200
    body = r.json()
    assert body["telegram"] is True and body["gemini"] is False
    assert all(isinstance(v, bool) for v in body.values())
    assert "gizli-test-deyer" not in r.text
    assert api.get("/api/admin/connections").status_code == 401


def test_price_list_from_money(api):
    adm = admin_token(api)
    r = api.get("/api/admin/price-list", headers=bearer(adm)).json()
    assert r["shoot_per_hour"]["studio"]["2"] == money.SHOOT_PER_HOUR["studio"][2]
    assert r["shoot_per_hour"]["onsite"]["3"] == money.SHOOT_PER_HOUR["onsite"][3]
    assert r["studio_rent"] == {"1": money.studio_rent_price(60), "2": money.studio_rent_price(120), "3": money.studio_rent_price(180)}
    assert r["reels_pack"] == money.REELS_PACK and r["editing"] == money.EDITING and r["reel"] == money.REEL
    assert r["single_reel"] == money.SINGLE_REEL and r["cover"] == money.COVER
    assert api.get("/api/admin/price-list").status_code == 401


def test_shoot_list_has_client_phone(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Nümunə Müştəri")
    api.patch(f"/api/admin/clients/{cid}", json={"phone": "994500000123"}, headers=bearer(adm))
    s = make_shoot(api, adm, cid)
    start = datetime.fromisoformat(s["starts_at"].replace("Z", "+00:00"))
    rows = api.get("/api/admin/shoots", params={"from": (start - timedelta(days=1)).isoformat(),
                                                "to": (start + timedelta(days=1)).isoformat()}, headers=bearer(adm)).json()
    assert next(x for x in rows if x["id"] == s["id"])["client_phone"].endswith("994500000123".lstrip("+")[-9:])


def test_report_same_days_compare(api):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Nümunə Müştəri")
    s = make_shoot(api, adm, cid)
    today = datetime.now(BAKU).date()
    prev_first = (today.replace(day=1) - timedelta(days=1)).replace(day=1)
    with SessionLocal() as db:
        sh = db.get(Shoot, s["id"])
        sh.deposit_amount = 7000
        sh.deposit_received_at = utc(datetime(prev_first.year, prev_first.month, 1, 12, tzinfo=BAKU))
        db.commit()
    cur = api.get("/api/admin/report", params={"month": today.strftime("%Y-%m")}, headers=bearer(adm)).json()
    assert cur["compare"]["days"] == today.day
    assert cur["compare"]["net"] == cur["cash"]["net"]
    assert cur["compare"]["prev_net"] == 7000  # əvvəlki ayın 1-i bu ayın günlərinə düşür
    prev = api.get("/api/admin/report", params={"month": prev_first.strftime("%Y-%m")}, headers=bearer(adm)).json()
    assert prev["compare"]["net"] == prev["cash"]["net"] == 7000
