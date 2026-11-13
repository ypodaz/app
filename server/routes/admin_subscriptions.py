"""Admin: aylıq abunələr və sub-icarə (subscriptions.py). Məbləğlər qəpiklə tam ədəddir."""

from datetime import date, datetime
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import subscriptions
from auth import current_admin
from db import get_db, now
from models import Admin, AuditLog, Client, Subscription, SubscriptionPayment
from views import baku_today, iso

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])


class SubscriptionIn(BaseModel):
    client_id: int
    title: str = Field(min_length=1, max_length=120)
    kind: Literal["client", "rent"]
    amount: int = Field(gt=0, le=100_000_00)  # qəpik
    pay_day: int = Field(ge=0, le=28)  # 0 = ayın son günü
    visits_per_month: Optional[int] = Field(default=None, ge=0, le=100)
    starts_on: date
    note: Optional[str] = Field(default=None, max_length=2000)


class SubscriptionPatch(BaseModel):
    title: Optional[str] = Field(default=None, min_length=1, max_length=120)
    amount: Optional[int] = Field(default=None, gt=0, le=100_000_00)
    pay_day: Optional[int] = Field(default=None, ge=0, le=28)
    active: Optional[bool] = None
    visits_per_month: Optional[int] = Field(default=None, ge=0, le=100)
    note: Optional[str] = Field(default=None, max_length=2000)


class PaidIn(BaseModel):
    paid_at: Optional[AwareDatetime] = None


def payment_out(p: SubscriptionPayment) -> dict:
    return {"id": p.id, "period": p.period, "status": p.status, "amount": p.amount, "due_on": p.due_on.isoformat(),
            "paid_at": iso(p.paid_at)}


def sub_out(db: DB, s: Subscription, periods: list[str]) -> dict:
    pays = db.scalars(select(SubscriptionPayment).where(SubscriptionPayment.subscription_id == s.id,
                                                        SubscriptionPayment.period.in_(periods))
                      .order_by(SubscriptionPayment.period.desc())).all()
    return {"id": s.id, "client_id": s.client_id, "client_name": db.get(Client, s.client_id).full_name,
            "title": s.title, "kind": s.kind, "amount": s.amount, "pay_day": s.pay_day, "active": s.active,
            "visits_per_month": s.visits_per_month, "starts_on": s.starts_on.isoformat(), "note": s.note,
            "payments": [payment_out(p) for p in pays]}


def last_periods(today: date, n: int = 3) -> list[str]:
    out, y, m = [], today.year, today.month
    for _ in range(n):
        out.append(f"{y:04d}-{m:02d}")
        y, m = (y - 1, 12) if m == 1 else (y, m - 1)
    return out


def get_sub(db: DB, sub_id: int) -> Subscription:
    s = db.get(Subscription, sub_id)
    if not s:
        raise HTTPException(404, "Abunə tapılmadı")
    return s


def get_payment(db: DB, payment_id: int) -> SubscriptionPayment:
    p = db.get(SubscriptionPayment, payment_id)
    if not p:
        raise HTTPException(404, "Ödəniş tapılmadı")
    return p


def audit(db: DB, admin: Admin, action: str, entity: str, entity_id: int, before: dict | None, after: dict) -> None:
    db.add(AuditLog(admin_id=admin.id, action=action, entity=entity, entity_id=entity_id, before=before, after=after))


@router.get("/subscriptions")
def list_subscriptions(db: DB = Depends(get_db)):
    periods = last_periods(baku_today())
    return [sub_out(db, s, periods) for s in db.scalars(select(Subscription).order_by(Subscription.active.desc(), Subscription.id))]


@router.post("/subscriptions")
def create_subscription(body: SubscriptionIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    if not db.get(Client, body.client_id):
        raise HTTPException(404, "Müştəri tapılmadı")
    s = Subscription(**body.model_dump())
    db.add(s)
    db.flush()
    subscriptions.ensure_payments(db, baku_today())
    audit(db, admin, "create", "subscription", s.id, None,
          {"client_id": s.client_id, "kind": s.kind, "amount": s.amount, "pay_day": s.pay_day})
    db.commit()
    return sub_out(db, s, last_periods(baku_today()))


@router.patch("/subscriptions/{sub_id}")
def patch_subscription(sub_id: int, body: SubscriptionPatch, db: DB = Depends(get_db),
                       admin: Admin = Depends(current_admin)):
    s = get_sub(db, sub_id)
    changes = body.model_dump(exclude_unset=True)
    if any(changes.get(k, 0) is None for k in ("title", "amount", "pay_day", "active")):
        raise HTTPException(422, "Ad, məbləğ, ödəniş günü və vəziyyət boş ola bilməz")
    before = {k: getattr(s, k) for k in changes}
    for k, v in changes.items():
        setattr(s, k, v)
    audit(db, admin, "update", "subscription", s.id, before, changes)
    db.commit()
    return sub_out(db, s, last_periods(baku_today()))


def _change(db: DB, admin: Admin, payment_id: int, action: str, fn) -> dict:
    p = get_payment(db, payment_id)
    snap = lambda: {"status": p.status, "paid_at": p.paid_at.isoformat() if p.paid_at else None, "amount": p.amount}  # noqa: E731
    before = snap()
    fn(p)
    audit(db, admin, action, "subscription_payment", p.id, before, snap())
    db.commit()
    return payment_out(p)


@router.post("/subscriptions/payments/{payment_id}/paid")
def paid(payment_id: int, body: PaidIn | None = None, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    when: datetime = body.paid_at if body and body.paid_at else now()
    return _change(db, admin, payment_id, "paid", lambda p: subscriptions.mark_paid(db, p, when))


@router.post("/subscriptions/payments/{payment_id}/skip")
def skip(payment_id: int, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    return _change(db, admin, payment_id, "skip", lambda p: subscriptions.mark_skipped(db, p))


@router.post("/subscriptions/payments/{payment_id}/unpaid")
def unpaid(payment_id: int, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    return _change(db, admin, payment_id, "unpaid", lambda p: subscriptions.mark_unpaid(db, p))
