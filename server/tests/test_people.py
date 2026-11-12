from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env  # noqa: F401,I001

import pytest  # noqa: E402

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
    msgs = [(now(), "Müştəri" if i % 2 else "Y Pod", f"mesaj{i} " + "x" * 300) for i in range(200)]
    t = people.transcript(msgs)
    assert len(t) <= 6200 and "mesaj0 " in t and "mesaj4 " in t and "mesaj199 " in t and "mesaj50 " not in t


def test_parse_card():
    c = people.parse_card('```json\n{"full_name":" Aysel ","profession":"Həkim","phones":["050 111 22 33","x"],'
                          '"outcome":"LEAD","summary":"Qısa","reason":null}\n```')
    assert c["full_name"] == "Aysel" and c["phones"] == ["994501112233"] and c["outcome"] == "lead"
    assert c["reason"] == "" and c["workplace"] == ""
    assert people.parse_card('{"outcome":"nə isə"}')["outcome"] == "unknown"
    with pytest.raises(ValueError):
        people.parse_card("cavab yoxdur")


def _bundle(**kw):
    b = {"phone": "994501112233", "phones_found": [], "ig_username": "test_user", "igsid": "111", "client_id": None,
         "sources": ["ig"], "msgs": [(now(), "Müştəri", "Salam")], "msg_count": 1, "first_contact_at": now(),
         "last_contact_at": now(), "transcript": "x",
         "facts": {"client_name": "", "profession": "", "workplace": "", "completed": False, "lead_service": "",
                   "lead_name": "", "wa_name": ""}}
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
                           outcome="client", last_contact_at=now(), ig_username="aysel_t", phones_found="994551112200"),
                    Person(display_name="Vəli", phone="994553334455", sources="app", outcome="lead", summary="Reels istəyir"),
                    Person(display_name="Anonim", sources="ig", outcome="unknown")])
        db.commit()


def test_people_api(api):
    assert api.get("/api/admin/people").status_code == 401
    assert api.get("/api/admin/people/1").status_code == 401
    adm = bearer(admin_token(api))
    _seed()
    r = api.get("/api/admin/people", headers=adm).json()
    assert r["total"] == 3 and r["items"][0]["display_name"] == "Aysel Test"
    assert [i["display_name"] for i in r["items"]] == ["Aysel Test", "Anonim", "Vəli"]  # boş last_contact_at sona, id azalan
    a = r["items"][0]
    assert a["wa_link"] == "https://wa.me/994501112233" and a["ig_link"] == "https://ig.me/m/aysel_t"
    assert a["sources"] == ["ig", "wa"] and a["phones_found"] == ["994551112200"]
    assert r["items"][1]["wa_link"] is None
    q = lambda **p: api.get("/api/admin/people", params=p, headers=adm).json()  # noqa: E731
    assert q(q="AYSEL")["total"] == 1 and q(q="reels")["total"] == 1 and q(q="1112233")["total"] == 1
    assert q(q="050 111 22 33")["total"] == 1 and q(q="həkim")["total"] == 1
    assert q(outcome="lead")["total"] == 1 and q(source="ig")["total"] == 2 and q(source="wa")["total"] == 1
    assert q(limit=1, offset=1)["items"][0]["display_name"] == "Anonim" and q(limit=1)["total"] == 3
    pid = a["id"]
    assert api.get(f"/api/admin/people/{pid}", headers=adm).json()["display_name"] == "Aysel Test"
    assert api.get("/api/admin/people/999", headers=adm).status_code == 404
