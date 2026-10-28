"""booking.py: dizayndakı axınlar bazaya düzgün yazılırmı (B2d, B4a, B4b, B6c, B7, B8, B9)."""

import os
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

import booking as b  # noqa: E402
from db import Base, SessionLocal, engine  # noqa: E402
from models import CashbackLedger, Client, Shoot  # noqa: E402

A = 100
BAKU = timezone(timedelta(hours=4))


@pytest.fixture()
def db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as s:
        yield s
    engine.dispose()
    Path("test.db").unlink(missing_ok=True)


def client(db, name, activated=None):
    c = Client(full_name=name, card_code=name[:8], activated_at=activated)
    db.add(c)
    db.flush()
    return c


def at(day, hour, month=11):
    return datetime(2026, month, day, hour, tzinfo=BAKU)


def shoot(db, c, **kw):
    args = dict(client_id=c.id, starts_at=at(6, 12), duration_min=60, kind="shoot", tag="podcast",
                location="studio", cameras=1, editing=False)
    args.update(kw)
    return b.create_shoot(db, None, **args)


def test_aysel_b9_cashback_spend_and_close(db):
    c = client(db, "Aysel", activated=at(1, 10, month=10))
    b.manual_cashback(db, None, c.id, 76 * A, "Əvvəlki keşbek")
    with pytest.raises(b.Rejected, match="tam istifadə"):  # hissə-hissə yox
        shoot(db, c, cameras=2, editing=True, cashback_use=20 * A)
    s = shoot(db, c, cameras=2, editing=True, cashback_use=76 * A)
    assert (s.total, s.cashback_used, s.deposit_expected) == (220 * A, 76 * A, 72 * A)
    assert b.cashback_balance(db, c.id) == 0
    b.receive_deposit(db, None, s, 72 * A)
    # Aysel artıq earn_first almış sayılsın deyə əvvəlki bağlanmış çəkiliş
    db.add(CashbackLedger(client_id=c.id, kind="earn_first", amount=0))
    earned = b.close_shoot(db, None, s, duration_min=60, paid_method="cash")
    assert earned == 22 * A
    assert (s.status, s.paid_at_studio) == ("completed", 72 * A)
    assert b.cashback_balance(db, c.id) == 22 * A


def test_leyla_b4a_first_shoot_two_hours(db):
    c = client(db, "Leyla", activated=at(20, 10, month=10))
    s = shoot(db, c, starts_at=at(28, 12, month=10))
    b.receive_deposit(db, None, s, 50 * A)
    earned = b.close_shoot(db, None, s, duration_min=120, paid_method="card")
    assert (s.total, s.paid_at_studio, earned) == (140 * A, 90 * A, 70 * A)
    assert db.query(CashbackLedger).filter_by(kind="earn_first").count() == 1
    # ikinci çəkiliş artıq 10%
    s2 = shoot(db, c, editing=True, reels_count=4)
    assert (s2.total, s2.deposit_expected) == (210 * A, 105 * A)
    assert b.close_shoot(db, None, s2, duration_min=60, paid_method="cash") == 21 * A


def test_not_activated_client_gets_10_percent(db):
    c = client(db, "Köhnə")
    s = shoot(db, c)
    assert b.close_shoot(db, None, s, duration_min=60, paid_method="cash") == 7 * A


def test_kamran_b4b_package(db):
    k = client(db, "Kamran", activated=at(1, 10, month=10))
    b.manual_cashback(db, None, k.id, 18 * A, "")
    db.add(CashbackLedger(client_id=k.id, kind="earn_first", amount=0))
    pkg = b.create_package(db, None, owner_client_id=k.id, title="Nümunə MMC", hours=20, cameras=2,
                           starts_on=date(2025, 11, 7), used_minutes=8 * 60)
    assert pkg.ends_on == date(2026, 11, 7) and pkg.price_paid == 1440 * A
    assert b.package_left(db, pkg) == 12 * 60
    s = shoot(db, k, starts_at=at(27, 16, month=10), cameras=2, editing=True, package_id=pkg.id)
    assert (s.total, s.deposit_expected) == (100 * A, 0)
    earned = b.close_shoot(db, None, s, duration_min=120, paid_method="cash")
    assert earned == 10 * A
    assert b.cashback_balance(db, k.id) == 28 * A
    assert b.package_left(db, pkg) == 10 * 60


def test_package_rules(db):
    k = client(db, "Kamran")
    other = client(db, "Kənar")
    pkg = b.create_package(db, None, owner_client_id=k.id, title="P", hours=5, cameras=1,
                           starts_on=date(2026, 10, 1))
    assert pkg.ends_on == date(2026, 12, 1)
    with pytest.raises(b.Rejected, match="üzvü deyil"):
        shoot(db, other, package_id=pkg.id)
    with pytest.raises(b.Rejected, match="müddətinə"):
        shoot(db, k, package_id=pkg.id, starts_at=at(2, 12, month=12))
    with pytest.raises(b.Rejected, match="qalıb"):
        shoot(db, k, package_id=pkg.id, duration_min=330)
    s = shoot(db, k, package_id=pkg.id, cameras=2, duration_min=90)
    assert s.price_extra_camera == 75 * A


def test_b8_cancel_gt24_refund_and_cashback_back(db):
    c = client(db, "Tural")
    b.manual_cashback(db, None, c.id, 80 * A, "")
    s = shoot(db, c, starts_at=at(4, 14), cameras=2, editing=True, cashback_use=80 * A)
    assert b.cashback_balance(db, c.id) == 0
    b.receive_deposit(db, None, s, 30 * A)
    r = b.cancel_shoot(db, None, s, at(28, 11, month=10))
    assert (r.window, r.refund, r.retained) == ("gt24", 30 * A, 0)
    assert b.cashback_balance(db, c.id) == 80 * A
    b.mark_refunded(db, None, s)
    with pytest.raises(b.Rejected):
        b.mark_refunded(db, None, s)


def test_cancel_lt24_and_no_show_keep_deposit(db):
    c = client(db, "Elvin")
    s = shoot(db, c)
    b.receive_deposit(db, None, s, 35 * A)
    r = b.cancel_shoot(db, None, s, at(6, 1))
    assert (r.window, r.retained, r.refund) == ("lt24", 35 * A, 0)
    s2 = shoot(db, c)
    b.receive_deposit(db, None, s2, 35 * A)
    b.no_show(db, None, s2)
    assert (s2.status, s2.retained_amount) == ("no_show", 35 * A)
    assert db.get(Client, c.id).deposit_required is True
    with pytest.raises(b.Rejected):
        b.close_shoot(db, None, s2, duration_min=60, paid_method="cash")


def test_reschedule_lt24_once(db):
    c = client(db, "Rauf")
    s = shoot(db, c)
    b.reschedule(db, None, s, at(8, 12), at(6, 2))
    assert s.rescheduled_lt24
    with pytest.raises(b.Rejected, match="bir dəfə"):
        b.reschedule(db, None, s, at(9, 12), at(8, 3))
    b.reschedule(db, None, s, at(12, 12), at(7, 12))  # 24 saatdan çox qalıb — yenə olar


def test_validation_messages(db):
    c = client(db, "Test")
    with pytest.raises(b.Rejected, match="montaj olmadan"):
        shoot(db, c, reels_count=2)
    with pytest.raises(b.Rejected, match="kifayət etmir"):
        shoot(db, c, cashback_use=5 * A)
    s = shoot(db, c, editing=True)
    with pytest.raises(b.Rejected, match="Beh"):
        b.receive_deposit(db, None, s, 500 * A)
    with pytest.raises(b.Rejected, match="mənfiyə|düzgün"):
        b.manual_cashback(db, None, c.id, -1 * A, "")


def test_close_cannot_drop_below_paid(db):
    c = client(db, "Az")
    s = shoot(db, c, cameras=3, duration_min=120)
    b.receive_deposit(db, None, s, 170 * A)
    with pytest.raises(b.Rejected, match="artıq ödəniləndən"):
        b.close_shoot(db, None, s, duration_min=30, paid_method=None)
    assert db.get(Shoot, s.id).status == "confirmed"
