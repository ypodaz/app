# Y Pod app

Y Pod studiyasının müştəri app-ı (PWA) və admin paneli.

- Frontend: `web/` (Vite + React) → GitHub Pages, `https://ypodaz.github.io/app/`
- API: `server/` (FastAPI + Postgres) → Railway

## Lokal işə salma

```sh
cd server && uv venv --python 3.12 .venv && uv pip install --python .venv/bin/python -r requirements.txt pytest httpx
.venv/bin/alembic upgrade head && .venv/bin/uvicorn main:app --reload --port 8000
.venv/bin/python -m pytest -q tests

cd web && npm install && npm run dev   # http://localhost:5173/app/
```

## Railway dəyişənləri

| Ad | Məna |
|---|---|
| `DATABASE_URL` | Postgres plugin-dən |
| `SESSION_SECRET` | uzun təsadüfi sətir |
| `ALLOWED_ORIGIN` | `https://ypodaz.github.io` |
| `APP_URL` | `https://ypodaz.github.io/app/` |
| `ADMIN_LOGIN` | admin login-i |
| `ADMIN_PASSWORD_HASH` | `python hash_password.py` nəticəsi; parolu dəyişmək üçün yenisini yaz |
| `BUFFER_API_KEY`, `BUFFER_ORG_ID` | Buffer API açarı və təşkilat id-si (paylaşım) |
| `R2_PUBLIC_BASE_URL` | Cloudflare R2 ictimai bucket ünvanı (videoların URL əsası) |
| `SOCIAL_DAILY_REQUEST_CAP` | Buffer sorğu limiti gündə (standart 80) |
| `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`, `KAPSO_PHONE_NUMBER_ID` | WhatsApp vasitəçisi Kapso |
| `TG_WEBHOOK_SECRET` | Telegram düymə webhook-u üçün sirr |

Railway servisi: Root Directory `server`, start command
`alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port $PORT`.

GitHub repo dəyişəni `VITE_API_URL` = Railway servisinin ünvanı (sonunda `/` olmadan).
