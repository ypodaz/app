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

## WhatsApp botu (Kapso) və Telegram düymələri

Susmaya görə bot **qaralama** rejimindədir: müştəriyə heç nə avtomatik getmir, cavab Telegram-a `✅ Göndər` / `✖️ Rədd`
düymələri ilə gəlir. `bot_enabled` və `bot_mode` (`draft` | `auto`) panel API-si ilə dəyişir
(`POST /api/admin/bot/settings`), Railway dəyişəni deyil.

Railway dəyişənləri: `KAPSO_API_KEY`, `KAPSO_WEBHOOK_SECRET`, `KAPSO_PHONE_NUMBER_ID`, `TG_BOT_TOKEN`, `TG_CHAT_ID`,
`TG_WEBHOOK_SECRET`, `GEMINI_API_KEY` (cədvəl yuxarıdadır).

Kapso webhook qeydiyyatı (Kapso paneli):
1. URL: `https://<api>/api/webhooks/kapso`.
2. Hadisələr: `whatsapp.message.received`, `whatsapp.message.sent`, `whatsapp.message.delivered`,
   `whatsapp.message.read`, `whatsapp.message.failed`, `whatsapp.contact.identity_changed`.
3. Buffering: 5 saniyə (batch gələ bilər, bot hər söhbət üçün bir dəfə işləyir).
4. Secret: `KAPSO_WEBHOOK_SECRET` ilə eyni. İmza `X-Webhook-Signature` başlığında HMAC-SHA256 hex-dir.

Telegram webhook (deploydan sonra bir dəfə, lokal terminalda; `TG_BOT_TOKEN` və `TG_WEBHOOK_SECRET` server/.env-də olmalıdır):

```
cd server && .venv/bin/python scripts/tg_set_webhook.py https://<api>/api/webhooks/telegram
```

Webhook yolları: `POST /api/webhooks/kapso`, `POST /api/webhooks/telegram`.
Admin API (bütün yollar `/api/admin/...`): `inbox`, `inbox/{id}`, `inbox/{id}/send`, `inbox/{id}/mode`,
`drafts/{id}/send`, `drafts/{id}/reject`, `contacts/{id}/exclude`, `leads`, `leads/{id}`, `leads/{id}/confirm`,
`faqs`, `quick-replies`, `unanswered`, `unanswered/{id}/resolve`, `bot/settings`, `bot/test`.

Bot sınağı (real Gemini işlədir, əl ilə): `cd server && .venv/bin/python scripts/bot_eval.py [--limit N]`;
nəticə `Biznes CRM/bot-sinaq.md`-ə yazılır. Bot mətni `server/crm/bot_prompt.py`-dadır (dəyişəndə `VERSION` artır).

Railway servisi: Root Directory `server`, start command
`alembic upgrade head && uvicorn main:app --host 0.0.0.0 --port $PORT`.

GitHub repo dəyişəni `VITE_API_URL` = Railway servisinin ünvanı (sonunda `/` olmadan).
