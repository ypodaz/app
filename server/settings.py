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
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")  # ehtiyat: Gemini işləməyəndə mətn cavabları
OPENAI_FALLBACK_MODEL = os.environ.get("OPENAI_FALLBACK_MODEL", "gpt-6-luna")
AI_DAILY_CLIENT_LIMIT = int(os.environ.get("AI_DAILY_CLIENT_LIMIT", "30"))
AI_DAILY_GLOBAL_LIMIT = int(os.environ.get("AI_DAILY_GLOBAL_LIMIT", "500"))
AI_DAILY_ADMIN_LIMIT = int(os.environ.get("AI_DAILY_ADMIN_LIMIT", "200"))
VAPID_PUBLIC_KEY = os.environ.get("VAPID_PUBLIC_KEY", "")
VAPID_PRIVATE_KEY = os.environ.get("VAPID_PRIVATE_KEY", "")
# xatırlatma/push dövrü (testlərdə söndürülür)
SCHEDULER = os.environ.get("SCHEDULER", "1") == "1"
VAPID_SUBJECT = os.environ.get("VAPID_SUBJECT", "https://ypodaz.github.io")  # py_vapid yolsuz URL istəyir
# sahibkara Telegram xəbərdarlığı (boşdursa söndürülüb)
TG_BOT_TOKEN = os.environ.get("TG_BOT_TOKEN", "")
TG_CHAT_ID = os.environ.get("TG_CHAT_ID", "")

# CRM Faza 1: avtomatik paylaşım (Buffer + Cloudflare R2)
BUFFER_API_KEY = os.environ.get("BUFFER_API_KEY", "")
BUFFER_ORG_ID = os.environ.get("BUFFER_ORG_ID", "")
R2_PUBLIC_BASE_URL = os.environ.get("R2_PUBLIC_BASE_URL", "")
FB_PAGE_ID = os.environ.get("FB_PAGE_ID", "")
FB_PAGE_TOKEN = os.environ.get("FB_PAGE_TOKEN", "")
SOCIAL_DAILY_REQUEST_CAP = int(os.environ.get("SOCIAL_DAILY_REQUEST_CAP", "80"))

# CRM Faza 2: WhatsApp (Kapso) və Telegram düymələri
KAPSO_API_KEY = os.environ.get("KAPSO_API_KEY", "")
KAPSO_WEBHOOK_SECRET = os.environ.get("KAPSO_WEBHOOK_SECRET", "")
KAPSO_PHONE_NUMBER_ID = os.environ.get("KAPSO_PHONE_NUMBER_ID", "")
TG_WEBHOOK_SECRET = os.environ.get("TG_WEBHOOK_SECRET", "")

# Sosial cavablar: Instagram DM/komment (Instagram Login) və YouTube kommentləri. Boşdursa söndürülüb.
IG_ACCESS_TOKEN = os.environ.get("IG_ACCESS_TOKEN", "")
IG_APP_SECRET = os.environ.get("IG_APP_SECRET", "")
IG_VERIFY_TOKEN = os.environ.get("IG_VERIFY_TOKEN", "")
IG_USER_ID = os.environ.get("IG_USER_ID", "")
YT_CLIENT_ID = os.environ.get("YT_CLIENT_ID", "")
YT_CLIENT_SECRET = os.environ.get("YT_CLIENT_SECRET", "")
YT_REFRESH_TOKEN = os.environ.get("YT_REFRESH_TOKEN", "")
YT_CHANNEL_ID = os.environ.get("YT_CHANNEL_ID", "")

# Apple Calendar «Public Calendar» linki (webcal:// və ya https://…ics): link gizlidir, yalnız Railway-də.
APPLE_CAL_ICS_URL = os.environ.get("APPLE_CAL_ICS_URL", "")
# Şəxsi təqvim (ayrı link): bütün günlük hadisələr həmin günü tam məşğul edir.
APPLE_CAL_ICS_URL_PERSONAL = os.environ.get("APPLE_CAL_ICS_URL_PERSONAL", "")
# «Y Pod» təqvimində çəkiliş yox, blok olan hadisələr (regex, böyük-kiçik hərf fərqi yoxdur; adlar repoda saxlanmır)
CALENDAR_SUBLET_RE = os.environ.get("CALENDAR_SUBLET_RE", r"şahin|sahin")
CALENDAR_PERSONAL_RE = os.environ.get("CALENDAR_PERSONAL_RE", "")
CALENDAR_PERSONAL_LABEL = os.environ.get("CALENDAR_PERSONAL_LABEL", "Şəxsi blok")
# App çəkilişlərinin ICS feed-i (routes/calendar_feed.py): uzun təsadüfi açar, boşdursa feed bağlıdır
CALENDAR_FEED_TOKEN = os.environ.get("CALENDAR_FEED_TOKEN", "")
