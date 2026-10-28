"""Admin: müştəri artımı — teqlər, seqment önizləməsi, kampaniyalar, avtomatik bildirişlər, boş saatlar."""

from datetime import date
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import growth
from auth import current_admin
from db import get_db
from models import Admin, Campaign, CampaignRecipient, Client, ClientTag, Tag
from views import iso

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])


# --- teqlər ---

class TagIn(BaseModel):
    name: str = Field(min_length=1, max_length=40)


def _tag_name(db: DB, name: str, exclude: int | None = None) -> str:
    name = name.strip()
    if not name:
        raise HTTPException(422, "Teq adı boşdur")
    same = db.scalar(select(Tag.id).where(func.lower(Tag.name) == name.lower()))
    if same and same != exclude:
        raise HTTPException(409, "Bu adda teq var")
    return name


@router.get("/tags")
def list_tags(db: DB = Depends(get_db)):
    counts = dict(db.execute(select(ClientTag.tag_id, func.count()).group_by(ClientTag.tag_id)).all())
    return [{"id": t.id, "name": t.name, "count": counts.get(t.id, 0)}
            for t in db.scalars(select(Tag).order_by(Tag.name))]


@router.post("/tags")
def add_tag(body: TagIn, db: DB = Depends(get_db)):
    t = Tag(name=_tag_name(db, body.name))
    db.add(t)
    db.commit()
    return {"id": t.id, "name": t.name, "count": 0}


@router.patch("/tags/{tag_id}")
def rename_tag(tag_id: int, body: TagIn, db: DB = Depends(get_db)):
    t = db.get(Tag, tag_id)
    if not t:
        raise HTTPException(404, "Teq tapılmadı")
    t.name = _tag_name(db, body.name, exclude=t.id)
    db.commit()
    return {"id": t.id, "name": t.name}


@router.delete("/tags/{tag_id}")
def delete_tag(tag_id: int, db: DB = Depends(get_db)):
    t = db.get(Tag, tag_id)
    if not t:
        raise HTTPException(404, "Teq tapılmadı")
    db.delete(t)
    db.commit()
    return {"ok": True}


@router.get("/referrals/{code}")
def by_referral_code(code: str, db: DB = Depends(get_db)):
    c = db.scalar(select(Client).where(Client.referral_code == code.strip().upper()))
    if not c:
        raise HTTPException(404, "Dəvət kodu tapılmadı")
    return {"id": c.id, "full_name": c.full_name}


# --- seqment və kampaniyalar ---

Service = Literal["podcast", "reels", "other", "reels_pack", "studio_rent"]


class SegmentIn(BaseModel):
    """Süzgəclər birlikdə (VƏ) işləyir; siyahının içində istənilən biri (VƏ YA)."""
    client_ids: list[int] = Field(default=[], max_length=1000)
    tag_ids: list[int] = Field(default=[], max_length=50)
    professions: list[str] = Field(default=[], max_length=20)
    services: list[Service] = []
    sources: list[str] = Field(default=[], max_length=10)
    inactive_days: Optional[int] = Field(default=None, ge=1, le=3650)
    has_package: Optional[bool] = None
    min_cashback: Optional[int] = Field(default=None, ge=0)
    birthday_month: Optional[int] = Field(default=None, ge=1, le=12)
    app_joined: Optional[bool] = None
    push_on: Optional[bool] = None
    preset: Optional[Literal["package_candidates", "podcast_no_reels"]] = None


class CampaignIn(BaseModel):
    title: str = Field(min_length=2, max_length=80)
    body: str = Field(min_length=2, max_length=400)
    url: Optional[str] = Field(default=None, max_length=500, pattern=r"^https://")
    filters: SegmentIn


@router.post("/segments/preview")
def segment_preview(body: SegmentIn, db: DB = Depends(get_db)):
    return growth.preview(db, body.model_dump(exclude_defaults=True))


def campaign_out(c: Campaign, stats: dict, admins: dict[int, str]) -> dict:
    return {"id": c.id, "kind": c.kind, "title": c.title, "body": c.body, "url": c.url, "filters": c.filters,
            "recipients": c.recipients, "push_on": c.push_on, "created_at": iso(c.created_at),
            "created_by": admins.get(c.created_by), **stats}


@router.post("/campaigns")
def send_campaign(body: CampaignIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    """Yalnız «Təkliflər» açarı açıq olanlara gedir. Əl ilə kampaniyaya həftəlik limit tətbiq olunmur."""
    f = body.filters.model_dump(exclude_defaults=True)
    clients = growth.segment(db, f)
    if not clients:
        raise HTTPException(422, "Bu süzgəcə uyğun müştəri yoxdur")
    camp = growth.send(db, title=body.title.strip(), body=body.body.strip(), url=body.url, clients=clients,
                       filters=f, admin_id=admin.id)
    db.commit()
    return campaign_out(camp, {"opened": 0, "booked_14d": 0}, {admin.id: admin.name})


@router.get("/campaigns")
def list_campaigns(db: DB = Depends(get_db)):
    camps = db.scalars(select(Campaign).order_by(Campaign.id.desc()).limit(100)).all()
    stats = growth.campaign_stats(db, camps)
    admins = dict(db.execute(select(Admin.id, Admin.name)).all())
    return [campaign_out(c, stats[c.id], admins) for c in camps]


@router.get("/campaigns/{campaign_id}")
def get_campaign(campaign_id: int, db: DB = Depends(get_db)):
    c = db.get(Campaign, campaign_id)
    if not c:
        raise HTTPException(404, "Kampaniya tapılmadı")
    admins = dict(db.execute(select(Admin.id, Admin.name)).all())
    rows = db.execute(select(Client.id, Client.full_name, CampaignRecipient.opened_at)
                      .join(CampaignRecipient, CampaignRecipient.client_id == Client.id)
                      .where(CampaignRecipient.campaign_id == c.id).order_by(Client.full_name)).all()
    return {**campaign_out(c, growth.campaign_stats(db, [c])[c.id], admins),
            "list": [{"id": i, "full_name": n, "opened_at": iso(o)} for i, n, o in rows]}


# --- avtomatik bildirişlər ---

class AutoText(BaseModel):
    enabled: bool
    title: str = Field(min_length=2, max_length=80)
    body: str = Field(min_length=2, max_length=400)


class Winback(AutoText):
    days: int = Field(ge=14, le=365)


class CashbackNudge(AutoText):
    min: int = Field(ge=100, le=100_000_00)


class Birthday(AutoText):
    gift: int = Field(ge=0, le=500_00)  # qəpik, 0 = hədiyyəsiz təbrik


class Review(AutoText):
    url: str = Field(default="", max_length=500, pattern=r"^(https://.*)?$")


class AutomationsIn(BaseModel):
    send_hour: int = Field(ge=8, le=21)
    studio_hours: list[int] = Field(min_length=2, max_length=2)
    winback: Winback
    cashback: CashbackNudge
    birthday: Birthday
    review: Review


@router.get("/automations")
def get_automations(db: DB = Depends(get_db)):
    return growth.load_settings(db)


@router.patch("/automations")
def set_automations(body: AutomationsIn, db: DB = Depends(get_db)):
    a, b = body.studio_hours
    if not 0 <= a < b <= 24:
        raise HTTPException(422, "İş saatları düzgün deyil")
    if body.review.enabled and not body.review.url:
        raise HTTPException(422, "Rəy xahişi üçün link lazımdır (məsələn Google rəy səhifəsi)")
    out = growth.save_settings(db, body.model_dump())
    db.commit()
    return out


@router.get("/free-slots")
def free_slots(day: date, db: DB = Depends(get_db)):
    """Boş saat təklifi şablonu üçün: həmin günün iş saatları içində ən azı 1 saatlıq boş aralıqlar."""
    return growth.free_slots(db, day, growth.load_settings(db)["studio_hours"])
