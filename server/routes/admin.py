import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import settings
from auth import create_invite, current_admin, new_card_code
from db import get_db
from models import Admin, AuditLog, CashbackLedger, Client, Package, PackageHoursLedger, PackageMember, Shoot
from views import baku_today, day_bounds, iso

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])


class ClientIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(default="", max_length=32)


class ClientEdit(BaseModel):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)


def client_out(c: Client) -> dict:
    return {"id": c.id, "full_name": c.full_name, "phone": c.phone, "notes": c.notes,
            "activated": c.activated_at is not None}


def wa_number(phone: str) -> str:
    """055 530 35 32 → 994555303532"""
    d = re.sub(r"\D", "", phone)
    if d.startswith("0") and len(d) == 10:
        d = "994" + d[1:]
    return d


@router.get("/clients")
def list_clients(db: DB = Depends(get_db)):
    """Siyahı + keşbek balansı, aktiv paket, son çəkiliş (aqreqat sorğularla, N+1 yoxdur)."""
    today = baku_today()
    cash = dict(db.execute(select(CashbackLedger.client_id, func.sum(CashbackLedger.amount))
                           .group_by(CashbackLedger.client_id)).all())
    last = dict(db.execute(select(Shoot.client_id, func.max(Shoot.starts_at))
                           .where(Shoot.status.in_(("confirmed", "completed")), Shoot.starts_at < day_bounds(today)[1])
                           .group_by(Shoot.client_id)).all())
    live = {p.id: p for p in db.scalars(select(Package).where(Package.starts_on <= today, Package.ends_on >= today)
                                        .order_by(Package.ends_on, Package.id))}
    used = dict(db.execute(select(PackageHoursLedger.package_id, func.sum(PackageHoursLedger.delta_minutes))
                           .where(PackageHoursLedger.package_id.in_(live)).group_by(PackageHoursLedger.package_id)).all())
    pairs = [(p.owner_client_id, p.id) for p in live.values()]
    pairs += db.execute(select(PackageMember.client_id, PackageMember.package_id)
                        .where(PackageMember.package_id.in_(live))).all()
    order = {pid: i for i, pid in enumerate(live)}  # ən tez bitən paket əvvəl
    pkg_of: dict[int, Package] = {}
    for cid, pid in sorted(pairs, key=lambda x: order[x[1]]):
        pkg_of.setdefault(cid, live[pid])
    return [{
        **client_out(c), "cashback_balance": cash.get(c.id) or 0, "last_shoot_at": iso(last.get(c.id)),
        "package": {"title": pkg_of[c.id].title, "minutes_left": pkg_of[c.id].minutes_total + (used.get(pkg_of[c.id].id) or 0)}
        if c.id in pkg_of else None,
    } for c in db.scalars(select(Client).order_by(Client.full_name))]


@router.post("/clients")
def add_client(body: ClientIn, db: DB = Depends(get_db)):
    c = Client(full_name=body.full_name.strip(), phone=body.phone.strip(), card_code=new_card_code())
    db.add(c)
    db.commit()
    return client_out(c)


@router.patch("/clients/{client_id}")
def edit_client(client_id: int, body: ClientEdit, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    """Ad, telefon və qeydi dəyişir; köhnə və yeni dəyər jurnala yazılır."""
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Müştəri tapılmadı")
    changes = {k: v.strip() for k, v in body.model_dump(exclude_none=True).items()}
    before = {k: getattr(c, k) for k in changes}
    for k, v in changes.items():
        setattr(c, k, v)
    if changes:
        db.add(AuditLog(admin_id=admin.id, action="edit", entity="client", entity_id=c.id,
                        before=before, after=changes))
    db.commit()
    return client_out(c)


@router.post("/clients/{client_id}/invite")
def invite(client_id: int, db: DB = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Müştəri tapılmadı")
    url = settings.APP_URL + "?i=" + create_invite(db, c)
    db.commit()
    text = f"Salam, {c.full_name}! Y Pod app-ına giriş linkiniz (7 gün etibarlıdır): {url}"
    number = wa_number(c.phone)
    return {"url": url, "whatsapp_url": f"https://wa.me/{number}?text={quote(text)}" if number else None}


@router.get("/cards/{card_code}")
def by_card(card_code: str, db: DB = Depends(get_db)):
    c = db.scalar(select(Client).where(Client.card_code == card_code))
    if not c:
        raise HTTPException(404, "Kart tapılmadı")
    return client_out(c)


@router.get("/whoami")
def whoami(admin: Admin = Depends(current_admin)):
    return {"name": admin.name}
