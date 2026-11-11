"""CRM testləri üçün ortaq köməkçilər: saxta HTTP (Kapso, Telegram, Gemini), webhook yükləri, baza qurğuları."""
import hmac
import json
import time
from datetime import timedelta
from hashlib import sha256

import httpx
import pytest

import test_auth  # noqa: F401  (settings/db-dən əvvəl: test bazasını və env-i qurur, əks halda dev.db silinər)
import ai
import alerts
import settings
from db import SessionLocal, now
from models import WaContact, WaConversation, WaMessage

SECRET = "kapso-secret"
TG_SECRET = "tg-secret"
CHAT = "777"


class Env:
    def __init__(self):
        self.http = []  # (url, json)
        self.alerts = []  # (key, text)
        self.kapso_error = None  # {"code": 131047, "message": "..."} verilsə Kapso xəta qaytarır
        self.gemini_calls = []
        self.gemini_queue = []
        self.n = 0

    def tg(self, method=None):
        return [j for u, j in self.http if "api.telegram.org" in u and (method is None or u.endswith("/" + method))]

    def kapso(self):
        return [(u, j) for u, j in self.http if "api.kapso.ai" in u]

    def gemini(self, *outs):
        """Növbəti Gemini cavabları: dict (JSON cavab), str (xam mətn) və ya Exception."""
        self.gemini_queue.extend(outs)


class Resp:
    def __init__(self, status, data):
        self.status_code, self._d, self.text, self.headers = status, data, json.dumps(data), {}

    def json(self):
        return self._d


@pytest.fixture(autouse=True)
def crm_env(monkeypatch):
    env = Env()
    for k, v in {"KAPSO_API_KEY": "k", "KAPSO_WEBHOOK_SECRET": SECRET, "KAPSO_PHONE_NUMBER_ID": "pn1",
                 "TG_BOT_TOKEN": "tok", "TG_CHAT_ID": CHAT, "TG_WEBHOOK_SECRET": TG_SECRET}.items():
        monkeypatch.setattr(settings, k, v)

    def fake_post(url, **kw):
        env.http.append((url, kw.get("json")))
        env.n += 1
        if "api.kapso.ai" in url:
            if env.kapso_error:
                return Resp(400, {"error": env.kapso_error})
            return Resp(200, {"messages": [{"id": f"wamid.out{env.n}"}]})
        if "api.telegram.org" in url:
            return Resp(200, {"ok": True, "result": {"message_id": 900 + env.n}})
        raise AssertionError(f"testdə real HTTP sorğusu göndərilməməlidir: {url}")

    def fake_generate(system, contents, tools=None, max_tokens=900):
        env.gemini_calls.append((system, contents))
        if not env.gemini_queue:
            raise AssertionError("gözlənilməyən Gemini sorğusu")
        out = env.gemini_queue.pop(0)
        if isinstance(out, Exception):
            raise out
        text = out if isinstance(out, str) else json.dumps(out, ensure_ascii=False)
        return {"content": {"parts": [{"text": text}]}, "usage": (10, 5)}

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(ai, "generate", fake_generate)
    monkeypatch.setattr(alerts, "notify",
                        lambda key, text: (key != "start" and env.alerts.append((key, text))) or True)  # «server başladı» sayılmır
    return env


def jreply(reply="Salam! Mən Y Pod-un virtual köməkçisiyəm. Necə kömək edə bilərəm?", **kw) -> dict:
    d = {"reply": reply, "language": "az", "handoff": False, "handoff_reason": None, "intent": "melumat",
         "lead": {"name": None, "service": None, "preferred_date": None, "people": None, "cameras": None,
                  "editing": None},
         "stage": None, "unanswered_question": None}
    lead = kw.pop("lead", None)
    d.update(kw)
    if lead:
        d["lead"] = {**d["lead"], **lead}
    return d


def sign(raw: bytes) -> str:
    return hmac.new(SECRET.encode(), raw, sha256).hexdigest()


def post_kapso(api, body, event="whatsapp.message.received", key=None, batch=False, signature=None):
    raw = json.dumps(body).encode()
    headers = {"X-Webhook-Signature": signature if signature is not None else sign(raw),
               "X-Webhook-Event": event, "Content-Type": "application/json"}
    if key:
        headers["X-Idempotency-Key"] = key
    if batch:
        headers["X-Webhook-Batch"] = "true"
    return api.post("/api/webhooks/kapso", content=raw, headers=headers)


def received(wamid, text="Salam", phone="+994501112233", conv="c1", name="Aysel", origin=None, typ="text", bsuid=None,
             extra=None, ts=None):
    msg = {"id": wamid, "timestamp": str(ts or int(time.time())), "type": typ, "text": {"body": text}}
    if origin:
        msg["kapso"] = {"origin": origin}
    msg.update(extra or {})
    conversation = {"id": conv, "contact_name": name}
    if phone:
        conversation["phone_number"] = phone
    if bsuid:
        conversation["business_scoped_user_id"] = bsuid
    return {"message": msg, "conversation": conversation, "is_new_conversation": False, "phone_number_id": "pn1"}


def mk_conv(*, phone="994501112233", name="Aysel", window=True, mode="bot", text="Salam", customer=True, bsuid=None):
    """Kontakt + söhbət + (müştərinin) son mesajı. Qaytarır: (contact_id, conv_id)."""
    with SessionLocal() as db:
        c = WaContact(phone=phone, bsuid=bsuid, name=name)
        db.add(c)
        db.flush()
        conv = WaConversation(contact_id=c.id, kapso_conversation_id=f"k{c.id}", mode=mode, last_message_at=now(),
                              last_inbound_at=now(),
                              window_expires_at=now() + timedelta(hours=2) if window else now() - timedelta(hours=1))
        db.add(conv)
        db.flush()
        db.add(WaMessage(conversation_id=conv.id, wamid=f"w{conv.id}", direction="in" if customer else "out",
                         source="customer" if customer else "bot", text=text, created_at=now()))
        db.commit()
        return c.id, conv.id
