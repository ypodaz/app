"""Telegram mövzu qrupu: hər mesaj növü öz mövzusuna (forum topic) gedir.

Qurulma: sahibkar qrup yaradır, «Topics»-i açır, botu admin edir («Manage topics»), qrupda `/qur` yazır. Bot
mövzuları özü yaradır, qrup və mövzu ID-ləri `settings` cədvəlində saxlanır (`tg_group_id`, `tg_topic_<açar>`).
Qrup qurulmayıbsa (və ya baza əlçatmazdırsa) hər şey əvvəlki kimi TG_CHAT_ID-yə gedir.
`/qur`-u yalnız sahibkar işlədə bilər: şəxsi çatın ID-si (TG_CHAT_ID) onun Telegram istifadəçi ID-sidir.
"""
import logging
import threading
import time

import settings

log = logging.getLogger("tgtopics")

TOPICS = {  # açar → mövzu adı (sıra Telegram-da yaradılma sırasıdır)
    "action": "🔴 Cavab lazımdır",
    "auto": "🤖 Bot özü cavabladı",
    "tasks": "📋 Montaj və işlər",
    "reports": "📊 Hesabatlar",
    "server": "⚙️ Server",
    "comments": "💬 Kommentlər",
}
ABOUT = {
    "action": "WhatsApp və Instagram qaralamaları, komandaya ötürülən söhbətlər, TƏCİLİ xəbərlər, yeni müştərilər.",
    "auto": "Botun təsdiqsiz göndərdiyi cavablar. Bu mövzunun səsini söndürə bilərsiniz.",
    "tasks": "Montaj növbəsi və rəy sorğuları.",
    "reports": "Gündəlik bot hesabatı və həftəlik statistika.",
    "server": "Server xətaları, AI, token və paylaşım problemləri.",
    "comments": "Instagram və YouTube komment qaralamaları.",
}
TTL = 60
_cache: dict = {"at": -TTL, "val": {}}
_lock = threading.Lock()


def _load() -> dict:
    """{"group": "-100…", "action": 12, …}; boş dict: qrup qurulmayıb. 60 saniyə keşlənir."""
    with _lock:
        if time.monotonic() - _cache["at"] < TTL:
            return _cache["val"]
    try:
        from sqlalchemy import select

        from db import SessionLocal
        from models import Setting
        with SessionLocal() as db:
            rows = {r.key: r.value for r in db.scalars(select(Setting).where(Setting.key.like("tg_%")))}
    except Exception:  # baza əlçatmazdır: son bilinən (və ya köhnə çat)
        log.warning("tg mövzuları oxunmadı")
        return _cache["val"]
    val = {}
    if rows.get("tg_group_id"):
        val["group"] = rows["tg_group_id"]
        for key in TOPICS:
            tid = rows.get(f"tg_topic_{key}")
            if tid and tid.isdigit():
                val[key] = int(tid)
    with _lock:
        _cache.update(at=time.monotonic(), val=val)
    return val


def invalidate() -> None:
    with _lock:
        _cache["at"] = -TTL


def has_group() -> bool:
    return bool(_load().get("group"))


def dest(topic: str) -> dict:
    """sendMessage üçün {"chat_id", "message_thread_id"?}. Mövzu yoxdursa qrupun ümumi çatı, qrup yoxdursa TG_CHAT_ID."""
    val = _load()
    if not val.get("group"):
        return {"chat_id": settings.TG_CHAT_ID}
    out = {"chat_id": val["group"]}
    if val.get(topic):
        out["message_thread_id"] = val[topic]
    return out


def chat_allowed(chat_id) -> bool:
    """Düymə və cavablar: köhnə şəxsi çat və ya qurulmuş qrup."""
    return str(chat_id) in {str(settings.TG_CHAT_ID), str(_load().get("group") or "")} - {""}


def setup(db, msg: dict, call) -> str:
    """`/qur` əmri. `call` = crm.tg._call. Qaytarır: not_owner | not_forum | no_rights | ok."""
    from crm import conf

    chat = msg.get("chat") or {}
    if str((msg.get("from") or {}).get("id")) != str(settings.TG_CHAT_ID):
        return "not_owner"  # başqası botu öz qrupuna əlavə edib bildirişləri ələ keçirə bilməsin
    reply = {"chat_id": chat.get("id")}
    if msg.get("message_thread_id"):
        reply["message_thread_id"] = msg["message_thread_id"]
    if chat.get("type") != "supergroup" or not chat.get("is_forum"):
        call("sendMessage", {**reply, "text": "Bu qrupda «Topics» açıq deyil. Qrup ayarlarından açın və yenidən /qur "
                                              "yazın."})
        return "not_forum"
    group = str(chat["id"])
    same = conf.get(db, "tg_group_id") == group
    created = []
    for key, name in TOPICS.items():
        if same and conf.get(db, f"tg_topic_{key}"):
            continue  # təkrar /qur: olan mövzular qalır, yalnız çatışmayan yaradılır
        res = call("createForumTopic", {"chat_id": group, "name": name}) or {}
        tid = (res.get("result") or {}).get("message_thread_id")
        if not tid:
            call("sendMessage", {**reply, "text": "Mövzu yaradılmadı. Botu admin edin və «Manage topics» icazəsini "
                                                  "verin, sonra yenidən /qur yazın."})
            db.rollback()
            return "no_rights"
        conf.put(db, f"tg_topic_{key}", str(tid))
        created.append((key, tid))
    conf.put(db, "tg_group_id", group)
    db.commit()
    invalidate()
    for key, tid in created:
        call("sendMessage", {"chat_id": group, "message_thread_id": tid, "text": f"{TOPICS[key]}\n\n{ABOUT[key]}"})
    call("sendMessage", {**reply, "text": "✅ Qrup quruldu. Bundan sonra bütün bildirişlər mövzulara gələcək."})
    if group != str(settings.TG_CHAT_ID):
        call("sendMessage", {"chat_id": settings.TG_CHAT_ID, "text": "✅ Bildirişlər artıq mövzu qrupuna gedir. Köhnə "
                                                                     "mesajlardakı düymələr işləməyə davam edir."})
    return "ok"
