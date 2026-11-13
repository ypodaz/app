"""WhatsApp botu: söhbəti oxuyur, Gemini-dən JSON cavab alır, təhlükəsizlik filtrindən keçirir, lead-i yeniləyir,
qaralama yaradır (susmaya görə) və ya göndərir (`bot_mode = auto`; `new_auto` — yalnız ilk dəfə yazana). Rezervi bot heç vaxt təsdiqləmir.
"""
import json
import logging
import re
import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import ai
import alerts
import tgtopics
from ai import WD, AiError
from crm import bot_prompt, chat, conf, contacts, customer_card, events, kapso, slots, tg, turns, typing_state, voice
from db import SessionLocal, aware, now
from models import BotDraft, Faq, Lead, LeadEvent, UnansweredQuestion, WaContact, WaConversation, WaMessage
from views import BAKU

log = logging.getLogger("bot")

HISTORY = 20
OLD_HISTORY = 10  # Kapso history_sync ilə gələn köhnə yazışmadan neçə mesaj
MAX_REPLY = 900
FORBIDDEN = ("icarə", "kirayə", "ən yaxşı")
# Türk sözləri azərbaycanca cavabda qadağandır; müştəri türkcə yazıbsa (language=tr) yoxlanmır.
FORBIDDEN_NON_TR = ("ekip", "kesin", " için")
LANGS = ("az", "ru", "en", "tr")
# Model qaydaya baxmayaraq kitab dili işlədir (v15 sınağında 86-dan 2–4 ssenari): göndərməzdən əvvəl danışıq dilinə çevrilir
POLISH = (
    (re.compile(r"(\d+(?:[.,]\d+)?\s*AZN)\s+təşkil edir"), r"\1-dir"),
    (re.compile(r"təşkil edir"), "edir"),
    (re.compile(r"planlaşdırırsınız"), "fikirləşirsiniz"),
    (re.compile(r"Planlaşdırırsınız"), "Fikirləşirsiniz"),
    (re.compile(r"([Qq])alan məbləğ"), r"\1alan hissə"),
    (re.compile(r"məbləğ"), "qiymət"),
)
SERVICES = ("podkast", "reels", "korporativ", "diger")
STAGES = ["yeni", "maraqlanir", "tarix", "beh", "tesdiq", "geldi", "itirildi"]
BOT_MAX_STAGE = "beh"  # bot bundan yuxarı qaldırmır
FOUND_VIA = ("instagram", "tiktok", "youtube", "reklam", "tanis", "google", "diger")
# Lead cədvəlində sütunu olmayan sahələr qeydlərə (notes) «Etiket: dəyər» sətri kimi yazılır
NOTE_FIELDS = {"instagram": "Instagram", "found_via": "Haradan tapıb", "referred_by": "Kim tövsiyə edib"}
IG_TALK = "Instagram yazışması"  # IG DM-dən lead yarananda müştərinin son mesajları (social_inbox)
MAX_REGENERATE = tg.MAX_REGENERATE
# Telegram xəbərində 🔴 ilə başda çıxan səbəblər: sahibkar dərhal geri zəng etsin
URGENT_REASONS = {"insan_istedi": "müştəri canlı adamla danışmaq istəyir", "sikayet": "şikayət var"}
ALEYKUM_RE = re.compile(r"[əae]l[eə]y?k[uü]m", re.I)  # «Aleykum salam» dindar tondur, sahibkar istəmir
# Video və sənədi bot aça bilmir: sabit cavab, söhbət sahibkara keçir (AI çağırılmır). routes/webhooks.MEDIA_LABEL
FILE_LABELS = ("[video]", "[sənəd]")
FILE_REPLY = "Mən Y Pod-un virtual köməkçisiyəm, faylı komandamıza ötürürəm, baxıb sizə məlumat verəcəklər 🙏"
PARTNER_REASONS = ("emekdasliq",)  # özünü təqdim edib xidmət/iş təklif edən: qısa təşəkkür, satış yox, söhbət sahibkara
SILENT_REASONS = ("is",)  # iş yazışması (montaj materialı, mövcud layihə, komanda): bot heç nə yazmır


class BotFormatError(Exception):
    pass


# --- cavabın oxunması və filtr ---

def _null(v):
    return None if v is None or (isinstance(v, str) and v.strip().lower() in ("", "null", "none")) else v


def _int(v):
    try:
        return int(v) if not isinstance(v, bool) and _null(v) is not None else None
    except (TypeError, ValueError):
        return None


def _bool(v):
    if isinstance(v, bool):
        return v
    return {"true": True, "false": False}.get(str(v).strip().lower())


def _str(v, n: int):
    v = _null(v)
    return str(v).strip()[:n] or None if v is not None else None


def _found_via(v):
    v = str(_null(v) or "").strip().lower()
    return v if v in FOUND_VIA else None  # model şablonu («instagram|tiktok|…») qaytarsa da yazılmır


def _date(v):
    """«YYYY-MM-DD» → həmin gün; model şablonu və ya yanlış yazılış None."""
    try:
        return datetime.strptime(str(_null(v) or "").strip(), "%Y-%m-%d").date()
    except ValueError:
        return None


REMIND_HOUR = 9  # «sonra yazacaq» xatırlatması həmin gün Bakı vaxtı 09:00-da
REMIND_MAX_DAYS = 90


def parse_reply(text: str) -> dict:
    """Kod hasarlarını (```json) təmizləyir, JSON-u oxuyur, sahələri yoxlayıb təmiz dict qaytarır."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I)
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        raise BotFormatError("JSON tapılmadı")
    try:
        data = json.loads(t[i:j + 1])
    except ValueError as e:
        raise BotFormatError("JSON oxunmadı") from e
    if not isinstance(data, dict) or not isinstance(data.get("reply"), str):
        raise BotFormatError("reply sahəsi yoxdur")
    handoff = _bool(data.get("handoff"))
    if handoff is None:
        raise BotFormatError("handoff sahəsi yoxdur")
    reply = data["reply"].strip()
    if not reply and not handoff:
        raise BotFormatError("reply boşdur")
    lead = data.get("lead") if isinstance(data.get("lead"), dict) else {}
    lang = str(_null(data.get("language")) or "").strip().lower()
    return {
        "reply": reply,
        "language": lang if lang in LANGS else None,
        "handoff": handoff,
        "handoff_reason": _null(data.get("handoff_reason")) if handoff else None,
        "asan": bool(_bool(data.get("asan"))) and not handoff,  # sırf fakt cavabı: gecə sahibkarı gözləmədən gedir
        "intent": _null(data.get("intent")),
        "lead": {"name": _null(lead.get("name")), "service": _null(lead.get("service")),
                 "preferred_date": _null(lead.get("preferred_date")), "people": _int(lead.get("people")),
                 "cameras": _int(lead.get("cameras")), "editing": _bool(lead.get("editing")),
                 "instagram": _str(lead.get("instagram"), 64), "found_via": _found_via(lead.get("found_via")),
                 "referred_by": _str(lead.get("referred_by"), 120)},
        "stage": _null(data.get("stage")),
        "remind_at": d.isoformat() if (d := _date(data.get("remind_at"))) else None,
        "unanswered_question": _null(data.get("unanswered_question")),
    }


def polish(reply: str) -> str:
    """Qadağan kitab ifadələrini danışıq dilinə çevirir («340 AZN təşkil edir» → «340 AZN-dir»)."""
    for rx, to in POLISH:
        reply = rx.sub(to, reply)
    return reply


def check_filter(reply: str, language: str | None = None) -> str | None:
    """Müştəriyə getməzdən əvvəl: kart nömrəsi ehtimalı, qadağan söz, uzunluq. Pozuntunun səbəbini qaytarır."""
    if re.search(r"\d{12,}", re.sub(r"[\s\-]", "", reply)):
        return "12 və daha çox ardıcıl rəqəm (kart nömrəsi ehtimalı)"
    low = reply.lower()
    words = FORBIDDEN if language == "tr" else FORBIDDEN + FORBIDDEN_NON_TR
    for w in words:
        if w in low:
            return f"qadağan söz «{w.strip()}»"
    if ALEYKUM_RE.search(reply):
        return "«əleykum» salamı (yalnız «Salam» və ya «Hər vaxtınız xeyir» yaz)"
    if len(reply) > MAX_REPLY:
        return f"{MAX_REPLY} simvoldan uzun"
    return None


# --- sorğu ---

def _lead_text(lead: Lead | None) -> str:
    if not lead:
        return "hələ heç nə məlum deyil"
    parts = [("ad", lead.name), ("xidmət", lead.service), ("tarix", lead.preferred_date), ("nəfər", lead.people),
             ("kamera", lead.cameras), ("montaj", None if lead.editing is None else ("bəli" if lead.editing else "xeyr")),
             ("instagram", _note_value(lead, NOTE_FIELDS["instagram"])),
             ("haradan tapıb", _note_value(lead, NOTE_FIELDS["found_via"])),
             ("kim tövsiyə edib", _note_value(lead, NOTE_FIELDS["referred_by"])),
             ("Instagram-da yazdıqları", _note_value(lead, IG_TALK))]
    known = [f"{k}: {v}" for k, v in parts if v not in (None, "")]
    return "; ".join(known + [f"mərhələ: {lead.stage}"]) if known else "hələ heç nə məlum deyil"


def now_text(dt: datetime) -> str:
    b = aware(dt).astimezone(BAKU)
    return f"{WD[b.weekday()]}, {b:%d.%m.%Y}, saat {b:%H:%M} (Bakı vaxtı)"


def build_system(db: DB, now_dt: datetime, *, first_message: bool, lead: Lead | None = None,
                 slots_text: str | None = None, customer: str = "") -> str:
    faqs = db.scalars(select(Faq).where(Faq.active.is_(True)).order_by(Faq.id)).all()
    if slots_text is None:
        slots_text = slots.free_text(db, now_dt) or "Növbəti 7 gündə boş vaxt yoxdur."
    return bot_prompt.render(
        prices=ai._price_lines(),
        faqs="\n".join(f"S: {f.question}\nC: {f.answer}" for f in faqs) or "(hələ yoxdur)",
        free_slots=slots_text, now=now_text(now_dt), first_message="bəli" if first_message else "xeyr",
        lead=_lead_text(lead), customer=customer)


def contents_from(history: list[tuple[str, str]]) -> list[dict]:
    """[(user|model, mətn)] → Gemini contents: ardıcıl eyni rolu birləşdirir, ilk mesaj həmişə user olur."""
    out: list[dict] = []
    for role, text in history:
        if not text.strip():
            continue
        if out and out[-1]["role"] == role:
            out[-1]["parts"][0]["text"] += "\n\n" + text
        elif out or role == "user":
            out.append({"role": role, "parts": [{"text": text}]})
    return out


def converse(system: str, contents: list[dict]) -> tuple[dict, tuple[int, int], str | None]:
    """Gemini-yə sual verir. Cavab oxunmursa və ya filtrə düşürsə bir dəfə yenidən soruşur.
    Qaytarır: (nəticə, (tokens_in, tokens_out), filtr_səbəbi). Səbəb None deyilsə cavab göndərilməməlidir.
    AiError qalxa bilər (Gemini xətası və ya iki dəfə oxunmayan cavab)."""
    used = [0, 0]
    note = ""
    res, problem = None, None
    for _ in range(2):
        # JSON rejimi: tarixçədəki adi mətnli cavablar modeli JSON-suz yazmağa çəkirdi (IG, 13.11)
        out = ai.generate(system + note, contents, max_tokens=1200, json_mode=True)
        used[0] += out["usage"][0]
        used[1] += out["usage"][1]
        try:
            res = parse_reply(ai.text_of(out["content"]))
            res["reply"] = polish(res["reply"])
        except BotFormatError as e:
            res, problem = None, f"cavab JSON deyil ({e})"
        else:
            problem = check_filter(res["reply"], res.get("language"))
            if not problem:
                break
        note = (f"\n\nƏVVƏLKİ CAVAB QƏBUL EDİLMƏDİ: {problem}. Eyni qaydalarla yenidən yaz: yalnız JSON, reply ən çoxu "
                f"{MAX_REPLY} simvol, kart və ya uzun rəqəm yoxdur, qadağan sözlər yoxdur.")
    if res is None:
        raise AiError("AI cavabı oxuna bilmədi")
    return res, (used[0], used[1]), problem


def parse_now(v: str | None) -> datetime:
    """`2026-11-12 23:30` (Bakı vaxtı) və ya qurşaqlı ISO; boşdursa indiki an."""
    if not v:
        return now()
    d = datetime.fromisoformat(v.strip().replace(" ", "T"))
    return d if d.tzinfo else d.replace(tzinfo=BAKU)


def simulate(db: DB, history: list[tuple[str, str]], message: str, *, now_dt: datetime | None = None,
             slots_list: list[str] | None = None, first_message: bool = False) -> dict:
    """Saxta söhbətdə bot: heç nə saxlamır və göndərmir. history: [(user|bot, mətn)]. AiError qalxa bilər."""
    now_dt = now_dt or now()
    system = build_system(db, now_dt, first_message=first_message,
                          slots_text=None if slots_list is None else ("\n".join(slots_list) or "Boş vaxt yoxdur."))
    turns = [("user" if r == "user" else "model", t) for r, t in history] + [("user", message)]
    res, _, problem = converse(system, contents_from(turns))
    if problem:
        res = {**res, "handoff": True, "handoff_reason": "filtr"}
    return {**res, "filtered": problem}


# --- lead ---

def _event(db: DB, lead: Lead, kind: str, data: dict) -> None:
    db.add(LeadEvent(lead_id=lead.id, kind=kind, data=data))


def _note_value(lead: Lead | None, label: str) -> str | None:
    m = re.search(rf"^{re.escape(label)}: (.+)$", (lead.notes if lead else "") or "", re.M)
    return m.group(1).strip() if m else None


def _set_note(lead: Lead, label: str, value: str) -> None:
    line = f"{label}: {value}"
    notes = lead.notes or ""
    if _note_value(lead, label) is not None:
        lead.notes = re.sub(rf"^{re.escape(label)}: .+$", lambda _: line, notes, count=1, flags=re.M)
    else:
        lead.notes = (notes.rstrip() + "\n" if notes.strip() else "") + line


def instagram_lead(db: DB, contact_id: int) -> Lead | None:
    """Kontaktın son 30 gündə Instagram-dan gələn, hələ bağlanmamış lead-i."""
    return db.scalar(select(Lead).where(Lead.contact_id == contact_id, Lead.source == "instagram",
                                        Lead.stage.not_in(("geldi", "itirildi")),
                                        Lead.created_at >= now() - timedelta(days=30))
                     .order_by(Lead.id.desc()).limit(1))


def apply_result(db: DB, conv: WaConversation, contact: WaContact, res: dict) -> Lead:
    """Lead yoxdursa yaradır; boş olmayan sahələri yeniləyir; mərhələ yalnız irəli (ən çoxu `beh`)."""
    lead = db.get(Lead, conv.lead_id) if conv.lead_id else None
    if not lead and (lead := instagram_lead(db, contact.id)):  # Instagram-da nömrəsini verib, indi WhatsApp-a yazır
        conv.lead_id = lead.id
        _event(db, lead, "linked", {"conversation_id": conv.id})
    if not lead:
        lead = Lead(contact_id=contact.id, name=contact.name or "", phone=contact.phone or "", source="whatsapp")
        db.add(lead)
        db.flush()
        conv.lead_id = lead.id
        _event(db, lead, "created", {"source": "whatsapp"})
    new = {k: v for k, v in res["lead"].items() if v not in (None, "")}
    for k, label in NOTE_FIELDS.items():
        v = new.pop(k, None)
        if v and _note_value(lead, label) != v:
            _event(db, lead, "update", {k: [_note_value(lead, label), v]})
            _set_note(lead, label, v)
    if new.get("service") not in (None, *SERVICES):
        del new["service"]
    if "preferred_date" in new:
        new["preferred_date"] = str(new["preferred_date"])[:64]
    if "name" in new:
        new["name"] = str(new["name"])[:120]
    changed = {}
    for k, v in new.items():
        if getattr(lead, k) != v:
            changed[k] = [getattr(lead, k), v]
            setattr(lead, k, v)
    if changed:
        _event(db, lead, "update", changed)
    stage = res.get("stage")
    if stage in STAGES and lead.stage in STAGES:
        if STAGES.index(lead.stage) < STAGES.index(stage) <= STAGES.index(BOT_MAX_STAGE):
            _event(db, lead, "stage", {"from": lead.stage, "to": stage})
            lead.stage = stage
    day = _date(res.get("remind_at"))
    today = aware(now()).astimezone(BAKU).date()
    if day and lead.stage not in ("geldi", "itirildi") and today <= day <= today + timedelta(days=REMIND_MAX_DAYS):
        at = datetime(day.year, day.month, day.day, REMIND_HOUR, tzinfo=BAKU).astimezone(timezone.utc)  # bazaya UTC
        if not lead.remind_at or aware(lead.remind_at) != at:
            _event(db, lead, "remind", {"at": at.isoformat()})
            lead.remind_at = at
    return lead


# --- əsas giriş ---

_locks: dict[int, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(cid: int) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(cid, threading.Lock())


GREETING_RE = re.compile(r"^[\W\d_]*(salam|slm|salam\s+[əae]l[eə]yk[uü]m|hi|hello|hey|привет|здравствуйте|"
                         r"merhaba|selam|sabahınız xeyir|axşamınız xeyir|günaydın|xoş gördük)[\W\d_]*$", re.I)
GREETING_WAIT = 12  # saniyə: yalnız «Salam» yazılıbsa əsl mesajı gözləyirik (çox vaxt dərhal ardınca gəlir)


def _greeting_wait(conversation_id: int) -> None:
    """Son müştəri mesajı təkcə salamdırsa və təzədirsə, bir az gözlə: ardınca gələn mesajla birlikdə bir cavab yazılsın."""
    if GREETING_WAIT <= 0:
        return
    with SessionLocal() as db:
        last = chat.last_message(db, conversation_id)
        if not last or last.source != "customer" or not GREETING_RE.match((last.text or "").strip()):
            return
        left = GREETING_WAIT - (now() - aware(last.created_at)).total_seconds()
    if left > 0:
        time.sleep(min(left, GREETING_WAIT))


def handle(conversation_id: int, *, avoid: str | None = None, instruction: str | None = None) -> str:
    """Söhbət üçün bir cavab dövrü. Nəticə kodunu qaytarır (testlər və log üçün); heç vaxt xəta atmır.
    `avoid`: sahibkarın bəyənmədiyi qaralama — bot başqa cür yazır və nəticə həmişə qaralama olur."""
    if not avoid:
        _greeting_wait(conversation_id)
    with _lock_for(conversation_id):  # eyni söhbətdə paralel iki işləmə olmasın
        try:
            with SessionLocal() as db:
                outcome = _handle(db, conversation_id, avoid=avoid, instruction=instruction)
                log.info("bot söhbət %s%s: %s", conversation_id, " (yenidən)" if avoid else "", outcome)
                return outcome
        except Exception as e:
            log.exception("bot xətası (söhbət %s)", conversation_id)
            alerts.notify("bot-crash", f"bot xətası (söhbət {conversation_id}): {type(e).__name__}: {str(e)[:200]}")
            return "error"


def regenerate(draft_id: int, instruction: str | None = None) -> str:
    """Telegram «🔄 Yenidən yaz» və ya qaralamaya cavabla göstəriş: rədd edilmiş qaralamanın söhbətinə yeni qaralama."""
    with SessionLocal() as db:
        old = db.get(BotDraft, draft_id)
        if not old:
            return "skip:no_draft"
        conv_id, text = old.conversation_id, old.text
    outcome = handle(conv_id, avoid=text, instruction=instruction)
    if outcome.startswith("skip:"):  # sahibkar «Yenidən yazılır…» görüb, səbəbsiz susmasın
        alerts.notify(f"regen:{draft_id}", topic="action", text=f"Yenidən yazılmadı ({outcome}). {chat.panel_link(conv_id)}")
    return outcome


def skip_reason(db: DB, conv: WaConversation, contact: WaContact) -> str | None:
    if not conf.bot_enabled(db):
        return "bot_disabled"
    if contact.excluded:
        return "excluded"
    if conv.mode == "human":
        return "human"
    if contact.bot_muted_until and aware(contact.bot_muted_until) > now():
        return "muted"
    last = chat.last_message(db, conv.id)
    if not last or last.source != "customer":
        return "last_not_customer"
    if not chat.window_open(conv):
        return "window_closed"
    return None


def _history(db: DB, conv: WaConversation) -> list[tuple[str, str]]:
    """Kontaktın son köhnə (history) mesajları, sonra bu söhbətin son mesajları; xronoloji."""
    old = db.scalars(select(WaMessage).join(WaConversation, WaConversation.id == WaMessage.conversation_id)
                     .where(WaConversation.contact_id == conv.contact_id, WaMessage.source == "history")
                     .order_by(WaMessage.created_at.desc(), WaMessage.id.desc()).limit(OLD_HISTORY)).all()
    rows = db.scalars(select(WaMessage).where(WaMessage.conversation_id == conv.id, WaMessage.source != "history")
                      .order_by(WaMessage.created_at.desc(), WaMessage.id.desc()).limit(HISTORY)).all()
    return ([("user" if m.direction == "in" else "model", m.text) for m in reversed(old)]
            + [("user" if m.source == "customer" else "model", m.text) for m in reversed(rows)])


ROUTE_HEAD = {"foreign": "🌍 Xarici nömrə", "personal": "👤 Şəxsi kontakt (Y Pod deyil)"}


def route_away(db: DB, conv: WaConversation, contact: WaContact) -> str | None:
    """Xarici və ya şəxsi nömrə: söhbət bir dəfəlik sahibkara keçir (qiymət fərqli deyilir), Telegram-a xəbər gedir.
    Qaytarır: foreign | personal | None (bot normal işləyir)."""
    if conv.route:  # artıq ötürülüb; sahibkar `bot`-a qaytarıbsa, onun qərarıdır
        return None
    kind = contacts.route(contact, contacts.lookup(db, contact.phone))
    if not kind:
        return None
    conv.mode, conv.route = "human", kind
    db.commit()
    last_in = chat.last_message(db, conv.id, "customer")
    text = (f"{ROUTE_HEAD[kind]}: {contact.name or '-'}, +{contacts.normalize(contact.phone)}, "
            f"söhbət sizdədir. Mesaj: «{(last_in.text if last_in else '')[:200]}»\n{chat.panel_link(conv.id)}")
    if kind == "personal":  # səhv işarələnibsə, bir toxunuşla müştəri kimi bota qaytarmaq olsun (crm/friends.py)
        tg._call("sendMessage", {**tgtopics.dest("action"), "text": text, "disable_web_page_preview": True,
                                 "reply_markup": {"inline_keyboard": [[tg.customer_button(contact.id)]]}})
    else:
        alerts.notify(f"route:{conv.id}", topic="action", text=text)
    return kind


def _handle(db: DB, conversation_id: int, *, avoid: str | None = None, instruction: str | None = None) -> str:
    conv = db.get(WaConversation, conversation_id)
    if not conv:
        return "skip:no_conversation"
    contact = db.get(WaContact, conv.contact_id)
    why = skip_reason(db, conv, contact)
    if why:
        return f"skip:{why}"
    routed = route_away(db, conv, contact)
    if routed:
        return f"route:{routed}"
    if chat.reject_pending(db, conv.id, "yeni mesaj gəldi"):
        db.commit()
    voice.fill_missing(db, conv.id)  # səsli mesaj mətnə çevrilir, şəkil təsvir olunur (Gemini)
    last_file = chat.last_message(db, conv.id, "customer")
    if not avoid and last_file and (last_file.text or "").startswith(FILE_LABELS):
        return _file_handoff(db, conv, contact, last_file)
    first =chat.last_message(db, conv.id, "bot") is None
    lead = db.get(Lead, conv.lead_id) if conv.lead_id else None
    system = build_system(db, now(), first_message=first, lead=lead, customer=customer_card.build(db, contact))
    if avoid:
        system += (f"\n\nSAHİBKAR ƏVVƏLKİ QARALAMANI BƏYƏNMƏDİ: «{avoid[:1500]}». Müştərinin son mesajına başqa cür "
                   "cavab yaz: fərqli başlanğıc, fərqli yanaşma və ifadələr. Faktlar və qaydalar eyni qalır.")
        if instruction:
            system += (f"\nSAHİBKARIN GÖSTƏRİŞİ: «{instruction[:500]}». Yeni cavabda buna əməl et; faktlar, qiymətlər "
                       "və yuxarıdakı qaydalar yenə keçərlidir.")
    try:
        with typing_state.generating(f"wa:{conv.id}"):
            res, usage, problem = converse(system, contents_from(_history(db, conv)))
    except AiError as e:
        conv.mode = "human"
        db.commit()
        alerts.notify("bot-ai-down", topic="action", text=f"AI cavab vermir, söhbət sizə keçdi. {contact.name} {contact.phone or ''}: "
                                     f"{e}\n{chat.panel_link(conv.id)}")
        return "ai_error"
    ai.count_usage(db, "bot", *usage)
    last_in = chat.last_message(db, conv.id, "customer")
    res = {**res, "customer_short": customer_card.short(db, contact)}  # Telegram qaralama başlığı üçün (model_output)
    if problem:  # iki dəfə filtrə düşdü: cavab getmir, söhbət insana keçir
        res = {**res, "handoff": True, "handoff_reason": "filtr", "reply": ""}
    silent = res["handoff"] and res["handoff_reason"] in SILENT_REASONS
    partner = res["handoff"] and res["handoff_reason"] in PARTNER_REASONS
    if silent:  # iş yazışması: müştəriyə heç nə getmir, satış lead-i də yaranmır
        res = {**res, "reply": ""}
    elif not partner:  # əməkdaşlıq təklifi satış deyil: lead yaranmır, yalnız qısa təşəkkür gedir
        apply_result(db, conv, contact, res)
    if not avoid:  # «Yenidən yaz»da eyni sual ikinci dəfə yazılmasın
        note_gap(db, conv.id, res, last_in.text if last_in else "")
    outcome = "draft"
    if res["reply"]:
        outcome = deliver(db, conv, res["reply"], res, reason=f"handoff:{res['handoff_reason']}" if res["handoff"] else None,
                          draft_only=bool(avoid))
    if res["handoff"]:
        # Avtomatik rejimdə söhbət sahibkarın cavabını gözləyir (asan suala bot yenə cavab verir, crm/turns.py).
        # Qaralama rejimində sahibkar hər cavabı onsuz da təsdiqləyir, ona görə yalnız xəbərdarlıq gedir.
        auto = auto_reply(db, conv, contact)
        if auto and (silent or partner):  # satış söhbəti deyil: bot bu söhbətə daha yazmır
            conv.mode = "human"
        elif auto:
            turns.to_wait(db, conv, now())
        outcome = f"handoff:{res['handoff_reason']}"
        if auto:  # rejim dəyişdi: söhbətdə sistem sətri (02 #17)
            events.handoff(db, events.WA, conv.id, res["handoff_reason"])
        why = URGENT_REASONS.get(res["handoff_reason"] or "")
        urgent = f"🔴 TƏCİLİ: {why}, zəng edin: {contact.phone or '-'}\n" if why else ""
        if res["handoff_reason"] in SILENT_REASONS:
            urgent = "🧾 İş yazışması (montaj, layihə və ya komanda), bot cavab yazmadı, özünüz cavab verin\n"
        elif partner:
            urgent = "🤝 Əməkdaşlıq və ya iş təklifi (müştəri deyil), bot qısa təşəkkür yazdı\n"
        alerts.notify(f"handoff:{conv.id}:{last_in.id if last_in else 0}", topic="action",
                      text=f"{urgent}{'söhbət sizə keçdi' if auto and (silent or partner) else 'bot komandaya ötürdü, sizin cavabınızı gözləyir (asan suallara özü cavab verir)' if auto else 'əməkdaş lazımdır (bot qaralama yazmağa davam edir)'}\n"
                      f"Ad: {contact.name or '-'}, telefon: {contact.phone or '-'}\n"
                      f"Səbəb: {res['handoff_reason'] or '-'}\nMüştəri: {(last_in.text if last_in else '')[:500]}\n"
                      f"Botun cavabı: {res['reply'][:500] or '(göndərilmədi: ' + (problem or '') + ')'}\n"
                      f"{chat.panel_link(conv.id)}")
    db.commit()
    return outcome


def _file_handoff(db: DB, conv: WaConversation, contact: WaContact, last_in: WaMessage) -> str:
    """Video/sənəd: yeni müştəriyə (avtomatik rejim) sabit cavab gedir və söhbət sahibkara keçir; köhnə kontakta
    (qaralama rejimi) heç nə yazılmır. Hər halda 🔴 mövzusuna xəbər gedir."""
    sent = ""
    if auto_reply(db, conv, contact):
        try:
            chat.send_bot_reply(db, conv, FILE_REPLY)
            tg.auto_log(db, conv, FILE_REPLY)
            sent = FILE_REPLY
        except kapso.KapsoError as e:
            log.warning("fayl cavabı getmədi (söhbət %s): %s", conv.id, e.message)
        turns.to_wait(db, conv, now())
        events.handoff(db, events.WA, conv.id, "fayl")
    db.commit()
    alerts.notify(f"handoff:{conv.id}:{last_in.id}", topic="action",
                  text=f"📎 Fayl göndərildi, {'bot qısa cavab verdi, sizin cavabınızı gözləyir' if sent else 'bot cavab yazmadı'}\n"
                  f"Ad: {contact.name or '-'}, telefon: {contact.phone or '-'}\nMesaj: {(last_in.text or '')[:500]}\n"
                  f"{chat.panel_link(conv.id)}")
    return "handoff:fayl"


GAP_REASONS = ("diger", "bilinmir", "filtr")


def note_gap(db: DB, conv_id: int | None, res: dict, customer_text: str, prefix: str = "") -> None:
    """Botun bilmədiyi sual (gündəlik hesabat və həftəlik prompt/FAQ baxışı üçün): model özü yazıbsa onun mətni,
    yoxsa handoff «diger/bilinmir» və ya boş cavabda (filtr) müştərinin mesajı «[səbəb]» ilə."""
    q = res.get("unanswered_question")
    if not q:
        reason = res.get("handoff_reason") if res.get("handoff") else None
        if reason not in GAP_REASONS or not (customer_text or "").strip():
            return
        q = f"[{'boş cavab' if reason == 'filtr' else 'handoff:' + reason}] {customer_text.strip()}"
    db.add(UnansweredQuestion(conversation_id=conv_id, question=(prefix + str(q))[:1000]))


def is_new_customer(db: DB, conv: WaConversation, contact: WaContact) -> bool:
    """İlk dəfə yazan: telefon kitabçasında yoxdur, bağlanmış çəkilişi yoxdur, köhnə (history) və ya başqa söhbətdə
    yazışması yoxdur. Qərar kontakt üçün yadda saxlanır (`wa_new:<id>`): bot ilə başlayan yeni müştəri sonrakı
    söhbətlərdə də yeni sayılır; bağlanmış çəkilişdən sonra isə köhnə müştəridir."""
    known, shoots, last_history = customer_card._facts(db, contact)
    if known or shoots or last_history:
        return False
    key = f"wa_new:{contact.id}"
    cached = conf.get(db, key)
    if cached is not None:
        return cached == "1"
    earlier = db.scalar(select(WaMessage.id).join(WaConversation, WaConversation.id == WaMessage.conversation_id)
                        .where(WaConversation.contact_id == contact.id, WaMessage.conversation_id != conv.id).limit(1))
    conf.put(db, key, "0" if earlier else "1")
    return not earlier


def auto_reply(db: DB, conv: WaConversation, contact: WaContact | None = None) -> bool:
    """Bot cavabı təsdiqsiz gedirmi: `auto` — hamıya, `new_auto` — yalnız ilk dəfə yazana, `draft` — heç kimə."""
    mode = conf.bot_mode(db)
    if mode == "new_auto":
        return is_new_customer(db, conv, contact or db.get(WaContact, conv.contact_id))
    return mode == "auto"


def deliver(db: DB, conv: WaConversation, text: str, res: dict, *, reason: str | None,
            draft_only: bool = False) -> str:
    """`auto`: dərhal göndərir; `draft` (susmaya görə): qaralama + Telegram düyməsi. Qaytarır: sent | draft.
    `draft_only`: yenidən yazılan cavab avtomatik rejimdə də yalnız qaralama olur."""
    auto_at = None
    send_now = auto_reply(db, conv) and not draft_only
    if send_now:
        send_now, auto_at = turns.plan(conv, res, now())  # sahibkar yazıbsa və ya gözləyirsə: qaralama (crm/turns.py)
    if send_now:
        try:
            chat.send_bot_reply(db, conv, text)
            tg.auto_log(db, conv, text)
            return "sent"
        except kapso.KapsoError as e:
            alerts.notify(f"bot-send:{conv.id}", topic="action", text=f"avtomatik göndəriş alınmadı (qaralama yaradıldı): {e.message}")
            reason = f"göndərilmədi: {e.message}"[:200]
            text = getattr(e, "remaining", text)  # birinci hissə gedibsə, qaralamada yalnız qalan
    draft = BotDraft(conversation_id=conv.id, text=text, reason=reason, model_output=res, auto_at=auto_at)
    db.add(draft)
    db.commit()
    tg.send_draft(db, draft)
    db.commit()
    return "draft"
