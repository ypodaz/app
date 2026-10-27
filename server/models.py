from datetime import date, datetime
from typing import Optional

from sqlalchemy import JSON, Date, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from db import Base, now

TS = DateTime(timezone=True)


class Client(Base):
    __tablename__ = "clients"
    id: Mapped[int] = mapped_column(primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120))
    phone: Mapped[str] = mapped_column(String(32), default="")
    lang: Mapped[str] = mapped_column(String(2), default="az")
    card_code: Mapped[str] = mapped_column(String(16), unique=True)
    activated_at: Mapped[Optional[datetime]] = mapped_column(TS)
    deposit_required: Mapped[bool] = mapped_column(default=False)
    notes: Mapped[str] = mapped_column(Text, default="")
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Admin(Base):
    __tablename__ = "admins"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    login: Mapped[str] = mapped_column(String(64), unique=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    failed_attempts: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[Optional[datetime]] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Invite(Base):
    __tablename__ = "invites"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(TS)
    used_at: Mapped[Optional[datetime]] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class PairCode(Base):
    """Safari-dəki sessiyadan ana ekrandakı app-a keçmək üçün 6 rəqəmli kod."""
    __tablename__ = "pair_codes"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    code_hash: Mapped[str] = mapped_column(String(64), index=True)
    expires_at: Mapped[datetime] = mapped_column(TS)
    used_at: Mapped[Optional[datetime]] = mapped_column(TS)


class Session(Base):
    __tablename__ = "sessions"
    id: Mapped[int] = mapped_column(primary_key=True)
    subject_type: Mapped[str] = mapped_column(String(8))  # client | admin
    subject_id: Mapped[int] = mapped_column(Integer, index=True)
    token_hash: Mapped[str] = mapped_column(String(64), unique=True)
    expires_at: Mapped[datetime] = mapped_column(TS)
    last_seen_at: Mapped[datetime] = mapped_column(TS, default=now)
    user_agent: Mapped[str] = mapped_column(String(255), default="")
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Package(Base):
    __tablename__ = "packages"
    id: Mapped[int] = mapped_column(primary_key=True)
    title: Mapped[str] = mapped_column(String(120))
    owner_client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    minutes_total: Mapped[int] = mapped_column(Integer)  # dəqiqə ilə
    cameras: Mapped[int] = mapped_column(Integer)
    starts_on: Mapped[date] = mapped_column(Date)
    ends_on: Mapped[date] = mapped_column(Date)
    price_paid: Mapped[int] = mapped_column(Integer)  # qəpik
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class PackageMember(Base):
    __tablename__ = "package_members"
    package_id: Mapped[int] = mapped_column(ForeignKey("packages.id", ondelete="CASCADE"), primary_key=True, index=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True, index=True)


class PackageHoursLedger(Base):
    __tablename__ = "package_hours_ledger"
    id: Mapped[int] = mapped_column(primary_key=True)
    package_id: Mapped[int] = mapped_column(ForeignKey("packages.id", ondelete="CASCADE"), index=True)
    shoot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shoots.id", ondelete="SET NULL"), index=True)
    delta_minutes: Mapped[int] = mapped_column(Integer)  # mənfi = işlənib, müsbət = qaytarılıb/düzəliş
    note: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Shoot(Base):
    __tablename__ = "shoots"
    __table_args__ = (Index("ix_shoots_starts_at", "starts_at"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    package_id: Mapped[Optional[int]] = mapped_column(ForeignKey("packages.id", ondelete="RESTRICT"), index=True)
    kind: Mapped[str] = mapped_column(String(16), default="shoot")  # shoot | reels_pack
    tag: Mapped[str] = mapped_column(String(16))  # podcast | reels | other
    location: Mapped[str] = mapped_column(String(16))  # studio | onsite
    address: Mapped[Optional[str]] = mapped_column(String(255))
    starts_at: Mapped[datetime] = mapped_column(TS)
    duration_min: Mapped[int] = mapped_column(Integer)
    cameras: Mapped[int] = mapped_column(Integer)
    editing: Mapped[bool] = mapped_column(default=False)
    reels_count: Mapped[int] = mapped_column(Integer, default=0)
    title: Mapped[Optional[str]] = mapped_column(String(120))
    note: Mapped[Optional[str]] = mapped_column(Text)
    source_note: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(16), default="confirmed")  # confirmed | completed | cancelled | no_show
    production: Mapped[str] = mapped_column(String(16), default="none")  # none | editing | ready
    delivery_on: Mapped[Optional[date]] = mapped_column(Date)
    # qiymət snapshot-ı (qəpik)
    price_base: Mapped[int] = mapped_column(Integer, default=0)
    price_editing: Mapped[int] = mapped_column(Integer, default=0)
    price_reels: Mapped[int] = mapped_column(Integer, default=0)
    price_extra_camera: Mapped[int] = mapped_column(Integer, default=0)
    total: Mapped[int] = mapped_column(Integer, default=0)
    # ödəniş (qəpik)
    cashback_used: Mapped[int] = mapped_column(Integer, default=0)
    deposit_expected: Mapped[int] = mapped_column(Integer, default=0)
    deposit_amount: Mapped[int] = mapped_column(Integer, default=0)
    deposit_received_at: Mapped[Optional[datetime]] = mapped_column(TS)
    deposit_waived: Mapped[bool] = mapped_column(default=False)
    paid_at_studio: Mapped[int] = mapped_column(Integer, default=0)
    paid_method: Mapped[Optional[str]] = mapped_column(String(16))  # cash | card
    # bağlanma / ləğv
    closed_at: Mapped[Optional[datetime]] = mapped_column(TS)
    cancel_requested_at: Mapped[Optional[datetime]] = mapped_column(TS)
    cancel_window: Mapped[Optional[str]] = mapped_column(String(16))  # gt24 | lt24
    retained_amount: Mapped[int] = mapped_column(Integer, default=0)
    refund_amount: Mapped[int] = mapped_column(Integer, default=0)
    refunded_at: Mapped[Optional[datetime]] = mapped_column(TS)
    rescheduled_lt24: Mapped[bool] = mapped_column(default=False)
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"), index=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[datetime] = mapped_column(TS, default=now, onupdate=now)


class Material(Base):
    __tablename__ = "materials"
    id: Mapped[int] = mapped_column(primary_key=True)
    shoot_id: Mapped[int] = mapped_column(ForeignKey("shoots.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(120))
    drive_url: Mapped[str] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Block(Base):
    __tablename__ = "blocks"
    id: Mapped[int] = mapped_column(primary_key=True)
    starts_at: Mapped[datetime] = mapped_column(TS)
    ends_at: Mapped[datetime] = mapped_column(TS)
    reason: Mapped[Optional[str]] = mapped_column(String(255))


class CashbackLedger(Base):
    __tablename__ = "cashback_ledger"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="RESTRICT"), index=True)
    shoot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shoots.id", ondelete="SET NULL"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # earn | earn_first | spend | spend_return | manual
    amount: Mapped[int] = mapped_column(Integer)  # qəpik, işarəli
    note: Mapped[Optional[str]] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Notification(Base):
    __tablename__ = "notifications"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    type: Mapped[str] = mapped_column(String(32))
    payload: Mapped[dict] = mapped_column(JSON, default=dict)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    read_at: Mapped[Optional[datetime]] = mapped_column(TS)


class AuditLog(Base):
    __tablename__ = "audit_log"
    id: Mapped[int] = mapped_column(primary_key=True)
    admin_id: Mapped[Optional[int]] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"), index=True)
    action: Mapped[str] = mapped_column(String(32))
    entity: Mapped[str] = mapped_column(String(32))
    entity_id: Mapped[int] = mapped_column(Integer)
    before: Mapped[Optional[dict]] = mapped_column(JSON)
    after: Mapped[Optional[dict]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Setting(Base):
    __tablename__ = "settings"
    key: Mapped[str] = mapped_column(String(64), primary_key=True)
    value: Mapped[str] = mapped_column(Text)
