"""«Bu gün» altlığı: bot_handled_today (crm/today_stats.py). Tərif: bu gün botun yazdığı və bu gün ötürülməyən söhbətlər."""
from test_auth import admin_token, api, bearer  # noqa: F401,I001
from crm_helpers import crm_env, mk_conv  # noqa: F401,I001

from datetime import timedelta  # noqa: E402

from crm import events  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import SocialItem, WaMessage  # noqa: E402

A = "/api/admin"


def bot_msg(conv_id, ago=timedelta(0)):
    with SessionLocal() as db:
        db.add(WaMessage(conversation_id=conv_id, direction="out", source="bot", text="Cavab", created_at=now() - ago))
        db.commit()


def ig_sent(thread, ago=timedelta(0)):
    with SessionLocal() as db:
        db.add(SocialItem(channel="instagram", kind="dm", external_id=f"m-{thread}-{ago}", thread_id=thread, text="Salam",
                          draft_text="Cavab", status="sent", decided_at=now() - ago))
        db.commit()


def count(api):
    r = api.get(f"{A}/dashboard", headers=bearer(admin_token(api)))
    assert r.status_code == 200, r.text
    return r.json()["bot_handled_today"]


def test_bot_replied_no_handoff_counted(api, crm_env):
    _, conv = mk_conv()
    bot_msg(conv)
    assert count(api) == 1


def test_handoff_today_not_counted(api, crm_env):
    _, conv = mk_conv()
    bot_msg(conv)
    with SessionLocal() as db:
        events.handoff(db, events.WA, conv, "insan")
        db.commit()
    assert count(api) == 0


def test_mode_to_owner_today_not_counted_but_back_to_bot_is(api, crm_env):
    _, a = mk_conv(phone="994501110001")
    _, b = mk_conv(phone="994501110002")
    bot_msg(a)
    bot_msg(b)
    with SessionLocal() as db:
        events.mode_changed(db, events.WA, a, "bot", "owner")
        events.mode_changed(db, events.WA, b, "owner", "bot")
        db.commit()
    assert count(api) == 1


def test_yesterday_not_counted(api, crm_env):
    _, conv = mk_conv()
    bot_msg(conv, timedelta(days=1, hours=1))
    ig_sent("ig-old", timedelta(days=1, hours=1))
    assert count(api) == 0


def test_ig_dm_counted_and_conversation_counted_once(api, crm_env):
    _, conv = mk_conv()
    bot_msg(conv)
    bot_msg(conv)
    ig_sent("ig-1")
    assert count(api) == 2
