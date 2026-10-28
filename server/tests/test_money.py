"""money.py: dizayndakı nümunə rəqəmləri (B2d, B2e, B4a, B4b, B8, B9, T4, T4b, T5, A7a)."""

from datetime import datetime, timedelta

import pytest

import money as m

A = m.AZN


def shoot(**kw):
    args = dict(kind="shoot", location="studio", cameras=1, duration_min=60, editing=False)
    args.update(kw)
    return m.price(**args)


def test_aysel_b9_t4():
    # 2 kamera, 1 saat, montaj; keşbekdən 20; beh 100 alınıb.
    p = shoot(cameras=2, editing=True)
    assert p.total == 220 * A
    assert m.deposit_expected(p.total, 20 * A, False) == 100 * A
    assert m.studio_balance(p.total, 20 * A, 100 * A) == 100 * A
    assert m.payment_status(total=p.total, cashback_used=20 * A, deposit_amount=100 * A,
                            deposit_received=True, deposit_waived=False) \
        == "Beh ödənib · 100 AZN · qalıq studiyada 100 AZN"
    # keşbeklə ödənən hissə çıxılmır: 220-dən +22
    assert m.cashback_earned(p, from_package=False, first_shoot=False) == ("earn", 22 * A)


def test_t4b_leyla_montaj_reels():
    p = shoot(editing=True, reels_count=4)
    assert (p.base, p.editing, p.reels, p.total) == (70 * A, 100 * A, 40 * A, 210 * A)
    assert m.deposit_expected(p.total, 0, False) == 105 * A
    assert m.payment_status(total=p.total, cashback_used=0, deposit_amount=0,
                            deposit_received=False, deposit_waived=False) == "Beh gözlənilir · 105 AZN"
    assert m.cashback_earned(p, from_package=False, first_shoot=False) == ("earn", 21 * A)


def test_b4a_leyla_first_shoot_two_hours():
    p = shoot(duration_min=120)
    assert p.total == 140 * A
    assert m.studio_balance(p.total, 0, 50 * A) == 90 * A
    assert m.cashback_earned(p, from_package=False, first_shoot=True) == ("earn_first", 70 * A)


def test_b4b_kamran_package():
    # Paket 2 kameralı, çəkiliş 2 kamera, 2 saat, montaj pulla.
    p = shoot(cameras=2, duration_min=120, editing=True, package_cameras=2)
    assert (p.base, p.extra_camera, p.total) == (0, 0, 100 * A)
    assert m.deposit_expected(p.total, 0, True) == 0
    kind, amount = m.cashback_earned(p, from_package=True, first_shoot=False)
    assert (kind, 18 * A + amount) == ("earn", 28 * A)
    assert m.payment_status(total=p.total, cashback_used=0, deposit_amount=0, deposit_received=False,
                            deposit_waived=False, package_minutes=120) \
        == "Paketdən 2 saat · əlavələr 100 AZN studiyada"


def test_package_extra_camera():
    p = shoot(cameras=3, duration_min=90, package_cameras=2)
    assert p.extra_camera == 75 * A  # 50 AZN × 1,5 saat
    assert m.payment_status(total=p.total, cashback_used=0, deposit_amount=0, deposit_received=False,
                            deposit_waived=False, package_minutes=90, extra_camera=p.extra_camera) \
        == "Paketdən 1,5 saat · əlavə kamera 75 AZN studiyada"
    plain = shoot(cameras=2, package_cameras=2)
    assert m.payment_status(total=plain.total, cashback_used=0, deposit_amount=0, deposit_received=False,
                            deposit_waived=False, package_minutes=60) == "Paketdən 1 saat"


def test_b2e_elvin_deposit():
    p = shoot()
    assert p.total == 70 * A
    assert m.deposit_expected(p.total, 0, False) == 35 * A
    assert m.cashback_earned(p, from_package=False, first_shoot=False) == ("earn", 7 * A)


def test_t5_fully_paid():
    p = shoot(editing=True)
    assert p.total == 170 * A
    assert m.payment_status(total=p.total, cashback_used=50 * A, deposit_amount=60 * A,
                            deposit_received=True, deposit_waived=False, paid_at_studio=60 * A) == "Tam ödənib"
    assert m.cashback_earned(p, from_package=False, first_shoot=False) == ("earn", 17 * A)


def test_waived_deposit():
    assert m.payment_status(total=70 * A, cashback_used=0, deposit_amount=0,
                            deposit_received=False, deposit_waived=True) == "Beh 0 AZN · ödəniş studiyada 70 AZN"


def test_a7a_history_sums_to_76():
    reels = m.price(kind="reels_pack", location="studio", cameras=1, duration_min=60, editing=False)
    first = m.cashback_earned(reels, from_package=False, first_shoot=True)
    assert first == ("earn_first", 75 * A)
    s170 = m.cashback_earned(shoot(editing=True), from_package=False, first_shoot=False)[1]
    s340 = m.cashback_earned(shoot(location="onsite", cameras=2, editing=True),
                             from_package=False, first_shoot=False)[1]
    assert (s170, s340) == (17 * A, 34 * A)
    assert first[1] + s170 - 50 * A + s340 == 76 * A


def test_onsite_and_reels_pack_prices():
    assert shoot(location="onsite", cameras=3).total == 340 * A
    assert shoot(location="onsite", editing=True).total == 240 * A
    assert m.price(kind="reels_pack", location="onsite", cameras=1, duration_min=60, editing=False).total == 250 * A


def test_cashback_keeps_qepik():
    assert m.percent(75 * A, 10) == 750  # 7,50 AZN
    assert m.fmt(750) == "7,50 AZN"
    assert m.fmt(7 * A) == "7 AZN"
    assert m.cashback_earned(shoot(duration_min=90), from_package=False, first_shoot=False) == ("earn", 1050)


def test_validation():
    with pytest.raises(ValueError, match="montaj olmadan"):
        shoot(reels_count=2)
    with pytest.raises(ValueError, match="yarım saat"):
        shoot(duration_min=45)
    with pytest.raises(ValueError, match="studiyada"):
        shoot(location="onsite", package_cameras=1)
    with pytest.raises(ValueError, match="kifayət etmir"):
        m.check_cashback_use(80 * A, 76 * A, 220 * A)
    with pytest.raises(ValueError, match="çox ola bilməz"):
        m.check_cashback_use(80 * A, 100 * A, 70 * A)
    m.check_cashback_use(20 * A, 76 * A, 220 * A)


def test_b8_cancel_more_than_24h():
    start = datetime(2026, 11, 4, 14)
    assert m.cancel_window(start, start - timedelta(days=7)) == "gt24"
    c = m.cancellation(window="gt24", deposit_paid=35 * A, cashback_used=0)
    assert (c.retained, c.refund, c.cashback_return) == (0, 35 * A, 0)


def test_cancel_less_than_24h_and_no_show():
    start = datetime(2026, 11, 4, 14)
    assert m.cancel_window(start, start - timedelta(hours=23, minutes=59)) == "lt24"
    assert m.cancel_window(start, start - timedelta(hours=24)) == "gt24"
    for window in ("lt24", "no_show"):
        c = m.cancellation(window=window, deposit_paid=100 * A, cashback_used=20 * A)
        assert (c.retained, c.refund, c.cashback_return) == (100 * A, 0, 20 * A)


def test_package_prices_match_site():
    months, prices = m.PACKAGES[20]
    assert months == 12 and prices[2] == 1440 * A


def test_studio_rent_hourly_with_cashback():
    p = m.price(kind="studio_rent", location="studio", cameras=0, duration_min=90, editing=False)
    assert p.total == 75 * A
    assert m.cashback_earned(p, from_package=False, first_shoot=False) == ("earn", 750)
    with pytest.raises(ValueError):
        m.price(kind="studio_rent", location="studio", cameras=0, duration_min=60, editing=True)
    with pytest.raises(ValueError):
        m.price(kind="studio_rent", location="onsite", cameras=0, duration_min=60, editing=False)


def test_discount_reels_pack_150_to_100():
    p = m.price(kind="reels_pack", location="studio", cameras=1, duration_min=45, editing=False, discount=50 * A)
    assert (p.gross, p.total) == (150 * A, 100 * A)
    assert m.deposit_expected(p.total, 0, False) == 50 * A
    assert m.cashback_earned(p, from_package=False, first_shoot=False) == ("earn", 10 * A)
    with pytest.raises(ValueError):
        m.price(kind="reels_pack", location="studio", cameras=1, duration_min=60, editing=False, discount=151 * A)
    with pytest.raises(ValueError):
        m.price(kind="reels_pack", location="studio", cameras=1, duration_min=50, editing=False)


def test_discount_on_package_extras():
    p = m.price(kind="shoot", location="studio", cameras=1, duration_min=60, editing=True, package_cameras=1,
                discount=20 * A)
    assert p.total == 80 * A
    assert m.cashback_earned(p, from_package=True, first_shoot=False) == ("earn", 8 * A)
