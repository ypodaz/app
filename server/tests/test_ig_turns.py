from test_social_inbox import auto_mode, callback, dm, echo, items, net, post_ig  # noqa: F401,I001
from test_auth import api  # noqa: F401,I001
from crm_helpers import crm_env, jreply  # noqa: F401,I001

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402

from crm import conf, ig_turns, social_inbox, turns  # noqa: E402
from db import SessionLocal, aware, now  # noqa: E402
from models import SocialItem  # noqa: E402

BAKU = timezone(timedelta(hours=4))
DAY = datetime(2026, 11, 13, 15, 0, tzinfo=BAKU)


def day(monkeypatch):
    monkeypatch.setattr(turns, "is_night", lambda t: False)


def night(monkeypatch):
    monkeypatch.setattr(turns, "is_night", lambda t: True)


def mode(thread="555"):
    with SessionLocal() as db:
        return social_inbox.ig_mode(db, thread)


def owner_mode(api, monkeypatch):
    monkeypatch.setattr(social_inbox, "ECHO_WAIT", 0)
    post_ig(api, echo("app1"))  # sahibkar app-dan yazdı
    assert mode() == "owner"


def graph_sends(net):
    return [c for c in net.calls if c[1].endswith("/me/messages")]


def test_echo_puts_thread_in_owner_mode_and_draft_has_timer(api, net, crm_env, monkeypatch):
    day(monkeypatch)
    auto_mode()
    owner_mode(api, monkeypatch)
    crm_env.gemini(jreply("Salam, buyurun."))
    post_ig(api, dm(mid="m1", text="Saat neçədə açıqsınız?"))
    [it] = items()
    assert it.status == "pending" and not graph_sends(net)
    assert timedelta(minutes=59) < aware(it.auto_at) - now() <= timedelta(hours=1)
    assert "dəq sonra bot özü göndərəcək" in crm_env.tg("sendMessage")[-1]["text"]
    assert mode() == "owner"  # 7 gün susma yoxdur, növbə sahibkardadır


def test_draft_auto_sent_after_hour_by_day(api, net, crm_env, monkeypatch):
    day(monkeypatch)
    auto_mode()
    owner_mode(api, monkeypatch)
    crm_env.gemini(jreply("Salam, buyurun."))
    post_ig(api, dm(mid="m1"))
    with SessionLocal() as db:
        assert ig_turns.auto_send_due(db, now()) == 0  # hələ 1 saat olmayıb
        assert ig_turns.auto_send_due(db, now() + timedelta(hours=1, minutes=1)) == 1
    [it] = items()
    assert it.status == "sent" and it.auto_at is None and len(graph_sends(net)) == 1
    assert mode() == "owner"  # bot özü göndərəndə növbə sahibkarda qalır
    assert "1 saat toxunulmadı" in crm_env.tg("editMessageText")[-1]["text"]


def test_auto_send_skipped_if_owner_wrote_again(api, net, crm_env, monkeypatch):
    day(monkeypatch)
    auto_mode()
    owner_mode(api, monkeypatch)
    crm_env.gemini(jreply("Salam, buyurun."))
    post_ig(api, dm(mid="m1"))
    post_ig(api, echo("app2"))
    with SessionLocal() as db:
        assert ig_turns.auto_send_due(db, now() + timedelta(hours=2)) == 0
    [it] = items()
    assert it.status == "pending" and it.auto_at is None and not graph_sends(net)


@pytest.mark.parametrize("asan,sent", [(True, True), (False, False)])
def test_night_only_easy_answers_go(api, net, crm_env, monkeypatch, asan, sent):
    night(monkeypatch)
    auto_mode()
    owner_mode(api, monkeypatch)
    crm_env.gemini(jreply("Ünvan: Nümunə küçəsi 1.", asan=asan))
    post_ig(api, dm(mid="m1", text="Ünvan haradır?"))
    [it] = items()
    assert (it.status == "sent") is sent and len(graph_sends(net)) == (1 if sent else 0)
    if not sent:
        assert it.auto_at is None
        assert "Siz baxana qədər gözləyir" in crm_env.tg("sendMessage")[-1]["text"]


def test_noon_reminder_lists_night_drafts_once(api, net, crm_env, monkeypatch):
    night(monkeypatch)
    auto_mode()
    owner_mode(api, monkeypatch)
    crm_env.gemini(jreply("Cavab."))
    post_ig(api, dm(mid="m1"))
    noon = datetime(2026, 11, 13, 12, 5, tzinfo=BAKU)
    with SessionLocal() as db:
        db.get(SocialItem, items()[0].id).created_at = noon - timedelta(hours=10)
        db.commit()
        assert ig_turns.noon_reminder(db, noon - timedelta(hours=1)) == 0
        assert ig_turns.noon_reminder(db, noon) == 1
        assert ig_turns.noon_reminder(db, noon + timedelta(hours=1)) == 0
    assert "Gecədən qalan" in crm_env.tg("sendMessage")[-1]["text"]


def test_handoff_goes_to_wait_with_single_reminder(api, net, crm_env, monkeypatch):
    day(monkeypatch)
    auto_mode()
    crm_env.gemini(jreply("Komandaya ötürürəm.", handoff=True, handoff_reason="endirim"),
                   jreply("Hard sual.", asan=False), jreply("70 AZN.", asan=True))
    post_ig(api, dm(mid="m1", text="Endirim olar?"))
    assert mode() == "wait" and items()[0].status == "sent"
    with SessionLocal() as db:
        since = datetime.fromisoformat(conf.get(db, "ig_wait:555"))
        assert ig_turns.remind_waiting(db, since + timedelta(minutes=10)) == 0
        assert ig_turns.remind_waiting(db, since + timedelta(minutes=31)) == 1
        assert ig_turns.remind_waiting(db, since + timedelta(hours=2)) == 0  # yalnız bir dəfə
    assert "cavab gözləyir" in crm_env.tg("sendMessage")[-1]["text"]
    post_ig(api, dm(mid="m2", text="Montaj da var?"))  # çətin: qaralama, avtomatik getmir
    hard = items()[1]
    assert hard.status == "pending" and hard.auto_at is None
    assert "Komandaya ötürülüb" in crm_env.tg("sendMessage")[-1]["text"]
    post_ig(api, dm(mid="m3", text="Qiyməti?"))  # asan: bot cavab verir
    assert items()[2].status == "sent"
    assert mode() == "wait"


def test_wait_reminder_not_at_night(api, net, crm_env, monkeypatch):
    night(monkeypatch)
    with SessionLocal() as db:
        social_inbox.to_wait(db, "555", DAY - timedelta(hours=2))
        db.commit()
        assert ig_turns.remind_waiting(db, DAY) == 0


def test_approve_returns_turn_to_bot(api, net, crm_env, monkeypatch):
    day(monkeypatch)
    auto_mode()
    owner_mode(api, monkeypatch)
    crm_env.gemini(jreply("Salam, buyurun."))
    post_ig(api, dm(mid="m1"))
    [it] = items()
    assert callback(api, f"x:{it.id}:s").status_code == 200
    assert items()[0].status == "sent" and mode() == "bot"


def test_new_auto_old_customer_stays_draft_only(api, net, crm_env, monkeypatch):
    day(monkeypatch)
    with SessionLocal() as db:
        conf.put(db, "ig_dm_mode", "new_auto")
        conf.put(db, "ig_new:555", "0")  # köhnə yazışan
        db.commit()
    crm_env.gemini(jreply("70 AZN.", asan=True))
    post_ig(api, dm(mid="m1", text="Qiymət?"))
    [it] = items()
    assert it.status == "pending" and it.auto_at is None and not graph_sends(net)
    assert "dəq sonra" not in crm_env.tg("sendMessage")[-1]["text"]


def test_legacy_ig_human_counts_as_owner(api):
    # 2026-11-13-dən əvvəl 7 günlük susmada olan söhbət deploydan sonra sahibkarda qalır, köhnəsi bota qayıdır
    with SessionLocal() as db:
        conf.put(db, "ig_human:T-legacy-1", (now() - timedelta(days=2)).isoformat())
        conf.put(db, "ig_human:T-legacy-2", (now() - timedelta(days=9)).isoformat())
        db.commit()
        assert social_inbox.ig_mode(db, "T-legacy-1") == "owner"
        assert social_inbox.ig_mode(db, "T-legacy-2") == "bot"
        social_inbox.draft_approved(db, "T-legacy-1")
        assert social_inbox.ig_mode(db, "T-legacy-1") == "bot"
