"""Müştəri artımı: profil bonusu, dəvət kodu, seqmentlər, kampaniyalar və gündəlik avtomatik bildirişlər.

Reklam xarakterli hər mesaj «campaign» bildirişidir və yalnız «Təkliflər» açarı açıq olanlara gedir.
Avtomatik bildirişlər bir müştəriyə 7 gündə ən çox MARKETING_CAP dəfə göndərilir (ad günü istisnadır).
Funksiyalar commit etmir, route və gündəlik dövr bir tranzaksiyada bağlayır.
"""

import json
import secrets
from datetime import date, datetime, time, timedelta

from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DB

import booking
import money
from db import aware, now
from models import (Block, Campaign, CampaignRecipient, CashbackLedger, Client, ClientTag, Material, Notification,
                    Package, PackageMember, PushSubscription, Setting, Shoot, Tag)
from views import BAKU, baku_today, day_bounds

MARKETING_CAP = 2  # 7 gündə avtomatik reklam bildirişi
PROFILE_FIELDS = ("profession", "workplace", "instagram", "birthday")  # bonus üçün dolu olmalıdır
SOURCES = ("instagram", "tiktok", "google", "youtube", "referral", "other")
CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"  # qarışan simvollar (0/O, 1/I) yoxdur

AUTOMATIONS = {
    "send_hour": 11,  # Bakı vaxtı
    "studio_hours": [10, 21],  # boş saat təklifi üçün iş saatları
    "winback": {"enabled": False, "days": 60, "title": "Yeni çəkiliş vaxtıdır?",
                "body": "{name}, son çəkilişinizdən bir müddət keçib. Yeni mövzunuz üçün studiya hazırdır — "
                        "WhatsApp-da yazın, uyğun vaxtı seçək."},
    "cashback": {"enabled": False, "min": 1000, "title": "Keşbekiniz sizi gözləyir",
                 "body": "Balansınızda {balance} keşbek var. Növbəti çəkilişdə istifadə edə bilərsiniz."},
    "birthday": {"enabled": False, "gift": 1000, "title": "Ad gününüz mübarək! 🎉",
                 "body": "{name}, Y Pod komandası sizi təbrik edir! Hədiyyə olaraq balansınıza {gift} keşbek yazdıq."},
    "review": {"enabled": False, "url": "", "title": "Çəkilişiniz necə keçdi?",
               "body": "Rəyinizi yazsanız, çox sevinərik — bu, başqalarının bizi tapmasına kömək edir."},
}


# --- profil və dəvət ---

def profile_complete(c: Client) -> bool:
    return all(getattr(c, f) for f in PROFILE_FIELDS)


def grant_profile_bonus(db: DB, c: Client) -> int:
    """Müştəri profili özü tam dolduranda bir dəfəlik bonus. Verilən məbləği qaytarır."""
    if c.profile_bonus_at or not profile_complete(c):
        return 0
    c.profile_bonus_at = now()
    db.add(CashbackLedger(client_id=c.id, kind="profile_bonus", amount=money.PROFILE_BONUS, note="Profil dolduruldu"))
    booking._notify(db, c.id, "bonus", kind="profile_bonus", amount=money.PROFILE_BONUS)
    return money.PROFILE_BONUS


def referral_code(db: DB, c: Client) -> str:
    if not c.referral_code:
        while True:
            code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
            if not db.scalar(select(Client.id).where(Client.referral_code == code)):
                break
        c.referral_code = code
    return c.referral_code


def tags_of(db: DB, client_ids: list[int]) -> dict[int, list[dict]]:
    out: dict[int, list[dict]] = {i: [] for i in client_ids}
    if client_ids:
        for cid, tid, name in db.execute(select(ClientTag.client_id, Tag.id, Tag.name).join(Tag, Tag.id == ClientTag.tag_id)
                                         .where(ClientTag.client_id.in_(client_ids)).order_by(Tag.name)):
            out[cid].append({"id": tid, "name": name})
    return out


def set_tags(db: DB, c: Client, tag_ids: list[int]) -> None:
    ids = set(db.scalars(select(Tag.id).where(Tag.id.in_(tag_ids)))) if tag_ids else set()
    if len(ids) != len(set(tag_ids)):
        raise booking.Rejected("Teq tapılmadı")
    db.execute(delete(ClientTag).where(ClientTag.client_id == c.id))
    db.add_all(ClientTag(client_id=c.id, tag_id=t) for t in ids)


# --- seqmentlər ---

def _fold(s: str) -> str:
    return s.casefold().translate(str.maketrans("əıöüşçğ", "eiouscg"))


def client_stats(db: DB) -> dict[int, dict]:
    """Hər müştəri üçün seqment məlumatı: xidmətlər, son/növbəti çəkiliş, xərc, keşbek, paket, bildiriş."""
    today = baku_today()
    t = now()
    stats: dict[int, dict] = {c: {"services": set(), "last": None, "upcoming": False, "spent": 0, "completed": 0,
                                  "recent_60d": 0}
                              for c in db.scalars(select(Client.id))}
    for s in db.scalars(select(Shoot).where(Shoot.status.in_(("confirmed", "completed")))):
        st = stats[s.client_id]
        start = aware(s.starts_at)
        if s.status == "confirmed" and start > t:
            st["upcoming"] = True
            continue
        if s.status == "completed":
            st["completed"] += 1
            st["spent"] += s.total
            st["services"].update({s.tag, s.kind} if s.kind == "shoot" else {s.kind})
            if s.reels_count:
                st["services"].add("reels")
            if start >= t - timedelta(days=60):
                st["recent_60d"] += 1
        st["last"] = max(st["last"] or start, start)
    cash = dict(db.execute(select(CashbackLedger.client_id, func.sum(CashbackLedger.amount))
                           .group_by(CashbackLedger.client_id)).all())
    live = select(Package.id).where(Package.starts_on <= today, Package.ends_on >= today)
    with_pkg = set(db.scalars(select(Package.owner_client_id).where(Package.id.in_(live))))
    with_pkg |= set(db.scalars(select(PackageMember.client_id).where(PackageMember.package_id.in_(live))))
    push_on = set(db.scalars(select(PushSubscription.client_id)))
    for cid, st in stats.items():
        st.update(cashback=cash.get(cid) or 0, package=cid in with_pkg, push=cid in push_on)
    return stats


def segment(db: DB, f: dict, *, marketing_only: bool = True) -> list[Client]:
    """Süzgəcə uyğun müştərilər. Verilməyən süzgəc tətbiq olunmur; hamısı birlikdə (VƏ) işləyir.
    Siyahılar daxilində isə istənilən biri (VƏ YA): məsələn «psixoloq və ya həkim»."""
    stats = client_stats(db)
    tags = tags_of(db, list(stats))
    t = now()
    out = []
    for c in db.scalars(select(Client).order_by(Client.full_name)):
        st = stats[c.id]
        checks = [
            not f.get("client_ids") or c.id in f["client_ids"],
            not f.get("tag_ids") or any(x["id"] in f["tag_ids"] for x in tags[c.id]),
            not f.get("professions") or any(_fold(p) in _fold(c.profession or "") for p in f["professions"]),
            not f.get("services") or bool(st["services"] & set(f["services"])),
            not f.get("sources") or c.source in f["sources"],
            f.get("inactive_days") is None or (not st["upcoming"] and st["last"] is not None
                                               and st["last"] < t - timedelta(days=f["inactive_days"])),
            f.get("has_package") is None or st["package"] == f["has_package"],
            f.get("min_cashback") is None or st["cashback"] >= f["min_cashback"],
            f.get("birthday_month") is None or (c.birthday is not None and c.birthday.month == f["birthday_month"]),
            f.get("app_joined") is None or (c.activated_at is not None) == f["app_joined"],
            f.get("push_on") is None or st["push"] == f["push_on"],
            # paket üçün namizəd: son 60 gündə 3+ çəkiliş, paketi yoxdur
            f.get("preset") != "package_candidates" or (st["recent_60d"] >= 3 and not st["package"]),
            # podcast çəkdirib Reels götürməyənlər
            f.get("preset") != "podcast_no_reels" or ("podcast" in st["services"] and "reels" not in st["services"]
                                                      and "reels_pack" not in st["services"]),
        ]
        if all(checks) and (c.marketing_opt_in or not marketing_only):
            out.append(c)
    return out


def preview(db: DB, f: dict) -> dict:
    matched = segment(db, f, marketing_only=False)
    ok = [c for c in matched if c.marketing_opt_in]
    push_on = set(db.scalars(select(PushSubscription.client_id)))
    return {"count": len(ok), "push_on": sum(c.id in push_on for c in ok),
            "opted_out": len(matched) - len(ok), "recently_messaged": len(_capped(db, [c.id for c in ok])),
            "sample": [{"id": c.id, "full_name": c.full_name} for c in ok[:30]]}


# --- kampaniyalar ---

def _capped(db: DB, client_ids: list[int]) -> set[int]:
    """Son 7 gündə MARKETING_CAP və ya daha çox reklam bildirişi almış müştərilər."""
    if not client_ids:
        return set()
    rows = db.execute(select(Notification.client_id, func.count()).where(
        Notification.client_id.in_(client_ids), Notification.type == "campaign",
        Notification.created_at >= now() - timedelta(days=7)).group_by(Notification.client_id)).all()
    return {cid for cid, n in rows if n >= MARKETING_CAP}


def _fill(text: str, **v) -> str:
    for k, x in v.items():
        text = text.replace("{" + k + "}", x)
    return text


def send(db: DB, *, title: str, body: str, url: str | None, clients: list[Client], kind: str = "manual",
         filters: dict | None = None, admin_id: int | None = None, values: dict[int, dict] | None = None) -> Campaign:
    """Kampaniya yaradır və hər alıcıya «campaign» bildirişi yazır (push dövrü telefona göndərir).
    values: müştəriyə görə mətn dəyişənləri ({name} həmişə var)."""
    push_on = set(db.scalars(select(PushSubscription.client_id)))
    camp = Campaign(kind=kind, title=title, body=body, url=url or None, filters=filters or {},
                    recipients=len(clients), push_on=sum(c.id in push_on for c in clients), created_by=admin_id)
    db.add(camp)
    db.flush()
    for c in clients:
        v = {"name": c.full_name.split()[0], **(values or {}).get(c.id, {})}
        db.add(CampaignRecipient(campaign_id=camp.id, client_id=c.id))
        booking._notify(db, c.id, "campaign", campaign_id=camp.id, title=_fill(title, **v), body=_fill(body, **v),
                        url=url or None)
    return camp


def campaign_stats(db: DB, camps: list[Campaign]) -> dict[int, dict]:
    """Açılan bildirişlər və 14 gün ərzində çəkiliş yazdıranlar (kampaniyanın nəticəsi)."""
    out = {}
    for camp in camps:
        rec = db.scalars(select(CampaignRecipient).where(CampaignRecipient.campaign_id == camp.id)).all()
        ids = [r.client_id for r in rec]
        start = aware(camp.created_at)
        booked = db.scalar(select(func.count(func.distinct(Shoot.client_id))).where(
            Shoot.client_id.in_(ids), Shoot.created_at >= start,
            Shoot.created_at < start + timedelta(days=14))) if ids else 0
        out[camp.id] = {"opened": sum(r.opened_at is not None for r in rec), "booked_14d": booked or 0}
    return out


def mark_opened(db: DB, client_id: int, campaign_id: int) -> bool:
    r = db.get(CampaignRecipient, (campaign_id, client_id))
    if not r:
        return False
    r.opened_at = r.opened_at or now()
    return True


# --- avtomatik bildirişlər ---

def load_settings(db: DB) -> dict:
    row = db.get(Setting, "automations")
    saved = json.loads(row.value) if row else {}
    out = json.loads(json.dumps(AUTOMATIONS))
    for k, v in saved.items():
        if isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k].update(v)
        elif k in out:
            out[k] = v
    return out


def save_settings(db: DB, value: dict) -> dict:
    row = db.get(Setting, "automations") or Setting(key="automations", value="{}")
    row.value = json.dumps(value, ensure_ascii=False)
    db.add(row)
    db.flush()
    return load_settings(db)


def run_daily(db: DB, force: bool = False) -> dict[str, int]:
    """Gündə bir dəfə, send_hour-dan sonra: ad günü, geri qaytarma, keşbek xatırlatması, rəy xahişi.
    Növə görə göndərilənlərin sayını qaytarır."""
    cfg = load_settings(db)
    today = baku_today()
    ran = db.get(Setting, "automations_ran_on")
    if not force and ((ran and ran.value == today.isoformat())
                      or datetime.now(BAKU).hour < int(cfg["send_hour"])):
        return {}
    if ran:
        ran.value = today.isoformat()
    else:
        db.add(Setting(key="automations_ran_on", value=today.isoformat()))
    t = now()
    stats = client_stats(db)
    clients = db.scalars(select(Client)).all()
    capped = _capped(db, [c.id for c in clients])
    sent: dict[str, int] = {}

    def go(kind: str, picked: list[Client], values: dict[int, dict] | None = None) -> None:
        if picked:
            c = cfg[kind]
            send(db, title=c["title"], body=c["body"], url=c.get("url") or None, clients=picked, kind=kind,
                 values=values)
            capped.update(x.id for x in picked)
            sent[kind] = len(picked)

    # ad günü: hədiyyə hamıya (Təkliflər bağlı olsa da), təbrik yalnız açarı açıq olanlara; limitə baxmır
    b = cfg["birthday"]
    if b["enabled"]:
        gift = int(b.get("gift") or 0)
        picked = []
        for c in clients:
            if c.birthday and _is_birthday(c.birthday, today) and c.birthday_year != today.year:
                c.birthday_year = today.year
                if gift > 0:
                    db.add(CashbackLedger(client_id=c.id, kind="birthday", amount=gift, note="Ad günü hədiyyəsi"))
                if c.marketing_opt_in:
                    picked.append(c)
        go("birthday", picked, {c.id: {"gift": money.fmt(gift)} for c in picked})

    w = cfg["winback"]
    if w["enabled"]:
        edge = t - timedelta(days=int(w["days"]))
        picked = [c for c in clients if c.marketing_opt_in and c.id not in capped and not stats[c.id]["upcoming"]
                  and stats[c.id]["last"] and stats[c.id]["last"] < edge
                  and (c.winback_at is None or aware(c.winback_at) < stats[c.id]["last"])]
        for c in picked:
            c.winback_at = t
        go("winback", picked)

    k = cfg["cashback"]
    if k["enabled"]:
        picked = [c for c in clients if c.marketing_opt_in and c.id not in capped and not stats[c.id]["upcoming"]
                  and stats[c.id]["cashback"] >= int(k["min"])
                  and (c.cashback_nudge_at is None or aware(c.cashback_nudge_at) < t - timedelta(days=30))]
        for c in picked:
            c.cashback_nudge_at = t
        go("cashback", picked, {c.id: {"balance": money.fmt(stats[c.id]["cashback"])} for c in picked})

    r = cfg["review"]
    if r["enabled"] and r.get("url"):
        ready = set(db.scalars(select(Shoot.client_id).join(Material, Material.shoot_id == Shoot.id)
                               .where(Material.created_at < t - timedelta(days=1))))
        picked = [c for c in clients if c.id in ready and c.marketing_opt_in and c.id not in capped
                  and c.review_asked_at is None]
        for c in picked:
            c.review_asked_at = t
        go("review", picked)
    return sent


def _is_birthday(bd: date, today: date) -> bool:
    if (bd.month, bd.day) == (2, 29) and not _leap(today.year):
        return (today.month, today.day) == (2, 28)
    return (bd.month, bd.day) == (today.month, today.day)


def _leap(y: int) -> bool:
    return y % 4 == 0 and (y % 100 != 0 or y % 400 == 0)


# --- boş saatlar (kampaniya şablonu üçün) ---

def free_slots(db: DB, d: date, hours: list[int], min_minutes: int = 60) -> list[dict]:
    """İş saatları içində çəkiliş (hazırlıq/yığışdırma daxil) və bloklardan boş qalan aralıqlar."""
    a, b = day_bounds(d)
    open_at = datetime.combine(d, time(int(hours[0])), BAKU)
    close_at = datetime.combine(d, time(int(hours[1])), BAKU) if int(hours[1]) < 24 else b
    busy = []
    for s in db.scalars(select(Shoot).where(Shoot.status == "confirmed", Shoot.starts_at < b,
                                            Shoot.starts_at >= a - timedelta(hours=12))):
        st = aware(s.starts_at)
        busy.append((st - timedelta(minutes=s.prep_min), st + timedelta(minutes=s.duration_min + s.wrap_min)))
    for bl in db.scalars(select(Block).where(Block.starts_at < b, Block.ends_at > a)):
        busy.append((aware(bl.starts_at), aware(bl.ends_at)))
    cur = max(open_at, now()) if d == baku_today() else open_at
    out = []
    for s, e in sorted(busy):
        if s > cur and cur < close_at:
            out.append((cur, min(s, close_at)))
        cur = max(cur, e)
    if cur < close_at:
        out.append((cur, close_at))
    return [{"start": f"{x.astimezone(BAKU):%H:%M}", "end": f"{y.astimezone(BAKU):%H:%M}"}
            for x, y in out if (y - x) >= timedelta(minutes=min_minutes)]


# --- hesabat ---

def growth_report(db: DB, a: datetime, b: datetime) -> dict:
    """Ay üzrə artım göstəriciləri: yeni müştərilər və mənbələri, təkrar gəlmə, orta çek, kampaniyalar."""
    new = db.scalars(select(Client).where(Client.created_at >= a, Client.created_at < b)).all()
    by_source: dict[str, int] = {}
    for c in new:
        by_source[c.source or "unknown"] = by_source.get(c.source or "unknown", 0) + 1
    done = db.scalars(select(Shoot).where(Shoot.status == "completed", Shoot.starts_at < b)).all()
    per_client: dict[int, list[int]] = {}
    for s in done:
        per_client.setdefault(s.client_id, []).append(s.total)
    in_month = [s for s in done if aware(s.starts_at) >= a]
    camps = db.scalars(select(Campaign).where(Campaign.created_at >= a, Campaign.created_at < b)).all()
    cs = campaign_stats(db, camps)
    bonuses = db.execute(select(CashbackLedger.kind, func.sum(CashbackLedger.amount)).where(
        CashbackLedger.kind.in_(money.BONUS_KINDS), CashbackLedger.created_at >= a, CashbackLedger.created_at < b)
        .group_by(CashbackLedger.kind)).all()
    return {
        "new_clients": len(new), "by_source": by_source,
        "referrals": db.scalar(select(func.count()).select_from(Client).where(
            Client.referral_rewarded_at >= a, Client.referral_rewarded_at < b)) or 0,
        # bu aya qədər ən az bir çəkilişi olanların neçə faizi ikinci dəfə gəlib
        "repeat_rate": round(100 * sum(len(v) >= 2 for v in per_client.values()) / len(per_client)) if per_client else 0,
        "avg_check": sum(s.total for s in in_month) // len(in_month) if in_month else 0,
        "avg_client_value": sum(map(sum, per_client.values())) // len(per_client) if per_client else 0,
        "bonuses": {k: v for k, v in bonuses},
        "campaigns": {"count": len(camps), "recipients": sum(c.recipients for c in camps),
                      "opened": sum(cs[c.id]["opened"] for c in camps),
                      "booked_14d": sum(cs[c.id]["booked_14d"] for c in camps)},
    }
