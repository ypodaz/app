import re
from datetime import date
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import booking
import growth
import settings
from auth import create_invite, current_admin, new_card_code
from db import get_db
from models import Admin, AuditLog, CashbackLedger, Client, Package, PackageHoursLedger, PackageMember, Shoot
from views import baku_today, day_bounds, iso

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])


class ClientIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(default="", max_length=32)


Source = Literal["instagram", "tiktok", "google", "youtube", "referral", "other"]


class ProfileIn(BaseModel):
    """Müştəri profili: admin də, müştəri də doldura bilər. Boş sətir sahəni təmizləyir."""
    profession: str | None = Field(default=None, max_length=80)
    workplace: str | None = Field(default=None, max_length=120)
    instagram: str | None = Field(default=None, max_length=80)
    niche: str | None = Field(default=None, max_length=120)
    birthday: date | None = None
    source: Source | Literal[""] | None = None
    marketing_opt_in: bool | None = None


class ClientEdit(ProfileIn):
    full_name: str | None = Field(default=None, min_length=2, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    notes: str | None = Field(default=None, max_length=2000)
    tag_ids: list[int] | None = Field(default=None, max_length=50)
    referred_by_id: int | None = Field(default=None, ge=0)  # 0 = dəvət edəni sil


def apply_profile(c: Client, body: ProfileIn) -> dict:
    """Verilən profil sahələrini yazır, dəyişənləri qaytarır (jurnal üçün)."""
    changes = {}
    for k, v in body.model_dump(exclude_unset=True, include=set(ProfileIn.model_fields)).items():
        if isinstance(v, str):
            v = v.strip()
            if k == "instagram":
                v = v.removeprefix("https://").removeprefix("www.").removeprefix("instagram.com/").strip("/@ ")
            v = v or None
        if k == "birthday" and v and not date(1920, 1, 1) <= v <= baku_today():
            raise HTTPException(422, "Doğum tarixi düzgün deyil")
        if k == "marketing_opt_in" and v is None:
            continue
        if getattr(c, k) != v:
            changes[k] = v
            setattr(c, k, v)
    return changes


def client_out(c: Client) -> dict:
    return {"id": c.id, "full_name": c.full_name, "phone": c.phone, "notes": c.notes,
            "activated": c.activated_at is not None, "app_seen_at": iso(c.app_seen_at),
            "app_standalone": c.app_standalone, "push_permission": c.push_permission,
            "profession": c.profession, "workplace": c.workplace, "instagram": c.instagram, "niche": c.niche,
            "birthday": c.birthday.isoformat() if c.birthday else None, "source": c.source,
            "marketing_opt_in": c.marketing_opt_in, "profile_complete": growth.profile_complete(c),
            "referral_code": c.referral_code, "referred_by_id": c.referred_by_id}


def client_full(db: DB, c: Client) -> dict:
    ref = db.get(Client, c.referred_by_id) if c.referred_by_id else None
    return {**client_out(c), "tags": growth.tags_of(db, [c.id])[c.id],
            "referred_by": {"id": ref.id, "full_name": ref.full_name} if ref else None}


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
    clients = db.scalars(select(Client).order_by(Client.full_name)).all()
    tags = growth.tags_of(db, [c.id for c in clients])
    names = {c.id: c.full_name for c in clients}
    return [{
        **client_out(c), "tags": tags[c.id],
        "referred_by": {"id": c.referred_by_id, "full_name": names[c.referred_by_id]} if c.referred_by_id else None,
        "cashback_balance": cash.get(c.id) or 0, "last_shoot_at": iso(last.get(c.id)),
        "package": {"title": pkg_of[c.id].title, "minutes_left": pkg_of[c.id].minutes_total + (used.get(pkg_of[c.id].id) or 0)}
        if c.id in pkg_of else None,
    } for c in clients]


@router.post("/clients")
def add_client(body: ClientIn, db: DB = Depends(get_db)):
    c = Client(full_name=body.full_name.strip(), phone=body.phone.strip(), card_code=new_card_code())
    db.add(c)
    db.commit()
    return client_out(c)


@router.patch("/clients/{client_id}")
def edit_client(client_id: int, body: ClientEdit, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    """Ad, telefon, qeyd, profil, teqlər və dəvət edən; köhnə və yeni dəyər jurnala yazılır.
    Admin doldurduqda profil bonusu verilmir (bonus müştərinin özü doldurmasına görədir)."""
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Müştəri tapılmadı")
    before = {k: getattr(c, k) for k in body.model_fields_set if hasattr(c, k)}
    before = {k: v.isoformat() if isinstance(v, date) else v for k, v in before.items()}
    changes = {k: v.strip() for k, v in body.model_dump(exclude_none=True, include={"full_name", "phone", "notes"}).items()}
    for k, v in changes.items():
        setattr(c, k, v)
    changes |= {k: v.isoformat() if isinstance(v, date) else v for k, v in apply_profile(c, body).items()}
    if body.referred_by_id is not None:
        rid = body.referred_by_id or None
        if rid == c.id:
            raise HTTPException(422, "Müştəri özünü dəvət edə bilməz")
        if rid and not db.get(Client, rid):
            raise HTTPException(404, "Dəvət edən tapılmadı")
        if c.referral_rewarded_at and rid != c.referred_by_id:
            raise HTTPException(409, "Dəvət bonusu artıq verilib, dəvət edən dəyişdirilə bilməz")
        if rid != c.referred_by_id:
            changes["referred_by_id"] = c.referred_by_id = rid
    if body.tag_ids is not None:
        try:
            growth.set_tags(db, c, body.tag_ids)
        except booking.Rejected as e:
            raise HTTPException(422, str(e))
        changes["tag_ids"] = sorted(set(body.tag_ids))
    if changes:
        db.add(AuditLog(admin_id=admin.id, action="edit", entity="client", entity_id=c.id,
                        before={k: before.get(k) for k in changes}, after=changes))
    db.commit()
    return client_full(db, c)


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
