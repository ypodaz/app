"""Telegram «✍️ Cavabımı yaz» (crm/owner_reply.py): düymə, reply, AI səliqəyə salma, göndəriş (WA və Instagram)."""
from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import CHAT, TG_SECRET, crm_env, jreply, mk_conv  # noqa: F401,I001
from test_social_inbox import auto_mode, dm, net, post_ig  # noqa: F401,I001
from test_crm_bot import callback  # noqa: F401,I001

from datetime import datetime, timedelta  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from crm import bot, conf, events, friends, owner_reply, social_inbox, tg, turns, worker  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from views import BAKU  # noqa: E402
from models import (AiUsage, BotDraft, ConversationEvent, OwnerReply, SocialItem, WaConversation,  # noqa: E402
                    WaMessage)

HOOK = "/api/webhooks/telegram"
RAW = "70 manatdır, sabah gəlin"
NICE = "Salam, qiymət 70 AZN-dir. Sabah gələ bilərsiniz."


@pytest.fixture(autouse=True)
def no_digest(monkeypatch):
    monkeypatch.setattr(worker.digest, "due", lambda db, t: False)


def one(model, *where):
    with SessionLocal() as db:
        return db.scalar(select(model).where(*where).order_by(model.id.desc()))


def rec():
    return one(OwnerReply)


def post_msg(api, text=None, reply_to=None, chat=CHAT, **extra):
    msg = {"message_id": 5000, "chat": {"id": int(chat)}, **extra}
    if text is not None:
        msg["text"] = text
    if reply_to:
        msg["reply_to_message"] = {"message_id": int(reply_to)}
    return api.post(HOOK, json={"message": msg}, headers={"X-Telegram-Bot-Api-Secret-Token": TG_SECRET})


def result(r):
    return r.json()["result"]


def prompt(api, ref, ch="wa"):
    assert result(callback(api, f"o:w:{ch}:{ref}")) == "prompt"
    return rec()


def ready(api, crm_env, ref, ch="wa", raw=RAW, nice=NICE):
    """Düymə → reply → AI kartı. Qaytarır: OwnerReply."""
    r = prompt(api, ref, ch)
    crm_env.gemini({"reply": nice})
    assert result(post_msg(api, raw, reply_to=r.prompt_message_id)) == "compose"
    return rec()


def ig_item(thread="555", status="pending", text="Salam, qiymət nədir?", author="aysel", ago=0):
    with SessionLocal() as db:
        db.add(SocialItem(channel="instagram", kind="dm", external_id=f"mid{thread}{now().timestamp()}", thread_id=thread,
                          author=author, text=text, draft_text="Qaralama", status=status, tg_message_id="321",
                          created_at=now() - timedelta(hours=ago)))
        db.commit()


def graph_texts(net):
    return [kw["json"]["message"]["text"] for m, url, kw in net.calls if m == "POST" and url.endswith("/me/messages")]


def kapso_texts(crm_env):
    return [j["text"]["body"] for u, j in crm_env.kapso()]


# --- düymə ---

def test_button_on_handoff_notice(api, crm_env):
    _, conv_id = mk_conv(text="Endirim olar?")
    with SessionLocal() as db:
        conf.put(db, "bot_mode", "auto")
        db.commit()
    crm_env.gemini(jreply("Komandaya ötürürəm.", handoff=True, handoff_reason="endirim"))
    assert bot.handle(conv_id) == "handoff:endirim"
    (key, _), = crm_env.alerts
    assert crm_env.markups[key]["inline_keyboard"][0][0] == {"text": "✍️ Cavabımı yaz", "callback_data": f"o:w:wa:{conv_id}"}


def test_button_on_wait_reminder_and_noon(api, crm_env):  # xatırlatma və 12:00 siyahısı
    _, conv_id = mk_conv(mode="wait")
    noon = datetime(2026, 11, 13, 12, 5, tzinfo=BAKU)
    with SessionLocal() as db:
        conf.put(db, f"wait_since:{conv_id}", (noon - timedelta(hours=1)).isoformat())
        db.commit()
        assert turns.remind_waiting(db, noon) == 1
    assert crm_env.tg("sendMessage")[-1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == f"o:w:wa:{conv_id}"
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="Gecə qaralaması", created_at=noon - timedelta(hours=10)))
        db.commit()
        assert turns.noon_reminder(db, noon) == 1
    keys = crm_env.tg("sendMessage")[-1]["reply_markup"]["inline_keyboard"]
    assert keys[0][0]["callback_data"] == f"o:w:wa:{conv_id}" and "Aysel" in keys[0][0]["text"]


def test_button_on_ig_handoff_notice(api, net, crm_env):
    auto_mode()
    crm_env.gemini(jreply("Komandaya ötürürəm.", handoff=True, handoff_reason="endirim"))
    post_ig(api, dm(mid="m1", text="Endirim olar?"))
    sent = [m for m in crm_env.tg("sendMessage") if m["text"].startswith("🤖") or "Əməkdaş lazımdır" in m["text"]]
    assert sent[-1]["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == "o:w:ig:555"


def test_long_ig_thread_uses_short_key(api, net, crm_env):
    thread = "9" * 80
    ig_item(thread)
    with SessionLocal() as db:
        data = owner_reply.button(db, "ig", thread)["callback_data"]
        item_id = db.scalar(select(SocialItem.id))
    assert data == f"o:w:ig:i{item_id}" and len(data.encode()) <= 64
    assert result(callback(api, data)) == "prompt"
    assert rec().ref == thread


# --- sorğu və reply ---

def test_callback_sends_force_reply_prompt_and_awaits(api, crm_env):
    _, conv_id = mk_conv()
    r = prompt(api, conv_id)
    assert (r.channel, r.ref, r.name, r.status) == ("wa", str(conv_id), "Aysel", "await")
    msg = crm_env.tg("sendMessage")[-1]
    assert msg["reply_markup"] == {"force_reply": True} and "Aysel üçün cavabınızı bu mesaja reply" in msg["text"]
    assert r.prompt_message_id and crm_env.tg("answerCallbackQuery")


def test_reply_makes_card(api, crm_env):
    _, conv_id = mk_conv(text="Qiymət nədir?")
    r = ready(api, crm_env, conv_id)
    assert (r.status, r.raw, r.text) == ("ready", RAW, NICE) and r.tg_message_id
    card = crm_env.tg("sendMessage")[-1]
    assert card["text"] == f"✍️ Səliqəli variant (Aysel):\n\n{NICE}\n\nXam mətniniz: {RAW}"
    assert [b["callback_data"] for row in card["reply_markup"]["inline_keyboard"] for b in row] == [
        f"o:{r.id}:{c}" for c in "bhgrx"]
    system, contents = crm_env.gemini_calls[-1]
    assert "SAHİBKARIN XAM CAVABI" in system and RAW in contents[-1]["parts"][0]["text"] and "Qiymət nədir?" in contents[0]["parts"][0]["text"]
    with SessionLocal() as db:
        assert db.scalar(select(AiUsage).where(AiUsage.subject == "owner_reply")).messages == 1


def test_ai_failure_falls_back_to_raw(api, crm_env):
    _, conv_id = mk_conv()
    r = prompt(api, conv_id)
    crm_env.gemini("JSON deyil")
    post_msg(api, RAW, reply_to=r.prompt_message_id)
    assert rec().text == RAW and rec().status == "ready"
    assert crm_env.tg("sendMessage")[-1]["text"].startswith("⚠️ AI səliqəyə sala bilmədi")


def test_voice_reply_transcribed(api, crm_env, monkeypatch):
    _, conv_id = mk_conv()
    r = prompt(api, conv_id)
    monkeypatch.setattr(owner_reply, "_transcribe", lambda db, file_id: RAW if file_id == "f1" else "")
    crm_env.gemini({"reply": NICE})
    assert result(post_msg(api, reply_to=r.prompt_message_id, voice={"file_id": "f1"})) == "compose"
    assert rec().raw == RAW and rec().status == "ready"


def test_voice_failure_asks_for_text(api, crm_env):
    _, conv_id = mk_conv()
    r = prompt(api, conv_id)
    post_msg(api, reply_to=r.prompt_message_id, voice={"file_id": "f1"})  # getFile fayl yolu qaytarmır
    assert crm_env.tg("sendMessage")[-1]["text"] == "Səsi mətnə çevirə bilmədim, yazılı göndərin."
    assert rec().status == "await"


# --- göndəriş: WhatsApp ---

def test_send_b_keeps_ai_and_changes_mode(api, crm_env):
    _, conv_id = mk_conv(mode="wait")
    with SessionLocal() as db:
        conf.put(db, f"wait_since:{conv_id}", now().isoformat())
        db.add(BotDraft(conversation_id=conv_id, text="Bot qaralaması", status="pending"))
        db.commit()
    r = ready(api, crm_env, conv_id)
    assert result(callback(api, f"o:{r.id}:b")) == "sent"
    assert kapso_texts(crm_env) == [NICE]
    with SessionLocal() as db:
        conv = db.get(WaConversation, conv_id)
        assert conv.mode == "bot" and not conf.get(db, f"wait_since:{conv_id}")
        assert db.scalar(select(WaMessage).where(WaMessage.direction == "out")).source == "panel"
        assert db.scalar(select(BotDraft)).status == "rejected"
        assert db.scalar(select(ConversationEvent).where(ConversationEvent.kind == "system", ConversationEvent.text.like("Cavab Telegram-dan%")))
    assert rec().status == "sent"
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("✅ Göndərildi (AI davam edir)")
    assert result(callback(api, f"o:{r.id}:b")) == "resolved"  # təkrar basma
    assert kapso_texts(crm_env) == [NICE]


def test_send_h_silences_ai(api, crm_env):
    _, conv_id = mk_conv()
    r = ready(api, crm_env, conv_id)
    assert result(callback(api, f"o:{r.id}:h")) == "sent"
    assert kapso_texts(crm_env) == [NICE]
    with SessionLocal() as db:
        assert db.get(WaConversation, conv_id).mode == "human"
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("✅ Göndərildi (AI susur)")


def test_send_raw(api, crm_env):
    _, conv_id = mk_conv()
    r = ready(api, crm_env, conv_id)
    assert result(callback(api, f"o:{r.id}:r")) == "sent"
    assert kapso_texts(crm_env) == [RAW]
    with SessionLocal() as db:
        assert db.get(WaConversation, conv_id).mode == "owner"


def test_cancel(api, crm_env):
    _, conv_id = mk_conv()
    r = ready(api, crm_env, conv_id)
    assert result(callback(api, f"o:{r.id}:x")) == "cancelled"
    assert rec().status == "cancelled" and not crm_env.kapso()
    assert crm_env.tg("editMessageText")[-1]["text"] == "✖️ Ləğv edildi"
    assert result(callback(api, f"o:{r.id}:b")) == "resolved"


def test_regenerate_button_and_limit(api, crm_env):
    _, conv_id = mk_conv()
    r = ready(api, crm_env, conv_id)
    for i in range(tg.MAX_REGENERATE):
        crm_env.gemini({"reply": f"Variant {i}"})
        assert result(callback(api, f"o:{r.id}:g")) == "owner_compose"
        assert rec().text == f"Variant {i}" and rec().regen_count == i + 1
        assert "Əvvəlki variant bəyənilmədi" in crm_env.gemini_calls[-1][1][-1]["parts"][0]["text"]
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("✍️ Səliqəli variant (Aysel):\n\nVariant 2")
    assert result(callback(api, f"o:{r.id}:g")) == "limit"


def test_reply_to_card_regenerates_with_instruction(api, crm_env):
    _, conv_id = mk_conv()
    r = ready(api, crm_env, conv_id)
    crm_env.gemini({"reply": "Daha qısa variant."})
    assert result(post_msg(api, "daha qısa yaz", reply_to=r.tg_message_id)) == "compose"
    assert rec().text == "Daha qısa variant." and rec().regen_count == 1
    assert "daha qısa yaz" in crm_env.gemini_calls[-1][1][-1]["parts"][0]["text"]


def test_window_closed_not_sent(api, crm_env):
    _, conv_id = mk_conv(window=False)
    r = ready(api, crm_env, conv_id)
    assert result(callback(api, f"o:{r.id}:b")) == "error"
    assert not crm_env.kapso() and rec().status == "ready"
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("⚠️ Göndərilmədi: 24 saat keçib")


# --- göndəriş: Instagram ---

def test_ig_flow_b(api, net, crm_env):
    ig_item()
    r = ready(api, crm_env, "555", ch="ig")
    assert r.name == "@aysel"
    assert result(callback(api, f"o:{r.id}:b")) == "sent"
    assert graph_texts(net) == [NICE]
    assert [i.status for i in [one(SocialItem)]] == ["rejected"]  # gözləyən qaralama köhnəlib
    with SessionLocal() as db:
        assert social_inbox.ig_mode(db, "555") == "bot"
    assert rec().status == "sent"


def test_ig_flow_h_silences_thread(api, net, crm_env):
    ig_item()
    r = ready(api, crm_env, "555", ch="ig")
    assert result(callback(api, f"o:{r.id}:h")) == "sent"
    assert graph_texts(net) == [NICE]
    with SessionLocal() as db:
        assert friends.is_ig_friend(db, "555")


def test_ig_window_closed(api, net, crm_env):
    ig_item(ago=30)
    r = ready(api, crm_env, "555", ch="ig")
    assert result(callback(api, f"o:{r.id}:b")) == "error"
    assert not graph_texts(net) and rec().status == "ready"
    assert "Göndərilmədi" in crm_env.tg("editMessageText")[-1]["text"]


# --- icazə və köhnə yol ---

def test_foreign_chat_ignored(api, crm_env):
    _, conv_id = mk_conv()
    assert result(callback(api, f"o:w:wa:{conv_id}", chat="123")) == "ignored"
    assert rec() is None
    r = prompt(api, conv_id)
    crm_env.gemini({"reply": NICE})
    assert result(post_msg(api, RAW, reply_to=r.prompt_message_id, chat="123")) == "ignored"
    assert rec().status == "await"
    crm_env.gemini({"reply": NICE})
    post_msg(api, RAW, reply_to=r.prompt_message_id)
    assert result(callback(api, f"o:{r.id}:b", chat="123")) == "ignored"
    assert not crm_env.kapso()


def test_unknown_conversation(api, crm_env):
    assert result(callback(api, "o:w:wa:999")) == "ignored" and rec() is None


def test_plain_draft_reply_still_regenerates(api, crm_env):
    _, conv_id = mk_conv(text="Qiymət nədir?")
    crm_env.gemini(jreply("Podkast 70 AZN-dir."))
    assert bot.handle(conv_id) == "draft"
    draft = one(BotDraft)
    assert result(post_msg(api, "qısa yaz", reply_to=draft.telegram_message_id)) == "regenerate"
    assert rec() is None
