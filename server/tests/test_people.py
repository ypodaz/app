from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env  # noqa: F401,I001

import pytest  # noqa: E402
from datetime import timedelta  # noqa: E402

from crm import people  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import Client, KnownContact, Lead, Person, Shoot, SocialItem, WaContact, WaConversation, WaMessage  # noqa: E402

ARCHIVE = {"me": {"username": "ypod_me", "id": "900"}, "conversations": [
    {"id": "t1", "participants": [{"username": "ypod_me", "id": "900"}, {"username": "Test_User", "id": "111"}],
     "messages": [
         {"id": "m1", "created_time": "2026-01-02T10:00:00+0000", "from": {"username": "Test_User", "id": "111"},
          "message": "Salam, podkast çəkmək istəyirəm. Nömrəm 050 111 22 33"},
         {"id": "m2", "created_time": "2026-01-02T10:05:00+0000", "from": {"username": "ypod_me", "id": "900"},
          "message": "Salam! Zəng edin: 055 530 35 32"}]},
    {"id": "t2", "participants": [{"username": "ypod_me", "id": "900"}, {"username": "friend", "id": "222"}],
     "messages": [{"id": "m3", "created_time": "2026-01-03T10:00:00+0000", "from": {"username": "friend", "id": "222"},
                   "message": "Mənim nömrəm 070 999 88 77"}]}]}


@pytest.mark.parametrize("text,expected", [
    ("050 111 22 33", ["994501112233"]), ("0501112233", ["994501112233"]), ("+994 50 111 22 33", ["994501112233"]),
    ("994501112233", ["994501112233"]), ("(050) 111-22-33", ["994501112233"]), ("012 345 67 89", ["994123456789"]),
    ("zəng 055 222 33 44, 070 555 66 77 də", ["994552223344", "994705556677"]),
    ("055 530 35 32", []),  # studiyanın öz nömrəsi
    ("kart 4169 7388 1234 5678", []), ("2026-11-12 saat 10", []), ("", []), (None, []),
    ("0501112233 və yenə 050 111 22 33", ["994501112233"]),
])
def test_extract_phones(text, expected):
    assert people.extract_phones(text) == expected


def test_ig_handle():
    assert people.ig_handle("@Test_User") == "test_user"
    assert people.ig_handle("https://www.instagram.com/Test_User/?igsh=abc") == "test_user"
    assert people.ig_handle(None) == ""


def test_collect_merges_and_excludes(api):
    with SessionLocal() as db:
        db.add(KnownContact(phone="994705556677", kind="personal"))
        db.add(KnownContact(phone="994709998877", kind="personal"))
        c = Client(full_name="Test Müştəri", phone="050 111 22 33", card_code="C1", profession="Həkim",
                   instagram="@test_user")
        db.add(c)
        db.flush()
        db.add(Shoot(client_id=c.id, tag="podcast", location="studio", starts_at=now(), duration_min=60, cameras=1,
                     status="completed"))
        wc = WaContact(phone="994553334455", name="Vəli")
        db.add(wc)
        db.flush()
        conv = WaConversation(contact_id=wc.id, last_message_at=now())
        db.add(conv)
        db.flush()
        db.add(WaMessage(conversation_id=conv.id, direction="in", source="customer", text="Salam"))
        db.add(Lead(contact_id=wc.id, name="Vəli", phone="994553334455", service="reels"))
        db.add(WaContact(phone="994705556677", name="Dost"))
        db.commit()
        bundles = people.collect(db, ARCHIVE)
    by_phone = {b["phone"]: b for b in bundles}
    assert "994705556677" not in by_phone and not any(b["ig_username"] == "friend" for b in bundles)
    b = by_phone["994501112233"]  # IG arxivi + Client bir şəxsdə
    assert b["client_id"] and b["ig_username"] == "test_user" and b["igsid"] == "111"
    assert b["sources"] == ["ig", "app"] and b["msg_count"] == 2 and b["facts"]["completed"]
    assert "Müştəri: Salam, podkast" in b["transcript"] and "Y Pod: Salam!" in b["transcript"]
    w = by_phone["994553334455"]
    assert w["sources"] == ["wa"] and w["facts"]["lead_service"] == "reels"


WA_ARCHIVE = {"contacts": [
    {"phone": "0553334455", "name": "Vəli Arxiv", "msgs": [
        ["2025-03-01T12:00:00+04:00", "Müştəri", "[səs] Salam, reels lazımdır"],
        ["2025-03-01T12:05:00+04:00", "Y Pod", "Salam!"]]},
    {"phone": "994501119900", "name": "Yalnız Arxiv", "msgs": [["2025-04-01T10:00:00+04:00", "Müştəri", "Salam"]]},
    {"phone": "994705556677", "name": "Dost", "msgs": [["2025-04-01T10:00:00+04:00", "Müştəri", "Salam"]]},
    {"phone": "", "name": "Nömrəsiz", "msgs": [["2025-04-01T10:00:00+04:00", "Müştəri", "Salam"]]}]}


def test_collect_wa_archive_merges_by_phone(api):
    with SessionLocal() as db:
        db.add(KnownContact(phone="994705556677", kind="personal"))
        wc = WaContact(phone="994553334455", name="Vəli")
        db.add(wc)
        db.flush()
        conv = WaConversation(contact_id=wc.id, last_message_at=now())
        db.add(conv)
        db.flush()
        db.add(WaMessage(conversation_id=conv.id, direction="in", source="customer", text="Canlı mesaj"))
        db.commit()
        bundles = people.collect(db, None, WA_ARCHIVE)
    by_phone = {b["phone"]: b for b in bundles}
    assert len(bundles) == 2 and "994705556677" not in by_phone  # şəxsi və nömrəsiz atılır
    v = by_phone["994553334455"]  # canlı WA kontaktı + arxiv bir şəxsdə
    assert v["sources"] == ["wa"] and v["msg_count"] == 3
    assert "[səs] Salam, reels" in v["transcript"] and "Canlı mesaj" in v["transcript"]
    assert v["msgs"][0][0].year == 2025 and v["facts"]["wa_name"]
    assert by_phone["994501119900"]["facts"]["wa_name"] == "Yalnız Arxiv"


def test_last_visit_deterministic_from_completed_shoot(api):
    from datetime import timedelta
    t1, t2 = now() - timedelta(days=40), now() - timedelta(days=10)
    with SessionLocal() as db:
        c = Client(full_name="Test Müştəri", phone="050 111 22 33", card_code="C1")
        db.add(c)
        db.flush()
        for t, st in ((t1, "completed"), (t2, "completed"), (now() + timedelta(days=5), "confirmed")):
            db.add(Shoot(client_id=c.id, tag="podcast", location="studio", starts_at=t, duration_min=60, cameras=1,
                         status=st))
        db.commit()
        b = people.collect(db, None, None)[0]
        assert abs((b["facts"]["last_shoot"] - t2).total_seconds()) < 1
        assert "Son çəkiliş: " in people.card_prompt(b)
        card = {"full_name": "", "profession": "", "workplace": "", "reason": "", "service": "", "need": "", "phones": [],
                "outcome": "lead", "summary": "", "last_visit": "2020-01-01", "last_topic": "Keşbek soruşdu"}
        p = people.upsert(db, b, card)
        assert abs((p.last_visit_at - t2).total_seconds()) < 1 and p.last_topic == "Keşbek soruşdu"


def test_last_visit_from_ai_when_no_shoot(api):
    base = {"full_name": "", "profession": "", "workplace": "", "reason": "", "service": "", "need": "", "phones": [],
            "outcome": "lead", "summary": "", "last_topic": "x"}
    with SessionLocal() as db:
        p = people.upsert(db, _bundle(), {**base, "last_visit": "2026-03-05"})
        assert p.last_visit_at.strftime("%Y-%m-%d") == "2026-03-05"
        p = people.upsert(db, _bundle(), {**base, "last_visit": "2099-01-01"})  # gələcək → None
        assert p.last_visit_at is None
        p = people.upsert(db, _bundle(), {**base, "last_visit": ""})
        assert p.last_visit_at is None


def test_collect_archive_me_as_plain_id(api, monkeypatch):
    import settings
    monkeypatch.setattr(settings, "IG_USER_ID", "")
    archive = {**ARCHIVE, "me": "900",
               "conversations": [{**ARCHIVE["conversations"][0],
                                  "participants": [{"id": "900"}, {"username": "Test_User", "id": "111"}]}]}
    with SessionLocal() as db:
        bundles = people.collect(db, archive)
    assert [b["igsid"] for b in bundles] == ["111"]
    assert "Y Pod: Salam!" in bundles[0]["transcript"]


def test_collect_ig_phone_links_live_thread_and_own_account(api, monkeypatch):
    import settings
    monkeypatch.setattr(settings, "IG_USER_ID", "900")
    with SessionLocal() as db:
        db.add(WaContact(phone="994501112233", name="Aysel"))
        db.add(SocialItem(channel="instagram", kind="dm", external_id="e1", thread_id="555", author="@Live_One",
                          text="nömrəm 0501112233", status="ignored"))
        db.add(SocialItem(channel="instagram", kind="dm", external_id="e2", thread_id="900", author="ypod_me",
                          text="öz hesabımız", status="ignored"))
        db.commit()
        bundles = people.collect(db, None)
    assert len(bundles) == 1
    b = bundles[0]
    assert b["phone"] == "994501112233" and b["igsid"] == "555" and b["ig_username"] == "live_one"
    assert b["sources"] == ["ig", "wa"]


def test_transcript_caps():
    msgs = [(now() - timedelta(days=200 - i), "Müştəri" if i % 2 else "Y Pod", f"mesaj{i} " + "x" * 300)
            for i in range(200)]
    t = people.transcript(msgs)
    assert len(t) <= 12500 and "mesaj0 " in t and "mesaj4 " in t and "mesaj199 " in t and "buraxıldı" in t
    assert t.startswith("— ") and t.count("— 20") >= 20  # gün başlıqları
    short = people.transcript(msgs[:3])
    assert "buraxıldı" not in short and short.count("Müştəri:") + short.count("Y Pod:") == 3


def test_parse_card():
    c = people.parse_card('```json\n{"full_name":" Aysel ","profession":"Həkim","phones":["050 111 22 33","x"],'
                          '"outcome":"LEAD","summary":"Qısa","reason":null}\n```')
    assert c["full_name"] == "Aysel" and c["phones"] == ["994501112233"] and c["outcome"] == "lead"
    assert c["reason"] == "" and c["workplace"] == "" and c["last_visit"] == "" and c["last_topic"] == ""
    c = people.parse_card('{"last_visit":" 2026-03-05 ","last_topic":"Qiymət soruşdu, cavab gözləyir"}')
    assert c["last_visit"] == "2026-03-05" and c["last_topic"] == "Qiymət soruşdu, cavab gözləyir"
    assert people.parse_card('{"last_visit":"keçən ay"}')["last_visit"] == ""
    assert people.parse_card('{"outcome":"nə isə"}')["outcome"] == "unknown"
    assert people.parse_card('{"outcome":"Other"}')["outcome"] == "other"
    with pytest.raises(ValueError):
        people.parse_card("cavab yoxdur")


def _bundle(**kw):
    b = {"phone": "994501112233", "phones_found": [], "ig_username": "test_user", "igsid": "111", "client_id": None,
         "sources": ["ig"], "msgs": [(now(), "Müştəri", "Salam")], "msg_count": 1, "first_contact_at": now(),
         "last_contact_at": now(), "transcript": "x",
         "facts": {"client_name": "", "profession": "", "workplace": "", "completed": False, "lead_service": "",
                   "lead_name": "", "wa_name": "", "last_shoot": None}}
    b.update(kw)
    return b


def test_upsert_idempotent_and_deterministic_wins(api):
    card = {"full_name": "AI Adı", "profession": "AI peşə", "workplace": "Klinika", "reason": "Brend", "service": "podkast",
            "need": "2 nəfər", "phones": ["994709998877"], "outcome": "lost", "summary": "Xülasə"}
    with SessionLocal() as db:
        db.add(KnownContact(phone="994709998877", kind="personal"))
        p1 = people.upsert(db, _bundle(), card)
        assert p1.display_name == "AI Adı" and p1.outcome == "lost" and p1.phones_found == "" and p1.card_at
        b = _bundle(igsid=None, phone=None, facts={**_bundle()["facts"], "client_name": "Real Ad", "profession": "Həkim",
                                                    "completed": True})
        p2 = people.upsert(db, b, card)  # ig_username üzrə eyni şəxs
        db.commit()
        assert p2.id == p1.id and db.query(Person).count() == 1
        assert p2.display_name == "Real Ad" and p2.profession == "Həkim" and p2.workplace == "Klinika"
        assert p2.outcome == "client" and p2.igsid == "111" and p2.phone == "994501112233"


def test_needs_card(api):
    with SessionLocal() as db:
        b = _bundle()
        assert people.needs_card(db, b)
        people.upsert(db, b, {"full_name": "", "profession": "", "workplace": "", "reason": "", "service": "",
                              "need": "", "phones": [], "outcome": "unknown", "summary": ""})
        assert not people.needs_card(db, b)
        assert people.needs_card(db, b, force=True)
        assert not people.needs_card(db, _bundle(msgs=[]))


def _seed():
    with SessionLocal() as db:
        db.add_all([Person(display_name="Aysel Test", phone="994501112233", profession="Həkim", sources="ig,wa",
                           outcome="client", last_contact_at=now(), last_visit_at=now(), last_topic="Reels soruşdu", ig_username="aysel_t", phones_found="994551112200"),
                    Person(display_name="Vəli", phone="994553334455", sources="app", outcome="lead", summary="Reels istəyir"),
                    Person(display_name="Anonim", sources="ig", outcome="unknown"),
                    Person(display_name="Montajçı", sources="wa", outcome="other")])
        db.commit()


def test_people_api(api):
    assert api.get("/api/admin/people").status_code == 401
    assert api.get("/api/admin/people/1").status_code == 401
    adm = bearer(admin_token(api))
    _seed()
    r = api.get("/api/admin/people", headers=adm).json()
    assert r["total"] == 4 and r["items"][0]["display_name"] == "Aysel Test"
    assert [i["display_name"] for i in r["items"]] == ["Aysel Test", "Montajçı", "Anonim", "Vəli"]  # boş last_contact_at sona, id azalan
    a = r["items"][0]
    assert a["wa_link"] == "https://wa.me/994501112233" and a["ig_link"] == "https://ig.me/m/aysel_t"
    assert a["sources"] == ["ig", "wa"] and a["phones_found"] == ["994551112200"]
    assert r["items"][2]["wa_link"] is None
    assert a["last_visit_at"] and a["last_topic"] == "Reels soruşdu" and r["items"][2]["last_visit_at"] is None
    q = lambda **p: api.get("/api/admin/people", params=p, headers=adm).json()  # noqa: E731
    assert q(q="AYSEL")["total"] == 1 and q(q="reels")["total"] == 1 and q(q="1112233")["total"] == 1
    assert q(q="050 111 22 33")["total"] == 1 and q(q="həkim")["total"] == 1
    assert q(outcome="lead")["total"] == 1 and q(source="ig")["total"] == 2 and q(source="wa")["total"] == 2 and q(outcome="other")["total"] == 1
    assert q(limit=1, offset=1)["items"][0]["display_name"] == "Montajçı" and q(limit=1)["total"] == 4
    pid = a["id"]
    assert api.get(f"/api/admin/people/{pid}", headers=adm).json()["display_name"] == "Aysel Test"
    assert api.get("/api/admin/people/999", headers=adm).status_code == 404


def test_collect_owner_links_ig_to_phone(api, monkeypatch):
    """people_links: IG hesabında nömrə yazılmayıb, amma Meta arxivindən təsdiqlənmiş bağ var -> bir şəxs."""
    import json, settings
    from crm import conf
    monkeypatch.setattr(settings, "IG_USER_ID", "")
    archive = {**ARCHIVE, "me": "900",
               "conversations": [{**ARCHIVE["conversations"][0],
                                  "participants": [{"id": "900"}, {"username": "Test_User", "id": "111"}]}]}
    with SessionLocal() as db:
        wc = WaContact(phone="994553334455", name="Vəli")
        db.add(wc)
        db.flush()
        conv = WaConversation(contact_id=wc.id, last_message_at=now())
        db.add(conv)
        db.flush()
        db.add(WaMessage(conversation_id=conv.id, direction="in", source="customer", text="WA mesajı"))
        db.commit()
        assert len(people.collect(db, archive)) == 2
        conf.put(db, people.LINKS_KEY, json.dumps([["@Test_User", "0553334455"], ["bad"], ["x", ""]]))
        db.commit()
        bundles = people.collect(db, archive)
    assert len(bundles) == 1
    b = bundles[0]
    assert b["phone"] == "994553334455" and b["ig_username"] == "test_user" and b["sources"] == ["ig", "wa"]
    assert "WA mesajı" in b["transcript"] and "Salam!" in b["transcript"]


def test_person_api_profile(api):
    import json
    with SessionLocal() as db:
        p = Person(display_name="Profil", phone="994501234567", profile=json.dumps({"prioritet": "isti", "ferdi_mesaj": "Salam"}))
        q = Person(display_name="Pozuq", profile="{bad")
        db.add_all([p, q])
        db.commit()
        pid, qid = p.id, q.id
    adm = bearer(admin_token(api))
    assert api.get(f"/api/admin/people/{pid}", headers=adm).json()["profile"]["prioritet"] == "isti"
    assert api.get(f"/api/admin/people/{qid}", headers=adm).json()["profile"] is None
