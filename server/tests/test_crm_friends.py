from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import CHAT, TG_SECRET, crm_env, jreply, mk_conv  # noqa: F401,I001

from sqlalchemy import select  # noqa: E402

from crm import bot, conf, social_inbox, social_tg  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import BotDraft, SocialItem, WaContact, WaConversation  # noqa: E402

H = {"X-Telegram-Bot-Api-Secret-Token": TG_SECRET}


def cb(api, data):  # noqa: F811
    body = {"callback_query": {"id": "q", "data": data, "from": {"id": int(CHAT)},
                               "message": {"message_id": 55, "chat": {"id": int(CHAT)}, "text": "kart"}}}
    return api.post("/api/webhooks/telegram", json=body, headers=H).json()["result"]


def cmd(api, text):  # noqa: F811
    m = {"message_id": 30, "text": text, "from": {"id": int(CHAT)}, "chat": {"id": int(CHAT)}}
    return api.post("/api/webhooks/telegram", json={"message": m}, headers=H).json()["result"]


def test_draft_card_has_friend_button_and_it_excludes(api, crm_env):  # noqa: F811
    cid, conv_id = mk_conv(text="Salam, necəsən?")
    crm_env.gemini(jreply("Salam!"))
    assert bot.handle(conv_id) == "draft"
    kb = crm_env.tg("sendMessage")[-1]["reply_markup"]["inline_keyboard"]
    assert kb[1][0] == {"text": "🙅 Dostdur, bot yazmasın", "callback_data": f"f:w:{cid}:off"}
    assert cb(api, f"f:w:{cid}:off") == "friend"
    with SessionLocal() as db:
        assert db.get(WaContact, cid).excluded is True
        d = db.scalar(select(BotDraft))
        assert d.status == "rejected" and d.reason == "dostdur, bot yazmır"
    edit = crm_env.tg("editMessageText")[-1]
    assert edit["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == f"f:w:{cid}:on"  # geri qaytarmaq olur
    assert bot.handle(conv_id) == "skip:excluded"


def test_dostlar_lists_and_turns_bot_back_on(api, crm_env):  # noqa: F811
    assert cmd(api, "/dostlar") == "ok"
    assert "boşdur" in crm_env.tg("sendMessage")[-1]["text"]
    cid, _ = mk_conv(name="Dost")
    with SessionLocal() as db:
        db.get(WaContact, cid).excluded = True
        conf.put(db, "ig_friend:1789", "1")
        db.commit()
    assert cmd(api, "/dostlar") == "ok"
    msg = crm_env.tg("sendMessage")[-1]
    assert msg["text"].startswith("🙅 Bot yazmayan dostlar: 2")
    rows = msg["reply_markup"]["inline_keyboard"]
    assert rows[0][0]["callback_data"] == f"f:w:{cid}:on" and "Dost" in rows[0][0]["text"]
    assert rows[1][0]["callback_data"] == "f:i:1789:on"
    assert cb(api, f"f:w:{cid}:on") == "customer"
    with SessionLocal() as db:
        assert db.get(WaContact, cid).excluded is False


def test_dostlar_only_owner(api, crm_env):  # noqa: F811
    m = {"message_id": 30, "text": "/dostlar", "from": {"id": 1}, "chat": {"id": int(CHAT)}}
    assert api.post("/api/webhooks/telegram", json={"message": m}, headers=H).json()["result"] == "not_owner"


def test_personal_contact_customer_button_returns_to_bot(api, crm_env):  # noqa: F811
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        c = db.get(WaConversation, conv_id)
        c.mode, c.route = "human", "personal"
        db.commit()
    assert cb(api, f"f:w:{cid}:on") == "customer"
    with SessionLocal() as db:
        c = db.get(WaConversation, conv_id)
        assert c.mode == "bot" and c.route == "personal"  # route qalır: təkrar ötürülmür


def test_ig_friend_button_and_skip(api, crm_env):  # noqa: F811
    with SessionLocal() as db:
        item = SocialItem(channel="instagram", kind="dm", external_id="m1", thread_id="1789", text="Salam qardaş")
        db.add(item)
        db.commit()
        assert social_tg._buttons(item)["inline_keyboard"][1][0]["callback_data"] == "f:i:1789:off"
        iid = item.id
    assert cb(api, "f:i:1789:off") == "friend"
    with SessionLocal() as db:
        assert db.get(SocialItem, iid).status == "rejected"
        db.add(SocialItem(channel="instagram", kind="dm", external_id="m2", thread_id="1789", text="Necəsən?"))
        db.commit()
        new = db.scalar(select(SocialItem).where(SocialItem.external_id == "m2"))
        assert social_inbox._draft(db, new, None) == "skip:friend"
        assert new.status == "ignored"
    assert crm_env.gemini_calls == []


def test_ig_comment_has_no_friend_button(api):  # noqa: F811
    item = SocialItem(id=1, channel="instagram", kind="comment", external_id="c", thread_id="media", text="x")
    assert len(social_tg._buttons(item)["inline_keyboard"]) == 1
