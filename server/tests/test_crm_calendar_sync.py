from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import CHAT, TG_SECRET, crm_env  # noqa: F401,I001

from datetime import timedelta  # noqa: E402

import pytest  # noqa: E402

import settings  # noqa: E402

from auth import new_card_code  # noqa: E402
from crm import calendar_ics, calendar_sync as cs  # noqa: E402
from db import SessionLocal, aware, now  # noqa: E402
from models import Block, CalendarLink, Client, KnownContact, Notification, Shoot  # noqa: E402

H = {"X-Telegram-Bot-Api-Secret-Token": TG_SECRET}
PHONE = "994500000111"


def at(days=3, hours=0):
    return now().replace(minute=0, second=0, microsecond=0) + timedelta(days=days, hours=hours)


def ev(uid="u1", title="Testa Nümunəva 2 kamera podkast Y Pod", start=None, minutes=60, desc=""):
    start = start or at()
    return {"uid": uid, "start": start, "end": start + timedelta(minutes=minutes), "title": title, "desc": desc}


@pytest.fixture()
def cal(monkeypatch):
    state = {"events": []}
    monkeypatch.setattr(calendar_ics, "detailed", lambda a, b: state["events"])
    return state


def sync():
    with SessionLocal() as db:
        return cs.run(db)


def add_client(name="Testa Nümunəva", phone=PHONE):
    with SessionLocal() as db:
        c = Client(full_name=name, phone=phone, card_code=new_card_code())
        db.add(c)
        db.commit()
        return c.id


def shoots():
    with SessionLocal() as db:
        return db.query(Shoot).order_by(Shoot.id).all()


def cb(api, data, message_id=5):
    body = {"callback_query": {"id": "q", "data": data, "from": {"id": int(CHAT)},
                               "message": {"message_id": message_id, "chat": {"id": int(CHAT)}}}}
    return api.post("/api/webhooks/telegram", json=body, headers=H).json()["result"]


def test_recognised_creates_confirmed_shoot_once(api, crm_env, cal):
    cid = add_client()
    cal["events"] = [ev()]
    sync()
    [s] = shoots()
    assert (s.client_id, s.status, s.calendar_uid, s.source_note) == (cid, "confirmed", "u1", "calendar")
    assert s.deposit_waived and s.location == "studio" and s.cameras == 2 and s.tag == "podcast" and s.duration_min == 60
    [msg] = crm_env.tg("sendMessage")
    assert msg["text"].startswith("📅 Təqvimdən çəkiliş yaradıldı · Testa Nümunəva, ")
    assert msg["reply_markup"]["inline_keyboard"][0][0]["text"] == "↩️ Geri al"
    with SessionLocal() as db:
        assert db.query(Notification).filter_by(type="shoot_created").count() == 1
    sync()
    assert len(shoots()) == 1 and len(crm_env.tg("sendMessage")) == 1


def test_phone_in_description_creates_client(api, crm_env, cal):
    cal["events"] = [ev(title="Yeniad Soyad podkast Y Pod", desc="nömrə 050 000 01 11")]
    sync()
    [s] = shoots()
    with SessionLocal() as db:
        c = db.get(Client, s.client_id)
        assert (c.full_name, c.phone) == ("Yeniad Soyad", PHONE)


def test_existing_app_shoot_is_linked_not_duplicated(api, crm_env, cal):
    cid = add_client()
    with SessionLocal() as db:
        db.add(Shoot(client_id=cid, tag="podcast", location="studio", starts_at=at(3, 0) + timedelta(minutes=30),
                     duration_min=60, cameras=1, status="confirmed"))
        db.commit()
    cal["events"] = [ev()]
    sync()
    [s] = shoots()
    assert s.calendar_uid == "u1" and crm_env.tg("sendMessage") == []


def test_unrecognised_sends_one_card_with_candidates(api, crm_env, cal):
    a, b = add_client("Testa Birinci", ""), add_client("Testa İkinci", "994500000222")
    with SessionLocal() as db:
        db.add(KnownContact(phone="994500000333", kind="customer", first_name="Testa Y Pod"))
        db.commit()
    cal["events"] = [ev(title="Testa 1 kamera Y Pod")]
    sync()
    sync()
    [msg] = crm_env.tg("sendMessage")
    assert "— kimdir?" in msg["text"] and shoots() == []
    rows = [r[0] for r in msg["reply_markup"]["inline_keyboard"]]
    assert [r["callback_data"].split(":")[1] for r in rows] == ["c", "c", "p", "n", "b", "x"]
    link_id = rows[0]["callback_data"].split(":")[2]
    assert cb(api, f"k:c:{link_id}:{a}") == "created"
    [s] = shoots()
    assert s.client_id == a and s.status == "confirmed" and s.calendar_uid == "u1"


def test_not_a_shoot_ignored_forever(api, crm_env, cal):
    cal["events"] = [ev(title="Naməlum Adam Y Pod")]
    sync()
    with SessionLocal() as db:
        link_id = db.query(CalendarLink).one().id
    assert cb(api, f"k:x:{link_id}") == "ignored_event"
    sync()
    sync()
    assert shoots() == [] and len(crm_env.tg("sendMessage")) == 1


def test_new_client_asks_phone_then_reply_creates(api, crm_env, cal):
    cal["events"] = [ev(title="Naməlum Adam Y Pod")]
    sync()
    with SessionLocal() as db:
        link_id = db.query(CalendarLink).one().id
    assert cb(api, f"k:n:{link_id}") == "asking"
    ask_id = 900 + crm_env.n - 1  # sonuncu sorğu answerCallbackQuery idi, ondan əvvəlki sendMessage
    body = {"message": {"message_id": 70, "text": "050 000 01 11", "from": {"id": int(CHAT)}, "chat": {"id": int(CHAT)},
                        "reply_to_message": {"message_id": ask_id}}}
    assert api.post("/api/webhooks/telegram", json=body, headers=H).json()["result"] == "calendar_created"
    [s] = shoots()
    with SessionLocal() as db:
        assert db.get(Client, s.client_id).phone == PHONE


def test_time_change_updates_without_customer_message(api, crm_env, cal):
    add_client()
    cal["events"] = [ev()]
    sync()
    with SessionLocal() as db:
        before = db.query(Notification).count()
    cal["events"] = [ev(start=at(3, 2), minutes=90)]
    sync()
    [s] = shoots()
    assert s.starts_at.replace(tzinfo=None) == at(3, 2).replace(tzinfo=None) and s.duration_min == 90
    with SessionLocal() as db:
        assert db.query(Notification).count() == before


def test_time_change_conflict_sends_note_once(api, crm_env, cal):
    cid = add_client()
    cal["events"] = [ev()]
    sync()
    with SessionLocal() as db:
        db.add(Shoot(client_id=cid, tag="podcast", location="studio", starts_at=at(3, 5), duration_min=60,
                     cameras=1, status="confirmed"))
        db.commit()
    cal["events"] = [ev(start=at(3, 5))]
    sync()
    sync()
    first = shoots()[0]
    assert first.starts_at.replace(tzinfo=None) == at(3).replace(tzinfo=None)
    msgs = crm_env.tg("sendMessage")
    assert len(msgs) == 2 and msgs[1]["text"].startswith("⚠️ Təqvimdə vaxt dəyişdi")


def test_deleted_twice_asks_never_cancels(api, crm_env, cal):
    add_client()
    cal["events"] = [ev()]
    sync()
    cal["events"] = []
    sync()
    assert len(crm_env.tg("sendMessage")) == 1
    sync()
    sync()
    msgs = crm_env.tg("sendMessage")
    assert len(msgs) == 2 and msgs[1]["text"].startswith("Təqvimdən silindi: Testa Nümunəva")
    assert shoots()[0].status == "confirmed"
    data = [b["callback_data"] for b in msgs[1]["reply_markup"]["inline_keyboard"][0]]
    assert cb(api, data[0]) == "cancelled"
    assert shoots()[0].status == "cancelled"


def test_undo_deletes_and_ignores(api, crm_env, cal):
    add_client()
    cal["events"] = [ev()]
    sync()
    data = crm_env.tg("sendMessage")[0]["reply_markup"]["inline_keyboard"][0][0]["callback_data"]
    assert cb(api, data) == "undone"
    assert shoots() == []
    sync()
    assert shoots() == []


def test_ics_failure_does_nothing(api, crm_env, cal, monkeypatch):
    add_client()
    cal["events"] = [ev()]
    sync()
    monkeypatch.setattr(calendar_ics, "detailed", lambda a, b: None)
    for _ in range(3):
        sync()
    assert shoots()[0].status == "confirmed" and len(crm_env.tg("sendMessage")) == 1


def test_past_skipped_and_title_without_ypod_synced(api, crm_env, cal):
    add_client()
    cal["events"] = [ev("b", start=now() - timedelta(hours=5)), ev("c", "Testa Nümunəva podkast")]
    sync()
    assert len(shoots()) == 1 and shoots()[0].calendar_uid == "c"


def blocks():
    with SessionLocal() as db:
        return [(aware(b.starts_at), b.reason) for b in db.query(Block).order_by(Block.id)]


def test_sublet_and_personal_events_become_blocks_and_follow_calendar(api, crm_env, cal, monkeypatch):
    monkeypatch.setattr(settings, "CALENDAR_SUBLET_RE", r"şahin|testkirayə")
    monkeypatch.setattr(settings, "CALENDAR_PERSONAL_RE", r"test\s*şəxsi")
    monkeypatch.setattr(settings, "CALENDAR_PERSONAL_LABEL", "Şəxsi (test)")
    add_client()
    cal["events"] = [ev("a", "Şahin podkast Y Pod"), ev("r", "Testkirayə 2", start=at(4)), ev("h", "Testşəxsi", start=at(5))]
    sync()
    sync()
    assert shoots() == [] and crm_env.tg("sendMessage") == []
    assert [r for _, r in blocks()] == ["Şahin (sub-icarə)", "Şahin (sub-icarə)", "Şəxsi (test)"]
    cal["events"] = [ev("a", "Şahin podkast Y Pod", start=at(3, 2)), ev("h", "Testşəxsi", start=at(5))]
    sync()
    assert blocks()[0][0] == at(3, 2) and len(blocks()) == 3
    sync()  # «Testkirayə 2» ardıcıl 2 oxunuşda yoxdur → gələcək blok silinir
    assert [s for s, _ in blocks()] == [at(3, 2), at(5)]


def test_card_sublet_button_makes_block(api, crm_env, cal):
    cal["events"] = [ev(title="Yeni Etkinlik")]
    sync()
    kb = crm_env.tg("sendMessage")[0]["reply_markup"]["inline_keyboard"]
    data = next(b["callback_data"] for row in kb for b in row if b["text"].startswith("🔒"))
    assert cb(api, data) == "blocked"
    assert shoots() == [] and [r for _, r in blocks()] == ["Şahin (sub-icarə)"]
    assert cb(api, data) == "resolved"
