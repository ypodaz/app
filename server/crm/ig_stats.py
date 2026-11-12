"""Həftəlik Instagram statistikası: bazar ertəsi Bakı vaxtı 10:00-dan sonra 📊 Hesabatlar mövzusuna bir mesaj.

Ötən həftə (bazar ertəsi 00:00 – bazar 24:00, Bakı) əvvəlki həftə ilə müqayisə olunur: əhatə, baxış, profil
baxışı, qarşılıqlı əlaqə, izləyici sayı və həftənin paylaşımları (ən çox və ən az baxılan). Mənbə Instagram
Insights API-dir (instagram_business_manage_insights, Instagram Login tokeni). Söndürmək: `ig_weekly_enabled=false`.
"""
import logging
from datetime import datetime, timedelta

import httpx
from sqlalchemy.orm import Session as DB

import tgtopics
from crm import conf, instagram, tg
from db import aware
from views import BAKU

log = logging.getLogger("ig_stats")
HOUR = 10
WEEK = timedelta(days=7)
ACCOUNT_METRICS = (("reach", "Əhatə (unikal hesab)"), ("views", "Baxış"), ("profile_views", "Profil baxışı"),
                   ("accounts_engaged", "Aktiv hesab"), ("total_interactions", "Qarşılıqlı əlaqə"))
MEDIA_METRICS = "reach,views,saved,shares,likes,comments"
TOP = 3


def _get(db: DB, path: str, **params) -> dict:
    r = httpx.get(f"{instagram.GRAPH}/{path}", params=params, timeout=30,
                  headers={"Authorization": f"Bearer {instagram.token(db)}"})
    data = r.json()
    if r.status_code >= 400 or "error" in data:
        raise instagram.IgError(str((data.get("error") or {}).get("message") or f"HTTP {r.status_code}")[:300])
    return data


def week_bounds(t: datetime) -> tuple[datetime, datetime]:
    """Ötən tam həftə, Bakı vaxtı: (bazar ertəsi 00:00, növbəti bazar ertəsi 00:00)."""
    local = aware(t).astimezone(BAKU)
    end = (local - timedelta(days=local.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return end - WEEK, end


def account_totals(db: DB, since: datetime, until: datetime) -> dict[str, int]:
    data = _get(db, "me/insights", metric=",".join(m for m, _ in ACCOUNT_METRICS), period="day",
                metric_type="total_value", since=int(since.timestamp()), until=int(until.timestamp()))
    return {d["name"]: int((d.get("total_value") or {}).get("value") or 0) for d in data.get("data") or []}


def _insights(item: dict) -> dict[str, int]:
    return {d["name"]: int(((d.get("values") or [{}])[0]).get("value") or 0)
            for d in ((item.get("insights") or {}).get("data") or [])}


def week_media(db: DB, since: datetime, until: datetime) -> list[dict]:
    """Həftənin paylaşımları insights ilə: [{caption, type, url, reach, views, ...}]."""
    fields = "id,caption,timestamp,media_product_type,permalink"
    data = _get(db, "me/media", fields=f"{fields},insights.metric({MEDIA_METRICS})", limit=50)
    out = []
    for m in data.get("data") or []:
        ts = datetime.fromisoformat(str(m.get("timestamp", "")).replace("+0000", "+00:00"))
        if since <= ts < until:
            out.append({"caption": " ".join((m.get("caption") or "").split()), "type": m.get("media_product_type"),
                        "url": m.get("permalink") or "", **_insights(m)})
    return out


def _n(v: int) -> str:
    return f"{v:,}".replace(",", " ")


def _delta(cur: int, prev: int | None) -> str:
    if not prev:
        return ""
    pct = round((cur - prev) * 100 / prev)
    return f" (ötən həftə {_n(prev)}, {'+' if pct >= 0 else '−'}{abs(pct)}%)"


def _media_line(m: dict) -> str:
    title = (m["caption"][:60] + "…") if len(m["caption"]) > 60 else (m["caption"] or "(mətnsiz)")
    return (f"• {title} — {_n(m.get('views', 0))} baxış, {_n(m.get('reach', 0))} əhatə, "
            f"{m.get('saved', 0)} saxlama, {m.get('shares', 0)} göndərmə")


def build(db: DB, t: datetime) -> str:
    since, until = week_bounds(t)
    cur = account_totals(db, since, until)
    prev = account_totals(db, since - WEEK, since)
    followers = int(_get(db, "me", fields="followers_count").get("followers_count") or 0)
    prev_f = conf.get(db, "ig_followers_week")
    head = f"İzləyici: {_n(followers)}"
    if prev_f:
        diff = followers - int(prev_f)
        head += f" ({'+' if diff >= 0 else '−'}{abs(diff)} həftədə)"
    lines = [f"📈 Instagram həftəsi, {since:%d.%m}–{until - timedelta(days=1):%d.%m}", "", head]
    lines += [f"{label}: {_n(cur.get(m, 0))}{_delta(cur.get(m, 0), prev.get(m))}" for m, label in ACCOUNT_METRICS]
    media = week_media(db, since, until)
    if media:
        ranked = sorted(media, key=lambda m: m.get("views", 0), reverse=True)
        lines += ["", f"Paylaşımlar: {len(media)}. Ən çox baxılan:"]
        lines += [_media_line(m) for m in ranked[:TOP]]
        if len(ranked) > TOP:
            lines += ["Ən az baxılan:", _media_line(ranked[-1])]
    else:
        lines += ["", "Bu həftə paylaşım olmayıb."]
    conf.put(db, "ig_followers_week", str(followers))
    return "\n".join(lines)


def due(db: DB, t: datetime) -> bool:
    local = aware(t).astimezone(BAKU)
    return (instagram.enabled() and local.weekday() == 0 and local.hour >= HOUR
            and conf.get(db, "ig_weekly_last") != local.date().isoformat()
            and (conf.get(db, "ig_weekly_enabled", "true") or "").strip().lower() != "false")


def send(db: DB, t: datetime) -> bool:
    local = aware(t).astimezone(BAKU)
    conf.put(db, "ig_weekly_last", local.date().isoformat())  # xəta olsa da: hər dəqiqə təkrar sorğu getməsin
    db.commit()
    try:
        text = build(db, t)
    except (instagram.IgError, httpx.HTTPError, ValueError) as e:
        log.warning("həftəlik IG statistikası alınmadı: %s", e)
        tg._call("sendMessage", {**tgtopics.dest("server"), "text": f"Həftəlik Instagram statistikası alınmadı: {e}"[:500]})
        return False
    tg._call("sendMessage", {**tgtopics.dest("reports"), "text": text})
    db.commit()
    return True
