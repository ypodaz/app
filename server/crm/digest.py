"""Gündəlik Telegram hesabatı: Bakı vaxtı 21:00-dan sonra gündə bir dəfə, sahibkara bot fəaliyyətinin xülasəsi."""
from collections import Counter
from datetime import datetime, timedelta

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import tgtopics
from crm import calendar_ics, calendar_import, conf, tg, turns
from db import aware
from models import BotDraft, Lead, LeadEvent, Shoot, SocialItem, UnansweredQuestion, WaConversation, WaMessage
from views import BAKU

HOUR = 21
SAMPLES = 3
GAPS = 8  # hesabatda ən çoxu neçə «bilmədiyi sual»
WEEK = timedelta(days=7)
STATUSES = (("sent", "göndərildi"), ("edited", "dəyişdirilib göndərildi"), ("auto", "1 saatdan sonra bot özü göndərdi"),
            ("rejected", "rədd"), ("pending", "gözləyir"))


def _in(col, since, until):
    return (col >= since, col < until)


def build(db: DB, since: datetime, until: datetime) -> str | None:
    convs = db.scalar(select(func.count()).select_from(WaConversation).where(
        *_in(WaConversation.created_at, since, until)))
    msgs = db.scalar(select(func.count()).select_from(WaMessage).where(
        WaMessage.direction == "in", WaMessage.source == "customer", *_in(WaMessage.created_at, since, until)))
    drafts = db.scalars(select(BotDraft).where(*_in(BotDraft.created_at, since, until)).order_by(BotDraft.id)).all()
    gaps = db.scalars(select(UnansweredQuestion).where(*_in(UnansweredQuestion.created_at, since, until))
                      .order_by(UnansweredQuestion.id)).all()
    weekly = _weekly(db, until)
    ads = db.execute(select(SocialItem.ad_id, func.count(func.distinct(SocialItem.thread_id))).where(
        SocialItem.ad_id.is_not(None), *_in(SocialItem.created_at, since, until)).group_by(SocialItem.ad_id)).all()
    waiting = turns.waiting_lines(db)
    cal = calendar_lines(db, until)
    leadl = lead_lines(db, since, until)
    if not (convs or msgs or drafts or gaps or weekly or ads or waiting or cal or leadl):
        return None
    lines = [f"📊 Bot hesabatı, {aware(until).astimezone(BAKU):%d.%m}", "",
             f"Yeni söhbət: {convs}", f"Müştəridən mesaj: {msgs}"]
    if ads:  # nömrə yazmasa da sayılır; reklam ID-si Meta Ads ilə tutuşdurmaq üçün
        lines.append(f"Reklamdan IG yazışma: {sum(n for _, n in ads)} (" + ", ".join(
            f"reklam {a}: {n}" for a, n in ads) + ")")
    if drafts:
        by = Counter(d.status for d in drafts)
        lines.append(f"Bot qaralamaları: {len(drafts)} (" + ", ".join(
            f"{label} {by[st]}" for st, label in STATUSES if by[st]) + ")")
        handoff = Counter(d.reason[8:] for d in drafts if (d.reason or "").startswith("handoff:"))
        if handoff:
            lines.append(f"Komandaya ötürülüb: {sum(handoff.values())} (" + ", ".join(
                f"{k} {v}" for k, v in handoff.most_common()) + ")")
        other = Counter(d.reason for d in drafts if d.reason in ("follow-up", "xatırlatma", tg.REGEN_REASON))
        if other:
            lines.append("Digər: " + ", ".join(f"{k} {v}" for k, v in other.items()))
    stages = Counter((e.data or {}).get("to") for e in db.scalars(select(LeadEvent).where(
        LeadEvent.kind == "stage", *_in(LeadEvent.created_at, since, until))))
    stages.pop(None, None)
    if stages:
        lines.append("Mərhələ irəliləyişi: " + ", ".join(f"{k} {v}" for k, v in stages.most_common()))
    lines += leadl
    edited = [d for d in drafts if d.status == "edited" and (d.model_output or {}).get("reply")]
    if edited:
        lines += ["", "Düzəlişlər:"]
        lines += [f"Bot: {d.model_output['reply'][:160]} → Siz: {d.text[:160]}" for d in edited[:SAMPLES]]
    rejected = [d for d in drafts if d.status == "rejected" and not (d.reason or "").startswith("handoff:")]
    if rejected:
        lines += ["", "Bəyənilməyən qaralamalar (rədd / yenidən yaz):"]
        lines += [f"✖️ {d.text[:200]}" for d in rejected[:SAMPLES]]
    if gaps:
        lines += ["", f"❓ Botun bilmədiyi suallar ({len(gaps)}):"]
        lines += [f"• {g.question[:200]}" for g in gaps[:GAPS]]
        if len(gaps) > GAPS:
            lines.append(f"… və daha {len(gaps) - GAPS} (panel → Bot ayarları → Cavabsız suallar)")
    if waiting:
        lines += ["", f"⏳ Komandaya ötürülüb, sizin cavabınızı gözləyən söhbətlər ({len(waiting)}):"] + waiting[:10]
    if cal:
        lines += [""] + cal
    if weekly:
        lines += ["", f"🗓 Həftəlik: son 7 gündə həll olunmamış {weekly} sual yığılıb. Claude-a «bot izləmə» yazın: "
                      "prompta və FAQ-a əlavə edək."]
    return "\n".join(lines)


LOST_LABELS = {"qiymet": "qiymət", "vaxt": "vaxt", "cavab_yox": "cavab yox", "basqa_yer": "başqa yer", "diger": "digər"}


def lead_lines(db: DB, since: datetime, until: datetime) -> list[str]:
    """Bu gün vaxtı çatan «sonra yazacaq» sayı və son 7 gündə itirilmiş leadlər səbəb üzrə (yalnız sıfır deyilsə)."""
    day_end = aware(since) + timedelta(days=1)
    due = db.scalar(select(func.count()).select_from(Lead).where(Lead.remind_at.is_not(None), Lead.remind_at < day_end)) or 0
    lost = Counter(e.data.get("lost_reason") for e in db.scalars(select(LeadEvent).where(
        LeadEvent.kind == "stage", *_in(LeadEvent.created_at, until - WEEK, until))) if (e.data or {}).get("to") == "itirildi")
    lines = []
    if due:
        lines.append(f"🔔 Bu gün yazacağını demiş müştəri: {due}")
    if lost:
        lines.append(f"📉 Son 7 gündə itirilən: {sum(lost.values())} (" + ", ".join(
            f"{LOST_LABELS.get(k, k or '-')} {v}" for k, v in lost.most_common()) + ")")
    return lines


def calendar_lines(db: DB, until: datetime) -> list[str]:
    """Bu günün təqvimi ilə app-ın fərqi: başlığı «… Y Pod» ilə bitən hadisələr sayılır (sub-icarə və s. yox).
    App-da ±60 dəqiqə içində çəkilişi olmayan hadisə siyahıya düşür (panelə əl ilə yazılmalıdır)."""
    day = aware(until).astimezone(BAKU).replace(hour=0, minute=0, second=0, microsecond=0)
    own = [e for e in calendar_ics.titled(day, day + timedelta(days=1)) if calendar_import.is_own(e[2])]
    starts = [aware(s) for s in db.scalars(select(Shoot.starts_at).where(
        Shoot.status != "cancelled", Shoot.starts_at >= day - timedelta(hours=1), Shoot.starts_at < day + timedelta(days=1, hours=1)))]
    if not own and not starts:
        return []
    missing = [(a, t) for a, _, t in own if not any(abs(s - a) <= timedelta(minutes=60) for s in starts)]
    lines = [f"📅 Təqvimdə bu gün {len(own)} «Y Pod» çəkilişi / app-da {len(starts)}"]
    lines += [f"• {a.astimezone(BAKU):%H:%M} {t[:80]} — app-da yoxdur (panel → Çəkilişlər → Yeni)" for a, t in missing[:8]]
    return lines


def _weekly(db: DB, until: datetime) -> int:
    """Bazar ertəsi: son 7 gündə həll olunmamış sualların sayı (başqa günlər 0)."""
    if aware(until).astimezone(BAKU).weekday() != 0:
        return 0
    return db.scalar(select(func.count()).select_from(UnansweredQuestion).where(
        UnansweredQuestion.resolved.is_(False), *_in(UnansweredQuestion.created_at, until - WEEK, until))) or 0


def due(db: DB, t: datetime) -> bool:
    local = aware(t).astimezone(BAKU)
    return (local.hour >= HOUR and conf.get(db, "digest_last") != local.date().isoformat()
            and (conf.get(db, "digest_enabled", "true") or "").strip().lower() != "false")


def send(db: DB, t: datetime) -> bool:
    local = aware(t).astimezone(BAKU)
    text = build(db, local.replace(hour=0, minute=0, second=0, microsecond=0), t)
    if text:
        tg._call("sendMessage", {**tgtopics.dest("reports"), "text": text})
    conf.put(db, "digest_last", local.date().isoformat())  # fəaliyyət olmasa da: saatda bir yoxlanmasın
    db.commit()
    return bool(text)
