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
        self.ig_thread = []  # Instagram Conversations API: köhnə yazışmanın mesajları
        self.ig_gets = []


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
        if "graph.instagram.com" in url and url.endswith("/me/conversations"):
            n.ig_gets.append(kw)
            return Resp(200, {"data": [{"messages": {"data": n.ig_thread}}]})
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


def draft_mode():
    with SessionLocal() as db:
        conf.put(db, "comment_mode", "draft")
        db.commit()


def test_send_comment_reply(api, net, crm_env):
    draft_mode()
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
    draft_mode()
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


def ad_dm(mid="a1", text="Salam, reklamı gördüm", sender="555", ad_id="120000000000000001"):
    body = dm(mid=mid, text=text, sender=sender)
    body["entry"][0]["messaging"][0]["message"]["referral"] = {
        "ref": "", "ad_id": ad_id, "source": "ADS", "type": "OPEN_THREAD",
        "ads_context_data": {"ad_title": "Reels paketi", "video_url": "https://example.com/v.mp4"}}
    return body


def test_ig_ad_referral_marks_thread_and_lead_source(api, net, crm_env):
    from models import Lead, LeadEvent
    auto_mode()
    crm_env.gemini(jreply("Salam! Nə çəkmək istəyirsiniz?"),
                   jreply("Təşəkkürlər! Komanda WhatsApp-dan yazacaq.", lead={"name": "Aysel"}),
                   jreply("Buyurun."))
    post_ig(api, ad_dm(mid="a1"))
    post_ig(api, dm(mid="a2", text="Nömrəm 055 123 45 67"))  # reklam yalnız ilk mesajda gəlir
    assert [(i.external_id, i.ad_id) for i in items()] == [("a1", "120000000000000001"), ("a2", None)]
    with SessionLocal() as db:
        [lead] = db.scalars(select(Lead)).all()
        assert lead.source == "reklam"
        ev = db.scalar(select(LeadEvent).where(LeadEvent.lead_id == lead.id, LeadEvent.kind == "created"))
        assert ev.data["ad_id"] == "120000000000000001"


def test_ig_link_referral_without_ad_ignored(api, net, crm_env):
    body = dm(mid="r1")
    body["entry"][0]["messaging"][0]["referral"] = {"ref": "sayt", "source": "SHORTLINK", "type": "OPEN_THREAD"}
    post_ig(api, body)
    assert [i.ad_id for i in items()] == [None]


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


def test_ig_mid_fits_columns():
    # Instagram DM mid 164 simvoldur; SQLite uzunluğu yoxlamır, Postgres isə 128-də xəta verirdi
    from models import SocialItem
    for col in ("external_id", "thread_id", "parent_id"):
        assert SocialItem.__table__.c[col].type.length >= 200


def voice_dm(mid="v1", url="https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1"):
    b = dm(mid=mid)
    b["entry"][0]["messaging"][0]["message"] = {"mid": mid, "attachments": [{"type": "audio", "payload": {"url": url}}]}
    return b


def test_ig_voice_transcribed_before_reply(api, net, crm_env, monkeypatch):
    from crm import voice
    seen = []
    monkeypatch.setattr(voice, "text_from_url", lambda db, url: seen.append(url) or "Reels çəkmək istəyirəm")
    crm_env.gemini(jreply("Əla, Reels Paketi var."))
    post_ig(api, voice_dm())
    [it] = items()
    assert seen == ["https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=1"]
    assert it.text == "Reels çəkmək istəyirəm" and it.draft_text.startswith("Əla")
    assert crm_env.gemini_calls[0][1][-1]["parts"][0]["text"] == "Reels çəkmək istəyirəm"


def test_ig_voice_failed_stays_placeholder(api, net, crm_env, monkeypatch):
    from crm import voice
    monkeypatch.setattr(voice, "text_from_url", lambda db, url: "")
    crm_env.gemini(jreply("Səs aydın deyil, mesaj kimi yaza bilərsiniz? 🙏"))
    post_ig(api, voice_dm())
    [it] = items()
    assert it.text == "[audio]" and "audio_url" not in (it.model_output or {})
    assert crm_env.gemini_calls[0][1][-1]["parts"][0]["text"] == "[audio]"


def image_dm(mid="i1", url="https://lookaside.fbsbx.com/ig_messaging_cdn/?asset_id=2"):
    b = dm(mid=mid)
    b["entry"][0]["messaging"][0]["message"] = {"mid": mid, "attachments": [{"type": "image", "payload": {"url": url}}]}
    return b


def test_ig_image_described_before_reply(api, net, crm_env, monkeypatch):
    from crm import voice
    monkeypatch.setattr(voice, "image_text", lambda db, url: "Reels kadrı, qız kameraya danışır")
    crm_env.gemini(jreply("Belə Reels çəkirik."))
    post_ig(api, image_dm())
    [it] = items()
    assert it.text == "[şəkil: Reels kadrı, qız kameraya danışır]"
    assert crm_env.gemini_calls[0][1][-1]["parts"][0]["text"] == it.text


def test_ig_image_failed_stays_label(api, net, crm_env, monkeypatch):
    from crm import voice
    monkeypatch.setattr(voice, "image_text", lambda db, url: "")
    crm_env.gemini(jreply("Şəkil açılmadı, nə ilə bağlı olduğunu yaza bilərsiniz? 🙏"))
    post_ig(api, image_dm())
    [it] = items()
    assert it.text == "[şəkil]" and "image_url" not in (it.model_output or {})


def test_ig_echo_after_restart_recognized_from_db(api, net, crm_env, monkeypatch):
    # deploy zamanı yeni prosesin yaddaşı boşdur: botun öz echo-su bazadakı sent_mid ilə tanınmalıdır
    monkeypatch.setattr(social_inbox, "ECHO_WAIT", 0)
    auto_mode()
    crm_env.gemini(jreply("Salam!"))
    post_ig(api, dm(mid="m1", text="Salam"))
    social_inbox._sent_mids.clear()
    post_ig(api, echo("mid.out1"))
    with SessionLocal() as db:
        assert not social_inbox.is_human(db, "555")
    assert not any(k == "ig-human:555" for k, _ in crm_env.alerts)


def test_prompt_keeps_internal_data_private():
    from crm import bot_prompt
    assert "Bu məlumatı sizinlə bölüşə bilmərik" in bot_prompt.PROMPT


def new_auto_mode():
    with SessionLocal() as db:
        conf.put(db, "ig_dm_mode", "new_auto")
        db.commit()


@pytest.mark.parametrize("history,expected", [(False, "sent"), (True, "pending"), (None, "pending")])
def test_ig_new_auto_by_history(api, net, crm_env, monkeypatch, history, expected):
    from crm import instagram
    calls = []
    monkeypatch.setattr(instagram, "has_history", lambda igsid, before: calls.append(igsid) or history)
    new_auto_mode()
    crm_env.gemini(jreply("Salam!"))
    post_ig(api, dm(mid="m1", text="Salam"))
    [it] = items()
    assert it.status == expected and calls == ["555"]
    with SessionLocal() as db:
        cached = conf.get(db, "ig_new:555")
    assert cached == {False: "1", True: "0", None: None}[history]


def ig_msg(text, sender, ago):
    t = (now() - ago).strftime("%Y-%m-%dT%H:%M:%S+0000")
    return {"message": text, "from": {"id": sender}, "created_time": t}


def test_ig_reply_sees_old_conversation(api, net, crm_env):
    # kampaniya mesajını sahibkar app-dan göndərib, müştəri cavab verir: bot köhnə söhbəti və o mesajı görməlidir
    net.ig_thread = [ig_msg("Salam", "555", timedelta(days=60)),  # API ən təzəni əvvəl qaytara bilər
                     ig_msg("Podkast neçəyədir? 2 nəfərik", "555", timedelta(days=60, seconds=-5)),
                     ig_msg("Salam! 2 nəfərlik podkast 1 saat 70 AZN-dir.", ME, timedelta(days=59)),
                     ig_msg("Salam! Y Pod-dan yazırıq, 2 nəfərlik podkastla maraqlanmışdınız.", ME, timedelta(hours=1)),
                     ig_msg("Hə, gələn həftə olar?", "555", timedelta(0))][::-1]
    crm_env.gemini(jreply("Bəli, hansı gün?"))
    post_ig(api, dm(mid="m1", text="Hə, gələn həftə olar?"))
    turns = [(c["role"], c["parts"][0]["text"]) for c in crm_env.gemini_calls[0][1]]
    joined = "\n".join(t for _, t in turns)  # ardıcıl eyni rollu mesajlar birləşir
    assert turns[0] == ("user", "Salam\n\nPodkast neçəyədir? 2 nəfərik")  # xronoloji
    assert "Y Pod-dan yazırıq" in joined and joined.count("Hə, gələn həftə olar?") == 1
    assert turns[-1] == ("user", "Hə, gələn həftə olar?")
    assert turns[1][0] == "model" and "1 saat 70 AZN" in turns[1][1]
    assert net.ig_gets[0]["params"]["user_id"] == "555"


def test_ig_history_api_error_keeps_local(api, net, crm_env, monkeypatch):
    def broken(url, **kw):
        raise httpx.ConnectError("yoxdur")
    crm_env.gemini(jreply("Salam!"))
    monkeypatch.setattr(httpx, "get", broken)
    post_ig(api, dm(mid="m1", text="Salam"))
    assert [c["parts"][0]["text"] for c in crm_env.gemini_calls[0][1]] == ["Salam"]


def test_ig_manual_message_without_bot_no_alert(api, net, crm_env, monkeypatch):
    # sahibkar köhnə müştəriyə əl ilə yazır (bot bu söhbətdə yazmayıb): Telegram-a xəbər getmir
    monkeypatch.setattr(social_inbox, "ECHO_WAIT", 0)
    post_ig(api, echo("app1", to="999"))
    assert not any(k == "ig-human:999" for k, _ in crm_env.alerts)


def test_dm_gap_recorded_comment_spam_not(api, net, crm_env):
    from models import UnansweredQuestion
    crm_env.gemini(jreply("Komandamız dəqiqləşdirəcək 🙏", handoff=True, handoff_reason="diger"),
                   jreply("", handoff=True, handoff_reason="diger"))
    post_ig(api, dm(text="Sizdə dron var?"))
    post_ig(api, comment(text="spam spam"))
    with SessionLocal() as db:
        assert [q.question for q in db.query(UnansweredQuestion)] == ["[IG] [handoff:diger] Sizdə dron var?"]


# --- komment: avtomatik cavab ---

def test_interest_regex():
    yes = ["+", " ++ ", "Qiymət nədir?", "neçəyə başa gəlir", "Rezerv etmək olar?", "çəkiliş istəyirəm", "Maraqlıdır",
           "Ətraflı yaza bilərsiz?", "ünvan?", "5+ nəfərik", "price?"]
    no = ["Çox gözəl!", "Əla video", "Təbriklər 👏"]
    assert all(social_inbox.INTEREST_RE.search(t) for t in yes)
    assert not any(social_inbox.INTEREST_RE.search(t) for t in no)


def test_comment_mode_default_auto(api, net, crm_env):
    with SessionLocal() as db:
        assert social_inbox.comment_auto(db)
        conf.put(db, "comment_mode", "draft")
        assert not social_inbox.comment_auto(db)


def test_ig_comment_not_interested_auto_public_reply(api, net, crm_env):
    crm_env.gemini(jreply("Təşəkkürlər! 🙏"))
    post_ig(api, comment(cid="c9", text="Çox gözəl!"))
    [it] = items()
    assert it.status == "sent" and it.model_output["auto"] is True
    [(_, url, kw)] = [c for c in net.calls if "graph.instagram.com" in c[1]]
    assert url.endswith("/v24.0/c9/replies") and kw["data"] == {"message": "Təşəkkürlər! 🙏"}
    [msg] = crm_env.tg("sendMessage")
    assert msg["text"].startswith("🤖 Komment avtomatik cavablandı") and "reply_markup" not in msg
    assert "Instagram DM" not in crm_env.gemini_calls[0][0] and "Direct-i sistem özü göndərir" in crm_env.gemini_calls[0][0]


def test_ig_comment_interested_sends_direct_then_public(api, net, crm_env):
    crm_env.gemini(jreply("Direct-ə yazdıq 🙏"), jreply("Salam! Kommentinizə görə yazırıq, podkast 70 AZN-dir. Neçə nəfərsiniz?"))
    body = comment(cid="c5", text="Qiymət nədir?")
    body["entry"][0]["changes"][0]["value"]["from"]["id"] = "777"
    post_ig(api, body)
    [it] = items()
    posts = [(c[1], c[2]) for c in net.calls if "graph.instagram.com" in c[1]]
    assert posts[0][0].endswith("/me/messages")
    assert posts[0][1]["json"] == {"recipient": {"comment_id": "c5"},
                                   "message": {"text": "Salam! Kommentinizə görə yazırıq, podkast 70 AZN-dir. Neçə nəfərsiniz?"}}
    assert posts[1][0].endswith("/c5/replies") and posts[1][1]["data"] == {"message": social_inbox.IG_DIRECT_REPLY}
    assert "055 530 35 32" in social_inbox.IG_DIRECT_REPLY and it.draft_text == social_inbox.IG_DIRECT_REPLY
    assert it.status == "sent" and it.model_output["dm_mid"] == "mid.out1" and it.model_output["auto"] is True
    assert it.model_output["from_id"] == "777" and "mid.out1" in social_inbox._sent_mids
    assert "Qiymət nədir?" in crm_env.gemini_calls[1][0] and "Instagram DM" in crm_env.gemini_calls[1][0]
    [msg] = crm_env.tg("sendMessage")
    assert msg["text"].startswith("🤖 Komment cavablandı + Direct yazıldı") and "podkast 70 AZN" in msg["text"]
    with SessionLocal() as db:  # recipient_id cavabda yoxdur: ig_new yazılmır
        assert conf.get(db, "ig_new:777") is None


def test_ig_comment_direct_marks_new_when_recipient_known(api, net, crm_env, monkeypatch):
    monkeypatch.setattr(social_inbox.instagram, "private_reply", lambda cid, text: ("888", "mid.x"))
    crm_env.gemini(jreply("Direct-ə yazdıq 🙏"), jreply("Salam!"))
    post_ig(api, comment(cid="c6", text="+"))
    with SessionLocal() as db:
        assert conf.get(db, "ig_new:888") == "1"


def test_ig_comment_direct_error_falls_back_to_draft(api, net, crm_env):
    net.ig_error = "Token bitib"
    crm_env.gemini(jreply("Direct-ə yazdıq 🙏"), jreply("Salam!"))
    post_ig(api, comment(cid="c7", text="Qiymət?"))
    [it] = items()
    assert it.status == "pending" and it.draft_text == "Direct-ə yazdıq 🙏"
    assert not [c for c in net.calls if c[1].endswith("/replies")]
    assert any(k.startswith("ig-comment-dm:") for k, _ in crm_env.alerts)
    assert "reply_markup" in crm_env.tg("sendMessage")[-1]


def test_ig_comment_skips_direct_when_human_talks(api, net, crm_env):
    with SessionLocal() as db:
        social_inbox.set_human(db, "777")
        db.commit()
    crm_env.gemini(jreply("Direct-ə yazdıq 🙏"))
    body = comment(cid="c8", text="Qiymət?")
    body["entry"][0]["changes"][0]["value"]["from"]["id"] = "777"
    post_ig(api, body)
    assert items()[0].status == "pending" and not [c for c in net.calls if "graph.instagram.com" in c[1]]
    assert len(crm_env.gemini_calls) == 1


def test_youtube_interested_reply_always_has_phone(api, net, crm_env):
    net.threads = [thread("n2", "Çəkiliş istəyirəm", 5)]
    with SessionLocal() as db:
        youtube.poll(db)
        conf.put(db, youtube.LAST_KEY, (now() - timedelta(minutes=30)).isoformat())
        db.commit()
    crm_env.gemini(jreply("Salam, yazın!"))
    youtube.tick()
    assert items()[0].draft_text == "Salam, yazın! Əlaqə: 055 530 35 32"
    ins = [c for c in net.calls if c[1].endswith("/youtube/v3/comments")][0]
    assert ins[2]["json"]["snippet"]["textOriginal"].endswith("055 530 35 32")


def test_comment_handoff_goes_to_draft(api, net, crm_env):
    crm_env.gemini(jreply("Üzr istəyirik, komanda yazacaq 🙏", handoff=True, handoff_reason="sikayet"))
    post_ig(api, comment(text="Pis xidmətdir!"))
    assert items()[0].status == "pending" and "reply_markup" in crm_env.tg("sendMessage")[0]
    assert not [c for c in net.calls if "graph.instagram.com" in c[1]]


def test_comment_draft_mode_keeps_telegram_draft(api, net, crm_env):
    draft_mode()
    crm_env.gemini(jreply("Təşəkkürlər!"))
    post_ig(api, comment(text="Çox gözəl!"))
    assert items()[0].status == "pending" and not [c for c in net.calls if "graph.instagram.com" in c[1]]


def test_comment_public_send_error_falls_back_to_draft(api, net, crm_env, monkeypatch):
    def boom(cid, text):
        raise social_inbox.instagram.IgError("Komment silinib")
    monkeypatch.setattr(social_inbox.instagram, "reply_comment", boom)
    crm_env.gemini(jreply("Təşəkkürlər!"))
    post_ig(api, comment(text="Çox gözəl!"))
    assert items()[0].status == "pending" and any(k.startswith("comment-auto:") for k, _ in crm_env.alerts)
    assert "reply_markup" in crm_env.tg("sendMessage")[-1]


def test_youtube_comment_auto_public_reply(api, net, crm_env):
    net.threads = [thread("new", "Qiymət neçədir?", 5)]
    with SessionLocal() as db:
        youtube.poll(db)
        conf.put(db, youtube.LAST_KEY, (now() - timedelta(minutes=30)).isoformat())
        db.commit()
    crm_env.gemini(jreply("Salam! WhatsApp-dan yazın: 055 530 35 32 🙏"))
    youtube.tick()
    [it] = items()
    assert it.status == "sent" and it.model_output["auto"] is True
    assert len(crm_env.gemini_calls) == 1 and "055 530 35 32" in crm_env.gemini_calls[0][0]
    assert it.draft_text == "Salam! WhatsApp-dan yazın: 055 530 35 32 🙏"  # nömrə artıq var: təkrarlanmır
    assert crm_env.tg("sendMessage")[0]["text"].startswith("🤖 Komment avtomatik cavablandı")
    assert [c for c in net.calls if c[1].endswith("/youtube/v3/comments")]


def test_comment_auto_cap_24h(api, net, crm_env):
    with SessionLocal() as db:
        for i in range(social_inbox.AUTO_COMMENT_CAP):
            db.add(SocialItem(channel="youtube", kind="comment", external_id=f"old{i}", thread_id="v", text="x",
                              status="sent", decided_at=now() - timedelta(hours=1), model_output={"auto": True}))
        db.add(SocialItem(channel="youtube", kind="comment", external_id="manual", thread_id="v", text="x",
                          status="sent", decided_at=now(), model_output={}))
        db.add(SocialItem(channel="youtube", kind="comment", external_id="ancient", thread_id="v", text="x",
                          status="sent", decided_at=now() - timedelta(hours=30), model_output={"auto": True}))
        db.commit()
    crm_env.gemini(jreply("Təşəkkürlər!"))
    post_ig(api, comment(cid="cap1", text="Çox gözəl!"))
    assert items()[-1].status == "pending"
    assert "reply_markup" in crm_env.tg("sendMessage")[-1]


def cmd(api, text, user=CHAT, chat=CHAT, thread=None):
    m = {"message_id": 7, "text": text, "from": {"id": int(user)}, "chat": {"id": int(chat)}}
    if thread:
        m["message_thread_id"] = thread
    return api.post("/api/webhooks/telegram", json={"message": m}, headers={"X-Telegram-Bot-Api-Secret-Token": TG_SECRET})


def test_komment_command(api, net, crm_env):
    assert cmd(api, "/komment").json()["result"] == "ok"
    assert "avtomatik cavab" in crm_env.tg("sendMessage")[-1]["text"]
    assert cmd(api, "/komment qaralama").json()["result"] == "set"
    with SessionLocal() as db:
        assert conf.get(db, "comment_mode") == "draft"
    assert "qaralama (təsdiqlə)" in crm_env.tg("sendMessage")[-1]["text"]
    assert cmd(api, "/komment@ypod_bot avto").json()["result"] == "set"
    with SessionLocal() as db:
        assert conf.get(db, "comment_mode") == "auto"
    n = len(crm_env.tg("sendMessage"))
    assert cmd(api, "/komment qaralama", user=555).json()["result"] == "not_owner"
    assert len(crm_env.tg("sendMessage")) == n
    with SessionLocal() as db:
        assert conf.get(db, "comment_mode") == "auto"
