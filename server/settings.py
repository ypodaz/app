import os

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
