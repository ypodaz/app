"""CRM ayarları `settings` cədvəlindədir (Railway dəyişəni yox): panel dəyişəndə redeploy lazım olmasın."""
from sqlalchemy.orm import Session as DB

from models import Setting

BOT_MODES = ("draft", "auto")


def get(db: DB, key: str, default: str | None = None) -> str | None:
    row = db.get(Setting, key)
    return row.value if row else default


def put(db: DB, key: str, value: str) -> None:
    row = db.get(Setting, key)
    if row:
        row.value = value
    else:
        db.add(Setting(key=key, value=value))


def bot_enabled(db: DB) -> bool:
    return (get(db, "bot_enabled", "true") or "").strip().lower() != "false"


def bot_mode(db: DB) -> str:
    v = (get(db, "bot_mode", "draft") or "").strip().lower()
    return v if v in BOT_MODES else "draft"  # naməlum dəyərdə təhlükəsiz rejim: qaralama
