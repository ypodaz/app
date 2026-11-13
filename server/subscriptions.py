"""Aylıq abunələr: müştəri abunəsi (çəkilişlər 0 AZN, keşbek yoxdur) və sub-icarə (kind=rent).

- Hər aktiv abunə üçün starts_on ayından bu aya qədər hər ayın `pending` ödəniş sətri yaranır (təkrar yaranmır).
- Ödəniş günü saat 10:00-dan (Bakı) sahibkara Telegram kartı gedir: ✅ Ödədi / ⏳ Sonra / 🚫 Bu ay yox.
  Cavabsız və ya «Sonra» kart növbəti gün 10:00-da təkrar gəlir (asked_at əvvəlki Bakı günündədirsə).
- Pul «Kassa»-ya `paid_at`-ın düşdüyü ayda yazılır (routes/admin_shoots.py `report`).

Telegram callback_data (`a:`): p (ödədi), l (sonra), s (bu ay yox); `a:{əməl}:{ödəniş_id}`.
"""
import asyncio
import calendar
import logging
from datetime import date, datetime

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import money
import tgtopics
from db import SessionLocal, aware, now
from models import Client, Subscription, SubscriptionPayment
from views import BAKU

log = logging.getLogger("subscriptions")
INTERVAL = 3600
ASK_HOUR = 10


def due_date(year: int, month: int, pay_day: int) -> date:
    """pay_day 1–28 (qısa ayda ayın sonuna sıxılır), 0 = ayın son günü."""
    last = calendar.monthrange(year, month)[1]
    return date(year, month, last if pay_day == 0 else min(pay_day, last))


def has_free_visits(db: DB, client_id: int) -> bool:
    """Aktiv müştəri abunəsi olan müştərinin çəkilişləri 0 AZN-dir, keşbek yazılmır."""
    return db.scalar(select(Subscription.id).where(Subscription.client_id == client_id, Subscription.kind == "client",
                                                   Subscription.active.is_(True)).limit(1)) is not None


def ensure_payments(db: DB, today: date) -> int:
    """Aktiv abunələr üçün çatışmayan aylıq `pending` sətirlər (yalnız starts_on ayından bu aya qədər). Qaytarır: yaranan say."""
    made = 0
    for sub in db.scalars(select(Subscription).where(Subscription.active.is_(True))):
        have = set(db.scalars(select(SubscriptionPayment.period).where(SubscriptionPayment.subscription_id == sub.id)))
        y, m = sub.starts_on.year, sub.starts_on.month
        while (y, m) <= (today.year, today.month):
            period = f"{y:04d}-{m:02d}"
            if period not in have:
                db.add(SubscriptionPayment(subscription_id=sub.id, period=period, amount=sub.amount,
                                           status="pending", due_on=due_date(y, m, sub.pay_day)))
                made += 1
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    db.flush()
    return made


def mark_paid(db: DB, p: SubscriptionPayment, when: datetime) -> None:
    p.status, p.paid_at = "paid", when


def mark_skipped(db: DB, p: SubscriptionPayment) -> None:
    p.status, p.paid_at = "skipped", None


def mark_unpaid(db: DB, p: SubscriptionPayment) -> None:
    p.status, p.paid_at = "pending", None


# --- Telegram ---

def _send(text: str, buttons: list[list[dict]]) -> str | None:
    from crm.tg import _call
    payload = {**tgtopics.dest("action"), "text": text[:4000], "reply_markup": {"inline_keyboard": buttons}}
    mid = ((_call("sendMessage", payload) or {}).get("result") or {}).get("message_id")
    return str(mid) if mid else None


def _label(db: DB, p: SubscriptionPayment) -> str:
    sub = db.get(Subscription, p.subscription_id)
    return f"{db.get(Client, sub.client_id).full_name} — {sub.title}: {money.fmt(p.amount)}"


def ask_due(db: DB, t: datetime) -> int:
    """Ödəniş günü gəlmiş `pending` sətirlər üçün (Bakı 10:00-dan sonra) bir kart. Qaytarır: göndərilən say."""
    local = aware(t).astimezone(BAKU)
    if local.hour < ASK_HOUR:
        return 0
    sent = 0
    rows = db.scalars(select(SubscriptionPayment).join(Subscription, Subscription.id == SubscriptionPayment.subscription_id)
                      .where(SubscriptionPayment.status == "pending", SubscriptionPayment.due_on <= local.date(),
                             Subscription.active.is_(True)).order_by(SubscriptionPayment.id)).all()
    for p in rows:
        if p.asked_at is not None and aware(p.asked_at).astimezone(BAKU).date() >= local.date():
            continue
        text = f"💳 {_label(db, p)} ödəniş günüdür. Ödədi?"
        kb = [[{"text": "✅ Ödədi", "callback_data": f"a:p:{p.id}"}, {"text": "⏳ Sonra", "callback_data": f"a:l:{p.id}"}],
              [{"text": "🚫 Bu ay yox", "callback_data": f"a:s:{p.id}"}]]
        if _send(text, kb):
            p.asked_at = t
            db.commit()
            sent += 1
    return sent


def handle_callback(db: DB, cq: dict) -> str:
    """`a:{əməl}:{ödəniş_id}`. Qaytarır: ignored | resolved | paid | later | skipped."""
    from crm.tg import _call
    from crm.todo import is_owner
    msg = cq.get("message") or {}
    parts = str(cq.get("data", "")).split(":")
    if len(parts) != 3 or parts[1] not in ("p", "l", "s") or not parts[2].isdigit() \
            or not is_owner({**msg, "from": cq.get("from")}):
        return "ignored"
    p = db.get(SubscriptionPayment, int(parts[2]))

    def reply(answer: str, text: str | None = None) -> None:
        _call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": answer[:190]})
        if text:
            _call("editMessageText", {"chat_id": msg["chat"]["id"], "message_id": msg.get("message_id"), "text": text[:4000]})

    if not p or p.status != "pending":
        reply("artıq həll olunub")
        return "resolved"
    label = _label(db, p)
    act = parts[1]
    if act == "p":
        mark_paid(db, p, now())
        db.commit()
        reply("✅ Ödənildi", f"✅ Ödənildi: {label}")
        return "paid"
    if act == "l":
        db.commit()  # pending qalır, asked_at bu gündədir → növbəti gün 10:00-da yenidən soruşulur
        reply("⏳ Sonra xatırladacam", f"⏳ Sonra: {label}")
        return "later"
    mark_skipped(db, p)
    db.commit()
    reply("🚫 Bu ay yox", f"🚫 Bu ay yox: {label}")
    return "skipped"


def tick() -> None:
    with SessionLocal() as db:
        t = now()
        ensure_payments(db, t.astimezone(BAKU).date())
        db.commit()
        ask_due(db, t)


async def loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:  # dövr heç vaxt dayanmamalıdır
            log.exception("abunə dövrü")
        await asyncio.sleep(INTERVAL)
