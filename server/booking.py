"""Çəkiliş və paket əməliyyatları: bazaya yazan hissə.

Hesabı money.py edir, bu modul onu bazaya köçürür: ledger sətirləri, status, jurnal, bildiriş.
Hər funksiya commit etmir, route bir əməliyyatı bir tranzaksiyada bağlayır.
"""

import calendar
from datetime import date, datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import money
from db import aware, now
from models import (AuditLog, Block, CashbackLedger, Client, Notification, Package, PackageHoursLedger,
                    PackageMember, Shoot)

MONEY_FIELDS = ("status", "total", "cashback_used", "deposit_expected", "deposit_amount", "deposit_waived",
                "paid_at_studio", "retained_amount", "refund_amount", "duration_min", "starts_at", "discount",
                # jurnalda düzəlişin nəyi dəyişdiyi görünsün
                "kind", "tag", "location", "cameras", "editing", "reels_count", "prep_min", "wrap_min")


class Rejected(ValueError):
    """Admin üçün başa düşülən səbəblə rədd edilən əməliyyat."""


def cashback_balance(db: DB, client_id: int) -> int:
    return db.scalar(select(func.coalesce(func.sum(CashbackLedger.amount), 0))
                     .where(CashbackLedger.client_id == client_id))


def package_left(db: DB, pkg: Package) -> int:
    """Paketdə qalan dəqiqə."""
    used = db.scalar(select(func.coalesce(func.sum(PackageHoursLedger.delta_minutes), 0))
                     .where(PackageHoursLedger.package_id == pkg.id))
    return pkg.minutes_total + used


def _snapshot(s: Shoot) -> dict:
    return {f: (getattr(s, f).isoformat() if isinstance(getattr(s, f), datetime) else getattr(s, f))
            for f in MONEY_FIELDS}


def _audit(db: DB, admin_id: int | None, action: str, s: Shoot, before: dict | None) -> None:
    db.flush()
    db.add(AuditLog(admin_id=admin_id, action=action, entity="shoot", entity_id=s.id,
                    before=before, after=_snapshot(s)))


def _notify(db: DB, client_id: int, type_: str, **payload) -> None:
    db.add(Notification(client_id=client_id, type=type_, payload=payload))


def _price(s: Shoot, pkg: Package | None) -> money.Price:
    try:
        return money.price(kind=s.kind, location=s.location, cameras=s.cameras, duration_min=s.duration_min,
                           editing=s.editing, reels_count=s.reels_count,
                           package_cameras=pkg.cameras if pkg else None, discount=s.discount)
    except ValueError as e:
        raise Rejected(str(e)) from e


def _apply_price(s: Shoot, p: money.Price) -> None:
    s.price_base, s.price_editing, s.price_reels, s.price_extra_camera = p.base, p.editing, p.reels, p.extra_camera
    s.total = p.total


def _spend_cashback(db: DB, s: Shoot, amount: int) -> None:
    if not amount:
        return
    try:
        money.check_cashback_use(amount, cashback_balance(db, s.client_id), s.total - s.cashback_used)
    except ValueError as e:
        raise Rejected(str(e)) from e
    s.cashback_used += amount
    db.add(CashbackLedger(client_id=s.client_id, shoot_id=s.id, kind="spend", amount=-amount))


def _return_cashback(db: DB, s: Shoot) -> None:
    if s.cashback_used:
        db.add(CashbackLedger(client_id=s.client_id, shoot_id=s.id, kind="spend_return", amount=s.cashback_used))


def _usable_package(db: DB, package_id: int, client_id: int, on: date, minutes: int) -> Package:
    pkg = db.get(Package, package_id)
    if not pkg:
        raise Rejected("Paket tapılmadı")
    member = pkg.owner_client_id == client_id or db.get(PackageMember, (pkg.id, client_id))
    if not member:
        raise Rejected("Müştəri bu paketin üzvü deyil")
    if not pkg.starts_on <= on <= pkg.ends_on:
        raise Rejected("Çəkiliş tarixi paketin müddətinə düşmür")
    if package_left(db, pkg) < minutes:
        raise Rejected(f"Paketdə {money.fmt_hours(package_left(db, pkg))} qalıb")
    return pkg


def _require(s: Shoot, *statuses: str) -> None:
    if s.status not in statuses:
        raise Rejected("Bu çəkilişin vəziyyəti bu əməliyyata imkan vermir")


def _check_buffer(prep_min: int, wrap_min: int) -> None:
    for v in (prep_min, wrap_min):
        if not 0 <= v <= 240 or v % 5:
            raise Rejected("Hazırlıq və yığışdırma 0–240 dəqiqə, 5 dəqiqə addımla olmalıdır")


def busy_span(s: Shoot) -> tuple[datetime, datetime]:
    """Studiyanın məşğul olduğu aralıq: hazırlıqdan yığışdırmanın sonuna qədər."""
    start = aware(s.starts_at)
    return (start - timedelta(minutes=s.prep_min),
            start + timedelta(minutes=s.duration_min + s.wrap_min))


def conflicts(db: DB, *, starts_at: datetime, duration_min: int, prep_min: int, wrap_min: int,
              exclude_id: int | None = None) -> list[dict]:
    """Bu vaxtla üst-üstə düşən çəkilişlər və bloklar (hazırlıq/yığışdırma daxil).
    Yalnız xəbərdarlıqdır, yaratmağa mane olmur."""
    start = aware(starts_at) - timedelta(minutes=prep_min)
    end = aware(starts_at) + timedelta(minutes=duration_min + wrap_min)
    out = []
    near = db.scalars(select(Shoot).where(Shoot.status == "confirmed",
                                          Shoot.starts_at < end + timedelta(hours=6),
                                          Shoot.starts_at > start - timedelta(hours=12)))
    for s in near:
        if s.id == exclude_id:
            continue
        a, b = busy_span(s)
        if a < end and start < b:
            out.append({"type": "shoot", "id": s.id, "client_id": s.client_id,
                        "starts_at": aware(s.starts_at).isoformat(), "duration_min": s.duration_min})
    for bl in db.scalars(select(Block).where(Block.starts_at < end, Block.ends_at > start)):
        out.append({"type": "block", "id": bl.id, "starts_at": aware(bl.starts_at).isoformat(),
                    "ends_at": aware(bl.ends_at).isoformat(), "reason": bl.reason})
    return out


def create_shoot(db: DB, admin_id: int | None, *, client_id: int, starts_at: datetime, duration_min: int,
                 kind: str, tag: str, location: str, cameras: int, editing: bool, reels_count: int = 0,
                 package_id: int | None = None, cashback_use: int = 0, address: str | None = None,
                 title: str | None = None, note: str | None = None, source_note: str | None = None,
                 discount: int = 0, discount_note: str | None = None, prep_min: int = 15,
                 wrap_min: int = 0) -> Shoot:
    client = db.get(Client, client_id)
    if not client:
        raise Rejected("Müştəri tapılmadı")
    _check_buffer(prep_min, wrap_min)
    if kind in ("reels_pack", "studio_rent"):
        editing, reels_count = False, 0
    if kind == "studio_rent":
        cameras, location, address = 0, "studio", None
    pkg = _usable_package(db, package_id, client_id, starts_at.date(), duration_min) if package_id else None
    s = Shoot(client_id=client_id, package_id=package_id, kind=kind, tag=tag, location=location, address=address,
              starts_at=starts_at, duration_min=duration_min, cameras=cameras, editing=editing,
              reels_count=reels_count, title=title, note=note, source_note=source_note, created_by=admin_id,
              discount=discount, discount_note=(discount_note or None) if discount else None,
              prep_min=prep_min, wrap_min=wrap_min)
    _apply_price(s, _price(s, pkg))
    db.add(s)
    db.flush()
    _spend_cashback(db, s, cashback_use)
    s.deposit_expected = money.deposit_expected(s.total, s.cashback_used, pkg is not None)
    _audit(db, admin_id, "create", s, None)
    _notify(db, client_id, "shoot_created", shoot_id=s.id)
    return s


def receive_deposit(db: DB, admin_id: int | None, s: Shoot, amount: int) -> None:
    _require(s, "confirmed")
    if amount <= 0 or amount > money.to_pay(s.total, s.cashback_used):
        raise Rejected("Beh məbləği düzgün deyil")
    before = _snapshot(s)
    s.deposit_amount, s.deposit_received_at, s.deposit_waived = amount, now(), False
    _audit(db, admin_id, "deposit", s, before)
    _notify(db, s.client_id, "deposit_received", shoot_id=s.id, amount=amount)


def waive_deposit(db: DB, admin_id: int | None, s: Shoot) -> None:
    _require(s, "confirmed")
    if s.deposit_received_at:
        raise Rejected("Beh artıq alınıb")
    before = _snapshot(s)
    s.deposit_waived = True
    _audit(db, admin_id, "deposit_waive", s, before)


def is_first_shoot(db: DB, client: Client, s: Shoot) -> bool:
    """App-a qoşulduqdan sonra bağlanan ilk çəkiliş (keçmişdə earn_first yoxdursa)."""
    if not client.activated_at or aware(s.starts_at) < aware(client.activated_at):
        return False
    had_bonus = db.scalar(select(func.count()).select_from(CashbackLedger)
                          .where(CashbackLedger.client_id == client.id, CashbackLedger.kind == "earn_first"))
    if had_bonus:
        return False
    earlier = db.scalar(select(func.count()).select_from(Shoot).where(
        Shoot.client_id == client.id, Shoot.status == "completed", Shoot.id != s.id,
        Shoot.starts_at >= client.activated_at))
    return not earlier


def close_shoot(db: DB, admin_id: int | None, s: Shoot, *, duration_min: int, paid_method: str | None,
                cashback_use: int = 0, discount: int | None = None) -> int:
    """Çəkilişi bağlayır: faktiki müddətlə qiymət yenilənir, paket saatı çıxılır, keşbek yazılır.
    discount verilirsə, endirim dəyişdirilir. Yazılan keşbeki qaytarır."""
    _require(s, "confirmed")
    before = _snapshot(s)
    pkg = db.get(Package, s.package_id) if s.package_id else None
    s.duration_min = duration_min
    if discount is not None:
        s.discount = discount
    p = _price(s, pkg)
    if p.total < s.cashback_used + (s.deposit_amount if s.deposit_received_at else 0):
        raise Rejected("Yeni məbləğ artıq ödəniləndən azdır, əvvəl məbləği yoxlayın")
    _apply_price(s, p)
    _spend_cashback(db, s, cashback_use)
    s.deposit_expected = money.deposit_expected(s.total, s.cashback_used, pkg is not None)
    if pkg:
        if package_left(db, pkg) < s.duration_min:
            raise Rejected(f"Paketdə {money.fmt_hours(package_left(db, pkg))} qalıb")
        db.add(PackageHoursLedger(package_id=pkg.id, shoot_id=s.id, delta_minutes=-s.duration_min))
    deposit = s.deposit_amount if s.deposit_received_at else 0
    s.paid_at_studio = money.studio_balance(s.total, s.cashback_used, deposit)
    s.paid_method = paid_method if s.paid_at_studio else None
    client = db.get(Client, s.client_id)
    kind, earned = money.cashback_earned(p, from_package=pkg is not None, first_shoot=is_first_shoot(db, client, s))
    if earned:
        db.add(CashbackLedger(client_id=s.client_id, shoot_id=s.id, kind=kind, amount=earned))
    s.status, s.closed_at = "completed", now()
    _audit(db, admin_id, "close", s, before)
    _notify(db, s.client_id, "shoot_closed", shoot_id=s.id, cashback=earned)
    return earned


def no_show(db: DB, admin_id: int | None, s: Shoot) -> None:
    _require(s, "confirmed")
    before = _snapshot(s)
    c = money.cancellation(window="no_show", deposit_paid=s.deposit_amount if s.deposit_received_at else 0,
                           cashback_used=s.cashback_used)
    _return_cashback(db, s)
    s.status, s.cancel_window, s.retained_amount, s.closed_at = "no_show", "no_show", c.retained, now()
    db.get(Client, s.client_id).deposit_required = True
    _audit(db, admin_id, "no_show", s, before)


def cancel_shoot(db: DB, admin_id: int | None, s: Shoot, requested_at: datetime) -> money.Cancellation:
    _require(s, "confirmed")
    before = _snapshot(s)
    window = money.cancel_window(aware(s.starts_at), aware(requested_at))
    c = money.cancellation(window=window, deposit_paid=s.deposit_amount if s.deposit_received_at else 0,
                           cashback_used=s.cashback_used)
    _return_cashback(db, s)
    s.status, s.cancel_requested_at, s.cancel_window = "cancelled", requested_at, window
    s.retained_amount, s.refund_amount = c.retained, c.refund
    _audit(db, admin_id, "cancel", s, before)
    _notify(db, s.client_id, "shoot_cancelled", shoot_id=s.id, refund=c.refund)
    return c


def mark_refunded(db: DB, admin_id: int | None, s: Shoot) -> None:
    if s.status != "cancelled" or not s.refund_amount or s.refunded_at:
        raise Rejected("Qaytarılacaq məbləğ yoxdur")
    before = _snapshot(s)
    s.refunded_at = now()
    _audit(db, admin_id, "refund", s, before)
    _notify(db, s.client_id, "refunded", shoot_id=s.id, amount=s.refund_amount)


def reschedule(db: DB, admin_id: int | None, s: Shoot, new_start: datetime, requested_at: datetime) -> None:
    """24 saatdan az qalanda vaxt bir dəfə dəyişdirilə bilər, beh yeni vaxta keçir."""
    _require(s, "confirmed")
    lt24 = money.cancel_window(aware(s.starts_at), aware(requested_at)) == "lt24"
    if lt24 and s.rescheduled_lt24:
        raise Rejected("24 saatdan az qalanda vaxt yalnız bir dəfə dəyişdirilir")
    if s.package_id:
        pkg = db.get(Package, s.package_id)
        if not pkg.starts_on <= new_start.date() <= pkg.ends_on:
            raise Rejected("Yeni tarix paketin müddətinə düşmür")
    before = _snapshot(s)
    s.starts_at = new_start
    s.rescheduled_lt24 = s.rescheduled_lt24 or lt24
    _audit(db, admin_id, "reschedule", s, before)
    _notify(db, s.client_id, "shoot_rescheduled", shoot_id=s.id, starts_at=new_start.isoformat())


def edit_shoot(db: DB, admin_id: int | None, s: Shoot, *, starts_at: datetime, duration_min: int, kind: str,
               tag: str, location: str, cameras: int, editing: bool, reels_count: int = 0,
               address: str | None = None, title: str | None = None, note: str | None = None, discount: int = 0,
               discount_note: str | None = None, prep_min: int = 15, wrap_min: int = 0) -> None:
    """Adminin düzəlişi (səhvi düzəltmək): qiymət və beh yenidən hesablanır, 24 saat qaydası tətbiq olunmur.
    Müştəri, paket və keşbek istifadəsi dəyişmir (onlar üçün ləğv edib yenidən yaradılır)."""
    _require(s, "confirmed")
    _check_buffer(prep_min, wrap_min)
    if kind in ("reels_pack", "studio_rent"):
        editing, reels_count = False, 0
    if kind == "studio_rent":
        cameras, location, address = 0, "studio", None
    pkg = None
    if s.package_id:
        pkg = db.get(Package, s.package_id)
        if not pkg.starts_on <= aware(starts_at).date() <= pkg.ends_on:
            raise Rejected("Yeni tarix paketin müddətinə düşmür")
        if package_left(db, pkg) < duration_min:
            raise Rejected(f"Paketdə {money.fmt_hours(package_left(db, pkg))} qalıb")
    before = _snapshot(s)
    old_start, old_total, old_duration = aware(s.starts_at), s.total, s.duration_min
    s.starts_at, s.duration_min, s.kind, s.tag, s.location, s.address = starts_at, duration_min, kind, tag, location, address
    s.cameras, s.editing, s.reels_count, s.title, s.note = cameras, editing, reels_count, title, note
    s.discount, s.discount_note = discount, (discount_note or None) if discount else None
    s.prep_min, s.wrap_min = prep_min, wrap_min
    _apply_price(s, _price(s, pkg))
    if s.cashback_used > s.total:
        raise Rejected(f"Bu çəkilişdə {money.fmt(s.cashback_used)} keşbek istifadə olunub, yeni məbləğ ondan azdır")
    if s.deposit_amount > money.to_pay(s.total, s.cashback_used):
        raise Rejected(f"Alınmış beh ({money.fmt(s.deposit_amount)}) yeni ödəniləcək məbləğdən çoxdur")
    s.deposit_expected = money.deposit_expected(s.total, s.cashback_used, pkg is not None)
    moved = aware(starts_at) != old_start
    if moved:
        s.reminded_at = None  # yeni vaxt üçün xatırlatma yenidən getsin
    _audit(db, admin_id, "edit", s, before)
    if moved:
        _notify(db, s.client_id, "shoot_rescheduled", shoot_id=s.id, starts_at=aware(starts_at).isoformat())
    elif s.total != old_total or s.duration_min != old_duration:
        _notify(db, s.client_id, "shoot_updated", shoot_id=s.id)


def add_months(d: date, months: int) -> date:
    """7 noyabr 2026 + 12 ay = 7 noyabr 2027; ayın sonu qısa aya sürüşür."""
    y, m = divmod(d.month - 1 + months, 12)
    year, month = d.year + y, m + 1
    return d.replace(year=year, month=month, day=min(d.day, calendar.monthrange(year, month)[1]))


def create_package(db: DB, admin_id: int | None, *, owner_client_id: int, title: str, hours: int, cameras: int,
                   starts_on: date, used_minutes: int = 0, member_ids: list[int] = ()) -> Package:
    """Paket yaradır. used_minutes köhnə paketin artıq işlənmiş saatlarıdır (B7)."""
    if hours not in money.PACKAGES or cameras not in money.PACKAGES[hours][1]:
        raise Rejected("Belə paket yoxdur")
    if not db.get(Client, owner_client_id):
        raise Rejected("Müştəri tapılmadı")
    if used_minutes < 0 or used_minutes > hours * 60 or used_minutes % 30:
        raise Rejected("İşlənmiş saat düzgün deyil")
    months, prices = money.PACKAGES[hours]
    pkg = Package(title=title, owner_client_id=owner_client_id, minutes_total=hours * 60, cameras=cameras,
                  starts_on=starts_on, ends_on=add_months(starts_on, months), price_paid=prices[cameras])
    db.add(pkg)
    db.flush()
    for cid in {owner_client_id, *member_ids}:
        if not db.get(Client, cid):
            raise Rejected("Üzv tapılmadı")
        db.add(PackageMember(package_id=pkg.id, client_id=cid))
    if used_minutes:
        db.add(PackageHoursLedger(package_id=pkg.id, delta_minutes=-used_minutes, note="Artıq istifadə olunub"))
    db.add(AuditLog(admin_id=admin_id, action="create", entity="package", entity_id=pkg.id,
                    after={"hours": hours, "cameras": cameras, "used_minutes": used_minutes}))
    return pkg


def audit_member(db: DB, admin_id: int | None, action: str, package_id: int, client_id: int) -> None:
    db.add(AuditLog(admin_id=admin_id, action=action, entity="package", entity_id=package_id,
                    after={"client_id": client_id}))


def manual_cashback(db: DB, admin_id: int | None, client_id: int, amount: int, note: str) -> None:
    """Köhnə müştərinin başlanğıc keşbeki (B6c) və ya düzəliş. Balans mənfiyə düşə bilməz."""
    if not db.get(Client, client_id):
        raise Rejected("Müştəri tapılmadı")
    if not amount or cashback_balance(db, client_id) + amount < 0:
        raise Rejected("Məbləğ düzgün deyil")
    row = CashbackLedger(client_id=client_id, kind="manual", amount=amount, note=note or "Əvvəlki keşbek")
    db.add(row)
    db.flush()
    db.add(AuditLog(admin_id=admin_id, action="manual", entity="cashback", entity_id=row.id,
                    after={"client_id": client_id, "amount": amount}))
