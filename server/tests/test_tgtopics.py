from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import CHAT, TG_SECRET, crm_env, jreply, mk_conv  # noqa: F401,I001

import pytest  # noqa: E402

import alerts  # noqa: E402
import tgtopics  # noqa: E402
from crm import bot, conf, tg  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import BotDraft, WaConversation  # noqa: E402

GROUP = -1001234567890
H = {"X-Telegram-Bot-Api-Secret-Token": TG_SECRET}


@pytest.fixture(autouse=True)
def fresh_cache():
    tgtopics.invalidate()
    yield
    tgtopics.invalidate()


class FakeCall:
    def __init__(self, fail=False):
        self.calls, self.fail, self.n = [], fail, 10

    def __call__(self, method, payload):
        self.calls.append((method, payload))
        if method == "createForumTopic":
            if self.fail:
                return {"ok": False}
            self.n += 1
            return {"ok": True, "result": {"message_thread_id": self.n}}
        return {"ok": True, "result": {"message_id": 1}}

    def of(self, method):
        return [p for m, p in self.calls if m == method]


def _msg(from_id=CHAT, forum=True, text="/qur"):
    return {"message_id": 5, "text": text, "from": {"id": int(from_id)},
            "chat": {"id": GROUP, "type": "supergroup", "is_forum": forum}}


def _setup():
    call = FakeCall()
    with SessionLocal() as db:
        assert tgtopics.setup(db, _msg(), call) == "ok"
    return call


def test_setup_creates_topics_and_routes(api, crm_env):
    call = _setup()
    assert [p["name"] for p in call.of("createForumTopic")] == list(tgtopics.TOPICS.values())
    intro = [p for p in call.of("sendMessage") if p.get("message_thread_id")]
    assert len(intro) == 6 and intro[0]["text"].startswith("🔴 Cavab lazımdır")
    assert tgtopics.dest("action") == {"chat_id": str(GROUP), "message_thread_id": 11}
    assert tgtopics.dest("server") == {"chat_id": str(GROUP), "message_thread_id": 15}
    assert tgtopics.chat_allowed(GROUP) and tgtopics.chat_allowed(CHAT) and not tgtopics.chat_allowed(999)
    again = FakeCall()  # təkrar /qur: yeni mövzu yaranmır
    with SessionLocal() as db:
        assert tgtopics.setup(db, _msg(), again) == "ok"
    assert again.of("createForumTopic") == []


def test_setup_rejects_strangers_and_non_forum(api, crm_env):
    call = FakeCall()
    with SessionLocal() as db:
        assert tgtopics.setup(db, _msg(from_id=555), call) == "not_owner"
        assert call.calls == []
        assert tgtopics.setup(db, _msg(forum=False), call) == "not_forum"
        assert "Topics" in call.of("sendMessage")[0]["text"]
        assert conf.get(db, "tg_group_id") is None


def test_setup_without_rights_saves_nothing(api, crm_env):
    call = FakeCall(fail=True)
    with SessionLocal() as db:
        assert tgtopics.setup(db, _msg(), call) == "no_rights"
        assert conf.get(db, "tg_group_id") is None and conf.get(db, "tg_topic_action") is None
    assert "Manage topics" in call.of("sendMessage")[0]["text"]
    assert tgtopics.dest("action") == {"chat_id": CHAT}


def test_webhook_qur_command(api, crm_env):
    r = api.post("/api/webhooks/telegram", json={"message": _msg(from_id=555)}, headers=H)
    assert r.json()["result"] == "not_owner"
    r = api.post("/api/webhooks/telegram", json={"message": _msg()}, headers=H)
    assert r.json()["result"] == "no_rights"  # saxta Telegram mövzu ID-si qaytarmır


def test_without_group_everything_goes_to_private_chat(api, crm_env):
    assert tgtopics.dest("reports") == {"chat_id": CHAT} and not tgtopics.has_group()


def test_draft_and_alert_go_to_topics(api, crm_env, monkeypatch):
    _setup()
    _, conv_id = mk_conv()
    crm_env.gemini(jreply("Salam, buyurun"))
    bot.handle(conv_id)
    draft = crm_env.tg("sendMessage")[-1]
    assert draft["chat_id"] == str(GROUP) and draft["message_thread_id"] == 11
    posted = []
    monkeypatch.setattr(alerts.httpx, "post", lambda url, json, timeout: posted.append(json))
    alerts._post("Y Pod: test")
    alerts._post("Y Pod: handoff", "action")
    assert [p["message_thread_id"] for p in posted] == [15, 11]


def test_callback_from_group_and_old_chat(api, crm_env):
    _, conv_id = mk_conv()
    crm_env.gemini(jreply("Salam"))
    bot.handle(conv_id)  # qrupdan əvvəl: qaralama şəxsi çatdadır
    _setup()
    with SessionLocal() as db:
        d1 = db.query(BotDraft).one()
    body = {"callback_query": {"id": "q", "data": f"d:{d1.id}:r", "message": {"message_id": 1, "chat": {"id": 999}}}}
    assert api.post("/api/webhooks/telegram", json=body, headers=H).json()["result"] == "ignored"
    body["callback_query"]["message"]["chat"]["id"] = int(CHAT)  # köhnə çatdakı düymə işləyir
    assert api.post("/api/webhooks/telegram", json=body, headers=H).json()["result"] == "rejected"


def test_wa_auto_reply_logged_only_with_group(api, crm_env):
    _, conv_id = mk_conv()
    with SessionLocal() as db:
        conf.put(db, "bot_mode", "auto")
        db.commit()
    crm_env.gemini(jreply("Salam, buyurun"))
    assert bot.handle(conv_id) == "sent"
    assert crm_env.tg("sendMessage") == []  # qrup yoxdur: şəxsi çat hər cavabla dolmur
    _setup()
    with SessionLocal() as db:
        tg.auto_log(db, db.get(WaConversation, conv_id), "Bəli")
    log = crm_env.tg("sendMessage")[-1]
    assert log["message_thread_id"] == 12 and log["text"].startswith("🤖 WhatsApp: Aysel")


# --- mövzuda adi mesaj qaralamaya cavab sayılmır ---

def _draft_row(mid, chat_id):
    _, conv_id = mk_conv()
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="Köhnə qaralama", telegram_message_id=str(mid),
                        telegram_chat_id=chat_id))
        db.commit()


def _topic_msg(reply_to, thread=13, **reply_extra):
    return {"message_id": 40, "text": "salam, test", "from": {"id": int(CHAT)}, "message_thread_id": thread,
            "chat": {"id": GROUP, "type": "supergroup", "is_forum": True},
            "reply_to_message": {"message_id": reply_to, **reply_extra}}


def test_topic_plain_message_does_not_hit_old_draft(api, crm_env):
    _setup()
    _draft_row(11, None)  # köhnə şəxsi çat qaralaması, mesaj id-si mövzunun (11) açılış mesajı ilə üst-üstə düşür
    before = len(crm_env.tg("sendMessage"))
    for body in (_topic_msg(11, thread=11, forum_topic_created={"name": "x"}), _topic_msg(11, thread=11)):
        assert api.post("/api/webhooks/telegram", json={"message": body}, headers=H).json()["result"] == "ignored"
    assert len(crm_env.tg("sendMessage")) == before and not crm_env.gemini_calls
    with SessionLocal() as db:
        assert db.query(BotDraft).one().status == "pending"


def test_reply_lookup_scoped_by_chat(api, crm_env):
    _setup()
    _draft_row(50, str(CHAT))  # şəxsi çatdakı qaralama
    before = len(crm_env.tg("sendMessage"))
    body = _topic_msg(50, thread=14)  # qrupda eyni nömrəli mesaja cavab: başqa mesajdır
    assert api.post("/api/webhooks/telegram", json={"message": body}, headers=H).json()["result"] == "ignored"
    assert len(crm_env.tg("sendMessage")) == before
    with SessionLocal() as db:
        assert db.query(BotDraft).one().status == "pending"


def test_reply_legacy_row_without_chat_id_matches_private_chat_only(api, crm_env):
    _draft_row(60, None)
    crm_env.gemini(jreply("Qısa."))
    private = {"message_id": 41, "text": "qısa yaz", "from": {"id": int(CHAT)}, "chat": {"id": int(CHAT)},
               "reply_to_message": {"message_id": 60}}
    assert api.post("/api/webhooks/telegram", json={"message": private}, headers=H).json()["result"] == "regenerate"


def test_send_draft_stores_chat_id(api, crm_env):
    _setup()
    _, conv_id = mk_conv()
    crm_env.gemini(jreply("Salam, buyurun"))
    bot.handle(conv_id)
    with SessionLocal() as db:
        d = db.query(BotDraft).one()
        assert d.telegram_chat_id == str(GROUP) and d.telegram_message_id
