import re
from datetime import date
from typing import Literal
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DB

import booking
import growth
import settings
from auth import create_invite, current_admin, new_card_code
from db import get_db
from models import Admin, AuditLog, CashbackLedger, Client, Package, PackageHoursLedger, PackageMember, Session, Shoot
from views import baku_today, day_bounds, iso

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])


def blank_to_none(v):
    """Boş və ya yalnız boşluqdan ibarət sətir (formdan «tarix yoxdur») → None."""
    return None if isinstance(v, str) and not v.strip() else v


def clean_name(v: str) -> str:
    v = v.strip()
    if len(v) < 2:
        raise HTTPException(422, "Ad ən azı 2 simvol olmalıdır")
    return v


def clean_phone(v: str) -> str:
    """Boşluq, tire və mötərizə atılır; isteğe bağlı + və 7–15 rəqəm. Boş qala bilər."""
    v = re.sub(r"[\s\-()]", "", v)
    if v and not re.fullmatch(r"\+?\d{7,15}", v):
        raise HTTPException(422, "Telefon nömrəsi düzgün deyil")
    return v


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

    _birthday_blank = field_validator("birthday", mode="before")(blank_to_none)


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
        "package": {"title": pkg_of[c.id].title, "minutes_left": pkg_of[c.id].minutes_total + (used.get(pkg_of[c.id].id) or 0),
                    "minutes_total": pkg_of[c.id].minutes_total}
        if c.id in pkg_of else None,
    } for c in clients]


@router.post("/clients")
def add_client(body: ClientIn, db: DB = Depends(get_db)):
    c = Client(full_name=clean_name(body.full_name), phone=clean_phone(body.phone), card_code=new_card_code())
    db.add(c)
    db.commit()
    return client_out(c)


class ContactIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(min_length=1, max_length=32)
    note: str = Field(default="", max_length=2000)


@router.post("/contacts")
def add_contact(body: ContactIn, db: DB = Depends(get_db)):
    """«Yeni kontakt yarat» (Inbox/axtarış, 99 G8): POST /clients kimi müştəri kartı yaradır, amma telefon məcburidir
    və eyni nömrə (son 9 rəqəm) artıq kartdadırsa 409 + mövcud kartın id-si qaytarır. Müştəriyə mesaj getmir."""
    name, phone = clean_name(body.full_name), clean_phone(body.phone)
    tail = re.sub(r"\D", "", phone)[-9:]
    if len(tail) < 7:
        raise HTTPException(422, "Telefon nömrəsi düzgün deyil")
    for c in db.scalars(select(Client).where(Client.phone != "")):
        if re.sub(r"\D", "", c.phone)[-9:] == tail:
            raise HTTPException(409, {"message": f"Bu nömrə artıq «{c.full_name}» kartındadır", "client_id": c.id})
    c = Client(full_name=name, phone=phone, notes=body.note.strip(), card_code=new_card_code())
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
    if "full_name" in changes:
        changes["full_name"] = clean_name(changes["full_name"])
    if "phone" in changes:
        changes["phone"] = clean_phone(changes["phone"])
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


@router.delete("/clients/{client_id}")
def delete_client(client_id: int, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    """Yalnız səhvən yaradılan müştəri: çəkilişi, keşbeki və paketi olan silinmir (pul qeydləri borcdur)."""
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Müştəri tapılmadı")
    has = lambda model, col: db.scalar(select(func.count()).select_from(model).where(col == client_id))  # noqa: E731
    if (has(Shoot, Shoot.client_id) or has(CashbackLedger, CashbackLedger.client_id)
            or has(Package, Package.owner_client_id) or has(PackageMember, PackageMember.client_id)):
        raise HTTPException(409, "Bu müştərinin çəkiliş, ödəniş və ya paket qeydləri var, silmək olmaz")
    db.add(AuditLog(admin_id=admin.id, action="delete", entity="client", entity_id=c.id,
                    before={"full_name": c.full_name, "phone": c.phone}, after=None))
    db.execute(delete(Session).where(Session.subject_type == "client", Session.subject_id == client_id))
    db.execute(delete(Client).where(Client.id == client_id))
    db.commit()
    return {"ok": True}


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


@router.get("/whoami")
def whoami(admin: Admin = Depends(current_admin)):
    return {"name": admin.name}


@router.get("/connections")
def connections():
    """Xidmət qoşulmalarının vəziyyəti: yalnız «quraşdırılıb/yox». Açarın özü heç vaxt qaytarılmır, şəbəkə sorğusu yoxdur."""
    return {
        "whatsapp": bool(settings.KAPSO_API_KEY),
        "telegram": bool(settings.TG_BOT_TOKEN),
        "instagram": bool(settings.IG_ACCESS_TOKEN),
        "facebook": bool(settings.FB_PAGE_TOKEN),
        "buffer": bool(settings.BUFFER_API_KEY),
        "youtube": bool(settings.YT_REFRESH_TOKEN),
        "gemini": bool(settings.GEMINI_API_KEY),
        "r2": bool(settings.R2_PUBLIC_BASE_URL),
        "push": bool(settings.VAPID_PRIVATE_KEY),
    }
