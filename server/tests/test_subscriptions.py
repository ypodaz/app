"""subscriptions.py: ödəniş günü, aylıq sətirlər, Kassa, 0 AZN görüş, Telegram düymələri."""
from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import CHAT, TG_SECRET, crm_env  # noqa: F401,I001

from datetime import date, datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

import booking  # noqa: E402
import subscriptions as subs  # noqa: E402
from auth import new_card_code  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import AuditLog, Client, Subscription, SubscriptionPayment  # noqa: E402

H = {"X-Telegram-Bot-Api-Secret-Token": TG_SECRET}
BAKU = timezone(timedelta(hours=4))


def mk_client(name="Nümunə Müştəri"):
    with SessionLocal() as db:
        c = Client(full_name=name, phone="", card_code=new_card_code())
        db.add(c)
        db.commit()
        return c.id


def mk_sub(client_id, kind="client", amount=200_00, pay_day=20, starts_on=date(2026, 11, 1), active=True):
    with SessionLocal() as db:
        s = Subscription(client_id=client_id, title="Aylıq abunə", kind=kind, amount=amount, pay_day=pay_day,
                         starts_on=starts_on, active=active)
        db.add(s)
        db.commit()
        return s.id


def payments(sub_id):
    with SessionLocal() as db:
        return db.scalars(select(SubscriptionPayment).where(SubscriptionPayment.subscription_id == sub_id)
                          .order_by(SubscriptionPayment.period)).all()


def test_due_date_clamps_and_last_day():
    assert subs.due_date(2026, 11, 20) == date(2026, 11, 20)
    assert subs.due_date(2026, 11, 0) == date(2026, 11, 30)
    assert subs.due_date(2026, 12, 0) == date(2026, 12, 31)
    assert subs.due_date(2026, 2, 0) == date(2026, 2, 28)
    assert subs.due_date(2028, 2, 0) == date(2028, 2, 29)
    assert subs.due_date(2026, 2, 28) == date(2026, 2, 28)
    assert subs.due_date(2026, 2, 31) == date(2026, 2, 28)  # sıxılır


def test_ensure_payments_idempotent_and_not_before_start(api):
    sid = mk_sub(mk_client(), starts_on=date(2026, 9, 15), pay_day=0)
    mk_sub(mk_client("Nümunə Müştəri 2"), starts_on=date(2026, 11, 5), active=False)  # passiv: sətir yoxdur
    with SessionLocal() as db:
        assert subs.ensure_payments(db, date(2026, 11, 13)) == 3
        db.commit()
        assert subs.ensure_payments(db, date(2026, 11, 13)) == 0
        db.commit()
    rows = payments(sid)
    assert [(p.period, p.due_on, p.status) for p in rows] == [
        ("2026-09", date(2026, 9, 30), "pending"), ("2026-10", date(2026, 10, 31), "pending"),
        ("2026-11", date(2026, 11, 30), "pending")]
    with SessionLocal() as db:  # ay dəyişir: yalnız yeni ay əlavə olunur
        assert subs.ensure_payments(db, date(2026, 12, 1)) == 1
        db.commit()
    assert len(payments(sid)) == 4


def test_paid_lands_in_month_of_paid_at(api):
    adm = bearer(admin_token(api))
    sid = mk_sub(mk_client(), starts_on=date(2026, 11, 1))
    with SessionLocal() as db:
        subs.ensure_payments(db, date(2026, 12, 3))
        db.commit()
    nov, dec = payments(sid)
    r = api.post(f"/api/admin/subscriptions/payments/{nov.id}/paid",
                 json={"paid_at": "2026-11-20T10:00:00+04:00"}, headers=adm)
    assert r.status_code == 200 and r.json()["status"] == "paid"
    cash = lambda m: api.get("/api/admin/report", params={"month": m}, headers=adm).json()["cash"]  # noqa: E731
    assert cash("2026-11")["subscriptions"] == 200_00 and cash("2026-11")["net"] == 200_00
    assert cash("2026-12")["subscriptions"] == 0 and cash("2026-12")["net"] == 0
    # keçən aya aid ödəniş bu ay ödənilib → bu ayın kassasına düşür
    api.post(f"/api/admin/subscriptions/payments/{dec.id}/paid", json={"paid_at": "2026-12-02T12:00:00+04:00"}, headers=adm)
    assert cash("2026-12")["subscriptions"] == 200_00
    # geri al
    assert api.post(f"/api/admin/subscriptions/payments/{dec.id}/unpaid", headers=adm).json()["status"] == "pending"
    assert cash("2026-12")["subscriptions"] == 0
    assert api.post(f"/api/admin/subscriptions/payments/{dec.id}/skip", headers=adm).json()["status"] == "skipped"
    with SessionLocal() as db:
        assert {a.action for a in db.scalars(select(AuditLog).where(AuditLog.entity == "subscription_payment"))} \
            == {"paid", "unpaid", "skip"}


def test_admin_api_create_list_patch_validation(api):
    adm = bearer(admin_token(api))
    cid = mk_client()
    body = {"client_id": cid, "title": "Sub-icarə", "kind": "rent", "amount": 400_00, "pay_day": 0,
            "starts_on": "2026-11-01"}
    assert api.post("/api/admin/subscriptions", json={**body, "pay_day": 29}, headers=adm).status_code == 422
    assert api.post("/api/admin/subscriptions", json={**body, "amount": 0}, headers=adm).status_code == 422
    assert api.post("/api/admin/subscriptions", json={**body, "client_id": 9999}, headers=adm).status_code == 404
    r = api.post("/api/admin/subscriptions", json=body, headers=adm)
    assert r.status_code == 200 and r.json()["client_name"] == "Nümunə Müştəri" and r.json()["payments"][0]["status"] == "pending"
    sid = r.json()["id"]
    r = api.patch(f"/api/admin/subscriptions/{sid}", json={"amount": 450_00, "active": False}, headers=adm)
    assert r.json()["amount"] == 450_00 and r.json()["active"] is False
    assert [x["id"] for x in api.get("/api/admin/subscriptions", headers=adm).json()] == [sid]


def test_subscription_client_visit_is_free_without_cashback(api):
    adm = bearer(admin_token(api))
    sub_client, other, tenant = mk_client("Abunəçi Nümunə"), mk_client("Adi Nümunə"), mk_client("İcarəçi Nümunə")
    mk_sub(sub_client)
    mk_sub(tenant, kind="rent")
    start = datetime(2026, 11, 18, 12, tzinfo=BAKU)
    quote = lambda cid: api.post("/api/admin/shoots/quote", headers=adm, json={  # noqa: E731
        "client_id": cid, "starts_at": start.isoformat(), "duration_min": 60, "kind": "shoot", "tag": "podcast",
        "location": "studio", "cameras": 2, "editing": True}).json()
    q = quote(sub_client)
    assert q["total"] == 0 and q["base"] == 0 and q["editing"] == 0 and q["cashback_earn"] == 0
    assert quote(other)["total"] > 0 and quote(tenant)["total"] > 0  # başqa müştərilər dəyişmir
    with SessionLocal() as db:
        s = booking.create_shoot(db, None, client_id=sub_client, starts_at=start, duration_min=60, kind="shoot",
                                 tag="podcast", location="studio", cameras=2, editing=True)
        assert s.total == 0 and s.price_base == 0 and s.discount_note == "Aylıq abunə" and s.deposit_expected == 0
        assert booking.close_shoot(db, None, s, duration_min=120, paid_method=None) == 0
        assert s.total == 0 and s.paid_at_studio == 0
        o = booking.create_shoot(db, None, client_id=other, starts_at=start, duration_min=60, kind="shoot",
                                 tag="podcast", location="studio", cameras=2, editing=True)
        assert o.total > 0
        db.rollback()
    # abunə passiv olunca qiymət qayıdır
    api.patch("/api/admin/subscriptions/1", json={"active": False}, headers=adm)
    assert quote(sub_client)["total"] > 0


@pytest.fixture()
def sent(monkeypatch):
    out = []
    monkeypatch.setattr(subs, "_send", lambda text, kb: out.append((text, kb)) or "42")
    return out


def utc(*a):
    return datetime(*a, tzinfo=timezone.utc)


def test_ask_due_once_per_day_after_10(api, sent):
    cid = mk_client()
    sid = mk_sub(cid, amount=200_00, pay_day=20, starts_on=date(2026, 11, 1))
    with SessionLocal() as db:
        subs.ensure_payments(db, date(2026, 11, 20))
        db.commit()
        assert subs.ask_due(db, utc(2026, 11, 19, 12)) == 0  # vaxt çatmayıb
        assert subs.ask_due(db, utc(2026, 11, 20, 5)) == 0  # Bakı 09:00
        assert sent == []
        assert subs.ask_due(db, utc(2026, 11, 20, 6)) == 1  # Bakı 10:00
        assert subs.ask_due(db, utc(2026, 11, 20, 15)) == 0  # eyni gün təkrar yox
        assert subs.ask_due(db, utc(2026, 11, 21, 6)) == 1  # cavabsız/«Sonra»: növbəti gün
    text, kb = sent[0]
    assert text == "💳 Nümunə Müştəri — Aylıq abunə: 200 AZN ödəniş günüdür. Ödədi?"
    pid = payments(sid)[0].id
    assert [b["callback_data"] for row in kb for b in row] == [f"a:p:{pid}", f"a:l:{pid}", f"a:s:{pid}"]
    assert payments(sid)[0].asked_at is not None


def cb(api, data, message_id=5):
    body = {"callback_query": {"id": "q", "data": data, "from": {"id": int(CHAT)},
                               "message": {"message_id": message_id, "chat": {"id": int(CHAT)}}}}
    return api.post("/api/webhooks/telegram", json=body, headers=H).json()["result"]


def test_telegram_callbacks(api, crm_env):
    sid = mk_sub(mk_client(), starts_on=date(2026, 9, 1), pay_day=1)
    with SessionLocal() as db:
        subs.ensure_payments(db, date(2026, 11, 13))
        db.commit()
    sep, octo, nov = payments(sid)
    assert cb(api, f"a:p:{sep.id}") == "paid"
    p = payments(sid)[0]
    assert p.status == "paid" and p.paid_at is not None
    assert "✅ Ödənildi: Nümunə Müştəri — Aylıq abunə: 200 AZN" in crm_env.tg("editMessageText")[-1]["text"]
    assert cb(api, f"a:l:{octo.id}") == "later" and payments(sid)[1].status == "pending"
    assert cb(api, f"a:s:{nov.id}") == "skipped" and payments(sid)[2].status == "skipped"
    assert "🚫 Bu ay yox" in crm_env.tg("editMessageText")[-1]["text"]
    assert cb(api, f"a:p:{sep.id}") == "resolved"  # artıq həll olunub
    assert cb(api, "a:p:9999") == "resolved"
    # sahibkar olmayan düyməyə basa bilməz
    body = {"callback_query": {"id": "q", "data": f"a:p:{octo.id}", "from": {"id": 1},
                               "message": {"message_id": 5, "chat": {"id": int(CHAT)}}}}
    assert api.post("/api/webhooks/telegram", json=body, headers=H).json()["result"] == "ignored"
    assert payments(sid)[1].status == "pending"
