"""Instagram DM/komment və YouTube kommenti: AI qaralaması (WhatsApp botunun təlimatı + kanal qeydi) və göndəriş.

Komment və YouTube: `comment_mode = auto` (susmaya görə) olanda AI cavabı özü ictimai yazır (sahibkar 🤖 mövzusunda
görür); Instagram-da maraqlanana (INTEREST_RE) əvvəl ilk Direct mesajı da gedir (private reply), Direct alınmasa
ictimai cavab yenə nömrə ilə gedir. Şikayət, mübahisə, cavabı bilinməyən sual (handoff): sabit nəzakətli cavab
(HANDOFF_REPLY) + sahibkara 🔴 xəbər. Spam cavabsız qalır. Sutkada 40-dan çox cavab və ya göndəriş xətası olanda
qaralama Telegram-a düymələrlə gedir (social_tg). `/komment avto|qaralama` rejimi dəyişir.
Instagram DM: `ig_dm_mode = auto` olanda bot özü cavab verir (sahibkar hər cavabı Telegram-da görür); `new_auto` —
yalnız əvvəl bizimlə yazışmayana, köhnə yazışanlara həmişə qaralama. Avtomatik cavab alan DM söhbətində bot ↔ sahibkar
növbəsi var (WhatsApp ilə eyni, qaydalar crm/turns.py və crm/ig_turns.py-dədir): `bot` — bot özü yazır; sahibkar app-dan
yazanda → `owner` (cavab qaralama, gündüz 1 saat toxunulmasa bot özü göndərir, gecə yalnız «asan» cavab); handoff →
`wait` (asan suala cavab, qalanı qaralama, 30 dəqiqədən sonra xatırlatma); qaralama təsdiqlənəndə → `bot`.
Rejim `settings`-də `ig_mode:<igsid>` açarındadır.
Müştəri DM-də nömrə yazanda kontakt + lead yaranır və Telegram-a «WhatsApp-dan yaz» linkli kart gedir.
"""
import logging
import re
import threading
import time
from collections import deque
from datetime import datetime, timedelta
from urllib.parse import quote

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session as DB

import ai
import alerts
from ai import AiError
from crm import bot, conf, contacts, friends, instagram, social_tg, turns, voice, youtube
from db import SessionLocal, aware, now
from models import Lead, SocialItem, WaContact

log = logging.getLogger("bot")
HISTORY = 10
OLD_MARGIN = timedelta(seconds=2)
WA_NUMBER = "994555303532"
DM_NOTE = ("\n\nKANAL: Bu, Instagram DM-dir. WhatsApp-dakı kimi qısa və isti cavab ver, suallara cavab ver. "
           "Məqsəd söhbəti WhatsApp-a keçirməkdir. İlk cavabda nömrə istəmə: əvvəl sualına cavab ver və bir sual ver. "
           "Müştəri konkret maraq göstərəndə (tarix, neçə nəfər, rezerv, «necə edək») adını və WhatsApp nömrəsini "
           "soruş (məs. «Adınızı və WhatsApp nömrənizi yazsanız, komanda WhatsApp-dan yazıb detalları "
           "dəqiqləşdirəcək»). Bir dəfə soruş, israr etmə; vermək istəməsə, sualına cavab verməyə davam et və istəsə "
           f"özünün yaza biləcəyini de: https://wa.me/{WA_NUMBER}. Nömrəni yazıbsa, bir daha soruşma: təşəkkür et və "
           "komandanın WhatsApp-dan yazacağını de. Nömrənin alınması ötürmə deyil: handoff = false qalır (müştəri "
           "kartı komandaya avtomatik gedir). Adı bilinəndə lead.name-ə yaz.")
ECHO_WAIT = 3.0
MOBILE = {"10", "50", "51", "55", "60", "70", "77", "99"}
PHONE_RE = re.compile(r"(?:\+|00)?\d[\d\s\-().]{6,17}\d")
_sent_mids: deque = deque(maxlen=500)  # API ilə göndərdiyimiz DM-lər: echo-su gələndə «sahibkar yazdı» sayılmasın
_locks: dict[str, threading.Lock] = {}
_locks_guard = threading.Lock()
COMMENT_NOTE = ("\n\nKANAL: Bu, {where} ictimai kommentdir. 1–2 qısa, isti cümlə yaz, ən çoxu bir emoji (yalnız 🙏 və ya 😊), "
                "qiymət yazma. Komment spam, təhqir və ya mənasızdırsa reply boş qaytar, handoff = true, "
                "handoff_reason = «diger». Şikayət, mənfi fikir, mübahisə və ya cavabını dəqiq bilmədiyin sualdırsa "
                "handoff = true (sahibkar özü baxacaq). Maraqlanan (qiymət soruşur, necə yazılacağını soruşur, çəkiliş "
                "istəyir, «+», «maraqlıdır», «ətraflı») üçün qısa isti cavab ver. {tail} Lead sahələri null qalır.")
COMMENT_TAILS = {
    "instagram": "«Direct-ə yazdıq» demə (Direct-i sistem özü göndərir və bunu özü yazır). Maraqlananı Direct-ə və ya "
                 "WhatsApp 055 530 35 32-yə yazmağa dəvət et, qiyməti ictimai yazma.",
    "youtube": "YouTube-da Direct yoxdur: maraqlananı WhatsApp 055 530 35 32 və ya Instagram @ypod.az Direct-inə dəvət et, "
               "qiyməti ictimai yazma.",
}
# Maraq əlamətləri: komment mətnində bunlardan biri varsa Instagram-da ilk Direct də göndərilir
INTEREST_RE = re.compile(r"^\s*\++\s*$|qiymət|qiymet|neçəyə|necəyə|price|rezerv|bron|çəkiliş|cekilis|maraq|ətraflı|etrafli|"
                         r"əlaqə|elaqe|nömrə|nomre|necə yazılım|harada|ünvan|\+", re.I)
FIRST_DM_NOTE = ("\n\nBu adam Instagram postunun altında komment yazıb: «{text}». Ona ilk Direct mesajını yaz: salamla, "
                 "kommentinə istinad et, sualı varsa cavab ver (qiymət və faktlar təlimatdakı kimi), sonda bir sual ver.")
PHONE = "055 530 35 32"
IG_DIRECT_REPLY = f"Sizə Direct-dən yazdıq 🙏 Həmçinin {PHONE} nömrəsi ilə əlaqə saxlaya bilərsiniz."  # model yazmır: nömrə həmişə olsun
YT_PHONE_TAIL = f" Əlaqə: {PHONE}"
HANDOFF_REPLY = (f"Yazdığınız üçün təşəkkür edirik 🙏 Komandamız sizə tezliklə ətraflı cavab verəcək. Həmçinin {PHONE} "
                 "nömrəsi ilə əlaqə saxlaya bilərsiniz.")
AUTO_COMMENT_CAP = 40  # sutkada (sürüşən 24 saat) avtomatik komment cavabı limiti
WHERE = {"instagram": "Instagram-da", "youtube": "YouTube-da"}


class WindowClosed(Exception):
    pass


SEND_ERRORS = (instagram.IgError, youtube.YtError, WindowClosed)


NEW_BUFFER = timedelta(hours=1)  # yeni adamın ilk mesajlarından bir az əvvəlki yazışma «köhnə» sayılır


def comment_auto(db: DB) -> bool:
    """Kommentə təsdiqsiz cavab: `auto` (susmaya görə) və ya `draft`."""
    return (conf.get(db, "comment_mode", "auto") or "auto").strip().lower() != "draft"


def _auto_count(db: DB) -> int:
    rows = db.scalars(select(SocialItem.model_output).where(
        SocialItem.kind == "comment", SocialItem.status == "sent", SocialItem.decided_at >= now() - timedelta(hours=24)))
    return sum(1 for mo in rows if (mo or {}).get("auto"))


def ig_auto(db: DB, item: SocialItem) -> bool:
    """DM-ə təsdiqsiz cavab: `auto` — hamıya, `new_auto` — yalnız əvvəl bizimlə yazışmayana, `draft` — heç kimə."""
    mode = (conf.get(db, "ig_dm_mode", "draft") or "").strip().lower()
    if mode == "new_auto":
        return is_new_ig(db, item)
    return mode == "auto"


def is_new_ig(db: DB, item: SocialItem) -> bool:
    """İlk dəfə yazan (Instagram-da əvvəlki yazışma yoxdur). Qərar `ig_new:<igsid>`-də saxlanır; API xətasında
    qaralama (ehtiyat) və yadda saxlanmır."""
    key = f"ig_new:{item.thread_id}"
    cached = conf.get(db, key)
    if cached is not None:
        return cached == "1"
    old = instagram.has_history(item.thread_id, aware(item.created_at) - NEW_BUFFER)
    if old is None:
        return False
    conf.put(db, key, "0" if old else "1")
    db.commit()
    return not old


def _mode_key(thread: str) -> str:
    return f"ig_mode:{thread}"[:64]


def ig_mode(db: DB, thread: str) -> str:
    """Bu DM söhbətində növbə kimdədir: bot | owner | wait (crm/turns.py ilə eyni mənada)."""
    v = conf.get(db, _mode_key(thread))
    return v if v in ("owner", "wait") else "bot"


def _clear_wait(db: DB, thread: str) -> None:
    conf.put(db, f"ig_wait:{thread}"[:64], "")


def owner_wrote(db: DB, thread: str) -> bool:
    """Sahibkar app-dan yazdı: söhbəti o aparır. True: vəziyyət indi dəyişdi (əvvəl `owner` deyildi)."""
    was = ig_mode(db, thread)
    conf.put(db, _mode_key(thread), "owner")
    conf.put(db, f"ig_owner:{thread}"[:64], now().isoformat())  # bundan əvvəlki qaralamalar köhnəlib (ig_turns)
    _clear_wait(db, thread)
    return was != "owner"


def owner_since(db: DB, thread: str, since: datetime) -> bool:
    v = conf.get(db, f"ig_owner:{thread}"[:64])
    try:
        return bool(v) and aware(datetime.fromisoformat(v)) > aware(since)
    except ValueError:
        return False


def draft_approved(db: DB, thread: str) -> None:
    """Sahibkar qaralamanı təsdiqlədi: bot söhbəti yenidən özü aparır."""
    if ig_mode(db, thread) != "bot":
        conf.put(db, _mode_key(thread), "bot")
        _clear_wait(db, thread)


def to_wait(db: DB, thread: str, t: datetime) -> None:
    """Handoff: komandaya ötürüldü, sahibkarın cavabı gözlənilir."""
    wkey = f"ig_wait:{thread}"[:64]
    if ig_mode(db, thread) != "wait" or not conf.get(db, wkey):
        conf.put(db, wkey, aware(t).isoformat())
    conf.put(db, _mode_key(thread), "wait")


def on_echo(thread: str, mid: str) -> str:
    """Fon işi: hesabımızdan gedən DM. Bizim API göndərişimiz deyilsə, sahibkar app-dan yazıb: söhbət `owner` rejiminə keçir."""
    time.sleep(ECHO_WAIT)  # API cavabı (mid) echo webhook-undan gec qeydə düşə bilər
    if mid in _sent_mids:
        return "own"
    with SessionLocal() as db:
        recent = db.scalars(select(SocialItem.model_output).where(  # deploy zamanı yaddaş boş ola bilər: bazaya bax
            SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.thread_id == thread,
            SocialItem.status == "sent").order_by(SocialItem.id.desc()).limit(20)).all()
        if any((mo or {}).get("sent_mid") == mid for mo in recent):
            return "own"
        changed = owner_wrote(db, thread)
        db.commit()
    if changed and recent:  # bot bu söhbətdə heç yazmayıbsa (məs. əl ilə kampaniya mesajı), xəbərə ehtiyac yoxdur
        alerts.notify(f"ig-human:{thread}", topic="auto", text="Instagram: müştəriyə özünüz yazdınız, söhbət sizdədir. Bot "
                                            "cavabı qaralama kimi Telegram-a göndərəcək; gündüz 1 saat toxunmasanız özü göndərəcək.")
    return "human"


def find_phone(texts: list[str]) -> str | None:
    """Müştəri mesajlarında ən son yazılan nömrə (994… formatında). Azərbaycan mobil kodları və ya +-lı xarici nömrə."""
    for t in reversed(texts):
        for m in reversed(PHONE_RE.findall(t or "")):
            d = contacts.normalize(m)
            if len(d) == 12 and d.startswith("994") and d[3:5] in MOBILE:
                return d
            if m.lstrip().startswith(("+", "00")) and not d.startswith("994") and 10 <= len(d) <= 15:
                return d
    return None


def _fill(lead: Lead, info: dict) -> None:
    if info.get("name") and not lead.name:
        lead.name = str(info["name"])[:120]
    if info.get("service") in bot.SERVICES:
        lead.service = info["service"]
    if info.get("preferred_date"):
        lead.preferred_date = str(info["preferred_date"])[:64]
    for k in ("people", "cameras", "editing"):
        if info.get(k) is not None:
            setattr(lead, k, info[k])


def thread_ad_id(db: DB, thread: str) -> str | None:
    """IG yazışması reklamdan (click-to-DM) açılıbsa ilk reklam ID-si."""
    return db.scalar(select(SocialItem.ad_id).where(
        SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.thread_id == thread,
        SocialItem.ad_id.is_not(None)).order_by(SocialItem.id).limit(1))


def capture_lead(db: DB, item: SocialItem, res: dict) -> Lead | None:
    """DM-də nömrə varsa: kontakt + lead (source=instagram, reklamdan gəlibsə reklam) və Telegram-a WhatsApp linkli kart. Təkrar kart getmir."""
    texts = [r.text for r in db.scalars(select(SocialItem).where(
        SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.thread_id == item.thread_id,
        SocialItem.id <= item.id).order_by(SocialItem.id.desc()).limit(20))][::-1]
    phone = find_phone(texts)
    if not phone:
        return None
    info, key = res.get("lead") or {}, f"ig_lead:{item.thread_id}"[:64]
    lid = conf.get(db, key)
    lead = db.get(Lead, int(lid)) if lid and lid.isdigit() else None
    if lead and contacts.normalize(lead.phone) == phone:
        _fill(lead, info)
        db.commit()
        return lead
    name = str(info.get("name") or "").strip()[:120]
    contact = db.scalar(select(WaContact).where(WaContact.phone == phone))
    if not contact:
        contact = WaContact(phone=phone, name=name)
        db.add(contact)
        db.flush()
    elif name and not contact.name:
        contact.name = name
    lead = bot.instagram_lead(db, contact.id)
    if not lead:
        ad_id = thread_ad_id(db, item.thread_id)
        source = "reklam" if ad_id else "instagram"
        lead = Lead(contact_id=contact.id, name=name or contact.name or "", phone=phone, source=source)
        db.add(lead)
        db.flush()
        bot._event(db, lead, "created", {"source": source, "igsid": item.thread_id, **({"ad_id": ad_id} if ad_id else {})})
    _fill(lead, info)
    user = instagram.username(item.thread_id)
    if user:
        item.author = user
        bot._set_note(lead, bot.NOTE_FIELDS["instagram"], "@" + user)
    talk = " | ".join(t.replace("\n", " ") for t in texts[-6:])[-600:]
    bot._set_note(lead, bot.IG_TALK, talk)
    conf.put(db, key, str(lead.id))
    db.commit()
    first = (lead.name or "").split(" ")[0]
    opening = (f"Salam{', ' + first if first else ''}! Y Pod-dan yazırıq. Instagram-da yazmışdınız, detalları burada "
               "dəqiqləşdirək 😊")
    want = ", ".join(str(x) for x in (lead.service, lead.preferred_date,
                                      f"{lead.cameras} kamera" if lead.cameras else None) if x) or "-"
    social_tg.lead_card(f"📥 Instagram-dan yeni müştəri\nAd: {lead.name or '-'}\nTelefon: +{phone}\n"
                        f"Instagram: {'@' + user if user else '-'}\nİstək: {want}\n\nYazdıqları: {talk[:500]}\n\n"
                        "Düyməyə basın: WhatsApp hazır salamla açılacaq, göndərin. Müştəri cavab yazanda bot davam edir.",
                        f"https://wa.me/{phone}?text={quote(opening)}")
    return lead


def _thread_lock(thread: str) -> threading.Lock:
    with _locks_guard:
        return _locks.setdefault(thread, threading.Lock())


def add(db: DB, data: dict) -> SocialItem | None:
    """Yeni item yazır (flush); external_id artıq varsa (təkrar webhook) None."""
    if not data.get("external_id") or db.scalar(select(SocialItem.id).where(SocialItem.external_id == data["external_id"])):
        return None
    item = SocialItem(**{**data, "text": str(data.get("text") or "")[:4000]})
    try:
        with db.begin_nested():
            db.add(item)
            db.flush()
    except IntegrityError:  # eyni hadisə paralel gəldi
        return None
    return item


def _history(db: DB, item: SocialItem) -> list[tuple[str, str]]:
    """DM: Instagram-dakı köhnə yazışmanın son 10 mesajı (bazadakılardan əvvəlki: webhook-dan qabaqkı söhbət, əl ilə
    göndərilən kampaniya mesajı), sonra thread-in son 10 item-i (müştəri mətni + göndərilmiş cavabımız).
    Komment: yalnız özü."""
    if item.kind != "dm":
        return [("user", item.text)]
    rows = db.scalars(select(SocialItem).where(SocialItem.channel == item.channel, SocialItem.kind == "dm",
                                               SocialItem.thread_id == item.thread_id, SocialItem.id <= item.id)
                      .order_by(SocialItem.id.desc()).limit(HISTORY)).all()
    out = []
    if item.channel == "instagram" and rows:
        start = aware(rows[-1].created_at) - OLD_MARGIN  # API vaxtı saniyəlikdir: ilk mesajın özü təkrarlanmasın
        out = [(role, text) for role, text, t in instagram.thread_messages(item.thread_id) if t < start][-HISTORY:]
    for r in reversed(rows):
        out.append(("user", r.text))
        if r.status == "sent" and r.draft_text:
            out.append(("model", r.draft_text))
    return out


def draft(item_id: int, avoid: str | None = None) -> str:
    """Fon işi: qaralama yazır və Telegram-a göndərir. Nəticə kodunu qaytarır; heç vaxt xəta atmır."""
    try:
        with SessionLocal() as db:
            item = db.get(SocialItem, item_id)
            if not item:
                outcome = "skip:no_item"
            elif item.kind == "dm":  # eyni müştərinin ardıcıl mesajları paralel cavablanmasın
                with _thread_lock(item.thread_id):
                    db.refresh(item)
                    outcome = _draft(db, item, avoid)
            else:
                outcome = _draft(db, item, avoid)
            log.info("sosial item %s: %s", item_id, outcome)
            return outcome
    except Exception as e:
        log.exception("sosial qaralama xətası (item %s)", item_id)
        alerts.notify("social-crash", f"sosial qaralama xətası (item {item_id}): {type(e).__name__}: {str(e)[:200]}")
        return "error"


def _draft(db: DB, item: SocialItem, avoid: str | None) -> str:
    if item.status != "pending":
        return "skip:decided"
    if item.kind == "dm" and friends.is_ig_friend(db, item.thread_id):  # sahibkarın dostu: bot yazmır
        item.status, item.decided_at = "ignored", now()
        db.commit()
        return "skip:friend"
    if item.kind == "dm":
        newer = db.scalar(select(SocialItem.id).where(SocialItem.channel == item.channel, SocialItem.kind == "dm",
                                                      SocialItem.thread_id == item.thread_id,
                                                      SocialItem.id > item.id).limit(1))
        if newer:  # ardıcıl bir neçə mesaj: yalnız sonuncuya bütün kontekstlə cavab yazılır
            item.status, item.decided_at = "ignored", now()
            db.commit()
            return "skip:newer"
        mo = item.model_output or {}
        if mo.get("audio_url") or mo.get("image_url"):  # bir dəfə Gemini ilə oxunur; alınmasa «[audio]»/«[şəkil]»
            if mo.get("audio_url"):  # qalır və bot yazmağı xahiş edir
                item.text = voice.text_from_url(db, mo["audio_url"]) or item.text
            else:
                item.text = voice.image_label(voice.image_text(db, mo["image_url"]))
            item.model_output = {k: v for k, v in mo.items() if k not in ("audio_url", "image_url")}
            db.commit()
        first = not db.scalar(select(SocialItem.id).where(SocialItem.channel == item.channel, SocialItem.kind == "dm",
                                                          SocialItem.thread_id == item.thread_id,
                                                          SocialItem.status == "sent").limit(1))
        note = DM_NOTE
    else:
        first, note = False, COMMENT_NOTE.format(where=WHERE.get(item.channel, ""),
                                                 tail=COMMENT_TAILS.get(item.channel, ""))
    system = bot.build_system(db, now(), first_message=first) + note
    if avoid:
        system += (f"\n\nSAHİBKAR ƏVVƏLKİ QARALAMANI BƏYƏNMƏDİ: «{avoid[:1500]}». Başqa cür yaz: fərqli başlanğıc və "
                   "ifadələr. Faktlar və qaydalar eyni qalır.")
    regen, from_id = (item.model_output or {}).get("regen", 0), (item.model_output or {}).get("from_id")
    try:
        res, usage, problem = bot.converse(system, bot.contents_from(_history(db, item)))
    except AiError as e:
        item.status, item.model_output, item.decided_at = "ignored", {"error": str(e)[:300], "regen": regen}, now()
        db.commit()
        alerts.notify(f"social-ai:{item.id}", topic="action", text=f"AI cavab vermədi ({item.channel} {item.kind}), özünüz baxın: "
                                              f"{item.text[:300]}")
        return "ai_error"
    ai.count_usage(db, "bot", *usage)
    reply = "" if problem else res["reply"]
    item.model_output = {**res, "problem": problem, "regen": regen, **({"from_id": from_id} if from_id else {})}
    if item.kind == "dm" and not avoid:
        bot.note_gap(db, None, {**res, "handoff": True, "handoff_reason": "filtr"} if problem else res, item.text,
                     "[IG] ")
    spam = not reply and not problem and res.get("handoff_reason") == "diger"
    auto_comment = item.kind == "comment" and not avoid and not spam and comment_auto(db)
    if auto_comment and (problem or not reply or res.get("handoff")):  # cavabsız qalmasın: sabit cavab + sahibkara xəbər
        auto_comment = False  # aşağıda ikinci dəfə cəhd edilməsin
        outcome = _auto_comment(db, item, from_id, handoff=True)
        if outcome:
            return outcome
        reply = reply or HANDOFF_REPLY
    if not reply:
        item.status, item.decided_at = "ignored", now()
        db.commit()
        if item.kind == "dm" or problem:  # DM cavabsız qalmasın; spam komment üçün xəbər getmir
            alerts.notify(f"social-empty:{item.id}", topic="action", text=f"{social_tg.title(item)}: qaralama yazılmadı "
                                                     f"({problem or res.get('handoff_reason') or 'boş cavab'}), "
                                                     f"özünüz baxın: {item.text[:300]}")
        return "ignored"
    item.draft_text = reply
    db.commit()
    if auto_comment:
        outcome = _auto_comment(db, item, from_id)
        if outcome:
            return outcome
    if item.kind == "dm":  # köhnə cavabsız qaralamalar artıq lazım deyil
        for old in db.scalars(select(SocialItem).where(SocialItem.channel == item.channel, SocialItem.kind == "dm",
                                                       SocialItem.thread_id == item.thread_id,
                                                       SocialItem.id < item.id, SocialItem.status == "pending")):
            old.status, old.decided_at = "ignored", now()
            social_tg.close(old, "⏭ Yeni mesaj gəldi, qaralama aşağıdadır")
        db.commit()
    if item.channel == "instagram" and item.kind == "dm":
        try:
            capture_lead(db, item, res)
        except Exception:  # lead xətası cavabı saxlamasın
            db.rollback()
            log.exception("Instagram lead (item %s)", item.id)
        if avoid:  # «Yenidən yaz» həmişə qaralamadır, avtomatik göndəriş taymeri də ləğv olunur
            item.auto_at = None
        elif ig_auto(db, item):
            send_now, item.auto_at = turns.plan_mode(ig_mode(db, item.thread_id), res, now())  # növbə: crm/turns.py
            handoff = bool(res.get("handoff"))
            if send_now:
                try:
                    send(db, item)
                    db.commit()
                except SEND_ERRORS as e:
                    db.rollback()
                    send_now = False
                    item.auto_at = None
                    alerts.notify(f"ig-auto:{item.id}", topic="action", text=f"Instagram avtomatik cavab getmədi ({str(e)[:200]}), "
                                                        "qaralama Telegram-dadır.")
            if handoff:  # komandaya ötürüldü: sahibkarın cavabı gözlənilir (asan suala bot yenə cavab verir)
                to_wait(db, item.thread_id, now())
            db.commit()
            if send_now:
                if handoff:
                    social_tg.auto_log(item, f"🙋 Əməkdaş lazımdır (səbəb: {res.get('handoff_reason') or '-'}). Bot "
                                             "cavab verdi, sizin cavabınızı gözləyir (asan suallara özü cavab verəcək), "
                                             "Instagram-dan özünüz yazın.", topic="action")
                    return f"handoff:{res.get('handoff_reason')}"
                social_tg.auto_log(item)
                return "sent"
    social_tg.send(item)
    db.commit()
    return "draft"


def _first_dm(db: DB, item: SocialItem) -> str:
    """Komment yazana ilk Direct mətni (ikinci AI çağırışı). Boş: yazılmadı, qaralama Telegram-a gedir."""
    system = (bot.build_system(db, now(), first_message=True) + DM_NOTE + FIRST_DM_NOTE.format(text=item.text[:500]))
    try:
        res, usage, problem = bot.converse(system, bot.contents_from([("user", item.text)]))
    except AiError:
        return ""
    ai.count_usage(db, "bot", *usage)
    return "" if problem or res.get("handoff") else (res.get("reply") or "").strip()


def _with_phone(text: str) -> str:
    return text if PHONE in text else text.rstrip() + YT_PHONE_TAIL


def _auto_comment(db: DB, item: SocialItem, from_id: str | None, handoff: bool = False) -> str | None:
    """Kommentə təsdiqsiz cavab. None: avtomatik getmədi (limit və ya göndəriş xətası), qaralama Telegram-a gedir.

    handoff: AI cavabı bilmir, şikayət və ya filtr — ictimai cavab sabit HANDOFF_REPLY, sahibkara 🔴 xəbər.
    Instagram-da maraqlanana əvvəl Direct gedir (sahibkar o adamla özü yazışsa da); Direct alınmasa ictimai cavab
    yenə gedir, sadəcə «Direct-dən yazdıq» demir və nömrə həmişə olur.
    """
    if _auto_count(db) >= AUTO_COMMENT_CAP:
        return None
    dm_text = ""
    interested = bool(INTEREST_RE.search(item.text))
    if handoff:
        item.draft_text = HANDOFF_REPLY
    elif interested:
        item.draft_text = _with_phone(item.draft_text or "")
    if item.channel == "instagram" and interested and not handoff:
        dm_text = _first_dm(db, item)
        if dm_text:
            try:
                rid, mid = instagram.private_reply(item.external_id, dm_text)
            except instagram.IgError as e:  # Direct getmədi: ictimai cavab «Direct-dən yazdıq» demədən gedir
                alerts.notify(f"ig-comment-dm:{item.id}", topic="action", text=f"Komment sahibinə Direct getmədi "
                                                           f"({str(e)[:200]}), kommentə cavab yazıldı: {item.text[:200]}")
                dm_text = ""
            else:
                if mid:
                    _sent_mids.append(mid)
                if rid and conf.get(db, f"ig_new:{rid}") is None:  # cavab yazsa new_auto rejimi avtomatik cavablasın
                    conf.put(db, f"ig_new:{rid}", "1")
                item.model_output = {**(item.model_output or {}), "dm_text": dm_text, "dm_mid": mid}
                item.draft_text = IG_DIRECT_REPLY  # Direct getdi: ictimai cavab sabit mətndir
        db.commit()
    try:
        send(db, item)
        item.model_output = {**(item.model_output or {}), "auto": True}
        db.commit()
    except SEND_ERRORS as e:
        db.rollback()
        alerts.notify(f"comment-auto:{item.id}", topic="action", text=f"Komment cavabı getmədi ({str(e)[:200]}), "
                                                  "qaralama Telegram-dadır.")
        return None
    if handoff:
        social_tg.auto_log(item, "🙋 Kommentə özünüz baxın (bot cavabı bilmir və ya şikayətdir). Bot nəzakətli cavab "
                                 "yazdı, ətraflı cavabı siz verin.", topic="action")
    elif dm_text:
        social_tg.auto_log(item, "🤖 Komment cavablandı + Direct yazıldı", topic="auto", extra=dm_text)
    else:
        social_tg.auto_log(item, "🤖 Komment avtomatik cavablandı", topic="auto")
    return "sent"


def send(db: DB, item: SocialItem) -> None:
    """Qaralamanı göndərir və statusu `sent` edir (commit çağıran tərəfindədir). SEND_ERRORS qalxa bilər."""
    text = item.draft_text or ""
    if item.channel == "instagram" and item.kind == "dm":
        last = db.scalar(select(SocialItem.created_at).where(
            SocialItem.channel == "instagram", SocialItem.kind == "dm", SocialItem.thread_id == item.thread_id)
            .order_by(SocialItem.created_at.desc()).limit(1))
        if not last or now() - aware(last) > instagram.WINDOW:
            raise WindowClosed("son müştəri mesajından 24 saat keçib, Instagram cavaba icazə vermir")
        mid = instagram.send_dm(item.thread_id, text)
        if mid:
            _sent_mids.append(mid)
            item.model_output = {**(item.model_output or {}), "sent_mid": mid}
    elif item.channel == "instagram":
        instagram.reply_comment(item.parent_id or item.external_id, text)
    else:
        youtube.insert_reply(item.parent_id or item.external_id, text)
    item.status, item.decided_at = "sent", now()
