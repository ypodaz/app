"""App çəkilişlərinin Apple təqvimi üçün ICS feed-i (iPhone: «Abunə təqvimi əlavə et»).

- Ünvan: GET /api/calendar/{CALENDAR_FEED_TOKEN}.ics. Token boşdursa feed bağlıdır (404).
- Yalnız app-ın öz çəkilişləri: Apple təqvimindən gələnlər (calendar_uid, source_note "calendar"/"calendar-archive")
  orada artıq var, təkrar yazılmır. Son 30 gün və gələcək. Ləğv edilən STATUS:CANCELLED ilə gedir.
- Bloklar da düşür, təqvimdən yaranan bloklar (sub-icarə, şəxsi, CalendarLink state=block) istisna.
- Admin linki /api/admin/calendar-feed ilə alır (Tənzimləmə → Hesab → «Təqvim linkini kopyala»).
"""
import hmac
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import settings
from auth import client_ip, current_admin, rate_limit
from crm import calendar_import
from db import aware, get_db, now
from models import Block, CalendarLink, Client, Shoot
from views import short_name

router = APIRouter(prefix="/api")
admin_router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])

PAST_DAYS = 30
FROM_CALENDAR = ("calendar", "calendar-archive")
KIND = {"shoot": "Çəkiliş", "reels_pack": "Reels paketi", "studio_rent": "Studiya icarəsi"}


def _esc(text: str) -> str:
    return (text.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
            .replace("\r\n", "\\n").replace("\n", "\\n"))


def _fold(line: str) -> list[str]:
    """RFC 5545: sətir 75 baytdan uzun olmur, davamı boşluqla başlayır (UTF-8 hərfi bölünmür)."""
    out, cur, size = [], "", 0
    for ch in line:
        n = len(ch.encode())
        if size + n > 75:
            out.append(cur)
            cur, size = " ", 1
        cur += ch
        size += n
    return out + [cur]


def _ts(dt: datetime) -> str:
    return aware(dt).astimezone(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def _event(uid: str, start: datetime, end: datetime, summary: str, stamp: str, *,
           status: str = "CONFIRMED", location: str = "", description: str = "") -> list[str]:
    lines = ["BEGIN:VEVENT", f"UID:{uid}", f"DTSTAMP:{stamp}", f"DTSTART:{_ts(start)}", f"DTEND:{_ts(end)}",
             f"SUMMARY:{_esc(summary)}", f"STATUS:{status}"]
    if location:
        lines.append(f"LOCATION:{_esc(location)}")
    if description:
        lines.append(f"DESCRIPTION:{_esc(description)}")
    return lines + ["END:VEVENT"]


def build_ics(db: DB, t: datetime) -> str:
    since = t - timedelta(days=PAST_DAYS)
    stamp = _ts(t)
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Y Pod//App//AZ", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
             "X-WR-CALNAME:Y Pod App", "X-WR-TIMEZONE:Asia/Baku",
             "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"]
    shoots = db.scalars(select(Shoot).where(Shoot.starts_at >= since, Shoot.calendar_uid.is_(None))
                        .order_by(Shoot.starts_at)).all()
    for s in shoots:
        if s.source_note in FROM_CALENDAR:
            continue
        client = db.get(Client, s.client_id)
        kind = KIND.get(s.kind, s.kind)
        summary = f"{short_name(client.full_name) if client else 'Müştəri'} · {kind}"
        details = [kind, f"{s.cameras} kamera" if s.cameras else "", "montaj" if s.editing else "",
                   f"{s.reels_count} reels" if s.reels_count else "", s.title or ""]
        lines += _event(f"shoot-{s.id}@ypod", s.starts_at, aware(s.starts_at) + timedelta(minutes=s.duration_min),
                        summary, stamp, status="CANCELLED" if s.status == "cancelled" else "CONFIRMED",
                        location="Y Pod studiya" if s.location == "studio" else (s.address or ""),
                        description=" · ".join(d for d in details if d))
    from_cal = {aware(link.starts_at) for link in db.scalars(select(CalendarLink).where(CalendarLink.state == "block"))}
    skip_reasons = {calendar_import.SUBLET, settings.CALENDAR_PERSONAL_LABEL}
    for b in db.scalars(select(Block).where(Block.ends_at >= since).order_by(Block.starts_at)):
        if b.reason in skip_reasons or aware(b.starts_at) in from_cal:
            continue
        lines += _event(f"block-{b.id}@ypod", b.starts_at, b.ends_at, f"🔒 {b.reason or 'Blok'}", stamp)
    lines.append("END:VCALENDAR")
    return "".join(part + "\r\n" for line in lines for part in _fold(line))


@router.get("/calendar/{token}.ics")
def feed(token: str, request: Request, db: DB = Depends(get_db)):
    want = settings.CALENDAR_FEED_TOKEN
    if not want or not hmac.compare_digest(token.encode(), want.encode()):
        rate_limit("ics:" + client_ip(request), 30, 3600)
        raise HTTPException(404, "Tapılmadı")
    return Response(build_ics(db, now()), media_type="text/calendar; charset=utf-8",
                    headers={"Cache-Control": "no-cache"})


@admin_router.get("/calendar-feed")
def feed_link():
    token = settings.CALENDAR_FEED_TOKEN
    return {"enabled": bool(token), "path": f"/calendar/{token}.ics" if token else None}
