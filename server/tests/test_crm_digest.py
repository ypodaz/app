from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env, mk_conv  # noqa: F401,I001

from datetime import datetime, timedelta, timezone  # noqa: E402

from crm import conf, digest, worker  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import BotDraft, Lead, LeadEvent  # noqa: E402

BAKU = timezone(timedelta(hours=4))
DAY = datetime(2026, 11, 12, tzinfo=BAKU)
SINCE, UNTIL = DAY, DAY + timedelta(hours=21)


def _seed(at=DAY + timedelta(hours=10)):
    contact_id, conv_id = mk_conv(phone="994509998877", name="Gizli Ad")
    with SessionLocal() as db:
        from models import WaConversation, WaMessage
        db.get(WaConversation, conv_id).created_at = at
        for m in db.query(WaMessage).all():
            m.created_at = at
        for status, reason, text in [("sent", None, "a"), ("edited", None, "Qısa cavab"), ("rejected", None, "c"),
                                     ("pending", None, "d"), ("rejected", "handoff:rezerv", "e"),
                                     ("pending", "handoff:rezerv", "f"), ("pending", "xatırlatma", "g")]:
            db.add(BotDraft(conversation_id=conv_id, text=text, status=status, reason=reason, created_at=at,
                            model_output={"reply": "Uzun bot cavabı"} if status == "edited" else None))
        lead = Lead(contact_id=contact_id)
        db.add(lead)
        db.flush()
        db.add(LeadEvent(lead_id=lead.id, kind="stage", data={"to": "tarix"}, created_at=at))
        db.commit()


def test_build_counts_and_sample(api):
    _seed()
    with SessionLocal() as db:
        text = digest.build(db, SINCE, UNTIL)
    assert text.startswith("📊 Bot hesabatı, 12.11")
    assert "Yeni söhbət: 1" in text and "Müştəridən mesaj: 1" in text
    assert "Bot qaralamaları: 7 (göndərildi 1, dəyişdirilib göndərildi 1, rədd 2, gözləyir 3)" in text
    assert "Komandaya ötürülüb: 2 (rezerv 2)" in text and "xatırlatma 1" in text
    assert "tarix 1" in text
    assert "Bot: Uzun bot cavabı → Siz: Qısa cavab" in text
    assert "994509998877" not in text and "Gizli Ad" not in text


def test_build_none_without_activity(api):
    with SessionLocal() as db:
        assert digest.build(db, SINCE, UNTIL) is None


def test_build_ignores_out_of_range(api):
    _seed(at=DAY - timedelta(hours=5))  # dünən
    with SessionLocal() as db:
        assert digest.build(db, SINCE, UNTIL) is None


def test_due_and_send(api, crm_env):
    _seed()
    with SessionLocal() as db:
        assert not digest.due(db, DAY + timedelta(hours=20, minutes=59))
        t = DAY + timedelta(hours=21, minutes=5)
        assert digest.due(db, t)
        assert digest.send(db, t) is True
        assert not digest.due(db, t)
        assert digest.due(db, t + timedelta(days=1))
        conf.put(db, "digest_enabled", "false")
        assert not digest.due(db, t + timedelta(days=1))
    sent = crm_env.tg("sendMessage")
    assert len(sent) == 1 and sent[0]["text"].startswith("📊")


def test_send_marks_even_without_activity(api, crm_env):
    t = DAY + timedelta(hours=22)
    with SessionLocal() as db:
        assert digest.send(db, t) is False
        assert conf.get(db, "digest_last") == "2026-11-12" and not digest.due(db, t)
    assert crm_env.tg("sendMessage") == []


def test_worker_run_survives_digest_error(api, monkeypatch):
    def boom(db, t):
        raise RuntimeError("x")
    monkeypatch.setattr(digest, "due", lambda db, t: True)
    monkeypatch.setattr(digest, "send", boom)
    with SessionLocal() as db:
        assert worker.run(db) == 0
