from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import CHAT, TG_SECRET, Resp, crm_env, jreply  # noqa: F401,I001

import hashlib  # noqa: E402
import hmac  # noqa: E402
import json  # noqa: E402
from datetime import timedelta  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

import settings  # noqa: E402
from crm import conf, social_inbox, social_tg, youtube  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import SocialItem  # noqa: E402

APP_SECRET, ME, CHANNEL = "ig-secret", "17841400000000001", "UCypod"


class Net:
    def __init__(self):
        self.calls = []  # (method, url, kw)
        self.threads = []  # YouTube commentThreads cavabı
        self.ig_error = None


@pytest.fixture()
def net(crm_env, monkeypatch):
    n = Net()
    for k, v in {"IG_ACCESS_TOKEN": "igtok", "IG_APP_SECRET": APP_SECRET, "IG_VERIFY_TOKEN": "verify-me",
                 "IG_USER_ID": ME, "YT_CLIENT_ID": "cid", "YT_CLIENT_SECRET": "csec", "YT_REFRESH_TOKEN": "rt",
                 "YT_CHANNEL_ID": CHANNEL}.items():
        monkeypatch.setattr(settings, k, v)
    monkeypatch.setattr(youtube, "_token", {"value": "", "until": 0.0})
    monkeypatch.setattr(social_tg, "_background", lambda fn, *a: fn(*a))
    base_post = httpx.post

    def fake_post(url, **kw):
        if "graph.instagram.com" in url or "googleapis.com" in url:
            n.calls.append(("POST", url, kw))
            if "oauth2.googleapis.com" in url:
                return Resp(200, {"access_token": "yt-access", "expires_in": 3600})
            if "graph.instagram.com" in url and n.ig_error:
                return Resp(400, {"error": {"message": n.ig_error}})
            return Resp(200, {"id": "out1", "message_id": "mid.out1"})
        return base_post(url, **kw)

    def fake_get(url, **kw):
        n.calls.append(("GET", url, kw))
        assert "youtube/v3/commentThreads" in url
        return Resp(200, {"items": n.threads})

    monkeypatch.setattr(httpx, "post", fake_post)
    monkeypatch.setattr(httpx, "get", fake_get)
    return n


def sig(raw: bytes) -> str:
    return "sha256=" + hmac.new(APP_SECRET.encode(), raw, hashlib.sha256).hexdigest()


def post_ig(api, body, signature=None):
    raw = json.dumps(body).encode()
    return api.post("/api/webhooks/instagram", content=raw,
                    headers={"X-Hub-Signature-256": signature if signature is not None else sig(raw),
                             "Content-Type": "application/json"})


def dm(mid="m1", text="Salam, qiymət nədir?", sender="555", echo=False):
    msg = {"mid": mid, "text": text}
    if echo:
        msg["is_echo"] = True
    return {"object": "instagram", "entry": [{"id": ME, "time": 1, "messaging": [
        {"sender": {"id": sender}, "recipient": {"id": ME}, "timestamp": int(now().timestamp() * 1000),
         "message": msg}]}]}


def comment(cid="c1", text="Çox gözəl!", frm="777", username="aysel", parent=None):
    v = {"id": cid, "from": {"id": frm, "username": username}, "text": text, "media": {"id": "media1"}}
    if parent:
        v["parent_id"] = parent
    return {"object": "instagram", "entry": [{"id": ME, "time": 1, "changes": [{"field": "comments", "value": v}]}]}


def items():
    with SessionLocal() as db:
        return db.scalars(select(SocialItem).order_by(SocialItem.id)).all()


def callback(api, data, message_id=901):
    body = {"callback_query": {"id": "q1", "data": data, "message": {"message_id": message_id, "chat": {"id": int(CHAT)}}}}
    return api.post("/api/webhooks/telegram", json=body, headers={"X-Telegram-Bot-Api-Secret-Token": TG_SECRET})


# --- webhook ---

def test_verify_token(api, net):
    q = "/api/webhooks/instagram?hub.mode=subscribe&hub.challenge=12345&hub.verify_token="
    r = api.get(q + "verify-me")
    assert r.status_code == 200 and r.text == "12345"
    assert api.get(q + "sehv").status_code == 403


def test_signature(api, net, crm_env):
    crm_env.gemini(jreply("Salam!"))
    assert post_ig(api, dm(), signature="sha256=deadbeef").status_code == 401
    assert post_ig(api, dm(), signature="").status_code == 401
    assert not items()
    assert post_ig(api, dm()).status_code == 200
    assert len(items()) == 1


def test_echo_own_and_textless_ignored(api, net, crm_env):
    post_ig(api, dm(mid="e1", echo=True))
    post_ig(api, dm(mid="e2", sender=ME))
    post_ig(api, dm(mid="e3", text=""))
    post_ig(api, comment(cid="own", frm=ME))
    assert not items() and not crm_env.gemini_calls and not crm_env.tg()


def test_dm_creates_item_draft_and_telegram(api, net, crm_env):
    crm_env.gemini(jreply("Salam! Mən Y Pod-un virtual köməkçisiyəm."))
    assert post_ig(api, dm()).status_code == 200
    post_ig(api, dm())  # təkrar webhook
    [it] = items()
    assert (it.channel, it.kind, it.thread_id, it.status) == ("instagram", "dm", "555", "pending")
    assert it.draft_text.startswith("Salam!") and it.tg_message_id
    system, contents = crm_env.gemini_calls[0]
    assert "Instagram DM" in system and contents[-1]["parts"][0]["text"] == "Salam, qiymət nədir?"
    [msg] = crm_env.tg("sendMessage")
    assert msg["text"].startswith("📸 Instagram DM")
    assert [b["callback_data"] for b in msg["reply_markup"]["inline_keyboard"][0]] == [f"x:{it.id}:s", f"x:{it.id}:g",
                                                                                       f"x:{it.id}:r"]


def test_dm_context_includes_previous_items(api, net, crm_env):
    crm_env.gemini(jreply("Salam!"), jreply("Bəli, var."))
    post_ig(api, dm(mid="m1", text="Salam"))
    callback(api, f"x:{items()[0].id}:s")
    post_ig(api, dm(mid="m2", text="Montaj var?"))
    contents = crm_env.gemini_calls[1][1]
    assert [c["role"] for c in contents] == ["user", "model", "user"]


def test_comment_empty_reply_ignored(api, net, crm_env):
    crm_env.gemini(jreply("", handoff=True, handoff_reason="diger"))
    post_ig(api, comment(text="spam spam"))
    [it] = items()
    assert it.status == "ignored" and not crm_env.tg() and not crm_env.alerts
    assert "ictimai kommentdir" in crm_env.gemini_calls[0][0]


# --- göndəriş ---

def test_send_dm(api, net, crm_env):
    crm_env.gemini(jreply("Salam!"))
    post_ig(api, dm())
    it = items()[0]
    assert callback(api, f"x:{it.id}:s").json()["result"] == "sent"
    [(_, url, kw)] = [c for c in net.calls if "graph.instagram.com" in c[1]]
    assert url == "https://graph.instagram.com/v24.0/me/messages"
    assert kw["json"] == {"recipient": {"id": "555"}, "message": {"text": "Salam!"}}
    assert kw["headers"]["Authorization"] == "Bearer igtok"
    assert items()[0].status == "sent"
    assert callback(api, f"x:{it.id}:s").json()["result"] == "resolved"


def test_send_comment_reply(api, net, crm_env):
    crm_env.gemini(jreply("Təşəkkürlər! Ətraflı məlumat üçün DM-ə yazın."))
    post_ig(api, comment(cid="c2", parent="c1"))
    it = items()[0]
    assert it.author == "aysel" and it.parent_id == "c1"
    assert callback(api, f"x:{it.id}:s").json()["result"] == "sent"
    [(_, url, kw)] = [c for c in net.calls if "graph.instagram.com" in c[1]]
    assert url.endswith("/v24.0/c1/replies") and kw["data"] == {"message": "Təşəkkürlər! Ətraflı məlumat üçün DM-ə yazın."}


def test_dm_window_closed(api, net, crm_env):
    crm_env.gemini(jreply("Salam!"))
    post_ig(api, dm())
    with SessionLocal() as db:
        db.get(SocialItem, items()[0].id).created_at = now() - timedelta(hours=25)
        db.commit()
    assert callback(api, f"x:{items()[0].id}:s").json()["result"] == "error"
    assert not [c for c in net.calls if "graph.instagram.com" in c[1]]
    assert items()[0].status == "pending"
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("⚠️ Göndərilmədi: son müştəri mesajından 24 saat")


def test_send_api_error_shown(api, net, crm_env):
    crm_env.gemini(jreply("Salam!"))
    post_ig(api, dm())
    net.ig_error = "Token bitib"
    assert callback(api, f"x:{items()[0].id}:s").json()["result"] == "error"
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("⚠️ Göndərilmədi: Token bitib")


def test_reject_and_regenerate_limit(api, net, crm_env):
    crm_env.gemini(jreply("Variant 1"), jreply("Variant 2"), jreply("Variant 3"), jreply("Variant 4"))
    post_ig(api, dm())
    iid = items()[0].id
    for n in range(3):
        assert callback(api, f"x:{iid}:g").json()["result"] == "social_regenerate"
        assert items()[0].draft_text == f"Variant {n + 2}"
        assert "BƏYƏNMƏDİ" in crm_env.gemini_calls[-1][0]
    assert callback(api, f"x:{iid}:g").json()["result"] == "limit"
    assert callback(api, f"x:{iid}:r").json()["result"] == "rejected"
    assert items()[0].status == "rejected"
    assert len(crm_env.gemini_calls) == 4


# --- YouTube ---

def thread(cid, text, minutes_ago, author_channel="UCother"):
    t = (now() - timedelta(minutes=minutes_ago)).strftime("%Y-%m-%dT%H:%M:%SZ")
    return {"snippet": {"videoId": "vid1", "canReply": True, "topLevelComment": {"id": cid, "snippet": {
        "authorDisplayName": "Murad", "authorChannelId": {"value": author_channel}, "textOriginal": text,
        "publishedAt": t}}}}


def test_youtube_poll_new_only(api, net, crm_env):
    net.threads = [thread("old", "köhnə", 600)]
    with SessionLocal() as db:
        assert youtube.poll(db) == []  # ilk dəfə: yalnız başlanğıc vaxtı
        conf.put(db, youtube.LAST_KEY, (now() - timedelta(minutes=30)).isoformat())
        db.commit()
    net.threads = [thread("new", "Studiya harada yerləşir?", 5), thread("mine", "cavab", 3, CHANNEL),
                   thread("old", "köhnə", 600)]
    crm_env.gemini(jreply("Salam! Ünvan DM-də."))
    youtube.tick()
    [it] = items()
    assert (it.channel, it.external_id, it.parent_id, it.thread_id, it.author) == ("youtube", "new", "new", "vid1", "Murad")
    assert crm_env.tg("sendMessage")[0]["text"].startswith("▶️ YouTube komment")
    get = [c for c in net.calls if c[0] == "GET"][-1]
    assert get[2]["params"]["allThreadsRelatedToChannelId"] == CHANNEL and get[2]["headers"]["Authorization"] == "Bearer yt-access"
    youtube.tick()  # eyni siyahı: təkrar götürülmür
    assert len(items()) == 1 and len(crm_env.gemini_calls) == 1
    assert callback(api, f"x:{it.id}:s").json()["result"] == "sent"
    ins = [c for c in net.calls if c[1].endswith("/youtube/v3/comments")][0]
    assert ins[2]["json"] == {"snippet": {"parentId": "new", "textOriginal": "Salam! Ünvan DM-də."}}


def test_disabled_when_env_empty(api, net, crm_env, monkeypatch):
    for k in ("IG_ACCESS_TOKEN", "IG_APP_SECRET", "IG_USER_ID", "YT_REFRESH_TOKEN"):
        monkeypatch.setattr(settings, k, "")
    r = post_ig(api, dm(), signature="sha256=xx")
    assert r.status_code == 200 and r.json()["disabled"]
    youtube.tick()
    with SessionLocal() as db:
        assert youtube.poll(db) == [] and conf.get(db, youtube.LAST_KEY) is None
    assert not items() and not net.calls and not crm_env.gemini_calls and not crm_env.http


# --- Instagram DM: avtomatik cavab, insan rejimi, nömrədən lead ---

def auto_mode():
    with SessionLocal() as db:
        conf.put(db, "ig_dm_mode", "auto")
        db.commit()


def echo(mid, to="555"):
    return {"object": "instagram", "entry": [{"id": ME, "time": 1, "messaging": [
        {"sender": {"id": ME}, "recipient": {"id": to}, "timestamp": int(now().timestamp() * 1000),
         "message": {"mid": mid, "text": "Salam, özüm yazıram", "is_echo": True}}]}]}


def test_ig_auto_sends_and_logs(api, net, crm_env):
    auto_mode()
    crm_env.gemini(jreply("Salam! Podkast çəkilişi 1 saat 70 AZN-dir."))
    post_ig(api, dm())
    [it] = items()
    assert it.status == "sent" and it.model_output["sent_mid"] == "mid.out1"
    assert [c[1] for c in net.calls if "graph.instagram.com" in c[1]] == ["https://graph.instagram.com/v24.0/me/messages"]
    [msg] = crm_env.tg("sendMessage")
    assert msg["text"].startswith("🤖 Avtomatik cavab getdi") and "reply_markup" not in msg


def test_ig_draft_mode_is_default(api, net, crm_env):
    crm_env.gemini(jreply("Salam!"))
    post_ig(api, dm())
    assert items()[0].status == "pending" and not [c for c in net.calls if "graph.instagram.com" in c[1]]


def test_ig_auto_handoff_then_drafts(api, net, crm_env):
    auto_mode()
    crm_env.gemini(jreply("Bunu komandaya ötürürəm.", handoff=True, handoff_reason="endirim"), jreply("Bəli."))
    post_ig(api, dm(mid="m1", text="Agentlikik, endirim olar?"))
    assert items()[0].status == "sent"
    assert "Əməkdaş lazımdır" in crm_env.tg("sendMessage")[0]["text"]
    post_ig(api, dm(mid="m2", text="Montaj da var?"))
    assert items()[1].status == "pending"  # insan rejimi: qaralama
    assert "reply_markup" in crm_env.tg("sendMessage")[-1]


def test_ig_echo_from_app_silences_bot(api, net, crm_env, monkeypatch):
    monkeypatch.setattr(social_inbox, "ECHO_WAIT", 0)
    auto_mode()
    crm_env.gemini(jreply("Salam!"), jreply("Bəli."))
    post_ig(api, dm(mid="m1", text="Salam"))
    post_ig(api, echo("mid.out1"))  # botun öz cavabının echo-su: heç nə dəyişmir
    with SessionLocal() as db:
        assert not social_inbox.is_human(db, "555")
    post_ig(api, echo("app1"))  # sahibkar app-dan yazdı
    with SessionLocal() as db:
        assert social_inbox.is_human(db, "555")
    assert any(k == "ig-human:555" for k, _ in crm_env.alerts)
    post_ig(api, dm(mid="m2", text="Saat neçədə?"))
    assert items()[1].status == "pending"


def test_ig_phone_creates_lead_and_card(api, net, crm_env):
    from models import Lead, WaContact
    auto_mode()
    crm_env.gemini(jreply("Təşəkkürlər, Aysel! Komanda WhatsApp-dan yazacaq.",
                          lead={"name": "Aysel Məmmədova", "service": "podkast", "cameras": 2}),
                   jreply("Buyurun."))
    post_ig(api, dm(mid="m1", text="Adım Aysel, nömrəm 055 123 45 67"))
    with SessionLocal() as db:
        [lead] = db.scalars(select(Lead)).all()
        assert (lead.source, lead.phone, lead.name, lead.service, lead.cameras) == (
            "instagram", "994551234567", "Aysel Məmmədova", "podkast", 2)
        assert db.get(WaContact, lead.contact_id).phone == "994551234567"
        assert "Instagram yazışması: Adım Aysel" in lead.notes
    cards = [m for m in crm_env.tg("sendMessage") if m["text"].startswith("📥 Instagram-dan yeni müştəri")]
    assert len(cards) == 1
    url = cards[0]["reply_markup"]["inline_keyboard"][0][0]["url"]
    assert url.startswith("https://wa.me/994551234567?text=Salam%2C%20Aysel%21")
    post_ig(api, dm(mid="m2", text="Cümə günü olar?"))
    assert len([m for m in crm_env.tg("sendMessage") if m["text"].startswith("📥")]) == 1  # təkrar kart yoxdur


def test_whatsapp_links_instagram_lead(api, net, crm_env):
    from crm import bot
    from models import Lead, WaContact, WaConversation
    crm_env.gemini(jreply("Təşəkkürlər!", lead={"name": "Aysel"}))
    post_ig(api, dm(mid="m1", text="+994 50 111 22 33 yazın mənə"))
    with SessionLocal() as db:
        contact = db.scalar(select(WaContact).where(WaContact.phone == "994501112233"))
        conv = WaConversation(contact_id=contact.id, kapso_conversation_id="k1", mode="bot")
        db.add(conv)
        db.flush()
        lead = bot.apply_result(db, conv, contact, jreply("Salam!"))
        assert lead.source == "instagram" and conv.lead_id == lead.id
        assert "Instagram-da yazdıqları" in bot._lead_text(lead)
        assert db.scalar(select(Lead.id).where(Lead.source == "whatsapp")) is None


@pytest.mark.parametrize("text,phone", [
    ("nömrəm 0551234567", "994551234567"), ("+994 (50) 111-22-33", "994501112233"), ("70 222 33 44", "994702223344"),
    ("whatsapp: 0099450 111 22 33", "994501112233"), ("+7 912 345 67 89", "79123456789"),
    ("2 saat, 3 kamera, 150 AZN", None), ("012 555 66 77", None), ("15.11.2026 saat 14:00", None)])
def test_find_phone(text, phone):
    assert social_inbox.find_phone([text]) == phone
