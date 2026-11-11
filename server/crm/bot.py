"""WhatsApp botu: söhbəti oxuyur, Gemini-dən JSON cavab alır, təhlükəsizlik filtrindən keçirir, lead-i yeniləyir,
qaralama yaradır (susmaya görə) və ya göndərir (`bot_mode = auto`). Rezervi bot heç vaxt təsdiqləmir.
"""
import json
import logging
import re
import threading
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import ai
import alerts
from ai import WD, AiError
from crm import bot_prompt, chat, conf, kapso, slots, tg
from db import SessionLocal, aware, now
from models import BotDraft, Faq, Lead, LeadEvent, UnansweredQuestion, WaContact, WaConversation, WaMessage
from views import BAKU

log = logging.getLogger("bot")

HISTORY = 20
MAX_REPLY = 900
FORBIDDEN = ("icarə", "kirayə", "ən yaxşı")
# Türk sözləri azərbaycanca cavabda qadağandır; müştəri türkcə yazıbsa (language=tr) yoxlanmır.
FORBIDDEN_NON_TR = ("ekip", "kesin", " için")
LANGS = ("az", "ru", "en", "tr")
SERVICES = ("podkast", "reels", "korporativ", "diger")
STAGES = ["yeni", "maraqlanir", "tarix", "beh", "tesdiq", "geldi", "itirildi"]
BOT_MAX_STAGE = "beh"  # bot bundan yuxarı qaldırmır


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
        "intent": _null(data.get("intent")),
        "lead": {"name": _null(lead.get("name")), "service": _null(lead.get("service")),
                 "preferred_date": _null(lead.get("preferred_date")), "people": _int(lead.get("people")),
                 "cameras": _int(lead.get("cameras")), "editing": _bool(lead.get("editing"))},
        "stage": _null(data.get("stage")),
        "unanswered_question": _null(data.get("unanswered_question")),
    }


def check_filter(reply: str, language: str | None = None) -> str | None:
    """Müştəriyə getməzdən əvvəl: kart nömrəsi ehtimalı, qadağan söz, uzunluq. Pozuntunun səbəbini qaytarır."""
    if re.search(r"\d{12,}", re.sub(r"[\s\-]", "", reply)):
        return "12 və daha çox ardıcıl rəqəm (kart nömrəsi ehtimalı)"
    low = reply.lower()
    words = FORBIDDEN if language == "tr" else FORBIDDEN + FORBIDDEN_NON_TR
    for w in words:
        if w in low:
            return f"qadağan söz «{w.strip()}»"
    if len(reply) > MAX_REPLY:
        return f"{MAX_REPLY} simvoldan uzun"
    return None


# --- sorğu ---

def _lead_text(lead: Lead | None) -> str:
    if not lead:
        return "hələ heç nə məlum deyil"
    parts = [("ad", lead.name), ("xidmət", lead.service), ("tarix", lead.preferred_date), ("nəfər", lead.people),
             ("kamera", lead.cameras), ("montaj", None if lead.editing is None else ("bəli" if lead.editing else "xeyr"))]
    known = [f"{k}: {v}" for k, v in parts if v not in (None, "")]
    return "; ".join(known + [f"mərhələ: {lead.stage}"]) if known else "hələ heç nə məlum deyil"


def now_text(dt: datetime) -> str:
    b = aware(dt).astimezone(BAKU)
    return f"{WD[b.weekday()]}, {b:%d.%m.%Y}, saat {b:%H:%M} (Bakı vaxtı)"


def build_system(db: DB, now_dt: datetime, *, first_message: bool, lead: Lead | None = None,
                 slots_text: str | None = None) -> str:
    faqs = db.scalars(select(Faq).where(Faq.active.is_(True)).order_by(Faq.id)).all()
    if slots_text is None:
        slots_text = slots.free_text(db, now_dt) or "Növbəti 7 gündə boş vaxt yoxdur."
    return bot_prompt.render(
        prices=ai._price_lines(),
        faqs="\n".join(f"S: {f.question}\nC: {f.answer}" for f in faqs) or "(hələ yoxdur)",
        free_slots=slots_text, now=now_text(now_dt), first_message="bəli" if first_message else "xeyr",
        lead=_lead_text(lead))


def contents_from(history: list[tuple[str, str]]) -> list[dict]:
    """[(user|model, mətn)] → Gemini contents: ardıcıl eyni rolu birləşdirir, ilk mesaj həmişə user olur."""
    out: list[dict] = []
    for role, text in history:
        if not text.strip():
            continue
        if out and out[-1]["role"] == role:
            out[-1]["parts"][0]["text"] += "\n" + text
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
        out = ai.generate(system + note, contents, max_tokens=1200)
        used[0] += out["usage"][0]
        used[1] += out["usage"][1]
        try:
            res = parse_reply(ai.text_of(out["content"]))
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


def apply_result(db: DB, conv: WaConversation, contact: WaContact, res: dict) -> Lead:
    """Lead yoxdursa yaradır; boş olmayan sahələri yeniləyir; mərhələ yalnız irəli (ən çoxu `beh`)."""
    lead = db.get(Lead, conv.lead_id) if conv.lead_id else None
    if not lead:
        lead = Lead(contact_id=contact.id, name=contact.name or "", phone=contact.phone or "", source="whatsapp")
        db.add(lead)
        db.flush()
        conv.lead_id = lead.id
        _event(db, lead, "created", {"source": "whatsapp"})
    new = {k: v for k, v in res["lead"].items() if v not in (None, "")}
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
    return lead


# --- əsas giriş ---

_locks: dict[int, threading.Lock] = {}
_locks_guard = threading.Lock()


def _lock_for(cid: int) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(cid, threading.Lock())


def handle(conversation_id: int) -> str:
    """Söhbət üçün bir cavab dövrü. Nəticə kodunu qaytarır (testlər və log üçün); heç vaxt xəta atmır."""
    with _lock_for(conversation_id):  # eyni söhbətdə paralel iki işləmə olmasın
        try:
            with SessionLocal() as db:
                return _handle(db, conversation_id)
        except Exception as e:
            log.exception("bot xətası (söhbət %s)", conversation_id)
            alerts.notify("bot-crash", f"bot xətası (söhbət {conversation_id}): {type(e).__name__}: {str(e)[:200]}")
            return "error"


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
    rows = db.scalars(select(WaMessage).where(WaMessage.conversation_id == conv.id, WaMessage.source != "history")
                      .order_by(WaMessage.created_at.desc(), WaMessage.id.desc()).limit(HISTORY)).all()
    return [("user" if m.source == "customer" else "model", m.text) for m in reversed(rows)]


def _handle(db: DB, conversation_id: int) -> str:
    conv = db.get(WaConversation, conversation_id)
    if not conv:
        return "skip:no_conversation"
    contact = db.get(WaContact, conv.contact_id)
    why = skip_reason(db, conv, contact)
    if why:
        return f"skip:{why}"
    if chat.reject_pending(db, conv.id, "yeni mesaj gəldi"):
        db.commit()
    first = chat.last_message(db, conv.id, "bot") is None
    lead = db.get(Lead, conv.lead_id) if conv.lead_id else None
    system = build_system(db, now(), first_message=first, lead=lead)
    try:
        res, usage, problem = converse(system, contents_from(_history(db, conv)))
    except AiError as e:
        conv.mode = "human"
        db.commit()
        alerts.notify("bot-ai-down", f"AI cavab vermir, söhbət sizə keçdi. {contact.name} {contact.phone or ''}: "
                                     f"{e}\n{chat.panel_link(conv.id)}")
        return "ai_error"
    ai.count_usage(db, "bot", *usage)
    last_in = chat.last_message(db, conv.id, "customer")
    if problem:  # iki dəfə filtrə düşdü: cavab getmir, söhbət insana keçir
        res = {**res, "handoff": True, "handoff_reason": "filtr", "reply": ""}
    apply_result(db, conv, contact, res)
    if res["unanswered_question"]:
        db.add(UnansweredQuestion(conversation_id=conv.id, question=str(res["unanswered_question"])[:1000]))
    outcome = "draft"
    if res["reply"]:
        outcome = deliver(db, conv, res["reply"], res, reason=f"handoff:{res['handoff_reason']}" if res["handoff"] else None)
    if res["handoff"]:
        conv.mode = "human"
        outcome = f"handoff:{res['handoff_reason']}"
        alerts.notify(f"handoff:{conv.id}:{last_in.id if last_in else 0}",
                      f"söhbət sizə keçdi\nAd: {contact.name or '-'}, telefon: {contact.phone or '-'}\n"
                      f"Səbəb: {res['handoff_reason'] or '-'}\nMüştəri: {(last_in.text if last_in else '')[:500]}\n"
                      f"Botun cavabı: {res['reply'][:500] or '(göndərilmədi: ' + (problem or '') + ')'}\n"
                      f"{chat.panel_link(conv.id)}")
    db.commit()
    return outcome


def deliver(db: DB, conv: WaConversation, text: str, res: dict, *, reason: str | None) -> str:
    """`auto`: dərhal göndərir; `draft` (susmaya görə): qaralama + Telegram düyməsi. Qaytarır: sent | draft."""
    if conf.bot_mode(db) == "auto":
        try:
            chat.send_out(db, conv, text, "bot")
            return "sent"
        except kapso.KapsoError as e:
            alerts.notify(f"bot-send:{conv.id}", f"avtomatik göndəriş alınmadı (qaralama yaradıldı): {e.message}")
            reason = f"göndərilmədi: {e.message}"[:200]
    draft = BotDraft(conversation_id=conv.id, text=text, reason=reason, model_output=res)
    db.add(draft)
    db.commit()
    tg.send_draft(db, draft)
    db.commit()
    return "draft"
