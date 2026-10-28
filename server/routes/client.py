"""Müştəri API-si: yalnız oxuma, hər şey token sahibi müştəri ilə məhdudlaşır.

Bütün məbləğlər qəpiklə tam ədəddir (7550 = 75,50 AZN).
"""

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy import delete, func, or_, select, update
from sqlalchemy.orm import Session as DB

import booking
import money
import push
import settings
from auth import create_pair_code, current_client, digest
from db import get_db, now
from models import (CashbackLedger, Client, Notification, Package, PackageHoursLedger, PackageMember,
                    PushSubscription, Session, Shoot)
from views import baku_today, iso, member_package_ids, materials_of, payment_line, shoot_core, studio_balance

router = APIRouter(prefix="/api/me")


def visible_shoots(db: DB, client: Client):
    """Öz çəkilişləri və üzv olduğu paketlərin çəkilişləri."""
    pids = member_package_ids(db, client.id)
    cond = or_(Shoot.client_id == client.id, Shoot.package_id.in_(pids)) if pids else Shoot.client_id == client.id
    return select(Shoot).where(cond)


def shoots_view(db: DB, client: Client, shoots: list[Shoot]) -> list[dict]:
    """Müştəri görünüşü: note və source_note yoxdur. Başqa üzvün ödəniş təfərrüatı gizlədilir."""
    names = {c.id: c.full_name for c in db.scalars(select(Client).where(Client.id.in_({s.client_id for s in shoots})))}
    mats = materials_of(db, [s.id for s in shoots])
    earned: dict[int, int] = {}
    for r in db.scalars(select(CashbackLedger).where(
            CashbackLedger.client_id == client.id, CashbackLedger.kind.in_(("earn", "earn_first")),
            CashbackLedger.shoot_id.in_([s.id for s in shoots]))):
        earned[r.shoot_id] = earned.get(r.shoot_id, 0) + r.amount
    out = []
    for s in shoots:
        mine = s.client_id == client.id
        expected = None
        if mine and s.status == "confirmed":
            # bağlananda yazılacaq keşbekin proqnozu: ilk çəkilişdə 50%, sonra 10%
            p = money.Price(s.price_base, s.price_editing, s.price_reels, s.price_extra_camera, s.discount)
            kind, amount = money.cashback_earned(p, from_package=s.package_id is not None,
                                                 first_shoot=booking.is_first_shoot(db, client, s))
            expected = {"amount": amount, "first_shoot": kind == "earn_first"}
        out.append({
            "cashback_expected": expected,
            **shoot_core(s), "mine": mine, "who": names[s.client_id].split()[0],
            "cashback_used": s.cashback_used if mine else None,
            "payment_line": payment_line(s) if mine else None,
            "studio_balance": studio_balance(s) if mine else None,
            "deposit_expected": s.deposit_expected if mine else None,
            "materials": mats[s.id] if mine else [], "cashback_earned": earned.get(s.id, 0) if mine else None,
        })
    return out


def active_package(db: DB, client: Client) -> Package | None:
    pids = member_package_ids(db, client.id)
    today = baku_today()
    return db.scalar(select(Package).where(Package.id.in_(pids), Package.starts_on <= today, Package.ends_on >= today)
                     .order_by(Package.id)) if pids else None


def package_brief(db: DB, pkg: Package) -> dict:
    return {"id": pkg.id, "title": pkg.title, "owner_name": db.get(Client, pkg.owner_client_id).full_name,
            "minutes_total": pkg.minutes_total, "minutes_left": booking.package_left(db, pkg),
            "cameras": pkg.cameras, "starts_on": pkg.starts_on, "ends_on": pkg.ends_on}


@router.get("")
def me(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    return {"full_name": client.full_name, "card_code": client.card_code,
            "cashback_balance": booking.cashback_balance(db, client.id)}


@router.get("/home")
def home(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    nxt = db.scalar(visible_shoots(db, client).where(Shoot.status == "confirmed", Shoot.starts_at > now())
                    .order_by(Shoot.starts_at).limit(1))
    pkg = active_package(db, client)
    unread = db.scalar(select(func.count()).select_from(Notification).where(Notification.client_id == client.id,
                                                  Notification.read_at.is_(None)))
    return {"full_name": client.full_name, "cashback_balance": booking.cashback_balance(db, client.id),
            "next_shoot": shoots_view(db, client, [nxt])[0] if nxt else None,
            "package": package_brief(db, pkg) if pkg else None, "unread_notifications": unread}


@router.get("/shoots")
def my_shoots(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    rows = db.scalars(visible_shoots(db, client).order_by(Shoot.starts_at.desc())).all()
    return shoots_view(db, client, list(rows))


@router.get("/shoots/{shoot_id}")
def my_shoot(shoot_id: int, client: Client = Depends(current_client), db: DB = Depends(get_db)):
    s = db.scalar(visible_shoots(db, client).where(Shoot.id == shoot_id))
    if not s:
        raise HTTPException(404, "Çəkiliş tapılmadı")
    return shoots_view(db, client, [s])[0]


@router.get("/cashback")
def my_cashback(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    rows = db.execute(select(CashbackLedger, Shoot.title).outerjoin(Shoot, Shoot.id == CashbackLedger.shoot_id)
                      .where(CashbackLedger.client_id == client.id).order_by(CashbackLedger.id.desc())).all()
    return {"balance": booking.cashback_balance(db, client.id),
            "rows": [{"kind": r.kind, "amount": r.amount, "note": r.note, "created_at": iso(r.created_at),
                      "shoot_title": title} for r, title in rows]}


@router.get("/package")
def my_package(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    pkg = active_package(db, client)
    if not pkg:
        raise HTTPException(404, "Paket tapılmadı")
    usage = db.execute(
        select(PackageHoursLedger, Client.full_name).outerjoin(Shoot, Shoot.id == PackageHoursLedger.shoot_id)
        .outerjoin(Client, Client.id == Shoot.client_id)
        .where(PackageHoursLedger.package_id == pkg.id).order_by(PackageHoursLedger.id.desc())).all()
    members = db.execute(select(Client.id, Client.full_name).join(PackageMember, PackageMember.client_id == Client.id)
                         .where(PackageMember.package_id == pkg.id).order_by(Client.full_name)).all()
    return {**package_brief(db, pkg),
            "usage": [{"member_name": name, "delta_minutes": r.delta_minutes, "note": r.note,
                       "date": iso(r.created_at)} for r, name in usage],
            "members": [{"name": n, "role": "owner" if i == pkg.owner_client_id else "member"}
                        for i, n in members]}


@router.get("/materials")
def my_materials(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    rows = db.scalars(select(Shoot).where(Shoot.client_id == client.id, Shoot.status == "completed")
                      .order_by(Shoot.starts_at.desc())).all()
    mats = materials_of(db, [s.id for s in rows])
    return [{"shoot_id": s.id, "title": s.title, "starts_at": iso(s.starts_at), "production": s.production,
             "materials": mats[s.id]} for s in rows if mats[s.id]]


@router.get("/notifications")
def notifications(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    rows = db.scalars(select(Notification).where(Notification.client_id == client.id)
                      .order_by(Notification.id.desc()).limit(50))
    return [{"id": n.id, "type": n.type, "payload": n.payload, "created_at": iso(n.created_at),
             "read_at": iso(n.read_at)} for n in rows]


@router.post("/notifications/read")
def notifications_read(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    db.execute(update(Notification).where(Notification.client_id == client.id, Notification.read_at.is_(None))
               .values(read_at=now()))
    db.commit()
    return {"ok": True}


class PushIn(BaseModel):
    endpoint: str = Field(min_length=10, max_length=1000, pattern=r"^https://")
    p256dh: str = Field(min_length=10, max_length=255)
    auth: str = Field(min_length=4, max_length=255)


@router.get("/push")
def push_info(endpoint: str = "", client: Client = Depends(current_client), db: DB = Depends(get_db)):
    """VAPID açarı (boşdursa push hələ qoşulmayıb) və bu cihazın abunə olub-olmadığı."""
    on = bool(endpoint) and db.scalar(select(PushSubscription.id).where(
        PushSubscription.endpoint == endpoint, PushSubscription.client_id == client.id)) is not None
    return {"public_key": settings.VAPID_PUBLIC_KEY, "subscribed": on}


@router.post("/push")
def push_subscribe(body: PushIn, client: Client = Depends(current_client), db: DB = Depends(get_db)):
    push.subscribe(db, client.id, body.endpoint, body.p256dh, body.auth)
    db.commit()
    return {"ok": True}


@router.post("/push/off")
def push_unsubscribe(body: PushIn, client: Client = Depends(current_client), db: DB = Depends(get_db)):
    db.execute(delete(PushSubscription).where(PushSubscription.endpoint == body.endpoint,
                                              PushSubscription.client_id == client.id))
    db.commit()
    return {"ok": True}


@router.post("/pair-code")
def pair_code(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    code = create_pair_code(db, client.id)
    db.commit()
    return {"pair_code": code}


@router.post("/logout")
def logout(request: Request, client: Client = Depends(current_client), db: DB = Depends(get_db)):
    token = request.headers["authorization"][7:].strip()
    db.execute(delete(Session).where(Session.token_hash == digest(token)))
    db.commit()
    return {"ok": True}
