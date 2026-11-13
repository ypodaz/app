"""Admin Inbox: Instagram DM, Instagram komment və YouTube komment (02-inbox.md, kanal filtri və komment görünüşü).

WhatsApp söhbətləri `admin_crm` `/inbox`-dadır, burada yalnız SocialItem var. Telegram kartları (social_tg) işləməyə
davam edir: app-dan göndərilən və ya rədd edilən qaralamanın kartı düyməsiz yenilənir.
- DM söhbəti thread_id (müştərinin IGSID-i) ilə, komment isə post (media id / YouTube video id) ilə açılır.
- DM tarixçəsi: bazadakı item-lər + Instagram API-dən köhnə yazışma və sahibkarın Instagram app-dan yazdıqları.
"""
import time
from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

from auth import current_admin
from crm import conf, friends, instagram, social_inbox, social_tg
from crm.tg import MAX_REGENERATE
from db import aware, get_db, now
from models import SocialItem
from views import iso

router = APIRouter(prefix="/api/admin/social-inbox", dependencies=[Depends(current_admin)])

LIST_DAYS = 60
NAME_LOOKUPS = 5  # bir siyahı sorğusunda Instagram-dan ən çox neçə ad soruşulur (qalanı növbəti 20 s-də)
HISTORY_TTL = 60  # saniyə: açıq söhbət 10 s-dən bir yenilənir, Instagram API-yə hər dəfə getmirik
_history_cache: dict[str, tuple[float, list]] = {}


def item_out(i: SocialItem) -> dict:
    mo = i.model_output or {}
    return {"id": i.id, "channel": i.channel, "kind": i.kind, "thread_id": i.thread_id, "author": i.author,
            "text": i.text, "draft_text": i.draft_text, "status": i.status, "auto": bool(mo.get("auto")),
            "by_owner": bool(mo.get("by_owner")), "hidden": bool(mo.get("hidden")), "regen": mo.get("regen", 0),
            "lead_id": mo.get("lead_id"),
            "auto_at": iso(i.auto_at), "created_at": iso(i.created_at), "decided_at": iso(i.decided_at)}


def _thread_items(db: DB, channel: str, kind: str, thread: str) -> list[SocialItem]:
    return list(db.scalars(select(SocialItem).where(SocialItem.channel == channel, SocialItem.kind == kind,
                                                    SocialItem.thread_id == thread).order_by(SocialItem.id)))


def _window_open(items: list[SocialItem]) -> bool:
    return bool(items) and now() - aware(items[-1].created_at) <= instagram.WINDOW


def _author(items: list[SocialItem]) -> str:
    return next((i.author for i in reversed(items) if i.author), "")


def _ts(dt: datetime) -> str:
    """Mətn kimi UTC vaxt: DM mesajları bazadan, `extra`-dan və Instagram API-dən gəlir, eyni formatda sıralanır."""
    return aware(dt).astimezone(timezone.utc).isoformat()


def _extras(item: SocialItem) -> list[dict]:
    return (item.model_output or {}).get("extra") or []


@router.get("")
def social_list(db: DB = Depends(get_db)):
    """Siyahı: hər DM söhbəti və hər post (kommentləri ilə) bir sətirdir."""
    rows = db.scalars(select(SocialItem).where(SocialItem.created_at >= now() - timedelta(days=LIST_DAYS))
                      .order_by(SocialItem.id)).all()
    groups: dict[tuple, list[SocialItem]] = {}
    for r in rows:
        if r.thread_id:
            groups.setdefault((r.channel, r.kind, r.thread_id), []).append(r)
    out, lookups = [], NAME_LOOKUPS
    for (channel, kind, thread), items in groups.items():
        last = items[-1]
        if kind == "dm" and not _author(items) and lookups:  # köhnə DM-lər: Instagram adı bir dəfə soruşulub yazılır
            lookups -= 1
            last.author = social_inbox.ig_author(db, thread)
        pending = [i for i in items if i.status == "pending"]
        extra = _extras(last)
        times = [aware(last.decided_at or last.created_at)] + [aware(datetime.fromisoformat(e["at"])) for e in extra if e.get("at")]
        shown = pending[-1] if pending else last
        out.append({"key": f"{kind}:{channel}:{thread}", "channel": channel, "kind": kind, "thread_id": thread,
                    "author": (shown.author if kind == "comment" else "") or _author(items),
                    "last_text": shown.text, "last_in": last.status != "sent" and not extra,
                    "last_at": iso(max(times)), "customer_at": iso(shown.created_at), "pending": len(pending),
                    "drafted": sum(1 for i in pending if i.draft_text), "total": len(items),
                    "mode": social_inbox.ig_mode(db, thread) if kind == "dm" else None,
                    "friend": kind == "dm" and friends.is_ig_friend(db, thread),
                    "window_open": _window_open(items) if kind == "dm" else None})
    out.sort(key=lambda r: r["last_at"] or "", reverse=True)
    if lookups < NAME_LOOKUPS:
        db.commit()
    return {"threads": out, "comment_mode": "auto" if social_inbox.comment_auto(db) else "draft"}


def _ig_history(thread: str) -> list:
    hit = _history_cache.get(thread)
    if hit and hit[0] > time.monotonic():
        return hit[1]
    msgs = instagram.thread_messages(thread, limit=30)
    _history_cache[thread] = (time.monotonic() + HISTORY_TTL, msgs)
    return msgs


@router.get("/dm/{thread}")
def dm_open(thread: str, db: DB = Depends(get_db)):
    items = _thread_items(db, "instagram", "dm", thread)
    if not items:
        raise HTTPException(404, "Söhbət tapılmadı")
    if not _author(items):
        items[-1].author = social_inbox.ig_author(db, thread)
        db.commit()
    msgs, ours = [], set()
    for i in items:
        msgs.append({"key": f"i{i.id}", "role": "in", "text": i.text, "at": _ts(i.created_at)})
        if i.status == "sent" and i.draft_text:
            role = "you" if (i.model_output or {}).get("by_owner") else "bot"
            msgs.append({"key": f"o{i.id}", "role": role, "text": i.draft_text, "at": _ts(i.decided_at or i.created_at)})
            ours.add(i.draft_text.strip())
        for n, e in enumerate(_extras(i)):
            msgs.append({"key": f"e{i.id}-{n}", "role": "you", "text": e.get("text", ""), "at": e.get("at") or _ts(i.created_at)})
            ours.add(str(e.get("text", "")).strip())
    start = aware(items[0].created_at) - social_inbox.OLD_MARGIN
    for n, (role, text, t) in enumerate(_ig_history(thread)):
        # Köhnə yazışma (webhook-dan əvvəl) və sahibkarın Instagram app-dan yazdığı (bazada yoxdur)
        if (role == "user" and t < start) or (role == "model" and text.strip() not in ours):
            msgs.append({"key": f"h{n}", "role": "in" if role == "user" else "you", "text": text, "at": _ts(t)})
    msgs.sort(key=lambda m: m["at"] or "")
    return {"thread_id": thread, "author": _author(items), "mode": social_inbox.ig_mode(db, thread),
            "lead_id": social_inbox.item_lead_id(db, items[-1]), "friend": friends.is_ig_friend(db, thread),
            "window_open": _window_open(items), "window_expires_at": iso(aware(items[-1].created_at) + instagram.WINDOW),
            "messages": msgs, "pending": [item_out(i) for i in items if i.status == "pending"]}


@router.get("/post/{channel}/{thread}")
def post_open(channel: Literal["instagram", "youtube"], thread: str, db: DB = Depends(get_db)):
    items = _thread_items(db, channel, "comment", thread)
    if not items:
        raise HTTPException(404, "Post tapılmadı")
    info = instagram.media(thread) if channel == "instagram" else {"permalink": f"https://www.youtube.com/watch?v={thread}"}
    return {"channel": channel, "thread_id": thread, "post": info,
            "comment_mode": "auto" if social_inbox.comment_auto(db) else "draft",
            "items": [item_out(i) for i in reversed(items)]}


def _pending_item(db: DB, item_id: int) -> SocialItem:
    item = db.get(SocialItem, item_id)
    if not item:
        raise HTTPException(404, "Mesaj tapılmadı")
    db.refresh(item)
    if item.status != "pending":
        raise HTTPException(409, "Artıq həll olunub")
    return item


def _send_or_raise(db: DB, item: SocialItem) -> None:
    try:
        social_inbox.send(db, item)
    except social_inbox.WindowClosed as e:
        db.rollback()
        raise HTTPException(409, str(e)) from e
    except social_inbox.SEND_ERRORS as e:
        db.rollback()
        raise HTTPException(502, f"Göndərilmədi: {str(e)[:300]}") from e


class SendIn(BaseModel):
    text: str | None = Field(default=None, max_length=2000)


@router.post("/items/{item_id}/send")
def item_send(item_id: int, body: SendIn | None = None, db: DB = Depends(get_db)):
    """Qaralamanı (lazım olsa redaktə edib) göndərir. DM: bot söhbəti yenə özü aparır (Telegram ✅ ilə eyni).
    DM-də söhbətin kilidi bot qaralaması ilə eyni anda göndərilməsin deyə tutulur."""
    first = db.get(SocialItem, item_id)
    if not first:
        raise HTTPException(404, "Mesaj tapılmadı")
    lock = social_inbox._thread_lock(first.thread_id) if first.kind == "dm" else None
    if lock:
        lock.acquire()
    try:
        item = _pending_item(db, item_id)
        text = ((body.text if body else None) or "").strip()
        if text and text != (item.draft_text or "").strip():
            item.draft_text = text
            item.model_output = {**(item.model_output or {}), "by_owner": True}
        if not (item.draft_text or "").strip():
            raise HTTPException(400, "Cavab mətni boşdur")
        item.auto_at = None
        _send_or_raise(db, item)
        if item.kind == "dm":
            social_inbox.draft_approved(db, item.thread_id)
        db.commit()
    finally:
        if lock:
            lock.release()
    social_tg.close(item, "✅ App-dan göndərildi")
    _history_cache.pop(item.thread_id, None)
    return item_out(item)


@router.post("/items/{item_id}/reject")
def item_reject(item_id: int, db: DB = Depends(get_db)):
    item = _pending_item(db, item_id)
    item.status, item.decided_at, item.auto_at = "rejected", now(), None
    db.commit()
    social_tg.close(item, "✖️ App-da rədd edildi")
    return item_out(item)


@router.post("/items/{item_id}/regenerate")
def item_regenerate(item_id: int, tasks: BackgroundTasks, db: DB = Depends(get_db)):
    item = _pending_item(db, item_id)
    regen = (item.model_output or {}).get("regen", 0)
    if regen >= MAX_REGENERATE:
        raise HTTPException(429, f"Yenidən yazma limiti ({MAX_REGENERATE}) bitib")
    item.model_output = {**(item.model_output or {}), "regen": regen + 1}
    avoid = item.draft_text
    db.commit()
    social_tg.close(item, "🔄 App-dan yenidən yazılır…")
    tasks.add_task(social_inbox.draft, item.id, avoid)
    return item_out(item)


def _gone(db: DB, item: SocialItem) -> dict:
    """Komment Instagram-da artıq yoxdur (yazan silib): xəta əvəzinə siyahıdan çıxarılır."""
    item.model_output = {**(item.model_output or {}), "gone": True}
    was_pending = item.status == "pending"
    if was_pending:
        item.status, item.decided_at = "ignored", now()
    db.commit()
    if was_pending:
        social_tg.close(item, "🗑 Komment Instagram-da silinib")
    return {**item_out(item), "gone": True}


@router.post("/items/{item_id}/hide")
def item_hide(item_id: int, db: DB = Depends(get_db)):
    """Instagram kommentini gizlədir; cavabsız idisə «ignored» olur."""
    item = db.get(SocialItem, item_id)
    if not item or item.channel != "instagram" or item.kind != "comment":
        raise HTTPException(404, "Instagram kommenti tapılmadı")
    try:
        instagram.hide_comment(item.external_id)
    except instagram.IgError as e:
        if not e.gone:
            raise HTTPException(502, f"Gizlədilmədi: {str(e)[:300]}") from e
        return _gone(db, item)
    item.model_output = {**(item.model_output or {}), "hidden": True}
    was_pending = item.status == "pending"
    if was_pending:
        item.status, item.decided_at = "ignored", now()
    db.commit()
    if was_pending:
        social_tg.close(item, "🙈 App-da gizlədildi")
    return item_out(item)


class DmIn(BaseModel):
    text: str = Field(min_length=1, max_length=2000)


@router.post("/dm/{thread}/send")
def dm_send(thread: str, body: DmIn, db: DB = Depends(get_db)):
    """Sahibkar özü yazır: son müştəri mesajı cavabsızdırsa ona cavab sayılır, yoxsa əlavə mesaj kimi saxlanır.
    Söhbət «Siz yazdınız» olur (WhatsApp-dakı kimi bot sonra yalnız qaralama yazır)."""
    text = body.text.strip()
    if not text:
        raise HTTPException(400, "Mesaj boşdur")
    with social_inbox._thread_lock(thread):
        items = _thread_items(db, "instagram", "dm", thread)
        if not items:
            raise HTTPException(404, "Söhbət tapılmadı")
        last = items[-1]
        answered = last.status == "pending"
        if answered:
            last.draft_text, last.auto_at = text, None
            last.model_output = {**(last.model_output or {}), "by_owner": True}
            _send_or_raise(db, last)
        else:
            if not _window_open(items):
                raise HTTPException(409, "son müştəri mesajından 24 saat keçib, Instagram cavaba icazə vermir")
            try:
                mid = instagram.send_dm(thread, text)
            except instagram.IgError as e:
                raise HTTPException(502, f"Göndərilmədi: {str(e)[:300]}") from e
            if mid:
                social_inbox._sent_mids.append(mid)
            last.model_output = {**(last.model_output or {}), "extra": [*_extras(last), {"text": text, "at": _ts(now())}]}
        for i in items[:-1]:  # köhnə cavabsız qaralamalar artıq lazım deyil
            if i.status == "pending":
                i.status, i.decided_at, i.auto_at = "ignored", now(), None
        social_inbox.owner_wrote(db, thread)
        db.commit()
    if answered:
        social_tg.close(last, "✍️ Sahibkar app-dan yazdı")
    _history_cache.pop(thread, None)
    return {"ok": True}


class CommentModeIn(BaseModel):
    mode: Literal["auto", "draft"]


@router.post("/comment-mode")
def comment_mode(body: CommentModeIn, db: DB = Depends(get_db)):
    conf.put(db, "comment_mode", body.mode)
    db.commit()
    return {"comment_mode": body.mode}


class ModeIn(BaseModel):
    mode: Literal["bot", "owner", "wait"]


class FriendIn(BaseModel):
    friend: bool


@router.post("/dm/{thread}/friend")
def dm_friend(thread: str, body: FriendIn, db: DB = Depends(get_db)):
    """«Dostdur · bot yazmır» (03 T9): Telegram «Dost» düyməsi ilə eyni; dost olanda gözləyən qaralamalar rədd olunur."""
    if not _thread_items(db, "instagram", "dm", thread):
        raise HTTPException(404, "Söhbət tapılmadı")
    with social_inbox._thread_lock(thread):
        friends.set_ig(db, thread, body.friend)
        db.commit()
    return {"friend": friends.is_ig_friend(db, thread)}


@router.post("/dm/{thread}/mode")
def dm_mode(thread: str, body: ModeIn, db: DB = Depends(get_db)):
    """Rejim menyusu (03 E2): bot | owner (Siz yazdınız) | wait (Komandaya ötürülüb). Müştəriyə mesaj getmir."""
    if not _thread_items(db, "instagram", "dm", thread):
        raise HTTPException(404, "Söhbət tapılmadı")
    with social_inbox._thread_lock(thread):
        social_inbox.set_mode(db, thread, body.mode)
        db.commit()
    return {"mode": social_inbox.ig_mode(db, thread)}


@router.post("/items/{item_id}/lead")
def item_lead(item_id: int, db: DB = Depends(get_db)):
    """«Lead kimi əlavə et» (02 #57–58): DM müştərisi və ya komment müəllifi lead olur (mərhələ «yeni», nömrəsiz)."""
    item = db.get(SocialItem, item_id)
    if not item:
        raise HTTPException(404, "Tapılmadı")
    lead, created = social_inbox.add_lead(db, item)
    return {"lead_id": lead.id, "created": created, "name": lead.name}
