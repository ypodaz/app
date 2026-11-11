"""Telegram webhook-u qeydiyyatdan keçirir (düymə callback-ləri üçün). Bir dəfə, deploydan sonra əl ilə işlədilir:

    cd server && .venv/bin/python scripts/tg_set_webhook.py https://<api>/api/webhooks/telegram

TG_BOT_TOKEN və TG_WEBHOOK_SECRET settings-dən (server/.env və ya mühit dəyişənləri) gəlir.
"""
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import settings  # noqa: E402


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
        print("istifadə: tg_set_webhook.py https://<api>/api/webhooks/telegram")
        return 2
    if not (settings.TG_BOT_TOKEN and settings.TG_WEBHOOK_SECRET):
        print("TG_BOT_TOKEN və TG_WEBHOOK_SECRET lazımdır")
        return 2
    r = httpx.post(f"https://api.telegram.org/bot{settings.TG_BOT_TOKEN}/setWebhook", timeout=15,
                   json={"url": sys.argv[1], "secret_token": settings.TG_WEBHOOK_SECRET,
                         "allowed_updates": ["callback_query", "message"]})
    print(r.status_code, r.text)
    return 0 if r.status_code == 200 else 1


if __name__ == "__main__":
    sys.exit(main())
