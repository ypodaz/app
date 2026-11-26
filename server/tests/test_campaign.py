"""«İlin son fürsəti» kampaniyası: qiymət, keşbek, avto-rezerv və bot təlimatı tarix şərti ilə."""
from datetime import date

import pytest

from test_api_faza1 import make_shoot, new_client, shoot_body  # noqa: F401,I001  (env-i əvvəl qurur)
from test_auth import admin_token, api, bearer  # noqa: F401,I001

import money  # noqa: E402
from crm import autobook, bot_prompt  # noqa: E402

A = money.AZN
LAST, AFTER = date(2026, 12, 29), date(2026, 12, 30)


@pytest.fixture
def campaign_on(monkeypatch):
    """Real tarixdən asılı olmasın deyə kampaniyanı uzadırıq."""
    monkeypatch.setattr(money, "CAMPAIGN_END", date(2099, 1, 1))


def test_campaign_active_boundary():
    assert money.campaign_active(LAST) and not money.campaign_active(AFTER)


def test_campaign_prices():
    def p(**kw):
        base = dict(kind="shoot", location="studio", cameras=1, duration_min=60, editing=False)
        return money.price(**{**base, **kw}).total
    assert p(campaign=True) == 50 * A and p() == 70 * A
    assert p(cameras=2, duration_min=120, campaign=True) == 200 * A  # hər saat 100
    assert p(cameras=2, editing=True, campaign=True) == 200 * A  # montaj ayrıca, 100
    assert p(kind="reels_pack", campaign=True) == 150 * A
    assert p(cameras=3, campaign=True) == 150 * A and p(cameras=3) == 170 * A
    with pytest.raises(ValueError):
        p(location="onsite", campaign=True)
    with pytest.raises(ValueError):
        p(kind="single_reel", campaign=True)


def test_campaign_no_cashback():
    pr = money.price(kind="shoot", location="studio", cameras=1, duration_min=60, editing=False, campaign=True)
    assert money.cashback_earned(pr, from_package=False, first_shoot=True, campaign=True) == ("earn", 0)
    assert money.cashback_earned(pr, from_package=False, first_shoot=True)[1] == 20 * A


def test_autobook_quote_by_date():
    q = autobook.quote({"service": "reels"}, None, LAST)
    assert q["campaign"] and q["total"] == 150 * A and "10 hazır Reels" in q["label"]
    q = autobook.quote({"service": "reels"}, None, AFTER)
    assert not q["campaign"] and "5 hazır Reels" in q["label"]
    q = autobook.quote({"service": "podkast", "hours": 2, "cameras": 2}, None, LAST)
    assert q["campaign"] and q["total"] == 200 * A
    assert autobook.quote({"service": "podkast", "hours": 2, "cameras": 2}, None, AFTER)["total"] == 240 * A
    assert autobook.quote({"service": "podkast", "hours": 1, "cameras": 3}, None, LAST)["total"] == 150 * A
    assert autobook.quote({"service": "podkast", "hours": 1, "cameras": 3}, None, AFTER)["total"] == 170 * A
    assert not autobook.quote({"service": "tek_reels"}, None, LAST)["campaign"]


def test_bot_prompt_by_campaign():
    kw = dict(prices="P", faqs="F", free_slots="S", now="N", first_message="bəli", lead="L")
    on, off = bot_prompt.render(campaign=True, **kw), bot_prompt.render(campaign=False, **kw)
    assert "§" not in on and "§" not in off
    assert "## Kampaniya (29.12 tarixinədək)" in on and "Kampaniya" not in off
    assert "10 hazır Reels" in on and "10 hazır Reels" not in off
    assert "40% keşbek" not in on and "40% keşbek" in off
    assert "5 hazır Reels, montaj daxil 150" not in on and "5 hazır Reels, montaj daxil 150" in off
    assert "5 hazır Reels, montaj daxil 100" in on  # yalnız «baha»dan sonra


def test_campaign_shoot_api_no_cashback(api, campaign_on):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Kamran Kampaniyalı")
    body = dict(cameras=2, editing=False, duration_min=60, campaign=True)
    q = api.post("/api/admin/shoots/quote", json=shoot_body(cid, **body), headers=bearer(adm)).json()
    assert q["total"] == 100 * A and q["cashback_earn"] == 0 and q["campaign_active"]
    s = make_shoot(api, adm, cid, **body)
    assert s["campaign"] and s["total"] == 100 * A
    c = api.post(f"/api/admin/shoots/{s['id']}/close", json={"duration_min": 60, "paid_method": "cash"},
                 headers=bearer(adm)).json()
    assert c["cashback_earned"] == 0 and c["campaign"]


def test_campaign_shoot_rejected_after_end(api, monkeypatch):
    monkeypatch.setattr(money, "CAMPAIGN_END", date(2000, 1, 1))
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Gecikən Kampaniya")
    r = api.post("/api/admin/shoots", json=shoot_body(cid, cameras=1, editing=False, campaign=True), headers=bearer(adm))
    assert r.status_code >= 400 and "Kampaniya bitib" in r.text
