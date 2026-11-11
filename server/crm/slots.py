"""Botun təklif edə biləcəyi boş saatlar: Bakı vaxtı ilə hər gün 08:00–22:00, məşğul vaxtlar çıxılır."""
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import booking
from ai import WD
from db import aware
from models import Block, Shoot
from views import BAKU

OPEN_H, CLOSE_H = 8, 22
MIN_GAP = timedelta(minutes=60)
LEAD = timedelta(hours=2)  # indidən 2 saat içindəki vaxt təklif edilmir


def _round_up(dt: datetime, minutes: int = 30) -> datetime:
    base = dt.replace(second=0, microsecond=0)
    if dt.second or dt.microsecond:
        base += timedelta(minutes=1)
    return base + timedelta(minutes=(-base.minute) % minutes)


def free_text(db: DB, now: datetime, days: int = 7) -> str:
    """Hər sətir: `Cümə 14.11: 11:00–13:00, 16:00–22:00`. Boş gün yazılmır; 60 dəqiqədən qısa boşluq atılır."""
    now_b = aware(now).astimezone(BAKU)
    first = now_b.replace(hour=0, minute=0, second=0, microsecond=0)
    horizon = first + timedelta(days=days)
    busy = []
    for s in db.scalars(select(Shoot).where(Shoot.status != "cancelled", Shoot.starts_at < horizon + timedelta(days=1),
                                            Shoot.starts_at > first - timedelta(days=1))):
        busy.append(booking.busy_span(s))
    for b in db.scalars(select(Block).where(Block.starts_at < horizon, Block.ends_at > first)):
        busy.append((aware(b.starts_at), aware(b.ends_at)))
    cutoff = _round_up(now_b + LEAD)
    lines = []
    for i in range(days):
        day = first + timedelta(days=i)
        cur, end = day.replace(hour=OPEN_H), day.replace(hour=CLOSE_H)
        cur = max(cur, cutoff)
        parts = []
        for a, b in sorted(x for x in busy if x[0] < end and x[1] > cur):
            a, b = a.astimezone(BAKU), b.astimezone(BAKU)
            if a - cur >= MIN_GAP:
                parts.append((cur, a))
            cur = max(cur, b)
        if end - cur >= MIN_GAP:
            parts.append((cur, end))
        if parts:
            lines.append(f"{WD[day.weekday()]} {day:%d.%m}: " + ", ".join(f"{a:%H:%M}–{b:%H:%M}" for a, b in parts))
    return "\n".join(lines)
