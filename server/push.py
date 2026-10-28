"""Web Push və vaxtlı bildirişlər.

Bildiriş həmişə əvvəl `notifications` cədvəlinə yazılır (app-daki siyahı üçün). Bu dövr hər yarım dəqiqədən bir
`pushed_at` boş olanları telefona göndərir, sonra «sabah çəkiliş» və «paket bitir» bildirişlərini yaradır.
Göndərmə tranzaksiyadan kənardadır: push alınmasa da bazadakı əməliyyat pozulmur.
"""

import asyncio
import json
import logging
from datetime import timedelta

from pywebpush import WebPushException, webpush
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DB

import booking
import growth
import money
import settings
from db import SessionLocal, aware, now
from models import Notification, Package, PushSubscription, Shoot
from views import BAKU, baku_today

log = logging.getLogger("push")
INTERVAL = 30
WD = ["bazar ertəsi", "çərşənbə axşamı", "çərşənbə", "cümə axşamı", "cümə", "şənbə", "bazar"]


def _when(dt) -> str:
    t = aware(dt).astimezone(BAKU)
    return f"{t.day:02d}.{t.month:02d} ({WD[t.weekday()]}) saat {t:%H:%M}"


def message(db: DB, n: Notification) -> dict:
    """Bildirişin telefondakı mətni: {title, body, url}."""
    p = n.payload or {}
    s = db.get(Shoot, p["shoot_id"]) if p.get("shoot_id") else None
    url = f"#/shoots/{s.id}" if s else "#/notifications"
    when = _when(s.starts_at) if s else ""
    texts = {
        "shoot_created": ("Yeni çəkiliş", f"{when} sizi gözləyirik"),
        "deposit_received": ("Beh qəbul olundu", f"{money.fmt(p.get('amount', 0))} · {when}"),
        "shoot_rescheduled": ("Çəkiliş vaxtı dəyişdi", f"Yeni vaxt: {when}"),
        "shoot_updated": ("Çəkiliş yeniləndi", f"{when} çəkilişinin məlumatı dəyişdi"),
        "shoot_cancelled": ("Çəkiliş ləğv olundu", f"{when} çəkilişi ləğv edildi"),
        "refunded": ("Ödəniş qaytarıldı", money.fmt(p.get("amount", 0))),
        "shoot_closed": ("Keşbek yazıldı", f"+{money.fmt(p.get('cashback', 0))} balansınıza əlavə olundu")
        if p.get("cashback") else ("Çəkiliş bağlandı", "Bizi seçdiyiniz üçün təşəkkür edirik"),
        "materials_ready": ("Materiallar hazırdır", "Çəkilişinizin materiallarını app-da aça bilərsiniz"),
        "shoot_reminder": ("Sabah çəkilişiniz var", f"{when} · Y Pod studiyası"),
        "package_ending": ("Paketiniz bitmək üzrədir",
                           f"{money.fmt_hours(p.get('minutes_left', 0))} saat qalıb, {p.get('ends_on', '')}-dək"),
    }
    if n.type == "campaign":
        return {"title": p.get("title") or "Y Pod", "body": p.get("body") or "", "url": f"#/offer/{p.get('campaign_id')}",
                "tag": f"campaign-{p.get('campaign_id')}"}
    if n.type == "bonus":
        amount = money.fmt(p.get("amount", 0))
        texts["bonus"] = {
            "profile_bonus": ("Profil bonusu", f"+{amount} keşbek balansınıza yazıldı. Təşəkkür edirik!"),
            "referral": ("Dostunuz gəldi 🎉", f"{p.get('friend', 'Dostunuz')} ilə birlikdə +{amount} keşbek qazandınız"),
        }.get(p.get("kind"), ("Bonus", f"+{amount} keşbek balansınıza yazıldı"))
        url = "#/cashback"
    title, body = texts.get(n.type, ("Y Pod", "Yeni bildiriş"))
    if n.type == "materials_ready":
        url = "#/materials"
    elif n.type == "package_ending":
        url = "#/package"
    return {"title": title, "body": body, "url": url, "tag": f"{n.type}-{p.get('shoot_id', n.id)}"}


def _send(sub: PushSubscription, data: dict) -> bool:
    """False: abunə artıq yoxdur (silinməlidir)."""
    try:
        webpush({"endpoint": sub.endpoint, "keys": {"p256dh": sub.p256dh, "auth": sub.auth}},
                json.dumps(data, ensure_ascii=False), vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_SUBJECT}, ttl=86400, timeout=10)
    except WebPushException as e:
        if e.response is not None and e.response.status_code in (404, 410):
            return False
        log.warning("push alınmadı: %s", e)
    return True


def send_pending(db: DB) -> int:
    rows = db.scalars(select(Notification).where(Notification.pushed_at.is_(None)).order_by(Notification.id)
                      .limit(100)).all()
    sent = 0
    for n in rows:
        n.pushed_at = now()
        if not settings.VAPID_PRIVATE_KEY or aware(n.created_at) < now() - timedelta(hours=6):
            continue  # açar yoxdur və ya çox köhnədir: yalnız app-da görünür
        data = message(db, n)
        for sub in db.scalars(select(PushSubscription).where(PushSubscription.client_id == n.client_id)).all():
            if _send(sub, data):
                sent += 1
            else:
                db.delete(sub)
    db.commit()
    return sent


def make_reminders(db: DB) -> None:
    """Çəkilişdən ~24 saat əvvəl xatırlatma; paketdə 2 saatdan az və ya 7 gündən az qalanda xəbərdarlıq."""
    t = now()
    for s in db.scalars(select(Shoot).where(Shoot.status == "confirmed", Shoot.reminded_at.is_(None),
                                            Shoot.starts_at > t, Shoot.starts_at <= t + timedelta(hours=24))):
        s.reminded_at = t
        if aware(s.starts_at) > t + timedelta(hours=3):  # son anda yaradılan çəkilişə «sabah» demirik
            booking._notify(db, s.client_id, "shoot_reminder", shoot_id=s.id)
    today = baku_today()
    for pkg in db.scalars(select(Package).where(Package.ending_notified_at.is_(None), Package.ends_on >= today)):
        left = booking.package_left(db, pkg)
        if pkg.starts_on <= today and (left < 120 or pkg.ends_on <= today + timedelta(days=7)):
            pkg.ending_notified_at = t
            booking._notify(db, pkg.owner_client_id, "package_ending", minutes_left=left,
                            ends_on=f"{pkg.ends_on:%d.%m.%Y}")
    db.commit()


def tick() -> None:
    with SessionLocal() as db:
        make_reminders(db)
        growth.run_daily(db)  # gündə bir dəfə avtomatik bildirişlər
        db.commit()
        send_pending(db)


async def loop() -> None:
    while True:
        try:
            await asyncio.to_thread(tick)
        except Exception:  # dövr heç vaxt dayanmamalıdır
            log.exception("bildiriş dövrü")
        await asyncio.sleep(INTERVAL)


def subscribe(db: DB, client_id: int, endpoint: str, p256dh: str, auth: str) -> None:
    db.execute(delete(PushSubscription).where(PushSubscription.endpoint == endpoint))
    db.add(PushSubscription(client_id=client_id, endpoint=endpoint, p256dh=p256dh, auth=auth))
