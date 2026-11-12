from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env, jreply, mk_conv  # noqa: F401,I001

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from crm import bot, chat, conf, digest, turns, worker  # noqa: E402
from db import SessionLocal, aware, now  # noqa: E402
from models import BotDraft, WaConversation, WaMessage  # noqa: E402

BAKU = timezone(timedelta(hours=4))
DAY = datetime(2026, 11, 13, 15, 0, tzinfo=BAKU)
NIGHT = datetime(2026, 11, 13, 23, 30, tzinfo=BAKU)


@pytest.fixture(autouse=True)
def no_digest(monkeypatch):
    monkeypatch.setattr(worker.digest, "due", lambda db, t: False)


@pytest.fixture()
def auto(api, crm_env):  # noqa: F811
    with SessionLocal() as db:
        conf.put(db, "bot_mode", "auto")
        db.commit()
    return crm_env


def day(monkeypatch):
    monkeypatch.setattr(turns, "is_night", lambda t: False)


def night(monkeypatch):
    monkeypatch.setattr(turns, "is_night", lambda t: True)


def draft():
    with SessionLocal() as db:
        return db.scalar(select(BotDraft).order_by(BotDraft.id.desc()))


def mode(conv_id):
    with SessionLocal() as db:
        return db.get(WaConversation, conv_id).mode


def test_is_night_baku_hours():
    assert turns.is_night(datetime(2026, 11, 13, 22, 0, tzinfo=BAKU))
    assert turns.is_night(datetime(2026, 11, 13, 7, 59, tzinfo=BAKU))
    assert not turns.is_night(datetime(2026, 11, 13, 8, 0, tzinfo=BAKU))
    assert not turns.is_night(datetime(2026, 11, 13, 21, 59, tzinfo=BAKU))


def test_parse_reply_asan_never_with_handoff():
    assert bot.parse_reply('{"reply":"70 AZN","handoff":false,"asan":true}')["asan"] is True
    assert bot.parse_reply('{"reply":"ötürdüm","handoff":true,"asan":true}')["asan"] is False
    assert bot.parse_reply('{"reply":"x","handoff":false}')["asan"] is False


def test_bot_mode_sends_immediately(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(text="Qiymət nədir?")
    auto.gemini(jreply("1 saat 70 AZN-dir."))
    assert bot.handle(conv_id) == "sent"
    assert len(auto.kapso()) == 1


def test_owner_mode_daytime_draft_with_one_hour_timer(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(text="Sabah saat 3 boşdur?", mode="owner")
    auto.gemini(jreply("Bəli, boşdur.", asan=True))
    assert bot.handle(conv_id) == "draft"
    assert auto.kapso() == []
    d = draft()
    assert timedelta(minutes=59) < aware(d.auto_at) - now() <= timedelta(hours=1)
    assert "1 saat ərzində toxunmasanız" in auto.tg("sendMessage")[-1]["text"]
    assert mode(conv_id) == "owner"


@pytest.mark.parametrize("asan,sent", [(True, True), (False, False)])
def test_owner_mode_night_only_easy_goes(auto, monkeypatch, asan, sent):
    night(monkeypatch)
    _, conv_id = mk_conv(text="Ünvan haradır?", mode="owner")
    auto.gemini(jreply("Zaur Nudirəliyev 34A.", asan=asan))
    assert bot.handle(conv_id) == ("sent" if sent else "draft")
    assert len(auto.kapso()) == (1 if sent else 0)
    if not sent:
        assert draft().auto_at is None
        assert "Siz baxana qədər gözləyir" in auto.tg("sendMessage")[-1]["text"]


@pytest.mark.parametrize("asan", [True, False])
def test_wait_mode_easy_answered_hard_waits(auto, monkeypatch, asan):
    day(monkeypatch)
    _, conv_id = mk_conv(text="Neçəyədir?", mode="wait")
    auto.gemini(jreply("70 AZN.", asan=asan))
    assert bot.handle(conv_id) == ("sent" if asan else "draft")
    if not asan:
        assert draft().auto_at is None


def test_handoff_moves_to_wait_and_keeps_answering(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(text="Endirim olar?")
    auto.gemini(jreply("Komandamıza ötürdüm, əməkdaşımız yazacaq.", handoff=True, handoff_reason="endirim"))
    assert bot.handle(conv_id) == "handoff:endirim"
    assert mode(conv_id) == "wait"
    with SessionLocal() as db:
        assert conf.get(db, f"wait_since:{conv_id}")
        db.add(WaMessage(conversation_id=conv_id, wamid="w-next", direction="in", source="customer",
                         text="Ünvan haradır?", created_at=now()))
        db.commit()
    auto.gemini(jreply("Zaur Nudirəliyev 34A.", asan=True))
    assert bot.handle(conv_id) == "sent"  # bot susmur, asan suala cavab verir


def test_owner_writes_from_panel_takes_turn(auto, api):  # noqa: F811
    _, conv_id = mk_conv()
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="köhnə qaralama"))
        db.commit()
    r = api.post(f"/api/admin/inbox/{conv_id}/send", json={"text": "Salam, buyurun"}, headers=bearer(admin_token(api)))
    assert r.status_code == 200, r.text
    assert mode(conv_id) == "owner"
    assert draft().status == "rejected"


def test_approved_draft_returns_turn_to_bot(auto):
    _, conv_id = mk_conv(mode="wait")
    with SessionLocal() as db:
        conf.put(db, f"wait_since:{conv_id}", DAY.isoformat())
        d = BotDraft(conversation_id=conv_id, text="Cavab")
        db.add(d)
        db.commit()
        chat.decide_draft(db, d, "send")
        db.commit()
        assert conf.get(db, f"wait_since:{conv_id}") == ""
    assert mode(conv_id) == "bot"


def test_rejected_draft_keeps_turn(auto):
    _, conv_id = mk_conv(mode="owner")
    with SessionLocal() as db:
        d = BotDraft(conversation_id=conv_id, text="Cavab")
        db.add(d)
        db.commit()
        chat.decide_draft(db, d, "reject")
        db.commit()
    assert mode(conv_id) == "owner"


def _due_draft(conv_id, asan=False, created=None):
    with SessionLocal() as db:
        d = BotDraft(conversation_id=conv_id, text="Bəli, boşdur.", model_output={"asan": asan},
                     auto_at=now() - timedelta(minutes=1), created_at=created or now() - timedelta(hours=1))
        db.add(d)
        db.commit()
        return d.id


def test_auto_send_after_hour_keeps_owner_turn(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(mode="owner")
    did = _due_draft(conv_id)
    with SessionLocal() as db:
        assert turns.auto_send_due(db, now()) == 1
        d = db.get(BotDraft, did)
        assert d.status == "auto" and d.auto_at is None
    assert len(auto.kapso()) == 1
    assert mode(conv_id) == "owner"


def test_auto_send_skipped_if_owner_wrote_meanwhile(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(mode="owner")
    did = _due_draft(conv_id)
    with SessionLocal() as db:
        db.add(WaMessage(conversation_id=conv_id, wamid="w-own", direction="out", source="phone", text="Salam",
                         created_at=now() - timedelta(minutes=5)))
        db.commit()
        assert turns.auto_send_due(db, now()) == 0
        d = db.get(BotDraft, did)
        assert d.status == "pending" and d.auto_at is None
    assert auto.kapso() == []


@pytest.mark.parametrize("asan,n", [(True, 1), (False, 0)])
def test_auto_send_at_night_only_easy(auto, monkeypatch, asan, n):
    night(monkeypatch)
    _, conv_id = mk_conv(mode="owner")
    _due_draft(conv_id, asan=asan)
    with SessionLocal() as db:
        assert turns.auto_send_due(db, now()) == n
    assert len(auto.kapso()) == n


def test_wait_reminder_once_after_30_min(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(mode="wait")
    with SessionLocal() as db:
        conf.put(db, f"wait_since:{conv_id}", (DAY - timedelta(minutes=31)).isoformat())
        db.commit()
        assert turns.remind_waiting(db, DAY - timedelta(minutes=10)) == 0  # hələ 30 dəqiqə olmayıb
        assert turns.remind_waiting(db, DAY) == 1
        assert turns.remind_waiting(db, DAY + timedelta(minutes=30)) == 0
    assert "cavab gözləyir" in auto.tg("sendMessage")[-1]["text"]


def test_wait_reminder_not_at_night(auto, monkeypatch):
    night(monkeypatch)
    _, conv_id = mk_conv(mode="wait")
    with SessionLocal() as db:
        conf.put(db, f"wait_since:{conv_id}", (NIGHT - timedelta(hours=2)).isoformat())
        db.commit()
        assert turns.remind_waiting(db, NIGHT) == 0


def test_noon_reminder_lists_night_drafts_once(auto):
    _, conv_id = mk_conv(mode="owner")
    noon = datetime(2026, 11, 13, 12, 5, tzinfo=BAKU)
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="Gecə qaralaması", created_at=noon - timedelta(hours=10)))
        db.commit()
        assert turns.noon_reminder(db, noon - timedelta(hours=1)) == 0  # 12:00-dan əvvəl
        assert turns.noon_reminder(db, noon) == 1
        assert turns.noon_reminder(db, noon + timedelta(hours=2)) == 0
    assert "Gecədən qalan" in auto.tg("sendMessage")[-1]["text"]


def test_digest_lists_waiting(auto):
    _, conv_id = mk_conv(mode="wait", name="Gözləyən")
    with SessionLocal() as db:
        text = digest.build(db, now() - timedelta(days=1), now() + timedelta(minutes=1))
    assert "sizin cavabınızı gözləyən" in text and "Gözləyən" in text
