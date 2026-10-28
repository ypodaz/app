import os
from pathlib import Path

# Lokal işdə server/.env oxunur (GitHub-a getmir); Railway dəyişənləri üstün tutulur.
_env = Path(__file__).with_name(".env")
if _env.exists():
    for _line in _env.read_text().splitlines():
        if "=" in _line and not _line.lstrip().startswith("#"):
            _k, _v = _line.split("=", 1)
            os.environ.setdefault(_k.strip(), _v.strip())

DATABASE_URL = os.environ.get("DATABASE_URL", "sqlite:///./dev.db")
# Railway "postgresql://" verir; SQLAlchemy psycopg 3 sürücüsünü açıq istəyir.
if DATABASE_URL.startswith("postgresql://"):
    DATABASE_URL = DATABASE_URL.replace("postgresql://", "postgresql+psycopg://", 1)

PRODUCTION = DATABASE_URL.startswith("postgresql")

SESSION_SECRET = os.environ.get("SESSION_SECRET", "")
if not SESSION_SECRET:
    if PRODUCTION:
        raise RuntimeError("SESSION_SECRET təyin edilməyib")
    SESSION_SECRET = "dev-secret"

ALLOWED_ORIGINS = [o.strip() for o in os.environ.get("ALLOWED_ORIGIN", "http://localhost:5173").split(",") if o.strip()]

# Dəvət linkinin əsası, məs. https://ypodaz.github.io/app/
APP_URL = os.environ.get("APP_URL", "http://localhost:5173/app/")

# Admin Railway dəyişənlərindən yaranır; parolu dəyişmək üçün hash-i yeniləmək kifayətdir.
ADMIN_LOGIN = os.environ.get("ADMIN_LOGIN", "")
ADMIN_PASSWORD_HASH = os.environ.get("ADMIN_PASSWORD_HASH", "")

# Faza 2: AI (Gemini) və Web Push
GEMINI_API_KEY = os.environ.get("GEMINI_API_KEY", "")
GEMINI_MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
AI_DAILY_CLIENT_LIMIT = int(os.environ.get("AI_DAILY_CLIENT_LIMIT", "30"))
AI_DAILY_GLOBAL_LIMIT = int(os.environ.get("AI_DAILY_GLOBAL_LIMIT", "500"))
AI_DAILY_ADMIN_LIMIT = int(os.environ.get("AI_DAILY_ADMIN_LIMIT", "200"))
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
# xatırlatma/push dövrü (testlərdə söndürülür)
SCHEDULER = os.environ.get("SCHEDULER", "1") == "1"
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "https://ypodaz.github.io")  # py_vapid yolsuz URL istəyir
