"""Həftəlik bot baxışı üçün xam material: həll olunmamış suallar, sahibkarın düzəltdiyi və bəyənmədiyi qaralamalar.

    cd server && DATABASE_URL=... .venv/bin/python scripts/bot_review.py [--days 7]

Production üçün DATABASE_URL `railway connect Postgres --tunnel-only --port 15432` tunelindən gəlir (ekrana çıxarma).
Nəticə `Biznes CRM/bot-izleme/YYYY-MM-DD.md` (chmod 600). Ad və telefon yazılmır; yalnız mesaj mətnləri.
Claude faylı oxuyub prompta (`crm/bot_prompt.py`) və ya FAQ-a nə əlavə ediləcəyini təklif edir, sahibkar təsdiqləyir.
"""
import argparse
import sys
from datetime import timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import select  # noqa: E402

from db import SessionLocal, now  # noqa: E402
from models import BotDraft, UnansweredQuestion, WaMessage  # noqa: E402

OUT_DIR = Path.home() / "Claude Projects/Biznes CRM/bot-izleme"


def _customer_before(db, draft: BotDraft) -> str:
    m = db.scalar(select(WaMessage).where(WaMessage.conversation_id == draft.conversation_id,
                                          WaMessage.source == "customer", WaMessage.created_at <= draft.created_at)
                  .order_by(WaMessage.id.desc()).limit(1))
    return (m.text if m else "-") or "-"


def build(db, days: int) -> str:
    since = now() - timedelta(days=days)
    gaps = db.scalars(select(UnansweredQuestion).where(UnansweredQuestion.resolved.is_(False),
                                                       UnansweredQuestion.created_at >= since)
                      .order_by(UnansweredQuestion.id)).all()
    drafts = db.scalars(select(BotDraft).where(BotDraft.created_at >= since, BotDraft.status.in_(("edited", "rejected")))
                        .order_by(BotDraft.id)).all()
    out = [f"# Bot baxışı: son {days} gün ({now():%Y-%m-%d})", "", f"## Həll olunmamış suallar ({len(gaps)})", ""]
    out += [f"- {g.question}" for g in gaps] or ["- yoxdur"]
    edited = [d for d in drafts if d.status == "edited" and (d.model_output or {}).get("reply")]
    out += ["", f"## Sahibkarın düzəltdiyi qaralamalar ({len(edited)})", ""]
    for d in edited:
        out += [f"- Müştəri: {_customer_before(db, d)}", f"  - Bot: {d.model_output['reply']}", f"  - Sahibkar: {d.text}"]
    rejected = [d for d in drafts if d.status == "rejected" and not (d.reason or "").startswith("handoff:")]
    out += ["", f"## Bəyənilməyən qaralamalar ({len(rejected)})", ""]
    for d in rejected:
        out += [f"- Müştəri: {_customer_before(db, d)}", f"  - Bot: {d.text}" + (f" ({d.reason})" if d.reason else "")]
    return "\n".join(out) + "\n"


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--out", type=Path)
    a = ap.parse_args()
    with SessionLocal() as db:
        text = build(db, a.days)
    out = a.out or OUT_DIR / f"{now():%Y-%m-%d}.md"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(text, encoding="utf-8")
    out.chmod(0o600)
    print(f"yazıldı: {out}")


if __name__ == "__main__":
    main()
