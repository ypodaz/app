"""Avtomatik rezerv (crm/autobook.py): yoxlama, tutma, mesajlar, qəbz, Telegram düymələri, vaxtın bitməsi, WhatsApp və Instagram yolu."""
from test_auth import api  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env, jreply, mk_conv  # noqa: F401,I001
from test_social_inbox import auto_mode, dm, items, net, post_ig  # noqa: F401,I001
from test_crm_bot import callback  # noqa: F401,I001

import json  # noqa: E402
from datetime import date, datetime, timedelta  # noqa: E402

import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

import booking  # noqa: E402
from crm import autobook, bot, calendar_ics, conf  # noqa: E402
from db import SessionLocal, now  # noqa: E402
from models import BookingHold, Block, Client, Lead, Shoot, WaConversation, WaMessage  # noqa: E402
from views import BAKU, utc  # noqa: E402

TODAY = date(2026, 11, 20)
CARD = "Test kart 0000 0000 0000 0000, Test Müştəri"
ADDR = "Test ünvan, test taksi qeydi"


@pytest.fixture(autouse=True)
def cal(monkeypatch):
    """Təqvim (ICS) saxtadır: state['busy'] aralıqları, state['error'] — oxunmur. Real ICS testləri test_autobook_ics.py-dədir."""
    state = {"busy": [], "error": False}

    def fake(start, end):
        if state["error"]:
            raise calendar_ics.CalendarUnavailable("test")
        return [(a, b) for a, b in state["busy"] if a < end and start < b]

    monkeypatch.setattr(calendar_ics, "busy_strict", fake)
    return state


def at(day, hh, mm=0):
    return datetime(2026, 11, day, hh, mm, tzinfo=BAKU)


def setup_conf(card=CARD, address=ADDR, on=True):
    with SessionLocal() as db:
        conf.put(db, "auto_booking", "true" if on else "false")
        conf.put(db, "booking_card_text", card)
        conf.put(db, "booking_address_text", address)
        db.commit()


def reels(days, start="12:00"):
    """Bakı vaxtı ilə bu gündən `days` gün sonrakı tarix (botun `booking` sahəsi)."""
    d = (now().astimezone(BAKU) + timedelta(days=days)).date().isoformat()
    return {"date": d, "start": start, "hours": None, "service": "reels", "cameras": None}


def hold_it(db, ref="1", day=24, hh=12, mm=0, channel="wa", service="reels"):
    b = {"date": f"2026-11-{day}", "start": f"{hh:02d}:{mm:02d}", "hours": None, "service": service, "cameras": None}
    return autobook.try_hold(db, channel=channel, ref=ref, lead=None, name="Test Müştəri", phone="994500000000",
                             booking=b, now_dt=at(20, 10))


def add_shoot(db, day, hh):
    c = Client(full_name="Test Müştəri", phone="994500000001", card_code=f"t{day}{hh}")
    db.add(c)
    db.flush()
    return booking.create_shoot(db, None, client_id=c.id, starts_at=utc(at(day, hh)), duration_min=60, kind="shoot", tag="podcast",
                                location="studio", cameras=1, editing=False)


# --- yoxlama ---

def test_check_days(api):
    with SessionLocal() as db:
        assert autobook.check(db, at(21, 12), 60, TODAY) == (False, "too_soon")  # D+1
        assert autobook.check(db, at(22, 12), 60, TODAY) == (True, "ok")  # D+2


def test_check_hours(api):
    with SessionLocal() as db:
        assert autobook.check(db, at(24, 7, 30), 60, TODAY) == (False, "hours")
        assert autobook.check(db, at(24, 21, 30), 60, TODAY) == (False, "hours")  # bitmə 22:30
        assert autobook.check(db, at(24, 21, 0), 60, TODAY)[0]


def test_check_buffer_after_shoot(api):
    with SessionLocal() as db:
        add_shoot(db, 24, 12)  # 12:00–13:00 (hazırlıq 15 dəq əvvəl: məşğul 11:45–13:00)
        db.commit()
        assert autobook.check(db, at(24, 13, 59), 60, TODAY) == (False, "conflict")
        assert autobook.check(db, at(24, 14, 0), 60, TODAY)[0]
        assert autobook.check(db, at(24, 10, 0), 60, TODAY) == (False, "conflict")  # bitmə 11:00 + 60 dəq = 12:00 > 11:45
        assert autobook.check(db, at(24, 9, 30), 60, TODAY)[0]  # 10:30 + 60 dəq = 11:30 ≤ 11:45


def test_check_block_and_calendar(api, cal):
    with SessionLocal() as db:
        db.add(Block(starts_at=utc(at(25, 15)), ends_at=utc(at(25, 16)), reason="test"))
        db.commit()
        assert autobook.check(db, at(25, 16, 30), 60, TODAY) == (False, "conflict")
        assert autobook.check(db, at(25, 17, 0), 60, TODAY)[0]
        cal["busy"] = [(at(26, 10), at(26, 11))]
        assert autobook.check(db, at(26, 11, 30), 60, TODAY) == (False, "conflict")  # ICS hadisəsi
        cal["error"] = True
        assert autobook.check(db, at(27, 12), 60, TODAY) == (False, "calendar")


def test_alternatives_respect_today_and_buffer(api):
    with SessionLocal() as db:
        db.add(Block(starts_at=utc(at(22, 8)), ends_at=utc(at(22, 20)), reason="test"))
        db.commit()
        alts = autobook.alternatives(db, date(2026, 11, 22), 60, today=TODAY)
        assert alts == [at(22, 21), at(23, 8), at(23, 8, 30)]  # bloka 60 dəq bufer
        assert autobook.alternatives(db, date(2026, 11, 20), 60, today=TODAY)[0] == at(22, 21)  # D+2-dən əvvəl təklif yox


def test_alternatives_calendar_down_returns_empty(api, cal):
    cal["error"] = True
    with SessionLocal() as db:
        assert autobook.alternatives(db, date(2026, 11, 24), 60, today=TODAY) == []


# --- qiymət və ayar ---

def test_quote(api):
    q = autobook.quote({"service": "reels"}, None)
    assert (q["kind"], q["duration_min"], q["total"], q["deposit"]) == ("reels_pack", 60, 150 * 100, 75 * 100)
    lead = Lead(contact_id=1, cameras=2, editing=True)
    q = autobook.quote({"service": "podkast", "hours": 2, "cameras": None}, lead)
    assert (q["kind"], q["tag"], q["cameras"], q["editing"], q["duration_min"]) == ("shoot", "podcast", 2, True, 120)
    assert q["total"] == 120 * 100 * 2 + 100 * 100 and q["deposit"] == q["total"] // 2
    assert autobook.quote({"service": "podkast", "hours": 0.7}, None) is None  # yarım saat addımı deyil
    assert autobook.quote({"service": "korporativ"}, None) is None
    assert autobook.quote({"service": "tek_reels"}, None)["total"] == 40 * 100


def test_enabled_needs_switch_and_card(api):
    with SessionLocal() as db:
        assert not autobook.enabled(db)
        conf.put(db, "auto_booking", "true")
        assert not autobook.enabled(db)  # kart mətni boşdur
        conf.put(db, "booking_card_text", "   ")
        assert not autobook.enabled(db)
        conf.put(db, "booking_card_text", CARD)
        assert autobook.enabled(db)
        conf.put(db, "auto_booking", "false")
        assert not autobook.enabled(db)


# --- tutma ---

def test_try_hold_messages_and_block(api, crm_env):
    setup_conf()
    with SessionLocal() as db:
        r = hold_it(db)
        assert r["ok"] and len(r["messages"]) == 5
        m = r["messages"]
        assert m[0] == "Çərşənbə axşamı 24.11 saat 12:00 sizin üçün boşdur 🙏\nReels paketi: 1 saat çəkiliş və 5 hazır Reels, montaj daxil — 150 AZN."
        assert m[1] == "Rezervasiya üçün 50% ön ödəniş: 75 AZN. Kart məlumatı:" and m[2] == CARD and m[3] == ADDR
        assert m[4].startswith("Ödənişi etdikdən sonra qəbzi")
        h = r["hold"]
        assert (h.status, h.deposit, h.total) == ("pending", 7500, 15000)
        assert db.get(Block, h.block_id).reason == "⏳ Bot rezervi: Test Müştəri"
        assert h.tg_message_id
        hid = h.id
    [card] = crm_env.tg("sendMessage")
    assert card["text"].startswith("📅 Bot saatı tutdu, qəbz gözlənilir\nTest Müştəri, 994500000000\nÇərşənbə axşamı 24.11 12:00–13:00")
    assert [b["callback_data"] for b in card["reply_markup"]["inline_keyboard"][0]] == [f"b:{hid}:c", f"b:{hid}:x"]


def test_second_hold_same_slot_conflicts_with_alternatives(api):
    setup_conf()
    with SessionLocal() as db:
        assert hold_it(db, ref="1")["ok"]
        r = hold_it(db, ref="2")
        assert not r["ok"] and r["reason"] == "conflict"
        assert r["messages"][0].startswith("Bu saat artıq doludur. Yaxın boş saatlar: 24.11 saat ")
        assert r["messages"][0].endswith(". Hansı sizə uyğundur?")
        assert len(db.scalars(select(Block)).all()) == 1


def test_same_ref_new_hold_replaces_old(api):
    setup_conf()
    with SessionLocal() as db:
        first = hold_it(db, ref="1", hh=12)["hold"]
        second = hold_it(db, ref="1", hh=12, mm=30)  # öz köhnə saatı ilə kəsişir, amma ona mane olmur
        assert second["ok"]
        db.refresh(first)
        assert first.status == "cancelled" and first.block_id is None
        assert len(db.scalars(select(Block)).all()) == 1
        assert autobook.pending_hold(db, "wa", "1").id == second["hold"].id


def test_try_hold_too_soon_has_no_messages(api):
    with SessionLocal() as db:
        r = hold_it(db, day=21)
        assert (r["ok"], r["reason"], r["messages"]) == (False, "too_soon", [])
        assert db.scalars(select(BookingHold)).all() == []


# --- bot (WhatsApp) ---

def booking_reply(days=5, **kw):
    return jreply("Təşəkkürlər, komandaya ötürürəm.", handoff=True, handoff_reason="rezerv", booking=reels(days), **kw)


def one(model, *where):
    with SessionLocal() as db:
        return db.scalar(select(model).where(*where).order_by(model.id.desc()))


def wa_ready(mode="auto", address=ADDR):
    setup_conf(address=address)
    with SessionLocal() as db:
        conf.put(db, "bot_mode", mode)
        db.commit()
    return mk_conv(phone="994500000000", name="Test Müştəri")


def sent_texts(crm_env):
    return [j["text"]["body"] for _, j in crm_env.kapso()]


def customer_says(conv_id, text):
    with SessionLocal() as db:
        db.add(WaMessage(conversation_id=conv_id, direction="in", source="customer", text=text,
                         created_at=now() + timedelta(seconds=5)))
        db.commit()


def test_bot_autobook_sends_five_messages(api, crm_env):
    _, conv_id = wa_ready()
    crm_env.gemini(booking_reply())
    assert bot.handle(conv_id) == "autobook"
    texts = sent_texts(crm_env)
    assert len(texts) == 5 and texts[2] == CARD and "sizin üçün boşdur 🙏" in texts[0]
    lead, hold = one(Lead), one(BookingHold)
    assert lead.stage == "beh" and hold.status == "pending" and hold.lead_id == lead.id
    assert one(WaConversation).mode == "bot"  # handoff yoxdur
    assert len(crm_env.tg("sendMessage")) == 1  # yalnız sahibkar kartı


def test_bot_autobook_conflict_sends_alternatives_instead_of_reply(api, crm_env):
    _, conv_id = wa_ready()
    d = reels(5)["date"]
    with SessionLocal() as db:
        db.add(Block(starts_at=utc(datetime.fromisoformat(f"{d}T11:00").replace(tzinfo=BAKU)),
                     ends_at=utc(datetime.fromisoformat(f"{d}T13:00").replace(tzinfo=BAKU)), reason="test"))
        db.commit()
    crm_env.gemini(booking_reply())
    assert bot.handle(conv_id) == "autobook:alternativ"
    [text] = sent_texts(crm_env)
    assert text.startswith("Bu saat artıq doludur. Yaxın boş saatlar:") and one(BookingHold) is None
    assert one(WaConversation).mode == "bot"


@pytest.mark.parametrize("case", ["too_soon", "ru", "disabled", "draft_mode", "no_booking"])
def test_bot_falls_back_to_old_path(api, crm_env, case):
    _, conv_id = wa_ready(mode="draft" if case == "draft_mode" else "auto")
    if case == "disabled":
        with SessionLocal() as db:
            conf.put(db, "auto_booking", "false")
            db.commit()
    out = booking_reply(days=1 if case == "too_soon" else 5, **({"language": "ru"} if case == "ru" else {}))
    if case == "no_booking":
        out["booking"] = None
    crm_env.gemini(out)
    assert bot.handle(conv_id) in ("handoff:rezerv", "draft")
    assert one(BookingHold) is None
    assert not any("Kart məlumatı" in t for t in sent_texts(crm_env))


def test_receipt_image_moves_hold_to_receipt_and_waits(api, crm_env):
    _, conv_id = wa_ready()
    crm_env.gemini(booking_reply())
    bot.handle(conv_id)
    crm_env.http.clear()
    customer_says(conv_id, "[şəkil: qəbz]")
    assert bot.handle(conv_id) == "receipt"  # Gemini çağırılmır (növbə boşdur)
    assert one(BookingHold).status == "receipt" and one(WaConversation).mode == "wait"
    assert sent_texts(crm_env) == ["Qəbzi aldıq, komanda yoxlayıb təsdiqləyəcək 🙏"]
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("🧾 Qəbz gəldi (yeni kart")
    card = crm_env.tg("sendMessage")[-1]
    assert card["text"].startswith("🧾 Qəbz gəldi\n") and card["reply_markup"]["inline_keyboard"][0][0]["text"] == "✅ Təsdiqlə"


def test_confirm_after_receipt_creates_shoot_with_deposit(api, crm_env):
    _, conv_id = wa_ready()
    crm_env.gemini(booking_reply())
    bot.handle(conv_id)
    hold_id = one(BookingHold).id
    customer_says(conv_id, "[şəkil]")
    bot.handle(conv_id)
    crm_env.http.clear()
    assert callback(api, f"b:{hold_id}:c").json()["result"] == "confirmed"
    with SessionLocal() as db:
        hold = db.get(BookingHold, hold_id)
        s = db.get(Shoot, hold.shoot_id)
        assert hold.status == "confirmed" and hold.block_id is None and db.scalars(select(Block)).all() == []
        assert (s.kind, s.total, s.deposit_amount, s.source_note, s.prep_min, s.wrap_min) == ("reels_pack", 15000, 7500, "bot", 15, 0)
        assert s.deposit_received_at is not None
        assert db.get(Client, s.client_id).phone == "994500000000"
        lead = db.get(Lead, hold.lead_id)
        assert lead.stage == "tesdiq" and lead.shoot_id == s.id
    assert sent_texts(crm_env)[0].startswith("Rezervasiyanız təsdiqləndi: ") and sent_texts(crm_env)[0].endswith("saat 12:00. Gözləyirik 😊")
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("✅ Təsdiqləndi")
    assert callback(api, f"b:{hold_id}:c").json()["result"] == "resolved"  # təkrar basma
    assert crm_env.tg("answerCallbackQuery")[-1]["text"] == "artıq həll olunub"


def test_confirm_without_receipt_has_no_deposit(api, crm_env):
    _, conv_id = wa_ready()
    crm_env.gemini(booking_reply())
    bot.handle(conv_id)
    assert callback(api, f"b:{one(BookingHold).id}:c").json()["result"] == "confirmed"
    s = one(Shoot)
    assert s.deposit_received_at is None and s.deposit_expected == 7500


def test_confirm_window_closed_notes_on_card(api, crm_env):
    _, conv_id = wa_ready()
    crm_env.gemini(booking_reply())
    bot.handle(conv_id)
    with SessionLocal() as db:
        db.get(WaConversation, conv_id).window_expires_at = now() - timedelta(hours=1)
        db.commit()
    assert callback(api, f"b:{one(BookingHold).id}:c").json()["result"] == "confirmed"
    assert one(Shoot) is not None
    assert "Müştəriyə yazılmadı" in crm_env.tg("editMessageText")[-1]["text"]


def test_cancel_button_frees_slot_silently(api, crm_env):
    _, conv_id = wa_ready()
    crm_env.gemini(booking_reply())
    bot.handle(conv_id)
    n = len(sent_texts(crm_env))
    hold_id = one(BookingHold).id
    assert callback(api, f"b:{hold_id}:x").json()["result"] == "cancelled"
    assert one(BookingHold).status == "cancelled" and one(Block) is None and one(Shoot) is None
    assert len(sent_texts(crm_env)) == n  # müştəriyə heç nə getmir
    assert crm_env.tg("editMessageText")[-1]["text"].startswith("❌ Ləğv edildi")
    assert callback(api, f"b:{hold_id}:x").json()["result"] == "resolved"


def test_callback_from_foreign_chat_ignored(api, crm_env):
    _, conv_id = wa_ready()
    crm_env.gemini(booking_reply())
    bot.handle(conv_id)
    assert callback(api, f"b:{one(BookingHold).id}:c", chat="123").json()["result"] == "ignored"
    assert one(BookingHold).status == "pending"


def test_expire_due(api, crm_env):
    setup_conf()
    with SessionLocal() as db:
        a = hold_it(db, ref="1", hh=10)["hold"]
        b = hold_it(db, ref="2", hh=14)["hold"]
        b.status = "receipt"  # qəbz gəlib: vaxtı bitsə də boşalmır
        a.hold_until = b.hold_until = now() + timedelta(hours=24)
        db.commit()
        assert autobook.expire_due(db, now() + timedelta(hours=23)) == 0
        assert autobook.expire_due(db, now() + timedelta(hours=25)) == 1
        db.refresh(a)
        db.refresh(b)
        assert (a.status, a.block_id, b.status) == ("expired", None, "receipt")
        assert len(db.scalars(select(Block)).all()) == 1
    assert crm_env.tg("sendMessage")[-1]["text"].startswith("⌛ Qəbz gəlmədi, Çərşənbə axşamı 24.11 saat 10:00 boşaldı: Test Müştəri")


# --- admin ayarları və JSON sahəsi ---

def test_admin_settings_roundtrip(api):
    from test_auth import admin_token, bearer
    adm = bearer(admin_token(api))
    s = api.get("/api/admin/bot/settings", headers=adm).json()
    assert (s["auto_booking"], s["booking_card_text"], s["booking_address_text"]) == (False, "", "")
    s = api.post("/api/admin/bot/settings", json={"auto_booking": True, "booking_card_text": f" {CARD} ",
                                                  "booking_address_text": ADDR}, headers=adm).json()
    assert (s["auto_booking"], s["booking_card_text"], s["booking_address_text"]) == (True, CARD, ADDR)
    s = api.post("/api/admin/bot/settings", json={"booking_address_text": ""}, headers=adm).json()
    assert s["booking_address_text"] == "" and s["booking_card_text"] == CARD  # boş string təmizləyir, qalanı toxunulmaz
    assert api.post("/api/admin/bot/settings", json={"booking_card_text": "x" * 501}, headers=adm).status_code == 422


def test_parse_reply_booking_field():
    def parse(b):
        return bot.parse_reply(json.dumps(jreply("x", booking=b)))["booking"]
    ok = {"date": "2026-11-25", "start": "9:30", "hours": 2, "service": "podkast", "cameras": 2}
    assert parse(ok) == {"date": "2026-11-25", "start": "09:30", "hours": 2.0, "service": "podkast", "cameras": 2}
    for bad in (None, "x", {**ok, "date": "sabah"}, {**ok, "start": "axşam"}, {**ok, "service": "diger"},
                {**ok, "hours": 12}, {**ok, "start": "25:00"}):
        assert parse(bad) is None


# --- Instagram DM ---

def graph_texts(net):
    return [kw["json"]["message"]["text"] for m, url, kw in net.calls if m == "POST" and url.endswith("/me/messages")]


def test_ig_autobook_receipt_and_confirm(api, net, crm_env):
    setup_conf()
    auto_mode()
    crm_env.gemini(booking_reply())
    post_ig(api, dm(mid="m1", text="Saat 12-də Reels çəkdirmək istəyirəm"))
    texts = graph_texts(net)
    assert len(texts) == 5 and texts[2] == CARD
    [it] = items()
    assert it.status == "sent" and "sizin üçün boşdur" in it.draft_text
    hold = one(BookingHold)
    assert (hold.channel, hold.ref, hold.status) == ("ig", "555", "pending")
    post_ig(api, dm(mid="m2", text="[şəkil]"))  # qəbz: Gemini çağırılmır
    assert graph_texts(net)[-1] == "Qəbzi aldıq, komanda yoxlayıb təsdiqləyəcək 🙏"
    assert one(BookingHold).status == "receipt"
    assert callback(api, f"b:{hold.id}:c").json()["result"] == "confirmed"
    assert graph_texts(net)[-1].startswith("Rezervasiyanız təsdiqləndi")
    assert one(Shoot).deposit_amount == 7500


def test_ig_autobook_off_keeps_old_path(api, net, crm_env):
    setup_conf(on=False)
    auto_mode()
    crm_env.gemini(booking_reply())
    post_ig(api, dm(mid="m1", text="Saat 12-də Reels"))
    assert one(BookingHold) is None and not any("Kart məlumatı" in t for t in graph_texts(net))
