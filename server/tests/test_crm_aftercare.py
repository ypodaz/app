from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import CHAT, TG_SECRET, crm_env  # noqa: F401,I001

from datetime import date, datetime, timedelta, timezone  # noqa: E402
from urllib.parse import unquote  # noqa: E402

from crm import aftercare, conf  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import Client, Material, Notification, Shoot  # noqa: E402

BAKU = timezone(timedelta(hours=4))
NOW = datetime(2026, 11, 12, 10, 30, tzinfo=BAKU)


def _client(name="Aysel Məmmədova", phone="050 111 22 33"):
    with SessionLocal() as db:
        c = Client(full_name=name, phone=phone, card_code=name[:8])
        db.add(c)
        db.commit()
        return c.id


def _shoot(cid, days_ago, **kw):
    args = dict(client_id=cid, starts_at=NOW - timedelta(days=days_ago), duration_min=60, kind="shoot",
                tag="podcast", location="studio", cameras=1, status="completed")
    args.update(kw)
    with SessionLocal() as db:
        s = Shoot(**args)
        db.add(s)
        db.commit()
        return s.id


def _callback(api, data, message_id=901):
    body = {"callback_query": {"id": "q1", "data": data,
                               "message": {"message_id": message_id, "chat": {"id": int(CHAT)}}}}
    return api.post("/api/webhooks/telegram", json=body, headers={"X-Telegram-Bot-Api-Secret-Token": TG_SECRET})


# --- montaj növbəsi ---

def test_queue_lists_only_open_editing_and_marks_late(api, crm_env):
    cid = _client()
    late = _shoot(cid, 6, editing=True, production="editing", delivery_on=date(2026, 11, 10), reels_count=3)
    _shoot(cid, 2, editing=True, production="none")  # tarixsiz
    _shoot(cid, 5, editing=True, production="ready")  # təhvil verilib
    _shoot(cid, 1, editing=False)  # montajsız
    _shoot(cid, 0, editing=True, status="confirmed")  # hələ bağlanmayıb
    with SessionLocal() as db:
        assert aftercare.send_queue(db, NOW.date())
    msg = crm_env.tg("sendMessage")[0]
    lines = msg["text"].splitlines()
    assert lines[0] == "📋 Montaj növbəsi (2)"
    assert "1. Aysel Məmmədova · podkast · çəkiliş 06.11 · 3 Reels · təhvil 10.11 ⚠️ 2 gün gecikir" in lines
    assert "2. Aysel Məmmədova · podkast · çəkiliş 10.11 · təhvil tarixi yoxdur" in lines
    buttons = msg["reply_markup"]["inline_keyboard"]
    assert buttons[0][0] == {"text": "✅ 1. Aysel — təhvil verildi", "callback_data": f"m:{late}:r"}
    assert len(buttons) == 2


def test_empty_queue_sends_nothing(api, crm_env):
    with SessionLocal() as db:
        assert aftercare.send_queue(db, NOW.date()) is False
    assert crm_env.tg("sendMessage") == []


def test_delivered_button_sets_ready_and_refreshes(api, crm_env):
    cid = _client()
    sid = _shoot(cid, 3, editing=True, production="editing")
    other = _shoot(cid, 2, editing=True, production="editing")
    with SessionLocal() as db:
        db.add(Material(shoot_id=sid, title="Video", drive_url="https://drive.google.com/x"))
        db.commit()
    assert _callback(api, f"m:{sid}:r").json()["result"] == "delivered"
    with SessionLocal() as db:
        s = db.get(Shoot, sid)
        assert s.production == "ready" and s.delivered_at is not None
        assert db.query(Notification).filter_by(type="materials_ready").count() == 1
    edit = crm_env.tg("editMessageText")[-1]
    assert edit["message_id"] == 901 and "(1)" in edit["text"]
    assert edit["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == f"m:{other}:r"
    assert crm_env.tg("answerCallbackQuery")[-1]["show_alert"] is False
    assert _callback(api, f"m:{sid}:r").json()["result"] == "resolved"  # ikinci basış


def test_delivered_without_materials_skips_app_notification(api, crm_env):
    sid = _shoot(_client(), 3, editing=True, production="editing")
    assert _callback(api, f"m:{sid}:r").json()["result"] == "delivered"
    with SessionLocal() as db:
        assert db.query(Notification).filter_by(type="materials_ready").count() == 0
    ans = crm_env.tg("answerCallbackQuery")[-1]
    assert ans["show_alert"] is True and "bildiriş getmədi" in ans["text"]
    assert crm_env.tg("editMessageText")[-1]["text"] == "📋 Montaj növbəsi boşdur ✅"


def test_bad_callback_ignored(api, crm_env):
    assert _callback(api, "m:abc:r").json()["result"] == "ignored"
    assert _callback(api, "m:999:r").json()["result"] == "ignored"


def test_panel_production_sets_and_clears_delivered_at(api, crm_env):
    adm = admin_token(api)
    sid = _shoot(_client(), 3, editing=True, production="editing")
    url = f"/api/admin/shoots/{sid}/production"
    assert api.patch(url, json={"production": "ready"}, headers=bearer(adm)).status_code == 200
    with SessionLocal() as db:
        assert db.get(Shoot, sid).delivered_at is not None
    api.patch(url, json={"production": "editing"}, headers=bearer(adm))
    with SessionLocal() as db:
        assert db.get(Shoot, sid).delivered_at is None


# --- rəy sorğusu ---

def test_feedback_after_3_days_without_editing(api, crm_env):
    cid = _client()
    due_id = _shoot(cid, 3)
    _shoot(_client("Kamran"), 2)  # hələ tezdir
    _shoot(_client("Köhnə"), 30)  # çox köhnədir
    with SessionLocal() as db:
        due = aftercare.feedback_due(db, NOW)
        assert [s.id for s in due] == [due_id]
        aftercare.send_feedback(db, due[0])
        db.commit()
        assert db.get(Shoot, due_id).feedback_asked_at is not None
        assert aftercare.feedback_due(db, NOW) == []  # bir çəkilişə bir dəfə
    msg = crm_env.tg("sendMessage")[0]
    assert msg["text"].startswith("⭐ Rəy sorğusu\nAysel Məmmədova · podkast · çəkiliş 09.11")
    assert "Salam, Aysel! Y Pod-dan yazırıq. Çəkilişiniz necə keçdi?" in msg["text"]
    url = msg["reply_markup"]["inline_keyboard"][0][0]["url"]
    assert url.startswith("https://wa.me/994501112233?text=")
    assert "Nəyi bəyəndiniz" in unquote(url)


def test_feedback_2_days_after_delivery(api, crm_env):
    cid = _client()
    sid = _shoot(cid, 10, editing=True, production="ready", delivered_at=NOW - timedelta(days=2))
    _shoot(_client("Lalə"), 10, editing=True, production="ready", delivered_at=NOW - timedelta(days=1))
    _shoot(_client("Nigar"), 10, editing=True, production="editing")  # təhvil verilməyib
    _shoot(_client("Orxan"), 10, editing=True, production="ready")  # köhnə, təhvil vaxtı bilinmir
    with SessionLocal() as db:
        due = aftercare.feedback_due(db, NOW)
        assert [s.id for s in due] == [sid]
        assert "Videolarınız artıq əlinizdədir" in aftercare.feedback_text(due[0], db.get(Client, cid))


def test_feedback_not_repeated_for_regular_client(api, crm_env):
    cid = _client()
    _shoot(cid, 12, feedback_asked_at=NOW - timedelta(days=9))
    _shoot(cid, 3)
    _shoot(cid, 4)
    cid2 = _client("Rəna")
    first = _shoot(cid2, 4)
    _shoot(cid2, 3)
    with SessionLocal() as db:
        assert [s.id for s in aftercare.feedback_due(db, NOW)] == [first]  # eyni gün bir müştəriyə bir kart


def test_feedback_without_phone_has_no_button(api, crm_env):
    _shoot(_client("Səbinə", phone=""), 3)
    with SessionLocal() as db:
        aftercare.run(db, NOW)
    msg = crm_env.tg("sendMessage")[0]
    assert "reply_markup" not in msg and "telefonu yoxdur" in msg["text"]


def test_daily_run_once_after_10(api, crm_env):
    _shoot(_client(), 5, editing=True, production="editing")
    _shoot(_client("Kamran"), 3)
    with SessionLocal() as db:
        assert not aftercare.due(db, NOW.replace(hour=9, minute=59))
        assert aftercare.due(db, NOW)
        assert aftercare.run(db, NOW) == 1
        assert not aftercare.due(db, NOW + timedelta(hours=3))
        assert aftercare.due(db, NOW + timedelta(days=1))
        conf.put(db, "aftercare_enabled", "false")
        assert not aftercare.due(db, NOW + timedelta(days=1))
    texts = [m["text"] for m in crm_env.tg("sendMessage")]
    assert texts[0].startswith("📋 Montaj növbəsi (1)")
    assert sum(t.startswith("⭐ Rəy sorğusu") for t in texts) == 1
