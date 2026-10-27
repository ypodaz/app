import os
import sys
from datetime import date
from pathlib import Path

import pytest
from sqlalchemy.exc import IntegrityError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ["DATABASE_URL"] = "sqlite:///./test.db"

from db import Base, SessionLocal, engine, now  # noqa: E402
from models import CashbackLedger, Client, Package, PackageHoursLedger, PackageMember, Shoot  # noqa: E402


@pytest.fixture()
def db():
    Base.metadata.drop_all(engine)
    Base.metadata.create_all(engine)
    with SessionLocal() as s:
        yield s
    engine.dispose()
    Path("test.db").unlink(missing_ok=True)


def seed(db):
    c = Client(full_name="Aysel", card_code="YP-0001")
    db.add(c)
    db.flush()
    p = Package(title="20 saat", owner_client_id=c.id, minutes_total=1200, cameras=3,
                starts_on=date(2026, 11, 1), ends_on=date(2027, 5, 1), price_paid=150000)
    db.add(p)
    db.flush()
    sh = Shoot(client_id=c.id, package_id=p.id, tag="podcast", location="studio",
               starts_at=now(), duration_min=120, cameras=3)
    db.add(sh)
    db.flush()
    db.add_all([PackageMember(package_id=p.id, client_id=c.id),
                PackageHoursLedger(package_id=p.id, shoot_id=sh.id, delta_minutes=-120)])
    db.commit()
    return c, p, sh


def test_shoot_defaults(db):
    _, _, sh = seed(db)
    assert (sh.kind, sh.status, sh.production) == ("shoot", "confirmed", "none")
    assert sh.total == 0 and sh.deposit_waived is False and sh.rescheduled_lt24 is False


def test_money_records_block_delete(db):
    # Çəkilişi olan paket və müştəri silinmir: pul tarixçəsi itməməlidir.
    c, p, _ = seed(db)
    for table, row_id in ((Package.__table__, p.id), (Client.__table__, c.id)):
        with pytest.raises(IntegrityError):
            db.execute(table.delete().where(table.c.id == row_id))
            db.flush()
        db.rollback()


def test_package_delete_cascades(db):
    _, p, _ = seed(db)
    db.execute(Shoot.__table__.delete())
    db.commit()
    db.execute(Package.__table__.delete().where(Package.__table__.c.id == p.id))
    db.commit()
    assert db.query(PackageMember).count() == 0
    assert db.query(PackageHoursLedger).count() == 0


def test_shoot_delete_nulls_ledger_refs(db):
    c, p, sh = seed(db)
    db.add(CashbackLedger(client_id=c.id, shoot_id=sh.id, kind="earn", amount=500))
    db.commit()
    db.execute(Shoot.__table__.delete())
    db.commit()
    assert db.query(CashbackLedger).one().shoot_id is None
    assert db.query(PackageHoursLedger).one().shoot_id is None
