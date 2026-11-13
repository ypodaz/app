from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env, jreply, mk_conv  # noqa: F401,I001

import sys  # noqa: E402
from datetime import datetime, timedelta, timezone  # noqa: E402
from pathlib import Path  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

from crm import bot, contacts, customer_card, worker  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import BotDraft, Client, KnownContact, Shoot, WaContact, WaConversation, WaMessage  # noqa: E402

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import import_contacts  # noqa: E402


def known(phone, kind, first_name=""):
    with SessionLocal() as db:
        db.add(KnownContact(phone=phone, kind=kind, first_name=first_name))
        db.commit()


def conv_of(conv_id):
    with SessionLocal() as db:
        return db.get(WaConversation, conv_id)


# --- nömrə və marşrut ---

@pytest.mark.parametrize("raw,out", [("+994 50 111 22 33", "994501112233"), ("00994501112233", "994501112233"),
                                     ("050-111-22-33", "994501112233"), ("501112233", "994501112233"),
                                     ("+994 (050) 111 22 33", "994501112233"), ("+7 900 123 45 67", "79001234567"),
                                     ("", ""), (None, "")])
def test_normalize(raw, out):
    assert contacts.normalize(raw) == out


@pytest.mark.parametrize("phone,kind,expected", [("79001234567", None, "foreign"),
                                                 ("79001234567", "customer", "foreign"),
                                                 ("994501112233", "personal", "personal"),
                                                 ("994501112233", "customer", None),
                                                 ("994501112233", None, None),
                                                 (None, None, None)])
def test_route(phone, kind, expected):
    k = KnownContact(phone=phone or "", kind=kind) if kind else None
    assert contacts.route(WaContact(phone=phone, bsuid="b1"), k) == expected


@pytest.mark.parametrize("phone,kind,head", [("79001234567", None, "🌍 Xarici nömrə: Aysel, +79001234567"),
                                             ("994501112299", "personal", "👤 Şəxsi kontakt (Y Pod deyil): Aysel, "
                                                                          "+994501112299")])
def test_foreign_and_personal_go_human_once(api, crm_env, phone, kind, head):
    if kind:
        known(phone, kind)
    cid, conv_id = mk_conv(phone=phone, text="Qiymət nədir?")
    assert bot.handle(conv_id) == f"route:{'personal' if kind else 'foreign'}"
    c = conv_of(conv_id)
    assert c.mode == "human" and c.route
    assert crm_env.gemini_calls == []
    with SessionLocal() as db:
        assert db.scalar(select(BotDraft.id)) is None
    if kind:  # şəxsi kontakt: düyməli kart («✅ Müştəridir, bot yazsın»)
        (card,) = crm_env.tg("sendMessage")
        assert crm_env.alerts == []
        key, text = f"route:{conv_id}", card["text"]
        assert card["reply_markup"]["inline_keyboard"][0][0]["callback_data"] == f"f:w:{cid}:on"
    else:
        assert crm_env.tg("sendMessage") == []
        (key, text), = crm_env.alerts
    assert key == f"route:{conv_id}" and text.startswith(head) and "söhbət sizdədir. Mesaj: «Qiymət nədir?»" in text
    sent = len(crm_env.alerts) + len(crm_env.tg("sendMessage"))
    # növbəti mesaj: söhbət insandadır, xəbər təkrarlanmır
    assert bot.handle(conv_id) == "skip:human" and len(crm_env.alerts) + len(crm_env.tg("sendMessage")) == sent
    # sahibkar `bot`-a qaytarıbsa, bot işləyir və təkrar ötürmür
    with SessionLocal() as db:
        db.get(WaConversation, conv_id).mode = "bot"
        db.commit()
    crm_env.gemini(jreply())
    assert bot.handle(conv_id) == "draft" and len(crm_env.alerts) == (0 if kind else 1)


def test_customer_and_new_numbers_get_bot(api, crm_env):
    known("994501112233", "customer", "Leyla")
    _, conv_id = mk_conv()
    _, conv2 = mk_conv(phone="994551112233")
    crm_env.gemini(jreply(), jreply())
    assert bot.handle(conv_id) == "draft" and bot.handle(conv2) == "draft"
    assert crm_env.alerts == [] and conv_of(conv_id).route is None


def test_bsuid_only_contact_not_routed(api, crm_env):
    _, conv_id = mk_conv(phone=None, bsuid="BSUID1")
    crm_env.gemini(jreply())
    assert bot.handle(conv_id) == "draft"


def test_followups_skip_human_conversations(api, crm_env):
    cid, conv_id = mk_conv(phone="79001234567")
    bot.handle(conv_id)
    with SessionLocal() as db:
        assert all(c.id != conv_id for c in worker.price_due(db) + worker.due_conversations(db))


# --- müştəri kartı ---

def _shoot(db, client_id, status, day, **kw):
    db.add(Shoot(client_id=client_id, tag=kw.pop("tag", "podcast"), location="studio", duration_min=60,
                 cameras=kw.pop("cameras", 2), status=status,
                 starts_at=datetime(2026, 8, day, 10, 0, tzinfo=timezone.utc), **kw))


def test_customer_card(api, crm_env):
    known("994501112233", "customer", "Leyla")
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        c = Client(full_name="Test Müştəri", phone="+994501112233", card_code="CARD1")
        other = Client(full_name="Başqa", phone="0559998877", card_code="CARD2")
        db.add_all([c, other])
        db.flush()
        _shoot(db, c.id, "completed", 1, tag="reels", cameras=1)
        _shoot(db, c.id, "completed", 20)
        _shoot(db, c.id, "cancelled", 25)
        _shoot(db, c.id, "no_show", 26)
        _shoot(db, c.id, "confirmed", 27)
        _shoot(db, other.id, "completed", 28)
        db.add(WaMessage(conversation_id=conv_id, direction="in", source="history", text="köhnə",
                         created_at=datetime(2026, 5, 3, 9, 0, tzinfo=timezone.utc)))
        db.commit()
        contact = db.get(WaContact, cid)
        assert customer_card.build(db, contact) == (
            "Köhnə müştəridir (kontaktda Y Pod kimi qeydlidir). Adı: Leyla\n"
            "Bizdə 2 çəkilişi olub, sonuncu: 2026-08-20, podkast, 2 kamera\n"
            "Əvvəlki yazışma var (son: 2026-05-03)")
        assert customer_card.short(db, contact) == "köhnə müştəri · 2 çəkiliş · son 2026-08 · köhnə yazışma var"
    crm_env.gemini(jreply())
    bot.handle(conv_id)
    system, _ = crm_env.gemini_calls[0]
    assert "Müştəri haqqında:\nKöhnə müştəridir" in system and "{customer}" not in system
    with SessionLocal() as db:
        assert db.scalar(select(BotDraft)).model_output["customer_short"].startswith("köhnə müştəri · 2 çəkiliş")


def test_new_customer_card_empty(api, crm_env):
    cid, conv_id = mk_conv()
    with SessionLocal() as db:
        assert customer_card.build(db, db.get(WaContact, cid)) == ""
        assert customer_card.short(db, db.get(WaContact, cid)) == ""
    crm_env.gemini(jreply())
    bot.handle(conv_id)
    assert "Müştəri haqqında:\nyoxdur" in crm_env.gemini_calls[0][0]


# --- köhnə yazışma kontekstdə ---

def test_history_context_before_current(api, crm_env):
    cid, conv_id = mk_conv(text="indi yazıram")
    with SessionLocal() as db:
        old = WaConversation(contact_id=cid, kapso_conversation_id="old")
        db.add(old)
        db.flush()
        base = now() - timedelta(days=30)
        for i in range(12):  # 12 köhnə mesaj: yalnız son 10-u düşür
            db.add(WaMessage(conversation_id=old.id if i < 6 else conv_id, direction="in" if i % 2 == 0 else "out",
                             source="history", text=f"h{i}", created_at=base + timedelta(minutes=i)))
        db.commit()
        hist = bot._history(db, db.get(WaConversation, conv_id))
    assert hist == [("user" if i % 2 == 0 else "model", f"h{i}") for i in range(2, 12)] + [("user", "indi yazıram")]


# --- kontakt idxalı ---

def test_import_parse():
    rows = import_contacts.parse([
        ["Leyla Həsənova Y Pod", ["+994 50 111 22 33"]],
        ["Dost", ["0501112233", "055 222 33 44", "+7 900 123 45 67"]],  # 0501112233 customer qalır
        ["ypod - Kamran", ["00994705556677"]],
        ["Nərmin Y-Pod", ["123"]],  # qısa nömrə atılır
        ["Anam", []],
    ])
    assert rows == {"994501112233": ("customer", "Leyla", "Leyla Həsənova"), "994552223344": ("personal", "", ""),
                    "79001234567": ("personal", "", ""), "994705556677": ("customer", "Kamran", "Kamran")}
    assert import_contacts.counts(rows) == {"customer": 2, "personal": 2, "xarici": 1}


def test_import_upsert(api):
    known("994552223344", "personal")
    assert import_contacts.upsert({"994552223344": ("customer", "Leyla", "Leyla Həsənova"),
                                   "994501112233": ("personal", "", "")}) == 2
    assert import_contacts.upsert({"994552223344": ("customer", "Leyla", "Leyla Həsənova")}) == 0
    with SessionLocal() as db:
        assert db.get(KnownContact, "994552223344").kind == "customer"
