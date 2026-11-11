"""Kapso webhook-unu qeydiyyatdan keçirir və ya yeniləyir (təkrar işlətmək olar). Açarlar Railway-dən gəlir, heç nə çap olunmur:

    cd server && railway run .venv/bin/python scripts/kapso_set_webhook.py https://<api>/api/webhooks/kapso

KAPSO_API_KEY və KAPSO_WEBHOOK_SECRET lazımdır. KAPSO_PHONE_NUMBER_ID boşdursa, Kapso-da tək nömrə varsa o götürülür.
Gələn mesajlar 5 saniyə yığılır (batch): müştəri ardıcıl 3 sətir yazsa, bot bir dəfə cavab verir.
"""
import sys
from pathlib import Path

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import settings  # noqa: E402

API = "https://api.kapso.ai/platform/v1"
EVENTS = ["whatsapp.message.received", "whatsapp.message.sent", "whatsapp.message.delivered",
          "whatsapp.message.read", "whatsapp.message.failed", "whatsapp.contact.identity_changed"]


def phone_number_id(client: httpx.Client) -> str | None:
    if settings.KAPSO_PHONE_NUMBER_ID:
        return settings.KAPSO_PHONE_NUMBER_ID
    r = client.get(f"{API}/whatsapp/phone_numbers")
    r.raise_for_status()
    nums = r.json().get("data") or []
    for n in nums:
        print(f"nömrə: {n.get('display_phone_number')}  phone_number_id: {n.get('phone_number_id')}  status: {n.get('status')}")
    if len(nums) != 1:
        print("Bir nömrə seçilməlidir: KAPSO_PHONE_NUMBER_ID-ni Railway-ə yaz və yenidən işlət.")
        return None
    print("Bu nömrə götürüldü. Server id-ni ilk gələn mesajda özü yadda saxlayır, Railway-ə yazmaq lazım deyil.")
    return nums[0].get("phone_number_id")


def main() -> int:
    if len(sys.argv) != 2 or not sys.argv[1].startswith("https://"):
        print("istifadə: kapso_set_webhook.py https://<api>/api/webhooks/kapso")
        return 2
    if not (settings.KAPSO_API_KEY and settings.KAPSO_WEBHOOK_SECRET):
        print("KAPSO_API_KEY və KAPSO_WEBHOOK_SECRET lazımdır")
        return 2
    url = sys.argv[1]
    with httpx.Client(headers={"X-API-Key": settings.KAPSO_API_KEY}, timeout=20) as client:
        pid = phone_number_id(client)
        if not pid:
            return 1
        base = f"{API}/whatsapp/phone_numbers/{pid}/webhooks"
        body = {"whatsapp_webhook": {
            "url": url, "secret_key": settings.KAPSO_WEBHOOK_SECRET, "events": EVENTS, "active": True,
            "buffer_enabled": True, "buffer_window_seconds": 5, "buffer_events": ["whatsapp.message.received"],
        }}
        r = client.get(base, params={"url_contains": "/api/webhooks/kapso", "kind": "kapso"})
        r.raise_for_status()
        found = r.json().get("data") or []
        if found:
            r = client.patch(f"{base}/{found[0]['id']}", json=body)
            action = "yeniləndi"
        else:
            r = client.post(base, json=body)
            action = "yaradıldı"
        # Cavabda secret_key var: gövdəni çap etmirik.
        if r.status_code not in (200, 201):
            err = r.json().get("error") if r.headers.get("content-type", "").startswith("application/json") else r.text[:200]
            print(f"xəta {r.status_code}: {err}")
            return 1
        d = r.json().get("data") or {}
        print(f"webhook {action}: id={d.get('id')} url={d.get('url')} active={d.get('active')} hadisələr={len(d.get('events') or [])}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
