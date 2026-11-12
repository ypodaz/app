"""Telegram to-do: sahibkar 📋 «Montaj və işlər» mövzusuna iş yazır → `tasks` cədvəli, «☑️ Bitdi» düyməsi (`t:{id}:d`).

`/isler` açıq işlərin siyahısını verir. Yalnız sahibkar (from.id == TG_CHAT_ID) yaza və bitirə bilər.
"""
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import settings
import tgtopics
from crm import conf
from crm.tg import _call
from db import now
from models import Task

MAX_BUTTONS = 20
MAX_TEXT = 500


def is_owner(msg: dict) -> bool:
    return str((msg.get("from") or {}).get("id")) == str(settings.TG_CHAT_ID) and tgtopics.chat_allowed(
        (msg.get("chat") or {}).get("id"))


def open_tasks(db: DB) -> list[Task]:
    return list(db.scalars(select(Task).where(Task.done_at.is_(None)).order_by(Task.id)))


def section(db: DB) -> str:
    """Gündəlik montaj mesajına əlavə: açıq işlər (yoxdursa boş)."""
    rows = open_tasks(db)
    if not rows:
        return ""
    return "\n".join(["📝 Açıq işlər", *[f"{i}. {t.text}" for i, t in enumerate(rows, 1)], "", "Bitirmək üçün /isler"])


def _list(db: DB) -> tuple[str, dict | None]:
    rows = open_tasks(db)
    if not rows:
        return "Açıq iş yoxdur ✅", None
    text = "\n".join(["📝 Açıq işlər", "", *[f"{i}. {t.text}" for i, t in enumerate(rows, 1)]])[:4000]
    kb = [[{"text": f"☑️ {i} bitdi", "callback_data": f"t:{t.id}:d"}] for i, t in enumerate(rows[:MAX_BUTTONS], 1)]
    return text, {"inline_keyboard": kb}


def _thread(msg: dict) -> dict:
    return {"message_thread_id": msg["message_thread_id"]} if msg.get("message_thread_id") else {}


def list_command(db: DB, msg: dict) -> str:
    """`/isler`. Qaytarır: not_owner | ok."""
    if not is_owner(msg):
        return "not_owner"
    text, kb = _list(db)
    payload = {"chat_id": msg["chat"]["id"], **_thread(msg), "text": text}
    if kb:
        payload["reply_markup"] = kb
    _call("sendMessage", payload)
    return "ok"


def topic_message(db: DB, msg: dict) -> str | None:
    """Mövzudakı adi mesaj → yeni iş. None: bu mövzu deyil (və ya qaralamaya açıq cavabdır), başqa emal davam edir."""
    group, topic = conf.get(db, "tg_group_id"), conf.get(db, "tg_topic_tasks")
    chat_id, thread = (msg.get("chat") or {}).get("id"), msg.get("message_thread_id")
    if not (group and topic and str(chat_id) == group and str(thread) == topic):
        return None
    text = (msg.get("text") or "").strip()
    replied = msg.get("reply_to_message") or {}
    if replied.get("message_id") and not replied.get("forum_topic_created") and replied["message_id"] != thread:
        return None  # qaralamaya cavab
    if not is_owner(msg) or not text or text.startswith("/"):
        return "ignored"
    task = Task(text=text[:MAX_TEXT])
    db.add(task)
    db.flush()
    res = _call("sendMessage", {"chat_id": chat_id, "message_thread_id": thread,
                                "text": f"✅ İş əlavə olundu: {task.text}",
                                "reply_markup": {"inline_keyboard": [[{"text": "☑️ Bitdi",
                                                                       "callback_data": f"t:{task.id}:d"}]]}})
    mid = ((res or {}).get("result") or {}).get("message_id")
    if mid:
        task.tg_message_id = str(mid)
    db.commit()
    return "task_added"


def handle_callback(db: DB, cq: dict) -> str:
    """`t:{id}:d`. Qaytarır: ignored | resolved | done."""
    parts = str(cq.get("data", "")).split(":")
    msg = cq.get("message") or {}
    if len(parts) != 3 or parts[2] != "d" or not parts[1].isdigit() or not is_owner({**msg, "from": cq.get("from")}):
        return "ignored"
    task = db.get(Task, int(parts[1]))
    if not task:
        _call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": "İş tapılmadı"})
        return "ignored"
    if task.done_at:
        _call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": "artıq bitib"})
        return "resolved"
    task.done_at = now()
    db.commit()
    _call("answerCallbackQuery", {"callback_query_id": cq.get("id"), "text": "☑️ Bitdi"})
    payload = {"chat_id": msg["chat"]["id"], "message_id": msg.get("message_id")}
    if str(msg.get("message_id")) == task.tg_message_id:
        payload["text"] = f"☑️ Bitdi: {task.text}"
    else:  # /isler siyahısı: qalan işlərlə yenilənir
        payload["text"], kb = _list(db)
        if kb:
            payload["reply_markup"] = kb
    _call("editMessageText", payload)
    return "done"
