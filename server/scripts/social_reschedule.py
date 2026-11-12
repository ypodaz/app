"""Mövcud paylaşım təqvimini gündə bir paylaşıma (20:00) köçürür: hələ paylaşılmamış videolar (planned/queued)
sıra ilə (gün, səhər→axşam) `--start` tarixindən hər gün bir video. Buffer-də növbədə olanların vaxtı da dəyişir.

    railway run --service app .venv/bin/python scripts/social_reschedule.py --start 2026-11-13 [--apply] [--only N]

Susmaya görə yalnız planı çap edir. `--only N`: Buffer-də yalnız N videonu dəyiş (əvvəl bir videoda sınamaq üçün).
"""
import argparse
import sys
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from db import SessionLocal  # noqa: E402
from models import MediaAsset, SocialPost  # noqa: E402
from social import buffer  # noqa: E402
from social.schedule import POST_TIME, SLOT_ORDER  # noqa: E402
from views import BAKU  # noqa: E402

OPEN = ("planned", "queued")


def plan(db, start: date) -> list[tuple[MediaAsset, datetime, list[SocialPost]]]:
    """[(video, yeni vaxt UTC, onun açıq postları)] — hələ paylaşılmamış videolar sırası ilə."""
    assets = {}
    for p in db.scalars(select(SocialPost).where(SocialPost.status.in_(OPEN))).all():
        assets.setdefault(p.media_asset_id, []).append(p)
    rows = []
    order = sorted((db.get(MediaAsset, aid) for aid in assets), key=lambda a: (a.day, SLOT_ORDER.get(a.slot, 0), a.number))
    for i, a in enumerate(order):
        due = datetime.combine(start + timedelta(days=i), POST_TIME, tzinfo=BAKU).astimezone(timezone.utc)
        rows.append((a, due, assets[a.id]))
    return rows


def main(argv=None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", type=date.fromisoformat, required=True)
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--only", type=int, help="yalnız bu nömrəli video")
    args = ap.parse_args(argv)
    with SessionLocal() as db:
        rows = plan(db, args.start)
        moved = failed = 0
        for a, due, posts in rows:
            if args.only and a.number != args.only:
                continue
            print(f"video {a.number:>2} (gün {a.day} {a.slot}) → {due.astimezone(BAKU):%Y-%m-%d %H:%M} "
                  f"[{', '.join(f'{p.platform}:{p.status}' for p in posts)}]")
            if not args.apply:
                continue
            for p in posts:
                if p.status == "queued" and p.external_id and p.platform != "facebook":
                    try:
                        buffer.reschedule(p.external_id, p.platform, p.text, a.public_url, due, p.title)
                    except buffer.BufferError as e:
                        print(f"  ✗ Buffer {p.platform} post {p.id}: {e}")
                        failed += 1
                        continue
                elif p.status == "queued":
                    print(f"  ✗ {p.platform} post {p.id}: Buffer-dən kənar növbə, toxunulmadı")
                    failed += 1
                    continue
                p.scheduled_at = due
                moved += 1
            db.commit()
        if rows:
            print(f"Son video: {rows[-1][1].astimezone(BAKU):%Y-%m-%d}. Köçürülən post: {moved}, alınmayan: {failed}"
                  + ("" if args.apply else " (sınaq, --apply yoxdur)"))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
