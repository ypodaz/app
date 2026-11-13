"""«Bot yazır…» göstəricisi (02-inbox #18), contact_exclude → friends.set_wa və POST /clients təkrar nömrə."""
from test_social_inbox import net  # noqa: F401,I001
from test_inbox_events import evs, mk_client  # noqa: F401,I001
from test_admin_social_inbox import mk  # noqa: F401,I001
from test_auth import admin_token, api, bearer  # noqa: F401,I001
from crm_helpers import crm_env, jreply, mk_conv  # noqa: F401,I001

from sqlalchemy import select  # noqa: E402

from crm import bot, social_inbox, typing_state  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import BotDraft, Client, WaContact, WaConversation  # noqa: E402

A = "/api/admin"


def test_typing_state_expires_and_clears(monkeypatch):
    typing_state.mark("wa:1")
    assert typing_state.is_typing("wa:1")
    typing_state.clear("wa:1")
    typing_state.clear("wa:1")  # təkrar təmizləmə xəta atmır
    assert not typing_state.is_typing("wa:1")
    typing_state.mark("wa:2")
    monkeypatch.setattr(typing_state.time, "monotonic", lambda: typing_state._since["wa:2"] + typing_state.TTL + 1)
    assert not typing_state.is_typing("wa:2")


def test_wa_bot_typing_during_generation(api, crm_env, monkeypatch):
    h = bearer(admin_token(api))
    _, conv_id = mk_conv(text="Salam, qiymət?")
    seen = []
    real = bot.converse

    def spy(system, contents):
        seen.append(api.get(f"{A}/inbox/{conv_id}", headers=h).json()["bot_typing"])
        return real(system, contents)

    monkeypatch.setattr(bot, "converse", spy)
    crm_env.gemini(jreply("Salam!"))
    assert bot.handle(conv_id) == "draft"
    assert seen == [True]
    assert api.get(f"{A}/inbox/{conv_id}", headers=h).json()["bot_typing"] is False


def test_wa_bot_typing_cleared_on_error(api, crm_env, monkeypatch):
    _, conv_id = mk_conv(text="Salam")

    def boom(system, contents):
        raise RuntimeError("x")

    monkeypatch.setattr(bot, "converse", boom)
    assert bot.handle(conv_id) == "error"
    assert not typing_state.is_typing(f"wa:{conv_id}")


def test_ig_bot_typing_during_generation(api, crm_env, net, monkeypatch):
    h = bearer(admin_token(api))
    item_id = mk(thread="555", draft=None)
    seen = []
    real = bot.converse

    def spy(system, contents):
        seen.append(api.get(f"{A}/social-inbox/dm/555", headers=h).json()["bot_typing"])
        return real(system, contents)

    monkeypatch.setattr(bot, "converse", spy)
    crm_env.gemini(jreply("Salam!"))
    social_inbox.draft(item_id)
    assert seen == [True]
    assert api.get(f"{A}/social-inbox/dm/555", headers=h).json()["bot_typing"] is False


# --- contact_exclude ---

def test_exclude_rejects_drafts_writes_event_and_include_returns_bot(api, crm_env):
    h = bearer(admin_token(api))
    cid, conv_id = mk_conv(name="Dost", mode="human")
    with SessionLocal() as db:
        db.add(BotDraft(conversation_id=conv_id, text="q"))
        db.commit()
    assert api.post(f"{A}/contacts/{cid}/exclude", json={"excluded": True}, headers=h).json() == {"id": cid, "excluded": True}
    with SessionLocal() as db:
        d = db.scalar(select(BotDraft))
        assert d.status == "rejected" and d.reason == "dostdur, bot yazmır"
        assert db.get(WaContact, cid).excluded is True
    assert evs("wa", conv_id)  # dost hadisəsi yazıldı
    n = len(evs("wa", conv_id))
    assert api.post(f"{A}/contacts/{cid}/exclude", json={"excluded": False}, headers=h).json()["excluded"] is False
    with SessionLocal() as db:
        assert db.get(WaContact, cid).excluded is False
        assert db.get(WaConversation, conv_id).mode == "bot"
    assert len(evs("wa", conv_id)) == n + 1


# --- POST /clients təkrar nömrə ---

def test_post_clients_duplicate_phone_409(api):
    cid = mk_client("Mövcud Şəxs", "+994 50 111 22 33")
    h = bearer(admin_token(api))
    r = api.post(f"{A}/clients", json={"full_name": "Təkrar Ad", "phone": "0501112233"}, headers=h)
    assert r.status_code == 409
    d = r.json()["detail"]
    assert d["client_id"] == cid and "Mövcud Şəxs" in d["message"]
    # telefonsuz müştərilər təkrar ola bilər, fərqli nömrə keçir
    assert api.post(f"{A}/clients", json={"full_name": "Telefonsuz Bir", "phone": ""}, headers=h).status_code == 200
    assert api.post(f"{A}/clients", json={"full_name": "Telefonsuz İki", "phone": ""}, headers=h).status_code == 200
    assert api.post(f"{A}/clients", json={"full_name": "Yeni Nömrə", "phone": "0559998877"}, headers=h).status_code == 200
    with SessionLocal() as db:
        assert db.query(Client).count() == 4
