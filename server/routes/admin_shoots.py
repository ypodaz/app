"""Admin: çəkilişlər, beh, bağlama, ləğv, paketlər, keşbek, panel.

Bütün məbləğlər qəpiklə tam ədəddir (7550 = 75,50 AZN).
"""

from datetime import date, datetime, timedelta
from typing import Literal, Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import booking
import money
from auth import current_admin
from db import get_db, now
from models import Admin, Block, CashbackLedger, Client, Material, Package, PackageMember, PushSubscription, Shoot
from routes.admin import client_out
from views import (baku_today, day_bounds, iso, material_out, materials_of, payment_line, shoot_core,
                   studio_balance, utc)

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])


class ShootIn(BaseModel):
    client_id: int
    starts_at: AwareDatetime
    duration_min: int = Field(ge=15, le=720)
    kind: Literal["shoot", "reels_pack", "studio_rent"]
    tag: Literal["podcast", "reels", "other"]
    location: Literal["studio", "onsite"]
    cameras: int = Field(ge=0, le=3)  # studiya icarəsində 0
    editing: bool
    reels_count: int = Field(default=0, ge=0, le=100)
    package_id: Optional[int] = None
    cashback_use: int = Field(default=0, ge=0)
    address: Optional[str] = Field(default=None, max_length=255)
    title: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=2000)
    source_note: Optional[str] = Field(default=None, max_length=2000)
    discount: int = Field(default=0, ge=0)
    discount_note: Optional[str] = Field(default=None, max_length=255)
    prep_min: int = Field(default=15, ge=0, le=240)
    wrap_min: int = Field(default=0, ge=0, le=240)


class ShootEditIn(BaseModel):
    starts_at: AwareDatetime
    duration_min: int = Field(ge=15, le=720)
    kind: Literal["shoot", "reels_pack", "studio_rent"]
    tag: Literal["podcast", "reels", "other"]
    location: Literal["studio", "onsite"]
    cameras: int = Field(ge=0, le=3)
    editing: bool
    reels_count: int = Field(default=0, ge=0, le=100)
    address: Optional[str] = Field(default=None, max_length=255)
    title: Optional[str] = Field(default=None, max_length=120)
    note: Optional[str] = Field(default=None, max_length=2000)
    discount: int = Field(default=0, ge=0)
    discount_note: Optional[str] = Field(default=None, max_length=255)
    prep_min: int = Field(default=15, ge=0, le=240)
    wrap_min: int = Field(default=0, ge=0, le=240)


class DepositIn(BaseModel):
    amount: int = Field(gt=0)


class CloseIn(BaseModel):
    duration_min: int = Field(ge=15, le=720)
    paid_method: Optional[Literal["cash", "card"]] = None
    cashback_use: int = Field(default=0, ge=0)
    discount: Optional[int] = Field(default=None, ge=0)  # verilməsə, endirim dəyişmir


class CancelIn(BaseModel):
    requested_at: Optional[AwareDatetime] = None


class RescheduleIn(BaseModel):
    starts_at: AwareDatetime
    requested_at: Optional[AwareDatetime] = None


class ProductionIn(BaseModel):
    production: Literal["none", "editing", "ready"]
    delivery_on: Optional[date] = None


class MaterialIn(BaseModel):
    title: str = Field(min_length=1, max_length=120)
    drive_url: str = Field(pattern=r"^https://\S+$", max_length=500)


class PackageIn(BaseModel):
    owner_client_id: int
    title: str = Field(min_length=1, max_length=120)
    hours: Literal[5, 10, 15, 20]
    cameras: int = Field(ge=1, le=3)
    starts_on: date
    used_minutes: int = Field(default=0, ge=0)
    member_ids: list[int] = Field(default_factory=list, max_length=20)


class BlockIn(BaseModel):
    starts_at: AwareDatetime
    ends_at: AwareDatetime
    reason: Optional[str] = Field(default=None, max_length=255)


class MemberIn(BaseModel):
    client_id: int


class CashbackIn(BaseModel):
    amount: int  # qəpik, mənfi ola bilər
    note: str = Field(default="", max_length=255)


def reject(db: DB, e: booking.Rejected):
    db.rollback()
    raise HTTPException(400, str(e))


def get_shoot(db: DB, shoot_id: int) -> Shoot:
    s = db.get(Shoot, shoot_id)
    if not s:
        raise HTTPException(404, "Çəkiliş tapılmadı")
    return s


def shoots_out(db: DB, shoots: list[Shoot]) -> list[dict]:
    names = {c.id: c.full_name for c in db.scalars(select(Client).where(Client.id.in_({s.client_id for s in shoots})))}
    mats = materials_of(db, [s.id for s in shoots])
    return [{
        **shoot_core(s), "client_id": s.client_id, "client_name": names.get(s.client_id),
        "note": s.note, "source_note": s.source_note, "cashback_used": s.cashback_used,
        "deposit_expected": s.deposit_expected, "deposit_amount": s.deposit_amount,
        "deposit_received_at": iso(s.deposit_received_at), "deposit_waived": s.deposit_waived,
        "paid_at_studio": s.paid_at_studio, "paid_method": s.paid_method, "closed_at": iso(s.closed_at),
        "cancel_requested_at": iso(s.cancel_requested_at), "cancel_window": s.cancel_window,
        "retained_amount": s.retained_amount, "refund_amount": s.refund_amount,
        "refunded_at": iso(s.refunded_at), "rescheduled_lt24": s.rescheduled_lt24,
        "payment_line": payment_line(s), "studio_balance": studio_balance(s), "materials": mats[s.id],
        "created_at": iso(s.created_at), "discount_note": s.discount_note,
        "prep_min": s.prep_min, "wrap_min": s.wrap_min,
    } for s in shoots]


def shoot_out(db: DB, s: Shoot) -> dict:
    return shoots_out(db, [s])[0]


def package_out(db: DB, pkg: Package) -> dict:
    rows = db.execute(select(Client.id, Client.full_name).join(PackageMember, PackageMember.client_id == Client.id)
                      .where(PackageMember.package_id == pkg.id).order_by(Client.full_name)).all()
    owner = db.get(Client, pkg.owner_client_id)
    return {
        "id": pkg.id, "title": pkg.title, "owner_client_id": pkg.owner_client_id, "owner_name": owner.full_name,
        "minutes_total": pkg.minutes_total, "minutes_left": booking.package_left(db, pkg), "cameras": pkg.cameras,
        "starts_on": pkg.starts_on, "ends_on": pkg.ends_on, "price_paid": pkg.price_paid,
        "members": [{"client_id": i, "full_name": n,
                     "role": "owner" if i == pkg.owner_client_id else "member"} for i, n in rows],
    }


# --- çəkilişlər ---

@router.post("/shoots")
def create_shoot(body: ShootIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    if not db.get(Client, body.client_id):
        raise HTTPException(404, "Müştəri tapılmadı")
    data = body.model_dump()
    data["starts_at"] = utc(body.starts_at)
    try:
        s = booking.create_shoot(db, admin.id, **data)
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return {**shoot_out(db, s), "conflicts": booking.conflicts(
        db, starts_at=s.starts_at, duration_min=s.duration_min, prep_min=s.prep_min, wrap_min=s.wrap_min,
        exclude_id=s.id)}


@router.patch("/shoots/{shoot_id}")
def edit_shoot(shoot_id: int, body: ShootEditIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    """Təsdiqlənmiş çəkilişin düzəlişi. Qiyməti öncədən görmək üçün /shoots/quote-a çəkilişin client_id və
    package_id-si ilə müraciət olunur."""
    s = get_shoot(db, shoot_id)
    data = body.model_dump()
    data["starts_at"] = utc(body.starts_at)
    try:
        booking.edit_shoot(db, admin.id, s, **data)
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return {**shoot_out(db, s), "conflicts": booking.conflicts(
        db, starts_at=s.starts_at, duration_min=s.duration_min, prep_min=s.prep_min, wrap_min=s.wrap_min,
        exclude_id=s.id)}


@router.post("/shoots/quote")
def quote(body: ShootIn, exclude_id: Optional[int] = None, db: DB = Depends(get_db)):
    """Qiymət hesabı, bazaya yazmır. Düzəlişdə exclude_id=çəkilişin öz id-si (özü ilə toqquşma sayılmasın)."""
    client = db.get(Client, body.client_id)
    if not client:
        raise HTTPException(404, "Müştəri tapılmadı")
    pkg = None
    if body.package_id:
        pkg = db.get(Package, body.package_id)
        if not pkg:
            raise HTTPException(404, "Paket tapılmadı")
    editing, reels, location = body.editing, body.reels_count, body.location
    if body.kind in ("reels_pack", "studio_rent"):
        editing, reels = False, 0
    if body.kind == "studio_rent":
        location = "studio"
    balance = booking.cashback_balance(db, client.id)
    try:
        p = money.price(kind=body.kind, location=location, cameras=body.cameras, duration_min=body.duration_min,
                        editing=editing, reels_count=reels, package_cameras=pkg.cameras if pkg else None,
                        discount=body.discount)
        money.check_cashback_use(body.cashback_use, balance, p.total)
        draft = Shoot(client_id=client.id, starts_at=utc(body.starts_at), kind=body.kind)
        first = booking.is_first_shoot(db, client, draft)
        kind, earn = money.cashback_earned(p, from_package=pkg is not None, first_shoot=first)
    except ValueError as e:
        raise HTTPException(400, str(e))
    return {
        "base": p.base, "editing": p.editing, "reels": p.reels, "extra_camera": p.extra_camera,
        "discount": p.discount, "gross": p.gross, "total": p.total,
        "conflicts": booking.conflicts(db, starts_at=utc(body.starts_at), duration_min=body.duration_min,
                                       prep_min=body.prep_min, wrap_min=body.wrap_min, exclude_id=exclude_id),
        "deposit_expected": money.deposit_expected(p.total, body.cashback_use, pkg is not None),
        "cashback_earn": earn, "cashback_kind": kind, "first_shoot_bonus": first,
        "cashback_balance": balance, "deposit_required": client.deposit_required,
    }


@router.get("/shoots")
def list_shoots(from_: AwareDatetime = Query(alias="from"), to: AwareDatetime = Query(), db: DB = Depends(get_db)):
    rows = db.scalars(select(Shoot).where(Shoot.starts_at >= utc(from_), Shoot.starts_at < utc(to))
                      .order_by(Shoot.starts_at)).all()
    return shoots_out(db, list(rows))


@router.get("/shoots/{shoot_id}")
def get_one(shoot_id: int, db: DB = Depends(get_db)):
    return shoot_out(db, get_shoot(db, shoot_id))


@router.post("/shoots/{shoot_id}/deposit")
def deposit(shoot_id: int, body: DepositIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    s = get_shoot(db, shoot_id)
    try:
        booking.receive_deposit(db, admin.id, s, body.amount)
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return shoot_out(db, s)


@router.post("/shoots/{shoot_id}/deposit/waive")
def waive(shoot_id: int, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    s = get_shoot(db, shoot_id)
    try:
        booking.waive_deposit(db, admin.id, s)
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return shoot_out(db, s)


@router.post("/shoots/{shoot_id}/close")
def close(shoot_id: int, body: CloseIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    s = get_shoot(db, shoot_id)
    try:
        earned = booking.close_shoot(db, admin.id, s, duration_min=body.duration_min,
                                     paid_method=body.paid_method, cashback_use=body.cashback_use,
                                     discount=body.discount)
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return {**shoot_out(db, s), "cashback_earned": earned}


@router.post("/shoots/{shoot_id}/no-show")
def no_show(shoot_id: int, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    s = get_shoot(db, shoot_id)
    try:
        booking.no_show(db, admin.id, s)
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return shoot_out(db, s)


def cancel_out(db: DB, admin_id: int, s: Shoot, requested_at: datetime | None) -> dict:
    """Ləğv hesabı və cavab; commit/rollback çağıranındır."""
    requested = utc(requested_at) if requested_at else now()
    try:
        c = booking.cancel_shoot(db, admin_id, s, requested)
    except booking.Rejected as e:
        reject(db, e)
    return {**shoot_out(db, s), "refund": c.refund, "retained": c.retained,
            "cashback_return": c.cashback_return, "window": c.window}


@router.post("/shoots/{shoot_id}/cancel")
def cancel(shoot_id: int, body: CancelIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    out = cancel_out(db, admin.id, get_shoot(db, shoot_id), body.requested_at)
    db.commit()
    return out


@router.post("/shoots/{shoot_id}/cancel/quote")
def cancel_quote(shoot_id: int, body: CancelIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    """Ləğv önbaxışı: eyni hesab, bazaya heç nə yazılmır."""
    out = cancel_out(db, admin.id, get_shoot(db, shoot_id), body.requested_at)
    db.rollback()
    return out


@router.post("/shoots/{shoot_id}/refunded")
def refunded(shoot_id: int, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    s = get_shoot(db, shoot_id)
    try:
        booking.mark_refunded(db, admin.id, s)
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return shoot_out(db, s)


@router.post("/shoots/{shoot_id}/reschedule")
def reschedule(shoot_id: int, body: RescheduleIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    s = get_shoot(db, shoot_id)
    requested = utc(body.requested_at) if body.requested_at else now()
    try:
        booking.reschedule(db, admin.id, s, utc(body.starts_at), requested)
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return shoot_out(db, s)


@router.patch("/shoots/{shoot_id}/production")
def production(shoot_id: int, body: ProductionIn, db: DB = Depends(get_db)):
    s = get_shoot(db, shoot_id)
    if body.production == "ready" and s.production != "ready":
        booking._notify(db, s.client_id, "materials_ready", shoot_id=s.id)
    s.production, s.delivery_on = body.production, body.delivery_on
    db.commit()
    return shoot_out(db, s)


@router.post("/shoots/{shoot_id}/materials")
def add_material(shoot_id: int, body: MaterialIn, db: DB = Depends(get_db)):
    get_shoot(db, shoot_id)
    m = Material(shoot_id=shoot_id, title=body.title.strip(), drive_url=body.drive_url)
    db.add(m)
    db.commit()
    return material_out(m)


@router.delete("/materials/{material_id}")
def delete_material(material_id: int, db: DB = Depends(get_db)):
    m = db.get(Material, material_id)
    if not m:
        raise HTTPException(404, "Material tapılmadı")
    db.delete(m)
    db.commit()
    return {"ok": True}


# --- paketlər ---

@router.post("/packages")
def create_package(body: PackageIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    if not db.get(Client, body.owner_client_id):
        raise HTTPException(404, "Müştəri tapılmadı")
    try:
        pkg = booking.create_package(db, admin.id, **body.model_dump())
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return package_out(db, pkg)


@router.get("/packages/quote")
def package_quote(hours: int, cameras: int):
    """Paket qiyməti və müddəti, bazaya yazmır."""
    if hours not in money.PACKAGES or cameras not in money.PACKAGES[hours][1]:
        raise HTTPException(400, "Belə paket yoxdur")
    months, prices = money.PACKAGES[hours]
    return {"price": prices[cameras], "months": months}


@router.get("/packages")
def list_packages(db: DB = Depends(get_db)):
    return [package_out(db, p) for p in db.scalars(select(Package).order_by(Package.ends_on, Package.id))]


def get_package(db: DB, package_id: int) -> Package:
    pkg = db.get(Package, package_id)
    if not pkg:
        raise HTTPException(404, "Paket tapılmadı")
    return pkg


@router.post("/packages/{package_id}/members")
def add_member(package_id: int, body: MemberIn, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    pkg = get_package(db, package_id)
    if not db.get(Client, body.client_id):
        raise HTTPException(404, "Müştəri tapılmadı")
    if not db.get(PackageMember, (pkg.id, body.client_id)):
        db.add(PackageMember(package_id=pkg.id, client_id=body.client_id))
        booking.audit_member(db, admin.id, "member_add", pkg.id, body.client_id)
        db.commit()
    return package_out(db, pkg)


@router.delete("/packages/{package_id}/members/{client_id}")
def remove_member(package_id: int, client_id: int, db: DB = Depends(get_db), admin: Admin = Depends(current_admin)):
    pkg = get_package(db, package_id)
    if client_id == pkg.owner_client_id:
        raise HTTPException(400, "Paketin sahibi çıxarıla bilməz")
    m = db.get(PackageMember, (pkg.id, client_id))
    if not m:
        raise HTTPException(404, "Üzv tapılmadı")
    db.delete(m)
    booking.audit_member(db, admin.id, "member_remove", pkg.id, client_id)
    db.commit()
    return package_out(db, pkg)


# --- bloklanmış vaxt ---

def block_out(b: Block) -> dict:
    return {"id": b.id, "starts_at": iso(b.starts_at), "ends_at": iso(b.ends_at), "reason": b.reason}


@router.post("/blocks")
def add_block(body: BlockIn, db: DB = Depends(get_db)):
    if body.ends_at <= body.starts_at:
        raise HTTPException(400, "Bitmə vaxtı başlanğıcdan sonra olmalıdır")
    b = Block(starts_at=utc(body.starts_at), ends_at=utc(body.ends_at), reason=(body.reason or "").strip() or None)
    db.add(b)
    db.commit()
    return block_out(b)


@router.get("/blocks")
def list_blocks(from_: AwareDatetime = Query(alias="from"), to: AwareDatetime = Query(), db: DB = Depends(get_db)):
    rows = db.scalars(select(Block).where(Block.starts_at < utc(to), Block.ends_at > utc(from_))
                      .order_by(Block.starts_at))
    return [block_out(b) for b in rows]


@router.delete("/blocks/{block_id}")
def delete_block(block_id: int, db: DB = Depends(get_db)):
    b = db.get(Block, block_id)
    if not b:
        raise HTTPException(404, "Blok tapılmadı")
    db.delete(b)
    db.commit()
    return {"ok": True}


# --- müştəri, keşbek, panel ---

@router.post("/clients/{client_id}/cashback")
def manual_cashback(client_id: int, body: CashbackIn, db: DB = Depends(get_db),
                    admin: Admin = Depends(current_admin)):
    if not db.get(Client, client_id):
        raise HTTPException(404, "Müştəri tapılmadı")
    try:
        booking.manual_cashback(db, admin.id, client_id, body.amount, body.note.strip())
    except booking.Rejected as e:
        reject(db, e)
    db.commit()
    return {"balance": booking.cashback_balance(db, client_id)}


@router.get("/clients/{client_id}")
def client_detail(client_id: int, db: DB = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Müştəri tapılmadı")
    ledger = db.scalars(select(CashbackLedger).where(CashbackLedger.client_id == c.id)
                        .order_by(CashbackLedger.id.desc())).all()
    pids = set(db.scalars(select(PackageMember.package_id).where(PackageMember.client_id == c.id)))
    pids |= set(db.scalars(select(Package.id).where(Package.owner_client_id == c.id)))
    packages = [package_out(db, p) for p in db.scalars(select(Package).where(Package.id.in_(pids)).order_by(Package.id))]
    recent = db.scalars(select(Shoot).where(Shoot.client_id == c.id).order_by(Shoot.starts_at.desc()).limit(20)).all()
    return {
        **client_out(c), "notes": c.notes, "deposit_required": c.deposit_required,
        "cashback_balance": booking.cashback_balance(db, c.id),
        "cashback_rows": [{"id": r.id, "kind": r.kind, "amount": r.amount, "note": r.note, "shoot_id": r.shoot_id,
                           "created_at": iso(r.created_at)} for r in ledger],
        "packages": packages, "shoots": shoots_out(db, list(recent)),
    }


@router.get("/dashboard")
def dashboard(db: DB = Depends(get_db)):
    day_start, day_end = day_bounds(baku_today())
    pending = db.scalars(select(Shoot).where(
        Shoot.status == "confirmed", Shoot.deposit_expected > 0, Shoot.deposit_received_at.is_(None),
        Shoot.deposit_waived.is_(False)).order_by(Shoot.starts_at)).all()
    today = db.scalars(select(Shoot).where(Shoot.starts_at >= day_start, Shoot.starts_at < day_end)
                       .order_by(Shoot.starts_at)).all()
    open_ = db.scalars(select(Shoot).where(Shoot.status == "confirmed", Shoot.starts_at < now())).all()
    unclosed = [s for s in open_ if utc(s.starts_at) + timedelta(minutes=s.duration_min) < now()]
    awaiting = db.scalars(select(Shoot.id).where(Shoot.status == "completed", Shoot.editing.is_(True),
                                                 Shoot.production != "ready")).all()
    return {"deposit_pending": shoots_out(db, list(pending)), "today": shoots_out(db, list(today)),
            "unclosed_count": len(unclosed), "awaiting_material_count": len(awaiting), "app_usage": app_usage(db)}


def app_usage(db: DB) -> dict:
    """Neçə müştəri app-a qoşulub, ana ekrana əlavə edib, bildirişi açıb, son 7 gündə açıb."""
    clients = db.scalars(select(Client)).all()
    subscribed = set(db.scalars(select(PushSubscription.client_id)))
    week = now() - timedelta(days=7)
    return {"clients": len(clients), "joined": sum(c.activated_at is not None for c in clients),
            "home_screen": sum(c.app_standalone for c in clients), "push_on": len(subscribed),
            "active_7d": sum(c.app_seen_at is not None and utc(c.app_seen_at) >= week for c in clients)}


def _month(month: str) -> tuple[datetime, datetime]:
    try:
        y, m = (int(x) for x in month.split("-"))
        first = date(y, m, 1)
    except ValueError:
        raise HTTPException(422, "Ay YYYY-MM olmalıdır")
    return day_bounds(first)[0], day_bounds(booking.add_months(first, 1))[0]


@router.get("/report")
def report(month: str = Query(pattern=r"^\d{4}-\d{2}$"), db: DB = Depends(get_db)):
    """Aylıq hesabat. «Kassa» = həmin ay əldə olan pul (beh, studiyada ödəniş, paket satışı, geri qaytarılan çıxılır);
    «çəkilişlər» = həmin ay keçirilən çəkilişlər (başlama tarixinə görə)."""
    a, b = _month(month)
    shoots = db.scalars(select(Shoot).where(Shoot.starts_at >= a, Shoot.starts_at < b)).all()
    done = [s for s in shoots if s.status == "completed"]

    def total(col, when):
        return sum(getattr(s, col) for s in db.scalars(select(Shoot).where(when >= a, when < b)))

    deposits = total("deposit_amount", Shoot.deposit_received_at)
    at_studio = total("paid_at_studio", Shoot.closed_at)
    refunds = total("refund_amount", Shoot.refunded_at)
    pkgs = db.scalars(select(Package).where(Package.created_at >= a, Package.created_at < b)).all()
    ledger = db.scalars(select(CashbackLedger).where(CashbackLedger.created_at < b)).all()
    in_month = [r for r in ledger if utc(r.created_at) >= a]
    by_kind = {}
    for s in done:
        k = by_kind.setdefault(s.kind, {"count": 0, "minutes": 0, "total": 0})
        k["count"] += 1
        k["minutes"] += s.duration_min
        k["total"] += s.total
    return {
        "month": month,
        "cash": {"deposits": deposits, "at_studio": at_studio, "packages": sum(p.price_paid for p in pkgs),
                 "refunds": refunds, "net": deposits + at_studio + sum(p.price_paid for p in pkgs) - refunds},
        "shoots": {"completed": len(done), "cancelled": sum(s.status == "cancelled" for s in shoots),
                   "no_show": sum(s.status == "no_show" for s in shoots),
                   "upcoming": sum(s.status == "confirmed" for s in shoots),
                   "minutes": sum(s.duration_min for s in done), "revenue": sum(s.total for s in done),
                   "discounts": sum(s.discount for s in done), "retained": sum(s.retained_amount for s in shoots),
                   "by_kind": by_kind},
        "packages_sold": len(pkgs),
        "cashback": {"earned": sum(r.amount for r in in_month if r.kind in ("earn", "earn_first")),
                     "manual": sum(r.amount for r in in_month if r.kind == "manual"),
                     "spent": -sum(r.amount for r in in_month if r.kind in ("spend", "spend_return")),
                     "liability": sum(r.amount for r in ledger)},
    }
