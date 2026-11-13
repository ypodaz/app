from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env, jreply, mk_conv  # noqa: F401,I001

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from crm import bot, digest, worker  # noqa: E402
from db import SessionLocal, aware, now  # noqa: E402
from models import Lead, LeadEvent, WaConversation  # noqa: E402

BAKU = timezone(timedelta(hours=4))


@pytest.fixture(autouse=True)
def no_digest(monkeypatch):
    monkeypatch.setattr(worker.digest, "due", lambda db, t: False)


def _lead(stage="maraqlanir", name="Test Müştəri", **kw):
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        lead = Lead(contact_id=cid, name=name, phone="994501112233", stage=stage, **kw)
        db.add(lead)
        db.flush()
        db.get(WaConversation, conv_id).lead_id = lead.id
        db.commit()
        return lead.id, conv_id


def _get(lid):
    with SessionLocal() as db:
        return db.get(Lead, lid)


def _events(lid):
    with SessionLocal() as db:
        return db.scalars(select(LeadEvent).where(LeadEvent.lead_id == lid).order_by(LeadEvent.id)).all()


def test_lost_requires_reason_and_stores_then_clears(api):
    adm = bearer(admin_token(api))
    lid, _ = _lead()
    r = api.patch(f"/api/admin/leads/{lid}", json={"stage": "itirildi"}, headers=adm)
    assert r.status_code == 422 and "səbəb" in r.json()["detail"] and _get(lid).stage == "maraqlanir"
    assert api.patch(f"/api/admin/leads/{lid}", json={"stage": "itirildi", "lost_reason": "yox"},
                     headers=adm).status_code == 422
    r = api.patch(f"/api/admin/leads/{lid}", json={"stage": "itirildi", "lost_reason": "diger", "lost_text": "  xaricə köçdü "},
                  headers=adm)
    assert r.status_code == 200 and r.json()["lost_reason"] == "diger" and r.json()["lost_text"] == "xaricə köçdü"
    ev = [e for e in _events(lid) if e.kind == "stage"][-1].data
    assert ev["to"] == "itirildi" and ev["lost_reason"] == "diger" and ev["lost_text"] == "xaricə köçdü"
    # səbəb dəyişir, mətn yalnız «diger»də qalır
    r = api.patch(f"/api/admin/leads/{lid}", json={"lost_reason": "qiymet"}, headers=adm)
    assert r.json()["lost_reason"] == "qiymet" and r.json()["lost_text"] is None
    # çıxanda silinir
    r = api.patch(f"/api/admin/leads/{lid}", json={"stage": "tarix"}, headers=adm)
    assert r.json()["stage"] == "tarix" and r.json()["lost_reason"] is None and r.json()["lost_text"] is None


def test_remind_at_set_and_clear_via_api(api):
    adm = bearer(admin_token(api))
    lid, _ = _lead()
    at = (now() + timedelta(days=2)).replace(microsecond=0)
    r = api.patch(f"/api/admin/leads/{lid}", json={"remind_at": at.isoformat(), "remind_note": "deposit"}, headers=adm)
    assert r.status_code == 200 and r.json()["remind_note"] == "deposit" and r.json()["remind_at"]
    assert aware(_get(lid).remind_at) == at
    r = api.patch(f"/api/admin/leads/{lid}", json={"remind_at": None}, headers=adm)
    assert r.json()["remind_at"] is None and r.json()["remind_note"] is None


def test_bot_remind_at_keeps_stage_and_never_loses(api, crm_env):
    _, conv_id = mk_conv()
    day = (aware(now()).astimezone(BAKU) + timedelta(days=1)).date()
    crm_env.gemini(jreply(stage="itirildi", remind_at=day.isoformat(), lead={"name": "Aysel"}))
    bot.handle(conv_id)
    with SessionLocal() as db:
        lid = db.scalar(select(Lead.id))
    lead = _get(lid)
    assert lead.stage == "yeni" and aware(lead.remind_at) == datetime(day.year, day.month, day.day, 9, tzinfo=BAKU)
    assert "remind" in [e.kind for e in _events(lid)]
    # model şablonu və ya yoxluq None verir
    assert bot.parse_reply('{"reply":"x","handoff":false,"remind_at":"YYYY-MM-DD|null"}')["remind_at"] is None
    assert bot.parse_reply('{"reply":"x","handoff":false}')["remind_at"] is None


def test_bot_remind_ignored_on_past_date(api, crm_env):
    _, conv_id = mk_conv()
    crm_env.gemini(jreply(remind_at="2020-01-01"))
    bot.handle(conv_id)
    with SessionLocal() as db:
        assert db.scalar(select(Lead.remind_at)) is None


def test_reminder_sends_once_and_clears(api, crm_env):
    at = datetime(2026, 11, 13, 9, 0, tzinfo=BAKU)
    lid, _ = _lead(remind_at=at, remind_note="beh məsələsi")
    with SessionLocal() as db:
        assert worker.send_reminders(db, at - timedelta(minutes=1)) == 0
        assert worker.send_reminders(db, at + timedelta(minutes=1)) == 1
        assert worker.send_reminders(db, at + timedelta(hours=1)) == 0
    sent = crm_env.tg("sendMessage")
    assert len(sent) == 1 and sent[0]["text"] == "🔔 Test Müştəri 13.11 yazacağını demişdi · beh məsələsi"
    assert "wa.me/994501112233" in sent[0]["reply_markup"]["inline_keyboard"][0][0]["url"]
    assert _get(lid).remind_at is None and _get(lid).remind_note is None


def test_reminder_night_waits_until_0800(api, crm_env):
    _lead(remind_at=datetime(2026, 11, 13, 22, 30, tzinfo=BAKU))
    with SessionLocal() as db:
        assert worker.send_reminders(db, datetime(2026, 11, 13, 23, 0, tzinfo=BAKU)) == 0
        assert worker.send_reminders(db, datetime(2026, 11, 14, 7, 59, tzinfo=BAKU)) == 0
        assert worker.send_reminders(db, datetime(2026, 11, 14, 8, 0, tzinfo=BAKU)) == 1
    assert len(crm_env.tg("sendMessage")) == 1


def test_followup_skipped_while_remind_in_future(api, crm_env):
    from test_crm_bot import _followup_setup
    conv_id = _followup_setup()
    with SessionLocal() as db:
        lead = db.get(Lead, db.get(WaConversation, conv_id).lead_id)
        lead.remind_at = now() + timedelta(days=1)
        db.commit()
        assert worker.due_conversations(db) == []
        lead.remind_at = now() - timedelta(minutes=1)  # vaxtı keçib: adi follow-up qaydası qayıdır
        db.commit()
        assert [c.id for c in worker.due_conversations(db)] == [conv_id]


def test_digest_lead_lines(api):
    day = datetime(2026, 11, 13, tzinfo=BAKU)
    until = day + timedelta(hours=21)
    lid, _ = _lead(remind_at=day + timedelta(hours=9))
    with SessionLocal() as db:
        db.add(LeadEvent(lead_id=lid, kind="stage", data={"to": "itirildi", "lost_reason": "qiymet"},
                         created_at=day + timedelta(hours=5)))
        db.add(LeadEvent(lead_id=lid, kind="stage", data={"to": "itirildi", "lost_reason": "vaxt"},
                         created_at=day - timedelta(days=3)))
        db.add(LeadEvent(lead_id=lid, kind="stage", data={"to": "itirildi", "lost_reason": "vaxt"},
                         created_at=day - timedelta(days=9)))  # həftədən köhnə
        db.commit()
        text = digest.build(db, day, until)
    assert "🔔 Bu gün yazacağını demiş müştəri: 1" in text
    assert "Son 7 gündə itirilən: 2 (qiymət 1, vaxt 1)" in text
    with SessionLocal() as db:
        db.query(LeadEvent).delete()
        db.query(Lead).update({Lead.remind_at: None})
        db.commit()
        text = digest.build(db, day, until)
    assert not text or ("🔔" not in text and "itirilən" not in text)  # boş hesabat None qaytarır
