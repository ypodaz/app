from datetime import date, datetime
from typing import Optional

from sqlalchemy import (JSON, Date, DateTime, Float, ForeignKey, Index, Integer, String, Text, UniqueConstraint,
                        false as sa_false, true as sa_true)
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
    # app istifadəsi: app hər açılanda yenilənir
    app_seen_at: Mapped[Optional[datetime]] = mapped_column(TS)
    app_standalone: Mapped[bool] = mapped_column(default=False, server_default=sa_false())  # ana ekrandan açılıb
    push_permission: Mapped[Optional[str]] = mapped_column(String(12))  # default | granted | denied | unsupported
    # profil: həm müştəri özü, həm admin doldurur (kampaniya seçimləri üçün)
    profession: Mapped[Optional[str]] = mapped_column(String(80))
    workplace: Mapped[Optional[str]] = mapped_column(String(120))
    instagram: Mapped[Optional[str]] = mapped_column(String(80))
    niche: Mapped[Optional[str]] = mapped_column(String(120))
    birthday: Mapped[Optional[date]] = mapped_column(Date)
    source: Mapped[Optional[str]] = mapped_column(String(16))  # instagram | tiktok | google | youtube | referral | other
    marketing_opt_in: Mapped[bool] = mapped_column(default=True, server_default=sa_true())  # «Təkliflər» açarı
    profile_bonus_at: Mapped[Optional[datetime]] = mapped_column(TS)
    # «Dostunu gətir»: dostun ilk çəkilişi bağlananda hər ikisinə bonus
    referral_code: Mapped[Optional[str]] = mapped_column(String(8), unique=True)
    referred_by_id: Mapped[Optional[int]] = mapped_column(ForeignKey("clients.id", ondelete="SET NULL"), index=True)
    referral_rewarded_at: Mapped[Optional[datetime]] = mapped_column(TS)
    # avtomatik bildirişlərin son göndərilmə vaxtı (təkrar getməsin)
    winback_at: Mapped[Optional[datetime]] = mapped_column(TS)
    cashback_nudge_at: Mapped[Optional[datetime]] = mapped_column(TS)
    birthday_year: Mapped[Optional[int]] = mapped_column(Integer)
    review_asked_at: Mapped[Optional[datetime]] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Tag(Base):
    __tablename__ = "tags"
    id: Mapped[int] = mapped_column(primary_key=True)
    name: Mapped[str] = mapped_column(String(40), unique=True)


class ClientTag(Base):
    __tablename__ = "client_tags"
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True)
    tag_id: Mapped[int] = mapped_column(ForeignKey("tags.id", ondelete="CASCADE"), primary_key=True, index=True)


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
    ending_notified_at: Mapped[Optional[datetime]] = mapped_column(TS)  # «paket bitir» bildirişi
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
    kind: Mapped[str] = mapped_column(String(16), default="shoot")  # shoot | reels_pack | studio_rent
    tag: Mapped[str] = mapped_column(String(16))  # podcast | reels | other
    location: Mapped[str] = mapped_column(String(16))  # studio | onsite
    address: Mapped[Optional[str]] = mapped_column(String(255))
    starts_at: Mapped[datetime] = mapped_column(TS)
    duration_min: Mapped[int] = mapped_column(Integer)
    # studiyanın əlavə məşğul vaxtı (dəqiqə): müştəri görmür, qiymətə təsir etmir
    prep_min: Mapped[int] = mapped_column(Integer, default=15, server_default="15")
    wrap_min: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
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
    discount: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    extras: Mapped[list] = mapped_column(JSON, default=list, server_default="[]")  # [{name, amount}]
    discount_note: Mapped[Optional[str]] = mapped_column(String(255))  # yalnız admin görür
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
    reminded_at: Mapped[Optional[datetime]] = mapped_column(TS)  # bir gün əvvəl xatırlatma göndərilib
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
    # earn | earn_first | spend | spend_return | manual | profile_bonus | referral | birthday
    kind: Mapped[str] = mapped_column(String(16))
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
    pushed_at: Mapped[Optional[datetime]] = mapped_column(TS)  # push göndərilib (və ya lazım deyil)


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


class AiUsage(Base):
    """Gündəlik AI sayğacı. subject: «client:7» və ya «admin:1»."""
    __tablename__ = "ai_usage"
    __table_args__ = (Index("ux_ai_usage_subject_day", "subject", "day", unique=True),)
    id: Mapped[int] = mapped_column(primary_key=True)
    subject: Mapped[str] = mapped_column(String(24))
    day: Mapped[date] = mapped_column(Date)
    messages: Mapped[int] = mapped_column(Integer, default=0)
    tokens_in: Mapped[int] = mapped_column(Integer, default=0)
    tokens_out: Mapped[int] = mapped_column(Integer, default=0)


class AiMessage(Base):
    """Müştərinin AI söhbəti (kontekst üçün son mesajlar)."""
    __tablename__ = "ai_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    role: Mapped[str] = mapped_column(String(8))  # user | model
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class PushSubscription(Base):
    __tablename__ = "push_subscriptions"
    id: Mapped[int] = mapped_column(primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), index=True)
    endpoint: Mapped[str] = mapped_column(String(1000), unique=True)
    p256dh: Mapped[str] = mapped_column(String(255))
    auth: Mapped[str] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Campaign(Base):
    """Toplu bildiriş: adminin göndərdiyi və ya avtomatik (kind = winback | cashback | birthday | review)."""
    __tablename__ = "campaigns"
    id: Mapped[int] = mapped_column(primary_key=True)
    kind: Mapped[str] = mapped_column(String(16), default="manual")
    title: Mapped[str] = mapped_column(String(80))
    body: Mapped[str] = mapped_column(String(400))
    url: Mapped[Optional[str]] = mapped_column(String(500))
    filters: Mapped[dict] = mapped_column(JSON, default=dict)
    recipients: Mapped[int] = mapped_column(Integer, default=0)
    push_on: Mapped[int] = mapped_column(Integer, default=0)  # göndərilən anda bildirişi açıq olanlar
    created_by: Mapped[Optional[int]] = mapped_column(ForeignKey("admins.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class CampaignRecipient(Base):
    __tablename__ = "campaign_recipients"
    campaign_id: Mapped[int] = mapped_column(ForeignKey("campaigns.id", ondelete="CASCADE"), primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id", ondelete="CASCADE"), primary_key=True, index=True)
    opened_at: Mapped[Optional[datetime]] = mapped_column(TS)


# --- CRM: paylaşım (Faza 1) və WhatsApp/leadlər (Faza 2). business_id sonrakı bizneslər üçündür. ---

class MediaAsset(Base):
    __tablename__ = "media_assets"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    number: Mapped[int] = mapped_column(Integer)  # video nömrəsi
    day: Mapped[int] = mapped_column(Integer)
    slot: Mapped[str] = mapped_column(String(8))  # seher | axsam
    title: Mapped[str] = mapped_column(String(200))
    file_name: Mapped[str] = mapped_column(String(200))
    public_url: Mapped[Optional[str]] = mapped_column(String(500))
    cover_offset_ms: Mapped[int] = mapped_column(Integer, default=1000, server_default="1000")
    duration_s: Mapped[Optional[float]] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class SocialPost(Base):
    __tablename__ = "social_posts"
    __table_args__ = (UniqueConstraint("media_asset_id", "platform", name="uq_social_posts_media_platform"),)
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    media_asset_id: Mapped[int] = mapped_column(ForeignKey("media_assets.id", ondelete="CASCADE"), index=True)
    platform: Mapped[str] = mapped_column(String(12))  # instagram | tiktok | youtube | facebook
    scheduled_at: Mapped[datetime] = mapped_column(TS)  # UTC
    text: Mapped[str] = mapped_column(Text)
    title: Mapped[Optional[str]] = mapped_column(String(200))  # YouTube üçün
    status: Mapped[str] = mapped_column(String(12), default="planned")  # planned | queued | published | error | cancelled
    external_id: Mapped[Optional[str]] = mapped_column(String(100))  # Buffer post id
    error: Mapped[Optional[str]] = mapped_column(Text)
    attempts: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[datetime] = mapped_column(TS, default=now, onupdate=now)


class WaContact(Base):
    __tablename__ = "wa_contacts"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    phone: Mapped[Optional[str]] = mapped_column(String(32), unique=True)
    bsuid: Mapped[Optional[str]] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    language: Mapped[Optional[str]] = mapped_column(String(8))
    excluded: Mapped[bool] = mapped_column(default=False, server_default=sa_false())  # bot yazmır
    bot_muted_until: Mapped[Optional[datetime]] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class WaConversation(Base):
    __tablename__ = "wa_conversations"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("wa_contacts.id", ondelete="CASCADE"), index=True)
    kapso_conversation_id: Mapped[Optional[str]] = mapped_column(String(64), unique=True)
    mode: Mapped[str] = mapped_column(String(8), default="bot", server_default="bot")  # bot | human
    last_message_at: Mapped[Optional[datetime]] = mapped_column(TS)
    last_inbound_at: Mapped[Optional[datetime]] = mapped_column(TS)
    window_expires_at: Mapped[Optional[datetime]] = mapped_column(TS)  # 24 saat pəncərəsi
    unread: Mapped[int] = mapped_column(Integer, default=0, server_default="0")
    lead_id: Mapped[Optional[int]] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class WaMessage(Base):
    __tablename__ = "wa_messages"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("wa_conversations.id", ondelete="CASCADE"), index=True)
    wamid: Mapped[Optional[str]] = mapped_column(String(128), unique=True)
    direction: Mapped[str] = mapped_column(String(3))  # in | out
    source: Mapped[str] = mapped_column(String(8))  # customer | bot | phone | panel | history
    type: Mapped[str] = mapped_column(String(16), default="text")
    text: Mapped[str] = mapped_column(Text, default="")
    media_url: Mapped[Optional[str]] = mapped_column(String(500))
    transcript: Mapped[Optional[str]] = mapped_column(Text)
    status: Mapped[Optional[str]] = mapped_column(String(16))
    raw: Mapped[Optional[dict]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class BotDraft(Base):
    __tablename__ = "bot_drafts"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    conversation_id: Mapped[int] = mapped_column(ForeignKey("wa_conversations.id", ondelete="CASCADE"), index=True)
    text: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(10), default="pending")  # pending | sent | rejected | edited
    reason: Mapped[Optional[str]] = mapped_column(String(200))
    model_output: Mapped[Optional[dict]] = mapped_column(JSON)
    telegram_message_id: Mapped[Optional[str]] = mapped_column(String(32))
    decided_at: Mapped[Optional[datetime]] = mapped_column(TS)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Lead(Base):
    __tablename__ = "leads"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    contact_id: Mapped[int] = mapped_column(ForeignKey("wa_contacts.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(120), default="")
    phone: Mapped[str] = mapped_column(String(32), default="")
    service: Mapped[Optional[str]] = mapped_column(String(12))  # podkast | reels | icare | korporativ | diger
    preferred_date: Mapped[Optional[str]] = mapped_column(String(64))
    people: Mapped[Optional[int]] = mapped_column(Integer)
    cameras: Mapped[Optional[int]] = mapped_column(Integer)
    editing: Mapped[Optional[bool]] = mapped_column()
    source: Mapped[str] = mapped_column(String(12), default="whatsapp")  # whatsapp | instagram | reklam | diger
    # yeni | maraqlanir | tarix | beh | tesdiq | geldi | itirildi
    stage: Mapped[str] = mapped_column(String(12), default="yeni")
    notes: Mapped[str] = mapped_column(Text, default="")
    shoot_id: Mapped[Optional[int]] = mapped_column(ForeignKey("shoots.id", ondelete="SET NULL"))
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
    updated_at: Mapped[datetime] = mapped_column(TS, default=now, onupdate=now)


class LeadEvent(Base):
    __tablename__ = "lead_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    lead_id: Mapped[int] = mapped_column(ForeignKey("leads.id", ondelete="CASCADE"), index=True)
    kind: Mapped[str] = mapped_column(String(24))
    data: Mapped[Optional[dict]] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class Faq(Base):
    __tablename__ = "faqs"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    question: Mapped[str] = mapped_column(Text)
    answer: Mapped[str] = mapped_column(Text)
    active: Mapped[bool] = mapped_column(default=True, server_default=sa_true())
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class QuickReply(Base):
    __tablename__ = "quick_replies"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    title: Mapped[str] = mapped_column(String(80))
    text: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class UnansweredQuestion(Base):
    __tablename__ = "unanswered_questions"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    conversation_id: Mapped[Optional[int]] = mapped_column(ForeignKey("wa_conversations.id", ondelete="SET NULL"),
                                                           index=True)
    question: Mapped[str] = mapped_column(Text)
    resolved: Mapped[bool] = mapped_column(default=False, server_default=sa_false())
    created_at: Mapped[datetime] = mapped_column(TS, default=now)


class WebhookEvent(Base):
    """Təkrar gələn webhook-ları atmaq üçün."""
    __tablename__ = "webhook_events"
    id: Mapped[int] = mapped_column(primary_key=True)
    business_id: Mapped[str] = mapped_column(String(16), default="ypod", server_default="ypod", index=True)
    provider: Mapped[str] = mapped_column(String(16))
    idempotency_key: Mapped[str] = mapped_column(String(128), unique=True)
    created_at: Mapped[datetime] = mapped_column(TS, default=now)
