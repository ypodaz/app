"""Admin və müştəri route-larının ortaq çıxış hissələri (yalnız oxuyur)."""

from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import money
from db import aware, now
from models import Material, Package, PackageMember, Shoot

BAKU = timezone(timedelta(hours=4))  # Azərbaycanda yay vaxtı yoxdur


def iso(dt: datetime | None) -> datetime | None:
    return aware(dt) if dt else None


def utc(dt: datetime) -> datetime:
    """SQLite qurşağı saxlamır, ona görə yazmazdan və müqayisədən əvvəl UTC-yə çeviririk."""
    return aware(dt).astimezone(timezone.utc)


def baku_today() -> date:
    return now().astimezone(BAKU).date()


def day_bounds(d: date) -> tuple[datetime, datetime]:
    start = datetime(d.year, d.month, d.day, tzinfo=BAKU)
    return utc(start), utc(start + timedelta(days=1))


def payment_line(s: Shoot) -> str:
    return money.payment_status(
        total=s.total, cashback_used=s.cashback_used, deposit_amount=s.deposit_amount,
        deposit_received=s.deposit_received_at is not None, deposit_waived=s.deposit_waived,
        paid_at_studio=s.paid_at_studio, package_minutes=s.duration_min if s.package_id else None,
        extra_camera=s.price_extra_camera)


def studio_balance(s: Shoot) -> int:
    """Hələ açıq çəkiliş üçün studiyada qalan; bağlanmış və ləğv olunmuşda 0."""
    if s.status != "confirmed":
        return 0
    return money.studio_balance(s.total, s.cashback_used, s.deposit_amount if s.deposit_received_at else 0)


def material_out(m: Material) -> dict:
    return {"id": m.id, "title": m.title, "drive_url": m.drive_url}


def materials_of(db: DB, shoot_ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {i: [] for i in shoot_ids}
    if shoot_ids:
        for m in db.scalars(select(Material).where(Material.shoot_id.in_(shoot_ids)).order_by(Material.id)):
            out[m.shoot_id].append(material_out(m))
    return out


def shoot_core(s: Shoot) -> dict:
    """Admin və müştəriyə eyni görünən sahələr."""
    return {
        "id": s.id, "package_id": s.package_id, "starts_at": iso(s.starts_at), "duration_min": s.duration_min,
        "kind": s.kind, "tag": s.tag, "location": s.location, "address": s.address, "cameras": s.cameras,
        "editing": s.editing, "reels_count": s.reels_count, "title": s.title, "status": s.status,
        "production": s.production, "delivery_on": s.delivery_on,
        "price_base": s.price_base, "price_editing": s.price_editing, "price_reels": s.price_reels,
        "price_extra_camera": s.price_extra_camera, "discount": s.discount, "total": s.total,
        "extras": s.extras or [],
    }


def member_package_ids(db: DB, client_id: int) -> list[int]:
    owned = db.scalars(select(Package.id).where(Package.owner_client_id == client_id))
    member = db.scalars(select(PackageMember.package_id).where(PackageMember.client_id == client_id))
    return sorted({*owned, *member})
