"""CRM admin API: WhatsApp gələn qutusu, qaralamalar, leadlər, FAQ, tez cavablar, bot ayarları (Faza 2)."""
from datetime import datetime, timezone
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException
from pydantic import AwareDatetime, BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as DB

import ai
import booking
from auth import current_admin, new_card_code
from crm import bot, chat, conf, kapso, turns
from db import aware, get_db, now
from models import (BotDraft, Client, Faq, Lead, LeadEvent, QuickReply, UnansweredQuestion, WaContact, WaConversation,
                    Shoot, WaMessage)
from views import iso, utc

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])

Stage = Literal["yeni", "maraqlanir", "tarix", "beh", "tesdiq", "geldi", "itirildi"]
LostReason = Literal["qiymet", "vaxt", "cavab_yox", "basqa_yer", "diger"]


def get_or_404(db: DB, model, id_: int, what: str):
    row = db.get(model, id_)
    if not row:
        raise HTTPException(404, f"{what} tapılmadı")
    return row


def msg_out(m: WaMessage) -> dict:
    return {"id": m.id, "direction": m.direction, "source": m.source, "type": m.type, "text": m.text,
            "media_url": m.media_url, "status": m.status, "created_at": iso(m.created_at),
            "error": ((m.raw or {}).get("error") if isinstance(m.raw, dict) else None) if m.status == "failed" else None}


def draft_out(d: BotDraft) -> dict:
    return {"id": d.id, "conversation_id": d.conversation_id, "text": d.text, "status": d.status, "reason": d.reason,
            "model_output": d.model_output, "created_at": iso(d.created_at), "decided_at": iso(d.decided_at),
            "auto_at": iso(d.auto_at)}


def lead_out(db: DB, lead: Lead) -> dict:
    conv_id = db.scalar(select(WaConversation.id).where(WaConversation.lead_id == lead.id).limit(1))
    return {"id": lead.id, "contact_id": lead.contact_id, "conversation_id": conv_id, "name": lead.name,
            "phone": lead.phone, "service": lead.service, "preferred_date": lead.preferred_date, "people": lead.people,
            "cameras": lead.cameras, "editing": lead.editing, "source": lead.source, "stage": lead.stage,
            "notes": lead.notes, "shoot_id": lead.shoot_id, "lost_reason": lead.lost_reason,
            "lost_text": lead.lost_text, "remind_at": iso(lead.remind_at), "remind_note": lead.remind_note,
            "created_at": iso(lead.created_at), "updated_at": iso(lead.updated_at)}


def send_error(e: kapso.KapsoError):
    if e.code == kapso.WINDOW_CLOSED:
        raise HTTPException(409, kapso.window_closed_text())
    raise HTTPException(502, e.message)


# --- gələn qutusu ---

@router.get("/inbox/badge")
def inbox_badge(db: DB = Depends(get_db)):
    """Menyu nişanı üçün yüngül say: gözləyən qaralaması olan söhbətlər."""
    n = db.scalar(select(func.count(func.distinct(BotDraft.conversation_id))).where(BotDraft.status == "pending"))
    return {"pending": n or 0}


@router.get("/inbox")
def inbox(mode: Literal["bot", "human"] | None = None, q: str | None = None, db: DB = Depends(get_db)):
    stmt = select(WaConversation, WaContact).join(WaContact, WaContact.id == WaConversation.contact_id)
    if mode:
        stmt = stmt.where(WaConversation.mode == mode)
    if q and q.strip():
        like = f"%{q.strip()}%"
        stmt = stmt.where(or_(WaContact.name.ilike(like), WaContact.phone.ilike(like)))
    rows = db.execute(stmt.order_by(WaConversation.last_message_at.desc().nulls_last(),
                                    WaConversation.id.desc()).limit(200)).all()
    out = []
    for c, ct in rows:
        last = chat.last_message(db, c.id)
        lead = db.get(Lead, c.lead_id) if c.lead_id else None
        auto_at = db.scalar(select(func.min(BotDraft.auto_at)).where(
            BotDraft.conversation_id == c.id, BotDraft.status == "pending")) if c.mode == "owner" else None
        out.append({"id": c.id, "contact": {"id": ct.id, "name": ct.name, "phone": ct.phone, "excluded": ct.excluded},
                    "last_message": msg_out(last) if last else None, "unread": c.unread, "mode": c.mode,
                    "pending_drafts": db.scalar(select(func.count()).select_from(BotDraft).where(
                        BotDraft.conversation_id == c.id, BotDraft.status == "pending")),
                    "lead_stage": lead.stage if lead else None, "last_message_at": iso(c.last_message_at),
                    "window_expires_at": iso(c.window_expires_at), "draft_auto_at": iso(auto_at),
                    "wait_since": (conf.get(db, f"wait_since:{c.id}") or None) if c.mode == "wait" else None,
                    "park": _park(db, c.id)})
    return out


PARK_TO = ("theirs", "archive")


def _park(db: DB, conv_id: int) -> dict | None:
    """Sahibkar söhbəti kənara qoyub: «theirs» (müştəri cavabını gözləyir) və ya «archive» (söhbət bitib).
    Siyahı müştərinin sonrakı mesajı ilə müqayisə edir: müştəri yenə yazanda söhbət öz bölməsinə qayıdır."""
    to, _, at = (conf.get(db, f"park:{conv_id}") or "").partition("|")
    return {"to": to, "at": at} if to in PARK_TO and at else None


def _client_card(db: DB, ct: WaContact, lead: Lead | None) -> dict | None:
    """İnsan paneli: kontaktın müştəri kartı (telefonun son 9 rəqəmi ilə), keşbeki və son çəkilişləri."""
    tail = _tail((lead.phone if lead else "") or ct.phone)
    if len(tail) < 7:
        return None
    cl = next((c for c in db.scalars(select(Client).where(Client.phone != "")) if _tail(c.phone) == tail), None)
    if not cl:
        return None
    shoots = db.scalars(select(Shoot).where(Shoot.client_id == cl.id).order_by(Shoot.starts_at.desc()).limit(5)).all()
    done = db.scalar(select(func.count()).select_from(Shoot).where(Shoot.client_id == cl.id, Shoot.status == "completed"))
    return {"id": cl.id, "full_name": cl.full_name, "cashback": booking.cashback_balance(db, cl.id), "shoots_done": done or 0,
            "shoots": [{"id": s.id, "starts_at": iso(s.starts_at), "status": s.status, "tag": s.tag, "kind": s.kind,
                        "total": s.total} for s in shoots]}


@router.get("/inbox/{conv_id}")
def inbox_open(conv_id: int, db: DB = Depends(get_db)):
    c = get_or_404(db, WaConversation, conv_id, "Söhbət")
    ct = db.get(WaContact, c.contact_id)
    c.unread = 0
    db.commit()
    msgs = db.scalars(select(WaMessage).where(WaMessage.conversation_id == c.id)
                      .order_by(WaMessage.created_at, WaMessage.id)).all()
    drafts = db.scalars(select(BotDraft).where(BotDraft.conversation_id == c.id).order_by(BotDraft.id)).all()
    lead = db.get(Lead, c.lead_id) if c.lead_id else None
    return {"id": c.id, "mode": c.mode, "unread": c.unread,
            "contact": {"id": ct.id, "name": ct.name, "phone": ct.phone, "excluded": ct.excluded,
                        "bot_muted_until": iso(ct.bot_muted_until)},
            "messages": [msg_out(m) for m in msgs], "drafts": [draft_out(d) for d in drafts],
            "lead": lead_out(db, lead) if lead else None, "window_expires_at": iso(c.window_expires_at),
            "window_open": chat.window_open(c), "client": _client_card(db, ct, lead),
            "wait_since": (conf.get(db, f"wait_since:{c.id}") or None) if c.mode == "wait" else None,
            "park": _park(db, c.id),
            "events": [{"kind": e.kind, "data": e.data, "at": iso(e.created_at)} for e in db.scalars(
                select(LeadEvent).where(LeadEvent.lead_id == lead.id).order_by(LeadEvent.id.desc()).limit(20))]
            if lead else []}


class SendIn(BaseModel):
    text: str = Field(min_length=1, max_length=4000)


@router.post("/inbox/{conv_id}/send")
def inbox_send(conv_id: int, body: SendIn, db: DB = Depends(get_db)):
    c = get_or_404(db, WaConversation, conv_id, "Söhbət")
    if not chat.window_open(c):
        raise HTTPException(409, kapso.window_closed_text())
    try:
        m = chat.send_out(db, c, body.text.strip(), "panel")
        turns.owner_wrote(db, c)
    except kapso.KapsoError as e:
        db.rollback()
        send_error(e)
    db.commit()
    return msg_out(m)


class ModeIn(BaseModel):
    mode: Literal["bot", "owner", "wait", "human"]


@router.post("/inbox/{conv_id}/mode")
def inbox_mode(conv_id: int, body: ModeIn, db: DB = Depends(get_db)):
    """Rejim menyusu (03 E2, T8): 4 rejimin hamısı əl ilə seçilir; müştəriyə mesaj getmir, qaralamalar qalır."""
    c = get_or_404(db, WaConversation, conv_id, "Söhbət")
    if body.mode == "wait":
        c.mode = "bot"  # to_wait «human»-dan keçmir; əl ilə seçimdə keçsin
        turns.to_wait(db, c, now())
    else:
        c.mode = body.mode
        turns._clear_wait(db, c.id)
    db.commit()
    return {"id": c.id, "mode": c.mode}


class ParkIn(BaseModel):
    to: Literal["theirs", "archive"] | None = None


@router.post("/inbox/{conv_id}/park")
def inbox_park(conv_id: int, body: ParkIn, db: DB = Depends(get_db)):
    """«Cavab gözləyirəm» (theirs) və «Arxivə at» (archive): söhbət «Sizi gözləyir»dən çıxır, müştəriyə mesaj getmir.
    Gözləyən qaralamalar rədd olunur; «Komandaya ötürülüb» isə «Siz yazdınız» olur (30 dəq xatırlatma dayanır). to=null: geri qaytar."""
    c = get_or_404(db, WaConversation, conv_id, "Söhbət")
    if body.to:
        chat.reject_pending(db, c.id, "sahibkar söhbəti kənara qoydu")
        if c.mode == "wait":
            c.mode = "owner"
            turns._clear_wait(db, c.id)
        conf.put(db, f"park:{c.id}", f"{body.to}|{now().isoformat()}")
    else:
        conf.put(db, f"park:{c.id}", "")
    db.commit()
    return {"id": c.id, "mode": c.mode, "park": _park(db, c.id)}


@router.post("/inbox/{conv_id}/unread")
def inbox_unread(conv_id: int, db: DB = Depends(get_db)):
    """«Oxunmamış et» (⋯ menyusu): söhbət yenə oxunmamış sayılır, müştəriyə mesaj getmir."""
    c = get_or_404(db, WaConversation, conv_id, "Söhbət")
    c.unread = max(c.unread, 1)
    db.commit()
    return {"id": c.id, "unread": c.unread}


# --- qaralamalar ---

class DraftSendIn(BaseModel):
    text: str | None = Field(default=None, min_length=1, max_length=4000)


@router.post("/drafts/{draft_id}/send")
def draft_send(draft_id: int, body: DraftSendIn | None = None, db: DB = Depends(get_db)):
    d = get_or_404(db, BotDraft, draft_id, "Qaralama")
    try:
        chat.decide_draft(db, d, "send", body.text if body else None)
    except chat.AlreadyDecided:
        raise HTTPException(409, "Qaralama artıq həll olunub")
    except kapso.KapsoError as e:
        db.rollback()
        send_error(e)
    db.commit()
    return draft_out(d)


@router.post("/drafts/{draft_id}/reject")
def draft_reject(draft_id: int, db: DB = Depends(get_db)):
    d = get_or_404(db, BotDraft, draft_id, "Qaralama")
    try:
        chat.decide_draft(db, d, "reject")
    except chat.AlreadyDecided:
        raise HTTPException(409, "Qaralama artıq həll olunub")
    db.commit()
    return draft_out(d)


class ExcludeIn(BaseModel):
    excluded: bool


@router.post("/contacts/{contact_id}/exclude")
def contact_exclude(contact_id: int, body: ExcludeIn, db: DB = Depends(get_db)):
    ct = get_or_404(db, WaContact, contact_id, "Kontakt")
    ct.excluded = body.excluded
    db.commit()
    return {"id": ct.id, "excluded": ct.excluded}


# --- leadlər ---

@router.get("/leads")
def leads(stage: Stage | None = None, db: DB = Depends(get_db)):
    q = select(Lead)
    if stage:
        q = q.where(Lead.stage == stage)
    return [lead_out(db, x) for x in db.scalars(q.order_by(Lead.updated_at.desc(), Lead.id.desc()).limit(500))]


class LeadPatch(BaseModel):
    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=32)
    service: Literal["podkast", "reels", "icare", "korporativ", "diger"] | None = None
    preferred_date: str | None = Field(default=None, max_length=64)
    people: int | None = Field(default=None, ge=0, le=100)
    cameras: int | None = Field(default=None, ge=0, le=3)
    editing: bool | None = None
    stage: Stage | None = None
    notes: str | None = Field(default=None, max_length=4000)
    lost_reason: LostReason | None = None
    lost_text: str | None = Field(default=None, max_length=200)
    remind_at: AwareDatetime | None = None  # null: xatırlatmanı sil
    remind_note: str | None = Field(default=None, max_length=200)


@router.patch("/leads/{lead_id}")
def lead_patch(lead_id: int, body: LeadPatch, db: DB = Depends(get_db)):
    lead = get_or_404(db, Lead, lead_id, "Lead")
    data = body.model_dump(exclude_unset=True)
    stage = data.get("stage") or lead.stage
    if stage == "itirildi":  # yalnız sahibkar qoyur və səbəbsiz olmaz
        reason = data["lost_reason"] if "lost_reason" in data else lead.lost_reason
        if not reason:
            raise HTTPException(422, "İtirildi üçün səbəb seçin: qiymət, vaxt, cavab yox, başqa yer və ya digər")
        data["lost_reason"] = reason
        text = data["lost_text"] if "lost_text" in data else lead.lost_text
        data["lost_text"] = (text or "").strip() or None if reason == "diger" else None
    else:  # başqa mərhələ: səbəb silinir
        data["lost_reason"] = data["lost_text"] = None
    if "remind_at" in data and data["remind_at"] is None:
        data["remind_note"] = None  # xatırlatma silinəndə qeyd də gedir
    changed = {}
    for k, v in data.items():
        if v is None and k in ("name", "phone", "notes", "stage"):
            continue  # bu sahələr boş ola bilməz
        if k == "remind_at":
            if v is not None:
                v = v.astimezone(timezone.utc)
            if (lead.remind_at and aware(lead.remind_at)) != v:
                changed[k] = [lead.remind_at and aware(lead.remind_at).isoformat(), v and v.isoformat()]
                setattr(lead, k, v)
        elif getattr(lead, k) != v:
            changed[k] = [getattr(lead, k), v]
            setattr(lead, k, v)
    if "stage" in changed:
        ev = {"from": changed["stage"][0], "to": changed["stage"][1], "by": "admin"}
        if lead.stage == "itirildi":
            ev.update(lost_reason=lead.lost_reason, lost_text=lead.lost_text)
        db.add(LeadEvent(lead_id=lead.id, kind="stage", data=ev))
    if changed:
        db.add(LeadEvent(lead_id=lead.id, kind="admin_edit", data=changed))
    db.commit()
    return lead_out(db, lead)


class ConfirmIn(BaseModel):
    starts_at: AwareDatetime
    duration_min: int = Field(ge=15, le=720)
    cameras: int = Field(ge=0, le=3)
    editing: bool
    location: Literal["studio", "onsite"]
    kind: Literal["shoot", "reels_pack", "studio_rent", "single_reel"]


def _tail(phone: str | None) -> str:
    return chat.digits(phone)[-9:]


def client_for_lead(db: DB, lead: Lead, contact: WaContact) -> Client | None:
    tail = _tail(lead.phone or contact.phone)
    if len(tail) < 7:
        return None
    return next((c for c in db.scalars(select(Client).where(Client.phone != "")) if _tail(c.phone) == tail), None)


@router.post("/leads/{lead_id}/confirm")
def lead_confirm(lead_id: int, body: ConfirmIn, db: DB = Depends(get_db), admin=Depends(current_admin)):
    lead = get_or_404(db, Lead, lead_id, "Lead")
    if lead.shoot_id:
        raise HTTPException(409, "Bu lead üçün çəkiliş artıq yaradılıb")
    starts = utc(body.starts_at)
    prep = 15
    found = booking.conflicts(db, starts_at=starts, duration_min=body.duration_min, prep_min=prep, wrap_min=0)
    if found:
        raise HTTPException(409, {"message": "Bu vaxt məşğuldur", "conflicts": found})
    contact = db.get(WaContact, lead.contact_id)
    client = client_for_lead(db, lead, contact)
    if not client:
        name = (lead.name or contact.name or "").strip()
        client = Client(full_name=name if len(name) >= 2 else "WhatsApp müştərisi",
                        phone=chat.digits(lead.phone or contact.phone), card_code=new_card_code())
        db.add(client)
        db.flush()
    tag = {"reels": "reels", "podkast": "podcast"}.get(lead.service or "", "other")
    try:
        s = booking.create_shoot(db, admin.id, client_id=client.id, starts_at=starts, duration_min=body.duration_min,
                                 kind=body.kind, tag=tag, location=body.location, cameras=body.cameras,
                                 editing=body.editing, prep_min=prep, source_note=f"WhatsApp lead #{lead.id}")
    except booking.Rejected as e:
        db.rollback()
        raise HTTPException(400, str(e))
    old = lead.stage
    lead.shoot_id, lead.stage = s.id, "tesdiq"
    db.add(LeadEvent(lead_id=lead.id, kind="confirmed", data={"shoot_id": s.id, "client_id": client.id, "from": old}))
    db.commit()
    return {**lead_out(db, lead), "shoot_id": s.id, "client_id": client.id}


# --- FAQ və tez cavablar ---

class FaqIn(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    answer: str = Field(min_length=1, max_length=3000)
    active: bool = True


class FaqPatch(BaseModel):
    question: str | None = Field(default=None, min_length=1, max_length=1000)
    answer: str | None = Field(default=None, min_length=1, max_length=3000)
    active: bool | None = None


def faq_out(f: Faq) -> dict:
    return {"id": f.id, "question": f.question, "answer": f.answer, "active": f.active}


@router.get("/faqs")
def faqs(db: DB = Depends(get_db)):
    return [faq_out(f) for f in db.scalars(select(Faq).order_by(Faq.id))]


@router.post("/faqs")
def faq_add(body: FaqIn, db: DB = Depends(get_db)):
    f = Faq(**body.model_dump())
    db.add(f)
    db.commit()
    return faq_out(f)


@router.patch("/faqs/{faq_id}")
def faq_edit(faq_id: int, body: FaqPatch, db: DB = Depends(get_db)):
    f = get_or_404(db, Faq, faq_id, "FAQ")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(f, k, v)
    db.commit()
    return faq_out(f)


@router.delete("/faqs/{faq_id}")
def faq_delete(faq_id: int, db: DB = Depends(get_db)):
    db.delete(get_or_404(db, Faq, faq_id, "FAQ"))
    db.commit()
    return {"ok": True}


class QuickIn(BaseModel):
    title: str = Field(min_length=1, max_length=80)
    text: str = Field(min_length=1, max_length=4000)


class QuickPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=80)
    text: str | None = Field(default=None, min_length=1, max_length=4000)


def quick_out(q: QuickReply) -> dict:
    return {"id": q.id, "title": q.title, "text": q.text}


@router.get("/quick-replies")
def quick_replies(db: DB = Depends(get_db)):
    return [quick_out(q) for q in db.scalars(select(QuickReply).order_by(QuickReply.id))]


@router.post("/quick-replies")
def quick_add(body: QuickIn, db: DB = Depends(get_db)):
    q = QuickReply(**body.model_dump())
    db.add(q)
    db.commit()
    return quick_out(q)


@router.patch("/quick-replies/{qr_id}")
def quick_edit(qr_id: int, body: QuickPatch, db: DB = Depends(get_db)):
    q = get_or_404(db, QuickReply, qr_id, "Tez cavab")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(q, k, v)
    db.commit()
    return quick_out(q)


@router.delete("/quick-replies/{qr_id}")
def quick_delete(qr_id: int, db: DB = Depends(get_db)):
    db.delete(get_or_404(db, QuickReply, qr_id, "Tez cavab"))
    db.commit()
    return {"ok": True}


# --- cavabsız suallar ---

@router.get("/unanswered")
def unanswered(resolved: bool = False, db: DB = Depends(get_db)):
    rows = db.scalars(select(UnansweredQuestion).where(UnansweredQuestion.resolved.is_(resolved))
                      .order_by(UnansweredQuestion.id.desc()).limit(300))
    return [{"id": u.id, "conversation_id": u.conversation_id, "question": u.question, "resolved": u.resolved,
             "created_at": iso(u.created_at)} for u in rows]


class ResolveIn(BaseModel):
    answer: str | None = Field(default=None, min_length=1, max_length=3000)


@router.post("/unanswered/{uq_id}/resolve")
def unanswered_resolve(uq_id: int, body: ResolveIn | None = None, db: DB = Depends(get_db)):
    u = get_or_404(db, UnansweredQuestion, uq_id, "Sual")
    u.resolved = True
    faq = None
    if body and body.answer:
        faq = Faq(question=u.question, answer=body.answer.strip())
        db.add(faq)
    db.commit()
    return {"id": u.id, "resolved": True, "faq": faq_out(faq) if faq else None}


# --- bot ayarları və sınaq ---

def settings_out(db: DB) -> dict:
    return {"bot_enabled": conf.bot_enabled(db), "bot_mode": conf.bot_mode(db),
            "kapso_month_count": kapso.month_count(db), "kapso_month_limit": kapso.MONTH_LIMIT}


@router.get("/bot/settings")
def bot_settings(db: DB = Depends(get_db)):
    return settings_out(db)


class BotSettingsIn(BaseModel):
    bot_enabled: bool | None = None
    bot_mode: Literal["draft", "auto", "new_auto"] | None = None


@router.post("/bot/settings")
def bot_settings_save(body: BotSettingsIn, db: DB = Depends(get_db)):
    if body.bot_enabled is not None:
        conf.put(db, "bot_enabled", "true" if body.bot_enabled else "false")
    if body.bot_mode is not None:
        conf.put(db, "bot_mode", body.bot_mode)
    db.commit()
    return settings_out(db)


class TestTurn(BaseModel):
    role: Literal["user", "bot"]
    text: str = Field(max_length=4000)


class BotTestIn(BaseModel):
    history: list[TestTurn] = Field(default_factory=list, max_length=40)
    message: str = Field(min_length=1, max_length=4000)
    now: str | None = None  # «2026-11-12 23:30» (Bakı vaxtı) və ya qurşaqlı ISO
    slots: list[str] | None = Field(default=None, max_length=30)
    first_message: bool = False


@router.post("/bot/test")
def bot_test(body: BotTestIn, db: DB = Depends(get_db)):
    """Botu saxta söhbətdə işlədir (real Gemini). Heç nə saxlamır və göndərmir."""
    try:
        now_dt = bot.parse_now(body.now)
    except ValueError:
        raise HTTPException(422, "now formatı düzgün deyil")
    try:
        return bot.simulate(db, [(t.role, t.text) for t in body.history], body.message, now_dt=now_dt,
                            slots_list=body.slots, first_message=body.first_message)
    except ai.AiError as e:
        raise HTTPException(502, str(e))
