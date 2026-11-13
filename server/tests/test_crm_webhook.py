from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env, mk_conv, post_kapso, received  # noqa: F401,I001

import time  # noqa: E402
from datetime import timedelta  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

import settings  # noqa: E402
from crm import bot, kapso  # noqa: E402
from db import SessionLocal, aware, now
from models import BotDraft, KnownContact, WaContact, WaConversation, WaMessage, WebhookEvent


@pytest.fixture()
def handled(monkeypatch):
    calls = []
    monkeypatch.setattr(bot, "handle", lambda cid: calls.append(cid))
    return calls


def rows(model):
    with SessionLocal() as db:
        return db.scalars(select(model).order_by(model.id)).all()


def test_signature_valid_wrong_missing_and_empty_secret(api, handled, monkeypatch):
    body = received("w1")
    assert post_kapso(api, body).status_code == 200
    assert post_kapso(api, body, signature="0" * 64).status_code == 401
    assert post_kapso(api, body, signature="").status_code == 401
    assert kapso.verify_signature(b"x", None) is False
    monkeypatch.setattr(settings, "KAPSO_WEBHOOK_SECRET", "")
    assert post_kapso(api, body).status_code == 503


def test_idempotency_same_key_and_same_body(api, handled):
    body = received("w1")
    assert post_kapso(api, body, key="abc").status_code == 200
    assert post_kapso(api, received("w1"), key="abc").status_code == 200
    assert len(rows(WaMessage)) == 1 and handled == [rows(WaConversation)[0].id]
    # açar yoxdursa gövdənin sha256-sı: eyni gövdə ikinci dəfə atılır
    assert post_kapso(api, received("w2")).status_code == 200
    assert post_kapso(api, received("w2")).status_code == 200
    assert len(rows(WaMessage)) == 2 and len(rows(WebhookEvent)) == 2
    with SessionLocal() as db:
        assert kapso.month_count(db) == 2  # təkrar sayğaca düşmür


def test_duplicate_wamid_with_new_key_is_skipped(api, handled):
    post_kapso(api, received("w1"), key="a")
    post_kapso(api, received("w1"), key="b")
    assert len(rows(WaMessage)) == 1 and len(handled) == 1


def test_batch_three_messages_one_bot_run(api, handled):
    evs = [received(f"w{i}", text=f"mesaj {i}") for i in range(3)]
    r = post_kapso(api, {"batch": True, "data": evs})
    assert r.status_code == 200
    assert len(rows(WaMessage)) == 3 and len(handled) == 1
    assert rows(WaConversation)[0].unread == 3
    # header ilə də batch
    r = post_kapso(api, {"data": [received("w9")]}, batch=True, key="zz")
    assert r.status_code == 200 and len(rows(WaMessage)) == 4


def test_history_sync_no_bot_no_counter_no_window(api, handled):
    post_kapso(api, received("w1", origin="history_sync", ts=int(time.time()) - 86400 * 30))
    m = rows(WaMessage)[0]
    assert m.source == "history" and handled == []
    conv = rows(WaConversation)[0]
    assert conv.window_expires_at is None and conv.unread == 0
    with SessionLocal() as db:
        assert kapso.month_count(db) == 0


def test_history_sync_outbound_kept_as_ours(api, handled):
    post_kapso(api, received("w1", origin="history_sync", extra={"kapso": {"origin": "history_sync", "direction": "outbound"}}))
    m = rows(WaMessage)[0]
    assert m.direction == "out" and m.source == "history" and handled == []


def test_customer_message_sets_window_unread_and_counter(api, handled):
    t = int(time.time())
    post_kapso(api, received("w1", ts=t))
    conv = rows(WaConversation)[0]
    assert aware(conv.window_expires_at) == aware(conv.last_inbound_at) + timedelta(hours=24)
    assert conv.unread == 1 and rows(WaMessage)[0].source == "customer"
    assert rows(WaContact)[0].name == "Aysel" and rows(WaContact)[0].phone == "994501112233"
    with SessionLocal() as db:
        assert kapso.month_count(db) == 1


def test_business_app_sent_hands_turn_to_owner_and_rejects_drafts(api, handled):
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="qaralama"))
        db.commit()
    ev = received("w-phone", text="Salam, buyurun", conv=f"k{cid}")
    ev["message"]["kapso"] = {"origin": "business_app"}
    assert post_kapso(api, ev, event="whatsapp.message.sent").status_code == 200
    with SessionLocal() as db:
        m = db.scalar(select(WaMessage).where(WaMessage.wamid == "w-phone"))
        assert m.direction == "out" and m.source == "phone"
        assert db.get(WaContact, cid).bot_muted_until is None  # 12 saatlıq susdurma yoxdur
        assert db.get(WaConversation, conv_id).mode == "owner"
        d = db.scalar(select(BotDraft))
        assert d.status == "rejected" and d.reason == "sahibkar özü yazdı"
    assert handled == []


def test_cloud_api_sent_only_updates_status(api, handled):
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        db.add(WaMessage(conversation_id=conv_id, wamid="wo1", direction="out", source="bot", text="x", status=None))
        db.commit()
    ev = received("wo1", conv=f"k{cid}")
    ev["message"]["kapso"] = {"origin": "cloud_api"}
    post_kapso(api, ev, event="whatsapp.message.sent")
    with SessionLocal() as db:
        assert db.scalar(select(WaMessage).where(WaMessage.wamid == "wo1")).status == "sent"
        assert db.scalar(select(WaMessage.id).where(WaMessage.source == "phone")) is None
        assert db.get(WaContact, cid).bot_muted_until is None


def test_status_events_and_failed_alert(api, handled, crm_env):
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        db.add(WaMessage(conversation_id=conv_id, wamid="wo1", direction="out", source="bot", text="x", status="sent"))
        db.commit()
    ev = received("wo1", conv=f"k{cid}")
    post_kapso(api, ev, event="whatsapp.message.read", key="1")
    post_kapso(api, ev, event="whatsapp.message.delivered", key="2")  # read-dən geri getmir
    with SessionLocal() as db:
        assert db.scalar(select(WaMessage).where(WaMessage.wamid == "wo1")).status == "read"
    ev["message"]["errors"] = [{"code": 131047, "message": "Re-engagement message"}]
    post_kapso(api, ev, event="whatsapp.message.failed", key="3")
    with SessionLocal() as db:
        m = db.scalar(select(WaMessage).where(WaMessage.wamid == "wo1"))
        assert m.status == "failed" and m.raw["error"]["code"] == "131047"
    assert any("24 saat keçib, şablon lazımdır" in t for _, t in crm_env.alerts)
    ev["message"]["errors"] = [{"code": 1, "message": "başqa xəta"}]
    post_kapso(api, ev, event="whatsapp.message.failed", key="4")
    assert any("başqa xəta" in t for _, t in crm_env.alerts)


def test_bsuid_contact_without_phone_and_recipient_send(api, handled, crm_env):
    post_kapso(api, received("w1", phone=None, bsuid="BS.123", conv="cb"))
    with SessionLocal() as db:
        c = db.scalar(select(WaContact))
        assert c.phone is None and c.bsuid == "BS.123"
    conv_id = rows(WaConversation)[0].id
    r = api.post(f"/api/admin/inbox/{conv_id}/send", json={"text": "Salam"}, headers=bearer(admin_token(api)))
    assert r.status_code == 200
    (_, body), = crm_env.kapso()
    assert body["recipient"] == "BS.123" and "to" not in body and body["messaging_product"] == "whatsapp"


def test_empty_profile_name_uses_known_customer_name(api, handled):
    with SessionLocal() as db:
        db.add(KnownContact(phone="994501112233", kind="customer", first_name="Nümunə", full_name="Nümunə Müştəriyeva"))
        db.add(KnownContact(phone="994551112233", kind="personal"))
        db.commit()
    post_kapso(api, received("w1", name=""))
    post_kapso(api, received("w2", name="", phone="+994551112233", conv="c2"))
    post_kapso(api, received("w3", name="Profil Adı", phone="+994701112233", conv="c3"))
    assert [c.name for c in rows(WaContact)] == ["Nümunə Müştəriyeva", "", "Profil Adı"]


def test_identity_changed_updates_phone(api, handled):
    post_kapso(api, received("w1", phone=None, bsuid="BS.1", conv="cb"))
    post_kapso(api, {"contact": {"business_scoped_user_id": "BS.1", "phone_number": "+994559998877"}},
               event="whatsapp.contact.identity_changed")
    with SessionLocal() as db:
        assert db.scalar(select(WaContact)).phone == "994559998877"


def test_audio_transcript_and_media_labels(api, handled):
    ev = received("wa", typ="audio", extra={"audio": {"id": "m1"}})
    ev["message"].pop("text")
    ev["message"]["kapso"] = {"transcript": {"text": "üç kamera neçəyə olar"}, "media_url": "https://x/a.ogg"}
    post_kapso(api, ev, key="1")
    img = received("wi", typ="image", extra={"image": {"caption": "bax"}})
    img["message"].pop("text")
    post_kapso(api, img, key="2")
    doc = received("wd", typ="document")
    doc["message"].pop("text")
    post_kapso(api, doc, key="3")
    sticker = received("ws", typ="sticker")
    sticker["message"].pop("text")
    post_kapso(api, sticker, key="4")
    texts = {m.wamid: m for m in rows(WaMessage)}
    assert texts["wa"].text == "üç kamera neçəyə olar" and texts["wa"].transcript == "üç kamera neçəyə olar"
    assert texts["wa"].media_url == "https://x/a.ogg"
    assert texts["wi"].text == "[şəkil] bax" and texts["wd"].text == "[sənəd]" and texts["ws"].text == "[sticker]"


def test_other_events_only_logged(api, handled):
    assert post_kapso(api, {"conversation": {"id": "c1"}}, event="whatsapp.conversation.created").status_code == 200
    assert rows(WaMessage) == [] and handled == []


def test_event_error_logged_alerted_and_not_retried(api, handled, monkeypatch, crm_env):
    """Bir hadisədə proqram xətası: 200 qaytarılır (Kapso sonsuz təkrar edib webhook-u dayandırmasın), alert gedir."""
    from routes import webhooks
    sent = []
    monkeypatch.setattr(webhooks.alerts, "notify", lambda key, text, topic="server": sent.append(key))

    def boom(*a, **k):
        raise RuntimeError("x")

    monkeypatch.setattr(webhooks, "on_received", boom)
    assert post_kapso(api, received("w1"), key="k1").status_code == 200
    assert len(rows(WebhookEvent)) == 1 and rows(WaMessage) == []
    assert "kapso-event-error" in sent


def test_commit_error_returns_500_and_key_not_saved(api, handled, monkeypatch):
    from sqlalchemy.orm import Session
    from fastapi.testclient import TestClient
    from main import app

    def bad_commit(self):
        raise RuntimeError("baza yoxdur")

    with TestClient(app, raise_server_exceptions=False) as quiet:
        monkeypatch.setattr(Session, "commit", bad_commit)
        assert post_kapso(quiet, received("w1"), key="k1").status_code == 500
        monkeypatch.undo()
    assert rows(WebhookEvent) == []


def test_webhook_returns_200_even_if_gemini_fails(api, crm_env):
    from ai import AiError
    crm_env.gemini(AiError("AI cavab vermədi"))
    assert post_kapso(api, received("w1")).status_code == 200  # bot fonda işləyir və xətanı özü tutur
    assert rows(WaConversation)[0].mode == "human"
    assert any(k == "bot-ai-down" for k, _ in crm_env.alerts)


def test_bad_batch_item_does_not_fail_whole_batch(api, handled, monkeypatch):
    import routes.webhooks as wh
    orig = wh.on_received

    def boom(db, ev, bot_convs):
        if ev["message"]["id"] == "bad":
            raise RuntimeError("xarab")
        return orig(db, ev, bot_convs)
    monkeypatch.setattr(wh, "on_received", boom)
    body = {"type": "whatsapp.message.received", "batch": True,
            "data": [received("w1"), "zibil", received("bad"), received("w2")]}
    r = post_kapso(api, body, batch=True, key="b1")
    assert r.status_code == 200
    assert sorted(m.wamid for m in rows(WaMessage)) == ["w1", "w2"]
    assert len(handled) == 1
    # eyni açar təkrar gəlsə, heç nə dəyişmir
    assert post_kapso(api, body, batch=True, key="b1").status_code == 200
    assert len(rows(WaMessage)) == 2
