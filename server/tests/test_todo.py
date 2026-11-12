from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import CHAT, TG_SECRET, crm_env  # noqa: F401,I001

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402

import tgtopics  # noqa: E402
from crm import aftercare, conf  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import Client, Shoot, Task  # noqa: E402

GROUP, TOPIC = -1001234567890, 13
H = {"X-Telegram-Bot-Api-Secret-Token": TG_SECRET}
BAKU = timezone(timedelta(hours=4))
NOW = datetime(2026, 11, 12, 10, 30, tzinfo=BAKU)


@pytest.fixture(autouse=True)
def group(api):
    with SessionLocal() as db:
        conf.put(db, "tg_group_id", str(GROUP))
        conf.put(db, "tg_topic_tasks", str(TOPIC))
        db.commit()
    tgtopics.invalidate()
    yield
    tgtopics.invalidate()


def post(api, text, user=CHAT, chat=GROUP, thread=TOPIC, **extra):
    m = {"message_id": 30, "text": text, "from": {"id": int(user)}, "chat": {"id": int(chat)}, **extra}
    if thread:
        m["message_thread_id"] = thread
    return api.post("/api/webhooks/telegram", json={"message": m}, headers=H).json()["result"]


def cb(api, data, message_id, user=CHAT):
    body = {"callback_query": {"id": "q", "data": data, "from": {"id": int(user)},
                               "message": {"message_id": message_id, "chat": {"id": GROUP}}}}
    return api.post("/api/webhooks/telegram", json=body, headers=H).json()["result"]


def tasks():
    with SessionLocal() as db:
        return db.query(Task).order_by(Task.id).all()


def test_topic_message_creates_task_with_button(api, crm_env):
    assert post(api, "Aysel reels-ini montaj et") == "task_added"
    [t] = tasks()
    assert t.text == "Aysel reels-ini montaj et" and t.done_at is None and t.tg_message_id
    [msg] = crm_env.tg("sendMessage")
    assert msg["text"] == "✅ İş əlavə olundu: Aysel reels-ini montaj et"
    assert msg["chat_id"] == GROUP and msg["message_thread_id"] == TOPIC
    assert msg["reply_markup"]["inline_keyboard"][0][0] == {"text": "☑️ Bitdi", "callback_data": f"t:{t.id}:d"}


def test_done_button_marks_and_edits(api, crm_env):
    post(api, "Montaj")
    [t] = tasks()
    assert cb(api, f"t:{t.id}:d", int(t.tg_message_id)) == "done"
    assert tasks()[0].done_at
    edit = crm_env.tg("editMessageText")[-1]
    assert edit["text"] == "☑️ Bitdi: Montaj" and "reply_markup" not in edit
    assert cb(api, f"t:{t.id}:d", int(t.tg_message_id)) == "resolved"
    assert cb(api, "t:999:d", 5) == "ignored"
    assert cb(api, f"t:{t.id}:x", 5) == "ignored"


def test_non_owner_ignored_in_topic_and_callback(api, crm_env):
    assert post(api, "yad adam yazır", user=555) == "ignored"
    assert not tasks() and not crm_env.tg("sendMessage")
    post(api, "iş")
    [t] = tasks()
    assert cb(api, f"t:{t.id}:d", 5, user=555) == "ignored"
    assert not tasks()[0].done_at


def test_command_and_other_places_do_not_create_tasks(api, crm_env):
    assert post(api, "/bilinmir") == "ignored"
    assert post(api, "iş", thread=14) == "ignored"  # başqa mövzu
    assert post(api, "iş", thread=None) == "ignored"  # qrupun ümumi çatı
    assert post(api, "iş", chat=CHAT, thread=None) == "ignored"  # şəxsi çat
    assert not tasks()


def test_explicit_reply_to_draft_skips_task(api, crm_env):
    assert post(api, "qısa yaz", reply_to_message={"message_id": 777}) == "ignored"  # handle_reply: qaralama tapılmadı
    assert not tasks()
    assert post(api, "iş", reply_to_message={"message_id": TOPIC, "forum_topic_created": {"name": "x"}}) == "task_added"


def test_isler_lists_open_with_buttons_and_done_refreshes(api, crm_env):
    assert post(api, "/isler", thread=None) == "ok"
    assert crm_env.tg("sendMessage")[-1]["text"] == "Açıq iş yoxdur ✅"
    post(api, "birinci")
    post(api, "ikinci")
    a, b = tasks()
    assert post(api, "/isler@ypod_bot") == "ok"
    msg = crm_env.tg("sendMessage")[-1]
    assert msg["text"].splitlines()[2:] == ["1. birinci", "2. ikinci"] and msg["message_thread_id"] == TOPIC
    assert [r[0] for r in msg["reply_markup"]["inline_keyboard"]] == [
        {"text": "☑️ 1 bitdi", "callback_data": f"t:{a.id}:d"}, {"text": "☑️ 2 bitdi", "callback_data": f"t:{b.id}:d"}]
    assert cb(api, f"t:{a.id}:d", 9999) == "done"  # siyahı mesajı: qalanla yenilənir
    edit = crm_env.tg("editMessageText")[-1]
    assert "1. ikinci" in edit["text"] and "birinci" not in edit["text"]
    assert post(api, "/isler", user=555) == "not_owner"


def test_daily_queue_message_includes_open_tasks(api, crm_env):
    with SessionLocal() as db:
        db.add(Task(text="Zuleyxa reels"))
        db.commit()
        # montaj növbəsi boşdur, amma açıq iş var: yenə də mesaj gedir
        assert aftercare.send_queue(db, NOW.date())
        c = Client(full_name="Aysel", phone="050", card_code="aysel")
        db.add(c)
        db.flush()
        db.add(Shoot(client_id=c.id, starts_at=NOW - timedelta(days=5), duration_min=60, kind="shoot", tag="podcast",
                     location="studio", cameras=1, status="completed", editing=True, production="editing"))
        db.commit()
        assert aftercare.send_queue(db, NOW.date())
    first, second = [m["text"] for m in crm_env.tg("sendMessage")]
    assert first.startswith("📋 Montaj növbəsi boşdur ✅") and "📝 Açıq işlər\n1. Zuleyxa reels" in first
    assert second.startswith("📋 Montaj növbəsi (1)") and "📝 Açıq işlər" in second
    assert "reply_markup" not in crm_env.tg("sendMessage")[0] and "reply_markup" in crm_env.tg("sendMessage")[1]


def test_daily_queue_empty_without_tasks_sends_nothing(api, crm_env):
    with SessionLocal() as db:
        db.add(Task(text="bitmiş", done_at=NOW))
        db.commit()
        assert aftercare.send_queue(db, NOW.date()) is False
