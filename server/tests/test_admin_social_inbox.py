"""routes/admin_social_inbox.py: admin Inbox-da Instagram DM, Instagram/YouTube kommentləri."""
from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env  # noqa: F401,I001
from test_social_inbox import net  # noqa: F401,I001

from datetime import timedelta  # noqa: E402

from crm import conf, social_inbox  # noqa: E402
from crm.tg import MAX_REGENERATE  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import SocialItem  # noqa: E402

BASE = "/api/admin/social-inbox"


def mk(kind="dm", channel="instagram", thread="555", text="Salam", status="pending", draft="Salam! Necə kömək edək?",
       ago=timedelta(minutes=5), **kw):
    with SessionLocal() as db:
        n = db.query(SocialItem).count()
        i = SocialItem(channel=channel, kind=kind, external_id=f"ext{n}-{thread}", thread_id=thread, text=text,
                       draft_text=draft, status=status, created_at=now() - ago, **kw)
        db.add(i)
        db.commit()
        return i.id


def get(item_id):
    with SessionLocal() as db:
        return db.get(SocialItem, item_id)


def ig_posts(net, part):
    return [kw for m, url, kw in net.calls if m == "POST" and part in url]


def test_requires_admin(api):
    assert api.get(BASE).status_code == 401


def test_list_groups_threads_and_posts(api, net):
    tok = bearer(admin_token(api))
    mk(thread="555", status="sent", ago=timedelta(hours=2))
    mk(thread="555", text="Qiymət?")
    mk(kind="comment", thread="media1", author="aynur.m", text="Neçəyədir?", parent_id="c1")
    mk(kind="comment", channel="youtube", thread="vid1", author="Kamran", status="sent")
    r = api.get(BASE, headers=tok).json()
    rows = {t["key"]: t for t in r["threads"]}
    assert set(rows) == {"dm:instagram:555", "comment:instagram:media1", "comment:youtube:vid1"}
    dm = rows["dm:instagram:555"]
    assert dm["pending"] == 1 and dm["total"] == 2 and dm["last_text"] == "Qiymət?" and dm["mode"] == "bot"
    assert dm["window_open"] is True and dm["last_in"] is True
    assert rows["comment:instagram:media1"]["author"] == "aynur.m" and rows["comment:youtube:vid1"]["pending"] == 0
    assert r["comment_mode"] == "auto"


def test_dm_open_merges_instagram_history(api, net):
    tok = bearer(admin_token(api))
    mk(thread="555", text="Salam", status="sent", draft="Salam! Buyurun", ago=timedelta(hours=1))
    mk(thread="555", text="Reels neçəyədir?")
    t0 = (now() - timedelta(days=3)).strftime("%Y-%m-%dT%H:%M:%S+0000")
    t1 = (now() - timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%S+0000")
    net.ig_thread = [{"message": "Köhnə sual", "from": {"id": "555"}, "created_time": t0},
                     {"message": "Salam! Buyurun", "from": {"id": "me"}, "created_time": t1},  # bazada var: təkrarlanmır
                     {"message": "Telefondan yazdım", "from": {"id": "me"}, "created_time": t1}]
    r = api.get(f"{BASE}/dm/555", headers=tok).json()
    texts = [(m["role"], m["text"]) for m in r["messages"]]
    assert texts[0] == ("in", "Köhnə sual")
    assert [t for t in texts if t[1] == "Salam! Buyurun"] == [("bot", "Salam! Buyurun")]
    assert ("you", "Telefondan yazdım") in texts
    assert [p["text"] for p in r["pending"]] == ["Reels neçəyədir?"] and r["window_open"] is True
    assert api.get(f"{BASE}/dm/nope", headers=tok).status_code == 404


def test_send_edited_draft_and_bot_takes_over(api, net):
    tok = bearer(admin_token(api))
    iid = mk(thread="777")
    with SessionLocal() as db:
        conf.put(db, social_inbox._mode_key("777"), "wait")
        db.commit()
    r = api.post(f"{BASE}/items/{iid}/send", json={"text": "Düzəldilmiş cavab"}, headers=tok)
    assert r.status_code == 200, r.text
    sent = ig_posts(net, "/me/messages")
    assert sent[-1]["json"] == {"recipient": {"id": "777"}, "message": {"text": "Düzəldilmiş cavab"}}
    i = get(iid)
    assert i.status == "sent" and i.draft_text == "Düzəldilmiş cavab" and i.model_output["by_owner"] is True
    with SessionLocal() as db:
        assert social_inbox.ig_mode(db, "777") == "bot"
    assert api.post(f"{BASE}/items/{iid}/send", headers=tok).status_code == 409  # təkrar göndərilmir


def test_send_refused_after_24h_window(api, net):
    tok = bearer(admin_token(api))
    iid = mk(thread="888", ago=timedelta(hours=30))
    r = api.post(f"{BASE}/items/{iid}/send", headers=tok)
    assert r.status_code == 409 and "24 saat" in r.json()["detail"]
    assert get(iid).status == "pending" and not ig_posts(net, "/me/messages")


def test_send_error_keeps_item_pending(api, net):
    tok = bearer(admin_token(api))
    iid = mk(kind="comment", thread="media2", parent_id="c9")
    net.ig_error = "Rate limit"
    r = api.post(f"{BASE}/items/{iid}/send", headers=tok)
    assert r.status_code == 502 and "Rate limit" in r.json()["detail"]
    assert get(iid).status == "pending"


def test_comment_reply_reject_hide(api, net):
    tok = bearer(admin_token(api))
    a = mk(kind="comment", thread="media3", parent_id="c1", author="a")
    b = mk(kind="comment", thread="media3", parent_id="c2", author="b")
    c = mk(kind="comment", thread="media3", parent_id="c3", author="c")
    assert api.post(f"{BASE}/items/{a}/send", json={"text": "Təşəkkür edirik 🙏"}, headers=tok).status_code == 200
    assert ig_posts(net, "/c1/replies")[-1]["data"] == {"message": "Təşəkkür edirik 🙏"}
    assert api.post(f"{BASE}/items/{b}/reject", headers=tok).json()["status"] == "rejected"
    r = api.post(f"{BASE}/items/{c}/hide", headers=tok).json()
    assert r["status"] == "ignored" and r["hidden"] is True
    ext = get(c).external_id
    assert any(url.endswith(f"/{ext}") and kw.get("data") == {"hide": "true"} for m, url, kw in net.calls if m == "POST")
    post = api.get(f"{BASE}/post/instagram/media3", headers=tok).json()
    assert [i["status"] for i in post["items"]] == ["ignored", "rejected", "sent"]


def test_youtube_comment_reply_and_link(api, net):
    tok = bearer(admin_token(api))
    iid = mk(kind="comment", channel="youtube", thread="vidX", parent_id="ytc1")
    post = api.get(f"{BASE}/post/youtube/vidX", headers=tok).json()
    assert post["post"]["permalink"] == "https://www.youtube.com/watch?v=vidX"
    assert api.post(f"{BASE}/items/{iid}/send", headers=tok).status_code == 200
    assert any("youtube/v3/comments" in url for m, url, kw in net.calls if m == "POST")
    assert get(iid).status == "sent"


def test_free_dm_answers_pending_or_adds_extra(api, net):
    tok = bearer(admin_token(api))
    old = mk(thread="999", ago=timedelta(minutes=20))
    last = mk(thread="999", draft=None)
    assert api.post(f"{BASE}/dm/999/send", json={"text": "Özüm yazıram"}, headers=tok).status_code == 200
    assert get(last).status == "sent" and get(last).draft_text == "Özüm yazıram"
    assert get(old).status == "ignored"
    with SessionLocal() as db:
        assert social_inbox.ig_mode(db, "999") == "owner"
    assert api.post(f"{BASE}/dm/999/send", json={"text": "Bir də bu"}, headers=tok).status_code == 200
    assert get(last).model_output["extra"][0]["text"] == "Bir də bu"
    msgs = api.get(f"{BASE}/dm/999", headers=tok).json()["messages"]
    assert [m["text"] for m in msgs if m["role"] == "you"] == ["Özüm yazıram", "Bir də bu"]


def test_regenerate_limit(api, net, monkeypatch):
    tok = bearer(admin_token(api))
    calls = []
    monkeypatch.setattr(social_inbox, "draft", lambda item_id, avoid=None: calls.append((item_id, avoid)) or "ok")
    iid = mk(thread="1001")
    for _ in range(MAX_REGENERATE):
        assert api.post(f"{BASE}/items/{iid}/regenerate", headers=tok).status_code == 200
    assert api.post(f"{BASE}/items/{iid}/regenerate", headers=tok).status_code == 429
    assert calls[0] == (iid, "Salam! Necə kömək edək?") and len(calls) == MAX_REGENERATE


def test_comment_mode_toggle(api, net):
    tok = bearer(admin_token(api))
    assert api.post(f"{BASE}/comment-mode", json={"mode": "draft"}, headers=tok).json() == {"comment_mode": "draft"}
    with SessionLocal() as db:
        assert social_inbox.comment_auto(db) is False
    assert api.post(f"{BASE}/comment-mode", json={"mode": "x"}, headers=tok).status_code == 422


def test_dm_author_filled_from_instagram(api, net):
    tok = bearer(admin_token(api))
    net.usernames["2001"] = "nigar.k"
    mk(thread="2001")
    rows = {t["key"]: t for t in api.get(BASE, headers=tok).json()["threads"]}
    assert rows["dm:instagram:2001"]["author"] == "nigar.k"
    assert len(net.name_gets) == 1
    api.get(BASE, headers=tok)  # bazaya yazılıb: təkrar soruşulmur
    assert len(net.name_gets) == 1


def test_dm_mode_menu(api, net):
    tok = bearer(admin_token(api))
    mk(thread="2002")
    for m in ("wait", "owner", "bot"):
        assert api.post(f"{BASE}/dm/2002/mode", json={"mode": m}, headers=tok).json() == {"mode": m}
        with SessionLocal() as db:
            assert social_inbox.ig_mode(db, "2002") == m
    assert api.post(f"{BASE}/dm/2002/mode", json={"mode": "human"}, headers=tok).status_code == 422
    assert api.post(f"{BASE}/dm/nope/mode", json={"mode": "bot"}, headers=tok).status_code == 404
    assert not ig_posts(net, "/me/messages")  # müştəriyə heç nə getmir


def test_comment_author_becomes_lead_once(api, net):
    from models import Lead
    tok = bearer(admin_token(api))
    a = mk(kind="comment", thread="media9", author="aynur.m", text="Neçəyədir?", parent_id="c1")
    b = mk(kind="comment", thread="media8", author="aynur.m", text="Bəs reels?", parent_id="c2")
    r = api.post(f"{BASE}/items/{a}/lead", headers=tok).json()
    assert r["created"] is True and r["name"] == "@aynur.m"
    r2 = api.post(f"{BASE}/items/{b}/lead", headers=tok).json()
    assert r2 == {**r, "created": False}  # eyni Instagram adı: mövcud lead-ə bağlanır
    with SessionLocal() as db:
        lead = db.get(Lead, r["lead_id"])
        assert lead.stage == "yeni" and lead.source == "instagram" and lead.phone == ""
        assert "Instagram: @aynur.m" in lead.notes
    items = api.get(f"{BASE}/post/instagram/media9", headers=tok).json()["items"]
    assert items[0]["lead_id"] == r["lead_id"]


def test_dm_lead_gets_phone_later(api, net):
    from models import Lead
    tok = bearer(admin_token(api))
    net.usernames["2003"] = "rauf"
    iid = mk(thread="2003")
    r = api.post(f"{BASE}/items/{iid}/lead", headers=tok).json()
    assert api.get(f"{BASE}/dm/2003", headers=tok).json()["lead_id"] == r["lead_id"]
    phone_item = mk(thread="2003", text="Nömrəm 050 123 45 67")
    with SessionLocal() as db:
        lead = social_inbox.capture_lead(db, db.get(SocialItem, phone_item), {})
        assert lead.id == r["lead_id"] and lead.phone.endswith("501234567")
        assert db.query(Lead).count() == 1


def test_hide_deleted_comment_closes_item(api, net):
    """Komment Instagram-da silinibsə (kod 100/33) «Gizlət» xəta vermir: element siyahıdan çıxır."""
    tok = bearer(admin_token(api))
    iid = mk(kind="comment", thread="media9", parent_id="c9")
    net.ig_error = {"message": "Object does not exist", "code": 100, "error_subcode": 33}
    r = api.post(f"{BASE}/items/{iid}/hide", headers=tok)
    assert r.status_code == 200 and r.json()["gone"] is True and r.json()["status"] == "ignored"
    net.ig_error = {"message": "Rate limit", "code": 4}
    other = mk(kind="comment", thread="media9", parent_id="c10")
    assert api.post(f"{BASE}/items/{other}/hide", headers=tok).status_code == 502
    assert get(other).status == "pending"


def test_dm_friend_toggle(api, net):
    """IG DM-də «Dostdur · bot yazmır»: siyahıda və söhbətdə görünür, gözləyən qaralama rədd olunur."""
    tok = bearer(admin_token(api))
    iid = mk(thread="777")
    assert api.post(f"{BASE}/dm/888/friend", json={"friend": True}, headers=tok).status_code == 404
    assert api.post(f"{BASE}/dm/777/friend", json={"friend": True}, headers=tok).json() == {"friend": True}
    assert get(iid).status == "rejected"
    rows = {t["key"]: t for t in api.get(BASE, headers=tok).json()["threads"]}
    assert rows["dm:instagram:777"]["friend"] is True and rows["dm:instagram:777"]["pending"] == 0
    assert api.get(f"{BASE}/dm/777", headers=tok).json()["friend"] is True
    assert api.post(f"{BASE}/dm/777/friend", json={"friend": False}, headers=tok).json() == {"friend": False}
