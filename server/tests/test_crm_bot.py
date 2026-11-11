from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env, jreply, mk_conv, post_kapso  # noqa: F401,I001

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

import booking  # noqa: E402
import settings  # noqa: E402
from ai import AiError  # noqa: E402
from crm import bot, bot_prompt, conf, kapso, slots, worker  # noqa: E402
from crm_helpers import CHAT, TG_SECRET  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import (BotDraft, Block, Client, Faq, Lead, LeadEvent, Shoot, UnansweredQuestion, WaContact,  # noqa: E402
                    WaConversation, WaMessage)


def one(model, *where):
    with SessionLocal() as db:
        return db.scalar(select(model).where(*where).order_by(model.id.desc()))


def count(model, *where):
    with SessionLocal() as db:
        return len(db.scalars(select(model).where(*where)).all())


def callback(api, data, chat=CHAT, secret=TG_SECRET, cq_id="q1", message_id=901):
    body = {"callback_query": {"id": cq_id, "data": data, "message": {"message_id": message_id, "chat": {"id": int(chat)}}}}
    return api.post("/api/webhooks/telegram", json=body, headers={"X-Telegram-Bot-Api-Secret-Token": secret})


# --- keçid şərtləri ---

def _disable(db, cid, conv_id):
    conf.put(db, "bot_enabled", "false")


def _exclude(db, cid, conv_id):
    db.get(WaContact, cid).excluded = True


def _human(db, cid, conv_id):
    db.get(WaConversation, conv_id).mode = "human"


def _mute(db, cid, conv_id):
    db.get(WaContact, cid).bot_muted_until = now() + timedelta(hours=1)


def _last_bot(db, cid, conv_id):
    db.add(WaMessage(conversation_id=conv_id, direction="out", source="bot", text="x",
                     created_at=now() + timedelta(seconds=5)))


def _closed(db, cid, conv_id):
    db.get(WaConversation, conv_id).window_expires_at = now() - timedelta(minutes=1)


@pytest.mark.parametrize("setup,reason", [(_disable, "bot_disabled"), (_exclude, "excluded"), (_human, "human"),
                                          (_mute, "muted"), (_last_bot, "last_not_customer"),
                                          (_closed, "window_closed")])
def test_skip_conditions(api, crm_env, setup, reason):
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        setup(db, cid, conv_id)
        db.commit()
    assert bot.handle(conv_id) == f"skip:{reason}"
    assert crm_env.gemini_calls == [] and count(BotDraft) == 0 and crm_env.kapso() == []


def test_expired_mute_does_not_skip(api, crm_env):
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        db.get(WaContact, cid).bot_muted_until = now() - timedelta(minutes=1)
        db.commit()
    crm_env.gemini(jreply())
    assert bot.handle(conv_id) == "draft"


# --- qaralama axını ---

def test_draft_created_and_sent_to_telegram_with_buttons(api, crm_env):
    cid, conv_id = mk_conv(text="Qiymət nədir?")
    crm_env.gemini(jreply("Podkast 70 AZN-dən başlayır."))
    assert bot.handle(conv_id) == "draft"
    d = one(BotDraft)
    assert d.status == "pending" and d.text == "Podkast 70 AZN-dən başlayır." and d.telegram_message_id
    (msg,) = crm_env.tg("sendMessage")
    assert msg["chat_id"] == CHAT and "Aysel" in msg["text"] and "Qiymət nədir?" in msg["text"]
    assert "Podkast 70 AZN" in msg["text"]
    btns = msg["reply_markup"]["inline_keyboard"][0]
    assert [b["callback_data"] for b in btns] == [f"d:{d.id}:s", f"d:{d.id}:r"]
    assert crm_env.kapso() == []  # susmaya görə müştəriyə heç nə getmir


def test_callback_send_and_reject_and_repeat(api, crm_env):
    _, conv_id = mk_conv()
    crm_env.gemini(jreply("Cavab 1"))
    bot.handle(conv_id)
    d = one(BotDraft)
    assert callback(api, f"d:{d.id}:s").json()["result"] == "sent"
    (url, body), = crm_env.kapso()
    assert body["to"] == "994501112233" and body["text"]["body"] == "Cavab 1" and "pn1" in url
    assert one(BotDraft).status == "sent"
    out = one(WaMessage, WaMessage.direction == "out")
    assert out.source == "bot" and out.wamid
    assert any("Göndərildi" in j["text"] for j in crm_env.tg("editMessageText"))
    assert any("Göndərildi" in j["text"] for j in crm_env.tg("answerCallbackQuery"))
    # təkrar callback
    assert callback(api, f"d:{d.id}:s").json()["result"] == "resolved"
    assert crm_env.tg("answerCallbackQuery")[-1]["text"] == "artıq həll olunub"
    assert len(crm_env.kapso()) == 1
    # rədd
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="başqa"))
        db.commit()
    d2 = one(BotDraft)
    assert callback(api, f"d:{d2.id}:r").json()["result"] == "rejected"
    assert one(BotDraft, BotDraft.id == d2.id).status == "rejected" and len(crm_env.kapso()) == 1
    assert any("Rədd edildi" in j["text"] for j in crm_env.tg("editMessageText"))


def test_telegram_wrong_secret_and_foreign_chat(api, crm_env):
    _, conv_id = mk_conv()
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="x"))
        db.commit()
    d = one(BotDraft)
    assert callback(api, f"d:{d.id}:s", secret="yanlis").status_code == 401
    assert callback(api, f"d:{d.id}:s", chat="999").json()["result"] == "ignored"
    assert one(BotDraft).status == "pending" and crm_env.kapso() == []


def test_callback_send_failure_shown_in_telegram(api, crm_env):
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="gec qaldı"))
        db.commit()
        db.get(WaConversation, conv_id).window_expires_at = now() - timedelta(minutes=1)
        db.commit()
    d = one(BotDraft)
    assert callback(api, f"d:{d.id}:s").json()["result"] == "error"
    assert "24 saat keçib, şablon lazımdır" in crm_env.tg("answerCallbackQuery")[-1]["text"]
    assert one(BotDraft).status == "pending" and crm_env.kapso() == []
    # Kapso özü 131047 qaytarsa
    with SessionLocal() as db:
        db.get(WaConversation, conv_id).window_expires_at = now() + timedelta(hours=1)
        db.commit()
    crm_env.kapso_error = {"code": 131047, "message": "Re-engagement"}
    assert callback(api, f"d:{d.id}:s").json()["result"] == "error"
    assert "24 saat keçib" in crm_env.tg("editMessageText")[-1]["text"]


def test_new_message_replaces_pending_draft(api, crm_env):
    _, conv_id = mk_conv()
    crm_env.gemini(jreply("birinci"), jreply("ikinci"))
    bot.handle(conv_id)
    with SessionLocal() as db:
        db.add(WaMessage(conversation_id=conv_id, direction="in", source="customer", text="yenə",
                         created_at=now() + timedelta(seconds=2)))
        db.commit()
    assert bot.handle(conv_id) == "draft"
    first, second = [d for d in (one(BotDraft, BotDraft.text == "birinci"), one(BotDraft, BotDraft.text == "ikinci"))]
    assert first.status == "rejected" and first.reason == "yeni mesaj gəldi" and second.status == "pending"
    assert len(crm_env.tg("sendMessage")) == 2


def test_auto_mode_sends_immediately(api, crm_env):
    _, conv_id = mk_conv()
    with SessionLocal() as db:
        conf.put(db, "bot_mode", "auto")
        db.commit()
    crm_env.gemini(jreply("Salam, buyurun"))
    assert bot.handle(conv_id) == "sent"
    (_, body), = crm_env.kapso()
    assert body["text"]["body"] == "Salam, buyurun" and count(BotDraft) == 0
    assert one(WaMessage, WaMessage.direction == "out").source == "bot"
    assert crm_env.tg("sendMessage") == []


def test_auto_mode_failure_falls_back_to_draft(api, crm_env):
    _, conv_id = mk_conv()
    with SessionLocal() as db:
        conf.put(db, "bot_mode", "auto")
        db.commit()
    crm_env.kapso_error = {"code": 131047, "message": "x"}
    crm_env.gemini(jreply("Salam"))
    assert bot.handle(conv_id) == "draft"
    assert "göndərilmədi" in one(BotDraft).reason and crm_env.alerts


# --- filtr ---

@pytest.mark.parametrize("bad", ["Kartım 4169 7388 1234 5678 ora göndərin", "Bizim ekip sizə kömək edər",
                                 "Bu ən yaxşı studiyadır", "Studiya icarəsi var", "x" * 901])
def test_filter_blocks_after_one_retry_and_hands_off(api, crm_env, bad):
    _, conv_id = mk_conv()
    crm_env.gemini(jreply(bad), jreply(bad))
    assert bot.handle(conv_id) == "handoff:filtr"
    assert len(crm_env.gemini_calls) == 2 and "QƏBUL EDİLMƏDİ" in crm_env.gemini_calls[1][0]
    assert crm_env.kapso() == [] and count(BotDraft) == 0
    assert one(WaConversation).mode == "human"
    assert any(k.startswith("handoff:") for k, _ in crm_env.alerts)


def test_filter_retry_can_succeed(api, crm_env):
    _, conv_id = mk_conv()
    crm_env.gemini(jreply("4169738812345678"), "```json\n" + __import__("json").dumps(jreply("Təmiz cavab")) + "\n```")
    assert bot.handle(conv_id) == "draft"
    assert one(BotDraft).text == "Təmiz cavab"


def test_check_filter_unit():
    assert bot.check_filter("Telefon 055 530 35 32") is None
    assert bot.check_filter("4169-7388-1234-5678")
    assert bot.check_filter("saat 12:00") is None
    assert bot.check_filter("Sizin için uygun saat") and bot.check_filter("Sizin için uygun saat", "tr") is None


# --- Gemini xətası ---

def test_gemini_error_hands_conversation_to_human(api, crm_env):
    _, conv_id = mk_conv()
    crm_env.gemini(AiError("AI cavab vermədi"))
    assert bot.handle(conv_id) == "ai_error"
    assert one(WaConversation).mode == "human" and count(BotDraft) == 0
    (key, text), = crm_env.alerts
    assert key == "bot-ai-down" and "AI cavab vermir, söhbət sizə keçdi" in text


def test_unparseable_twice_counts_as_ai_error(api, crm_env):
    _, conv_id = mk_conv()
    crm_env.gemini("salam, bu JSON deyil", "yenə deyil")
    assert bot.handle(conv_id) == "ai_error" and one(WaConversation).mode == "human"


# --- lead ---

def test_lead_collected_stage_forward_only_and_capped(api, crm_env):
    cid, conv_id = mk_conv()
    crm_env.gemini(jreply(stage="maraqlanir", lead={"name": "Aysel", "service": "podkast", "people": 2, "cameras": 2,
                                                    "editing": True, "preferred_date": "cümə"},
                          unanswered_question="Parkinq var?"))
    bot.handle(conv_id)
    lead = one(Lead)
    assert (lead.name, lead.service, lead.people, lead.cameras, lead.editing, lead.stage, lead.source) == \
        ("Aysel", "podkast", 2, 2, True, "maraqlanir", "whatsapp")
    assert one(WaConversation).lead_id == lead.id and lead.phone == "994501112233"
    assert one(UnansweredQuestion).question == "Parkinq var?"
    kinds = [e.kind for e in _events(lead.id)]
    assert "created" in kinds and "update" in kinds and "stage" in kinds
    # geri getmir, boş sahələr köhnəni silmir, bot beh-dən yuxarı qaldırmır
    _more(conv_id)
    crm_env.gemini(jreply(stage="yeni", lead={"people": None}))
    bot.handle(conv_id)
    assert one(Lead).stage == "maraqlanir" and one(Lead).people == 2
    _more(conv_id)
    crm_env.gemini(jreply(stage="tesdiq"))
    bot.handle(conv_id)
    assert one(Lead).stage == "maraqlanir"
    _more(conv_id)
    crm_env.gemini(jreply(stage="beh"))
    bot.handle(conv_id)
    assert one(Lead).stage == "beh"
    assert count(Lead) == 1


def _events(lead_id):
    with SessionLocal() as db:
        return db.scalars(select(LeadEvent).where(LeadEvent.lead_id == lead_id)).all()


def _more(conv_id):
    with SessionLocal() as db:
        db.add(WaMessage(conversation_id=conv_id, direction="in", source="customer", text="davam",
                         created_at=now() + timedelta(seconds=count(WaMessage) + 1)))
        db.commit()


def test_handoff_sets_human_alerts_and_still_drafts_handoff_sentence(api, crm_env):
    _, conv_id = mk_conv(text="Qiymətdə endirim olar?")
    crm_env.gemini(jreply("Bunu komandamıza ötürürəm.", handoff=True, handoff_reason="endirim"))
    assert bot.handle(conv_id) == "handoff:endirim"
    assert one(WaConversation).mode == "human"
    d = one(BotDraft)
    assert d.text == "Bunu komandamıza ötürürəm." and d.reason == "handoff:endirim"
    (key, text), = crm_env.alerts
    for part in ("Aysel", "994501112233", "endirim", "Qiymətdə endirim olar?", "Bunu komandamıza", "#inbox/"):
        assert part in text


def test_history_roles_and_prompt_inputs(api, crm_env):
    cid, conv_id = mk_conv(text="son sual")
    with SessionLocal() as db:
        db.add(Faq(question="Parkinq var?", answer="Bəli, həyətdə."))
        db.add(Faq(question="Gizli?", answer="yox", active=False))
        for i, (src, d) in enumerate([("history", "in"), ("customer", "in"), ("bot", "out"), ("phone", "out")]):
            db.add(WaMessage(conversation_id=conv_id, direction=d, source=src, text=f"{src}-mətn",
                             created_at=now() - timedelta(minutes=10 - i)))
        db.commit()
    crm_env.gemini(jreply())
    bot.handle(conv_id)
    system, contents = crm_env.gemini_calls[0]
    assert "Parkinq var?" in system and "Gizli?" not in system and "Bəli, həyətdə." in system
    assert "{prices}" not in system and "{lead}" not in system and '{"reply"' in system
    assert "Studiyada çəkiliş, 1 saat" in system  # ai._price_lines
    assert "Bakı vaxtı" in system and "- bəli" not in system
    roles = [c["role"] for c in contents]
    assert roles == ["user", "model", "user"] and "history-mətn" not in str(contents)  # bot+phone birləşir
    assert "bot-mətn" in str(contents) and "phone-mətn" in str(contents)


def test_prompt_render_does_not_reprocess_inserted_text():
    out = bot_prompt.render(prices="P", faqs="S: {lead}\nC: {now}", free_slots="s", now="N", first_message="bəli",
                            lead="L")
    assert "S: {lead}" in out and "C: {now}" in out and '"handoff": true|false' in out


# --- boş saatlar ---

def test_free_text_subtracts_shoots_blocks_cancelled_and_short_gaps(api):
    now_dt = datetime(2026, 11, 11, 5, 0, tzinfo=timezone.utc)  # Bakı: çərşənbə 09:00 → təklif 11:00-dan
    utc = lambda d, h, m=0: datetime(2026, 11, d, h, m, tzinfo=timezone.utc)  # noqa: E731
    with SessionLocal() as db:
        c = Client(full_name="Test Müştəri", card_code="CARD1")
        db.add(c)
        db.flush()
        mk = lambda start, dur, status="confirmed": db.add(Shoot(  # noqa: E731
            client_id=c.id, tag="podcast", location="studio", starts_at=start, duration_min=dur, cameras=1,
            status=status, prep_min=15, wrap_min=0))
        mk(utc(11, 10), 120)  # Bakı 14:00–16:00, prep ilə 13:45
        mk(utc(11, 13), 60, "cancelled")  # ləğv: sayılmır
        db.add(Block(starts_at=utc(11, 16), ends_at=utc(11, 17, 30)))  # Bakı 20:00–21:30
        db.add(Block(starts_at=utc(13, 4), ends_at=utc(13, 17, 20)))  # cümə Bakı 08:00–21:20 → qalan 40 dəq atılır
        db.commit()
        text = slots.free_text(db, now_dt)
    lines = text.splitlines()
    assert lines[0] == "Çərşənbə 11.11: 11:00–13:45, 16:00–20:00"
    assert lines[1] == "Cümə axşamı 12.11: 08:00–22:00"
    assert not any(l.startswith("Cümə 13.11") for l in lines)
    assert len(lines) == 6 and lines[-1].startswith("Çərşənbə axşamı 17.11")


# --- confirm ---

def _lead_for(phone="994501112233", name="Aysel Həsənova"):
    cid, conv_id = mk_conv(phone=phone)
    with SessionLocal() as db:
        lead = Lead(contact_id=cid, name=name, phone=phone, service="podkast", stage="beh")
        db.add(lead)
        db.flush()
        db.get(WaConversation, conv_id).lead_id = lead.id
        db.commit()
        return lead.id


def _confirm_body(hours=72):
    start = (now() + timedelta(hours=hours)).replace(minute=0, second=0, microsecond=0)
    return {"starts_at": start.isoformat(), "duration_min": 60, "cameras": 2, "editing": True, "location": "studio",
            "kind": "shoot"}


def test_lead_confirm_creates_shoot_matches_client_by_phone_and_conflicts(api):
    adm = bearer(admin_token(api))
    with SessionLocal() as db:
        db.add(Client(full_name="Köhnə Müştəri", phone="0501112233", card_code="OLD1"))
        db.commit()
    lid = _lead_for()
    r = api.post(f"/api/admin/leads/{lid}/confirm", json=_confirm_body(), headers=adm)
    assert r.status_code == 200, r.text
    body = r.json()
    with SessionLocal() as db:
        s = db.get(Shoot, body["shoot_id"])
        assert s.client_id == db.scalar(select(Client.id).where(Client.card_code == "OLD1")) and s.tag == "podcast"
        assert db.get(Lead, lid).stage == "tesdiq" and db.get(Lead, lid).shoot_id == s.id
        assert len(db.scalars(select(Client)).all()) == 1  # yenisi yaradılmadı
    assert api.post(f"/api/admin/leads/{lid}/confirm", json=_confirm_body(), headers=adm).status_code == 409
    # toqquşma
    lid2 = _lead_for(phone="994551234567", name="Başqa Biri")
    r = api.post(f"/api/admin/leads/{lid2}/confirm", json=_confirm_body(), headers=adm)
    assert r.status_code == 409 and r.json()["detail"]["conflicts"]
    r = api.post(f"/api/admin/leads/{lid2}/confirm", json=_confirm_body(hours=100), headers=adm)
    assert r.status_code == 200
    with SessionLocal() as db:
        assert db.get(Client, r.json()["client_id"]).full_name == "Başqa Biri"  # mövcud qaydada yeni müştəri


# --- panel ---

def test_panel_send_closed_window_409_and_open_ok(api, crm_env):
    adm = bearer(admin_token(api))
    _, closed = mk_conv(window=False)
    assert api.post(f"/api/admin/inbox/{closed}/send", json={"text": "salam"}, headers=adm).status_code == 409
    assert crm_env.kapso() == []
    _, open_ = mk_conv(phone="994559990000")
    r = api.post(f"/api/admin/inbox/{open_}/send", json={"text": "salam"}, headers=adm)
    assert r.status_code == 200 and r.json()["source"] == "panel" and len(crm_env.kapso()) == 1


def test_inbox_list_open_mode_exclude_and_unread(api, crm_env):
    adm = bearer(admin_token(api))
    cid, conv_id = mk_conv(name="Leyla")
    with SessionLocal() as db:
        db.get(WaConversation, conv_id).unread = 3
        db.add(BotDraft(conversation_id=conv_id, text="q"))
        db.commit()
    (item,) = api.get("/api/admin/inbox", headers=adm).json()
    assert item["unread"] == 3 and item["pending_drafts"] == 1 and item["contact"]["name"] == "Leyla"
    assert api.get("/api/admin/inbox?mode=human", headers=adm).json() == []
    assert len(api.get("/api/admin/inbox?q=ley", headers=adm).json()) == 1
    full = api.get(f"/api/admin/inbox/{conv_id}", headers=adm).json()
    assert full["messages"][0]["text"] == "Salam" and full["drafts"][0]["status"] == "pending" and full["window_open"]
    assert api.get("/api/admin/inbox", headers=adm).json()[0]["unread"] == 0
    assert api.post(f"/api/admin/inbox/{conv_id}/mode", json={"mode": "human"}, headers=adm).json()["mode"] == "human"
    assert api.post(f"/api/admin/contacts/{cid}/exclude", json={"excluded": True}, headers=adm).status_code == 200
    assert one(WaContact).excluded is True
    assert api.get("/api/admin/inbox/9999", headers=adm).status_code == 404


def test_admin_draft_edit_send_and_reject(api, crm_env):
    adm = bearer(admin_token(api))
    _, conv_id = mk_conv()
    crm_env.gemini(jreply("asılı cavab"))
    bot.handle(conv_id)
    d = one(BotDraft)
    r = api.post(f"/api/admin/drafts/{d.id}/send", json={"text": "dəyişdirilmiş cavab"}, headers=adm)
    assert r.status_code == 200 and r.json()["status"] == "edited"
    assert one(BotDraft).model_output["reply"] == "asılı cavab" and crm_env.kapso()[0][1]["text"]["body"] == "dəyişdirilmiş cavab"
    assert api.post(f"/api/admin/drafts/{d.id}/send", headers=adm).status_code == 409
    assert api.post(f"/api/admin/drafts/{d.id}/reject", headers=adm).status_code == 409


def test_admin_requires_auth(api):
    for path in ("/api/admin/inbox", "/api/admin/leads", "/api/admin/faqs", "/api/admin/bot/settings"):
        assert api.get(path).status_code == 401


def test_leads_faqs_quick_replies_unanswered_settings(api, crm_env):
    adm = bearer(admin_token(api))
    lid = _lead_for()
    assert [x["id"] for x in api.get("/api/admin/leads?stage=beh", headers=adm).json()] == [lid]
    r = api.patch(f"/api/admin/leads/{lid}", json={"stage": "tarix", "notes": "zəng et", "people": 3}, headers=adm)
    assert r.status_code == 200 and r.json()["stage"] == "tarix" and r.json()["people"] == 3
    assert "stage" in [e.kind for e in _events(lid)]
    f = api.post("/api/admin/faqs", json={"question": "S?", "answer": "C"}, headers=adm).json()
    assert api.patch(f"/api/admin/faqs/{f['id']}", json={"active": False}, headers=adm).json()["active"] is False
    assert api.delete(f"/api/admin/faqs/{f['id']}", headers=adm).status_code == 200 and api.get("/api/admin/faqs", headers=adm).json() == []
    q = api.post("/api/admin/quick-replies", json={"title": "Kart", "text": "mətn"}, headers=adm).json()
    assert api.patch(f"/api/admin/quick-replies/{q['id']}", json={"text": "yeni"}, headers=adm).json()["text"] == "yeni"
    assert api.delete(f"/api/admin/quick-replies/{q['id']}", headers=adm).status_code == 200
    with SessionLocal() as db:
        db.add(UnansweredQuestion(question="Parkinq?"))
        db.commit()
    (u,) = api.get("/api/admin/unanswered", headers=adm).json()
    r = api.post(f"/api/admin/unanswered/{u['id']}/resolve", json={"answer": "Bəli"}, headers=adm).json()
    assert r["resolved"] and r["faq"]["question"] == "Parkinq?" and api.get("/api/admin/unanswered", headers=adm).json() == []
    s = api.get("/api/admin/bot/settings", headers=adm).json()
    assert s["bot_enabled"] is True and s["bot_mode"] == "draft" and s["kapso_month_limit"] == 2000
    s = api.post("/api/admin/bot/settings", json={"bot_mode": "auto", "bot_enabled": False}, headers=adm).json()
    assert s["bot_mode"] == "auto" and s["bot_enabled"] is False
    assert api.post("/api/admin/bot/settings", json={"bot_mode": "x"}, headers=adm).status_code == 422


def test_bot_test_endpoint_saves_and_sends_nothing(api, crm_env):
    adm = bearer(admin_token(api))
    crm_env.gemini(jreply("Test cavabı", lead={"name": "X"}, stage="beh"))
    before = (count(Lead), count(WaMessage), count(BotDraft))
    r = api.post("/api/admin/bot/test", headers=adm, json={
        "history": [{"role": "bot", "text": "Sabah 11:00 boşdur"}, {"role": "user", "text": "yaxşı"}],
        "message": "16:00 olsun", "now": "2026-11-12 23:30", "slots": ["sabah 11:00–13:00"]})
    assert r.status_code == 200 and r.json()["reply"] == "Test cavabı" and r.json()["lead"]["name"] == "X"
    assert (count(Lead), count(WaMessage), count(BotDraft)) == before and crm_env.http == []
    system, contents = crm_env.gemini_calls[0]
    assert "sabah 11:00–13:00" in system and "23:30" in system and contents[0]["role"] == "user"
    crm_env.gemini(AiError("x"))
    assert api.post("/api/admin/bot/test", headers=adm, json={"message": "a"}).status_code == 502
    assert api.post("/api/admin/bot/test", headers=adm, json={"message": "a", "now": "xyz"}).status_code == 422


# --- Kapso sayğacı ---

def test_kapso_counter_alerts_once_at_1600(api, crm_env, monkeypatch):
    monkeypatch.setattr(bot, "handle", lambda cid: None)
    with SessionLocal() as db:
        conf.put(db, f"kapso_msgs:{kapso._month()}", "1598")
        db.commit()
    post_kapso(api, __import__("crm_helpers").received("w1"), key="1")
    assert crm_env.alerts == []
    post_kapso(api, __import__("crm_helpers").received("w2"), key="2")  # 1600
    assert [k for k, _ in crm_env.alerts if k.startswith("kapso_alert")] == [f"kapso_alert:{kapso._month()}:1600"]
    post_kapso(api, __import__("crm_helpers").received("w3"), key="3")
    assert len([k for k, _ in crm_env.alerts if k.startswith("kapso_alert")]) == 1
    with SessionLocal() as db:
        assert kapso.month_count(db) == 1601


# --- follow-up ---

_n = iter(range(1, 1000))


def _followup_setup(hours=21, stage="maraqlanir"):
    cid, conv_id = mk_conv(phone=f"99450{next(_n):07d}")
    with SessionLocal() as db:
        t = now() - timedelta(hours=hours)
        conv = db.get(WaConversation, conv_id)
        conv.last_inbound_at, conv.window_expires_at, conv.last_message_at = t, t + timedelta(hours=24), t
        db.get(WaMessage, db.scalar(select(WaMessage.id).where(WaMessage.conversation_id == conv_id))).created_at = t
        lead = Lead(contact_id=cid, name="A", phone="994501112233", stage=stage)
        db.add(lead)
        db.flush()
        conv.lead_id = lead.id
        db.commit()
    return conv_id


def test_followup_creates_one_draft_only(api, crm_env):
    conv_id = _followup_setup()
    crm_env.gemini(jreply("Salam, hələ də maraqlanırsınızmı?"))
    with SessionLocal() as db:
        assert worker.run(db) == 1
        assert worker.run(db) == 0  # ikinci dəfə yox
    d = one(BotDraft)
    assert d.reason == "follow-up" and d.status == "pending" and len(crm_env.tg("sendMessage")) == 1
    assert crm_env.kapso() == [] and len(crm_env.gemini_calls) == 1
    assert conv_id and "followup" in [e.kind for e in _events(one(Lead).id)]


def test_followup_conditions(api, crm_env):
    _followup_setup(hours=15)
    _followup_setup(hours=21, stage="yeni")
    _followup_setup(hours=24)  # pəncərə bağlanıb
    answered = _followup_setup()
    with SessionLocal() as db:
        db.add(WaMessage(conversation_id=answered, direction="out", source="phone", text="cavab",
                         created_at=now() - timedelta(hours=1)))
        db.commit()
    with SessionLocal() as db:
        assert worker.run(db) == 0
    assert crm_env.gemini_calls == []


def test_followup_in_auto_mode_is_still_a_draft(api, crm_env):
    _followup_setup()
    with SessionLocal() as db:
        conf.put(db, "bot_mode", "auto")
        db.commit()
    crm_env.gemini(jreply("Xatırlatma"))
    with SessionLocal() as db:
        assert worker.run(db) == 1
    assert crm_env.kapso() == [] and one(BotDraft).status == "pending"


# --- eval ---

def test_eval_mock_writes_report(api, tmp_path):
    import sys
    from pathlib import Path
    sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
    import bot_eval
    import ai
    scen = tmp_path / "s.json"
    scen.write_text('{"global_must_not_contain": ["icarə"], "scenarios": ['
                    '{"id": 1, "name": "salam", "first_message": true, "message": "Salam", '
                    '"expect": {"handoff": false, "language": "az", "must_contain_any": ["virtual köməkçi"], "max_sentences": 3}},'
                    '{"id": 2, "name": "ünvan", "message": "ünvan?", "expect": {"handoff": true}}]}', encoding="utf-8")
    out = tmp_path / "r.md"
    before = ai.generate
    assert bot_eval.main(["--mock", "--scenarios", str(scen), "--out", str(out)]) == 0
    assert ai.generate is before  # saxta model sızmır
    text = out.read_text(encoding="utf-8")
    assert "| 1 | salam | ✅ keçdi" in text and "| 2 | ünvan | ❌ düşdü" in text and "Ümumi: 1/2 keçdi (50%)" in text
    assert bot_eval.detect_lang("Здравствуйте") == "ru" and bot_eval.detect_lang("Salam, əla") == "az"
    assert bot_eval.detect_lang("Hello, our studio is in Baku") == "en"
