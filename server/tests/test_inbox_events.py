"""Inbox: daxili qeyd, sistem sətirləri (handoff, rejim, avto-göndəriş, xatırlatma), yeni kontakt (02 #17, #19; 99 G8)."""
from test_crm_turns import auto, day, DAY  # noqa: F401,I001
from test_social_inbox import auto_mode, dm, items, net, post_ig  # noqa: F401,I001
from test_ig_turns import mode as ig_mode  # noqa: F401,I001
from test_auth import admin_token, api, bearer  # noqa: F401,I001
from crm_helpers import crm_env, jreply, mk_conv  # noqa: F401,I001

from datetime import timedelta  # noqa: E402

from sqlalchemy import select  # noqa: E402

from crm import bot, conf, ig_turns, turns  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import BotDraft, Client, ConversationEvent, Lead, WaMessage  # noqa: E402

A = "/api/admin"


def evs(channel="wa", ref=None, kind=None):
    with SessionLocal() as db:
        q = select(ConversationEvent).where(ConversationEvent.channel == channel).order_by(ConversationEvent.id)
        if ref is not None:
            q = q.where(ConversationEvent.ref == str(ref))
        if kind:
            q = q.where(ConversationEvent.kind == kind)
        return [(e.kind, e.text) for e in db.scalars(q)]


def mk_client(name="Aysel Nümunə", phone="+994 50 111 22 33"):
    with SessionLocal() as db:
        c = Client(full_name=name, phone=phone, card_code=f"C{name[:3]}{phone[-4:]}".replace(" ", ""))
        db.add(c)
        db.commit()
        return c.id


# --- daxili qeyd ---

def test_wa_note_is_internal_and_listed(api, crm_env):
    _, conv_id = mk_conv(mode="wait")
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="qaralama"))
        db.commit()
    h = bearer(admin_token(api))
    r = api.post(f"{A}/inbox/{conv_id}/note", json={"text": "  Zəng edəcəm  "}, headers=h)
    assert r.status_code == 200, r.text
    assert r.json()["kind"] == "note" and r.json()["text"] == "Zəng edəcəm" and r.json()["meta"]["author"] == "Siz"
    assert crm_env.kapso() == []  # müştəriyə heç nə getmir
    o = api.get(f"{A}/inbox/{conv_id}", headers=h).json()
    assert o["mode"] == "wait" and [d["status"] for d in o["drafts"]] == ["pending"]  # rejim və qaralama dəyişmir
    assert [(e["kind"], e["text"]) for e in o["thread_events"]] == [("note", "Zəng edəcəm")]
    assert len(o["messages"]) == 1  # qeyd mesaj deyil


def test_note_validation_and_404(api):
    _, conv_id = mk_conv()
    h = bearer(admin_token(api))
    assert api.post(f"{A}/inbox/{conv_id}/note", json={"text": "   "}, headers=h).status_code == 422
    assert api.post(f"{A}/inbox/{conv_id}/note", json={"text": ""}, headers=h).status_code == 422
    assert api.post(f"{A}/inbox/9999/note", json={"text": "x"}, headers=h).status_code == 404
    assert api.post(f"{A}/inbox/{conv_id}/note", json={"text": "x"}).status_code == 401


def test_note_reaches_client_card_history(api):
    cid = mk_client(phone="+994 50 111 22 33")
    _, conv_id = mk_conv(phone="994501112233")
    h = bearer(admin_token(api))
    api.post(f"{A}/inbox/{conv_id}/note", json={"text": "Keşbeki xatırlat"}, headers=h)
    d = api.get(f"{A}/clients/{cid}", headers=h).json()
    assert [n["text"] for n in d["chat_notes"]] == ["Keşbeki xatırlat"]
    other = mk_client("Başqa Şəxs", "+994 55 000 00 01")
    assert api.get(f"{A}/clients/{other}", headers=h).json()["chat_notes"] == []


def test_note_reaches_lead_history(api):
    ct, conv_id = mk_conv(phone="994509998877")
    with SessionLocal() as db:
        lead = Lead(contact_id=ct, phone="994509998877", name="Lead", stage="yeni")
        db.add(lead)
        db.flush()
        from models import WaConversation
        db.get(WaConversation, conv_id).lead_id = lead.id
        db.commit()
        lid = lead.id
    h = bearer(admin_token(api))
    api.post(f"{A}/inbox/{conv_id}/note", json={"text": "Podkast istəyir"}, headers=h)
    assert [n["text"] for n in api.get(f"{A}/leads/{lid}/notes", headers=h).json()] == ["Podkast istəyir"]
    assert api.get(f"{A}/leads/9999/notes", headers=h).status_code == 404


def test_ig_note(api, net, crm_env):
    crm_env.gemini(jreply("Salam!"))
    post_ig(api, dm())
    h = bearer(admin_token(api))
    r = api.post(f"{A}/social-inbox/dm/555/note", json={"text": "Reklamdan gəlib"}, headers=h)
    assert r.status_code == 200, r.text
    assert not [c for c in net.calls if c[1].endswith("/me/messages")]
    o = api.get(f"{A}/social-inbox/dm/555", headers=h).json()
    assert [(e["kind"], e["text"]) for e in o["thread_events"]] == [("note", "Reklamdan gəlib")]
    assert items()[0].status == "pending"  # qaralama toxunulmaz
    assert api.post(f"{A}/social-inbox/dm/nope/note", json={"text": "x"}, headers=h).status_code == 404
    assert api.post(f"{A}/social-inbox/dm/555/note", json={"text": " "}, headers=h).status_code == 422


# --- sistem sətirləri ---

def test_handoff_writes_system_lines(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(text="Endirim olar?")
    auto.gemini(jreply("Komandamıza ötürdüm.", handoff=True, handoff_reason="endirim"))
    assert bot.handle(conv_id) == "handoff:endirim"
    assert evs(ref=conv_id) == [("system", "Bot söhbəti komandaya ötürdü"),
                                ("system", "Bot niyə ötürdü: 10%-dən çox endirim istəyir")]


def test_handoff_in_draft_mode_writes_nothing(api, crm_env, monkeypatch):
    day(monkeypatch)  # bot_mode standart «draft»: rejim dəyişmir
    _, conv_id = mk_conv(text="Endirim olar?")
    crm_env.gemini(jreply("Komandamıza ötürdüm.", handoff=True, handoff_reason="endirim"))
    bot.handle(conv_id)
    assert evs(ref=conv_id) == []


def test_mode_change_and_friend_write_system_lines(api):
    _, conv_id = mk_conv(mode="bot")
    h = bearer(admin_token(api))
    api.post(f"{A}/inbox/{conv_id}/mode", json={"mode": "owner"}, headers=h)
    api.post(f"{A}/inbox/{conv_id}/mode", json={"mode": "owner"}, headers=h)  # eyni rejim: sətir yoxdur
    api.post(f"{A}/inbox/{conv_id}/mode", json={"mode": "human"}, headers=h)
    ct = api.get(f"{A}/inbox/{conv_id}", headers=h).json()["contact"]["id"]
    api.post(f"{A}/contacts/{ct}/exclude", json={"excluded": True}, headers=h)
    assert [t for _, t in evs(ref=conv_id)] == ["Rejim: Siz yazdınız", "Rejim: Bot susur", "Dostdur · bot yazmır"]


def test_owner_send_and_draft_approval_write_mode_lines(api, crm_env):
    _, conv_id = mk_conv(mode="bot")
    h = bearer(admin_token(api))
    assert api.post(f"{A}/inbox/{conv_id}/send", json={"text": "Salam"}, headers=h).status_code == 200
    with SessionLocal() as db:
        d = BotDraft(conversation_id=conv_id, text="Bəli.")
        db.add(d)
        db.commit()
        did = d.id
    assert api.post(f"{A}/drafts/{did}/send", headers=h).status_code == 200
    assert [t for _, t in evs(ref=conv_id)] == ["Rejim: Siz yazdınız", "Rejim: Bot aparır"]


def test_auto_send_writes_bot_sent_line(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(mode="owner")
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="Bəli, boşdur.", model_output={"asan": False},
                        auto_at=now() - timedelta(minutes=1), created_at=now() - timedelta(hours=1)))
        db.commit()
        assert turns.auto_send_due(db, now()) == 1
    assert evs(ref=conv_id) == [("system", "Bot özü göndərdi")]


def test_wait_reminder_writes_line(auto, monkeypatch):
    day(monkeypatch)
    _, conv_id = mk_conv(mode="wait")
    with SessionLocal() as db:
        conf.put(db, f"wait_since:{conv_id}", (DAY - timedelta(minutes=31)).isoformat())
        db.commit()
        assert turns.remind_waiting(db, DAY) == 1
        assert turns.remind_waiting(db, DAY + timedelta(minutes=30)) == 0
    assert evs(ref=conv_id) == [("system", "Xatırlatma göndərildi · 31 dəq")]


def test_ig_handoff_mode_auto_and_reminder_lines(api, net, crm_env, monkeypatch):
    day(monkeypatch)
    auto_mode()
    crm_env.gemini(jreply("Komandaya ötürürəm.", handoff=True, handoff_reason="sikayet"))
    post_ig(api, dm(mid="m1", text="Narazıyam"))
    assert ig_mode() == "wait"
    assert evs("ig", "555") == [("system", "Bot söhbəti komandaya ötürdü"), ("system", "Bot niyə ötürdü: Şikayət edir")]
    from datetime import datetime
    with SessionLocal() as db:
        since = datetime.fromisoformat(conf.get(db, "ig_wait:555"))
        assert ig_turns.remind_waiting(db, since + timedelta(minutes=31)) == 1
    assert evs("ig", "555")[-1] == ("system", "Xatırlatma göndərildi · 31 dəq")
    h = bearer(admin_token(api))
    api.post(f"{A}/social-inbox/dm/555/mode", json={"mode": "owner"}, headers=h)
    api.post(f"{A}/social-inbox/dm/555/friend", json={"friend": True}, headers=h)
    api.post(f"{A}/social-inbox/dm/555/friend", json={"friend": True}, headers=h)  # dəyişmir: təkrar sətir yox
    assert [t for _, t in evs("ig", "555")][-2:] == ["Rejim: Siz yazdınız", "Dostdur · bot yazmır"]


def test_ig_auto_send_line(api, net, crm_env, monkeypatch):
    from crm import social_inbox
    day(monkeypatch)
    auto_mode()
    monkeypatch.setattr(social_inbox, "ECHO_WAIT", 0)
    from test_social_inbox import echo
    post_ig(api, echo("evt-app1"))  # sahibkar yazdı: owner
    assert ig_mode() == "owner"
    crm_env.gemini(jreply("Salam, buyurun."))
    post_ig(api, dm(mid="m1"))
    with SessionLocal() as db:
        assert ig_turns.auto_send_due(db, now() + timedelta(hours=1, minutes=1)) == 1
    assert ("system", "Bot özü göndərdi") in evs("ig", "555")
    assert ("system", "Rejim: Siz yazdınız") in evs("ig", "555")


# --- yeni kontakt ---

def test_new_contact_creates_client(api):
    h = bearer(admin_token(api))
    r = api.post(f"{A}/contacts", json={"full_name": "Nümunə Müştəri", "phone": "050 111 22 33", "note": " Podkast "}, headers=h)
    assert r.status_code == 200, r.text
    j = r.json()
    assert j["full_name"] == "Nümunə Müştəri" and j["phone"] == "0501112233" and j["notes"] == "Podkast"
    with SessionLocal() as db:
        c = db.get(Client, j["id"])
        assert c.card_code and c.full_name == "Nümunə Müştəri"


def test_new_contact_duplicate_phone_409(api):
    cid = mk_client("Mövcud Şəxs", "+994 50 111 22 33")
    h = bearer(admin_token(api))
    r = api.post(f"{A}/contacts", json={"full_name": "Təkrar", "phone": "0501112233"}, headers=h)
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["client_id"] == cid and "Mövcud Şəxs" in d["message"]
    with SessionLocal() as db:
        assert db.query(Client).count() == 1


def test_new_contact_validation(api):
    h = bearer(admin_token(api))
    assert api.post(f"{A}/contacts", json={"full_name": "A", "phone": "0501112233"}, headers=h).status_code == 422
    assert api.post(f"{A}/contacts", json={"full_name": "Ad Soyad", "phone": ""}, headers=h).status_code == 422
    assert api.post(f"{A}/contacts", json={"full_name": "Ad Soyad", "phone": "abc"}, headers=h).status_code == 422
    assert api.post(f"{A}/contacts", json={"full_name": "Ad Soyad", "phone": "123"}, headers=h).status_code == 422
    assert api.post(f"{A}/contacts", json={"full_name": "Ad Soyad", "phone": "0501112233"}).status_code == 401
