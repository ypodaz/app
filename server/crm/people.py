"""Müştəri bazası: IG arxivi, canlı IG DM, WhatsApp, app müştəriləri, leadlər və kontaktlardan şəxsləri birləşdirir,
Gemini ilə kart çıxarır (scripts/build_people.py). Saf məntiq burada, şəbəkə çağırışı skriptdədir.

Şəxsi kontaktlar (KnownContact.kind=personal) və öz Instagram hesabımız heç vaxt daxil edilmir."""
import json
import re
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DB

import settings
from crm.contacts import normalize
from db import aware, now
from views import BAKU
from models import Client, KnownContact, Lead, Person, Shoot, SocialItem, WaContact, WaConversation, WaMessage

PREFIXES = {"50", "51", "55", "70", "77", "99", "10", "60", "12"}  # mobil operatorlar + Bakı
STUDIO = "994555303532"  # öz nömrəmiz: müştəri nömrəsi sayılmır
OUTCOMES = ("client", "lead", "lost", "unknown", "other")
MAX_MSGS, HEAD_MSGS, MID_MSGS, MAX_CHARS, MAX_LINE = 120, 5, 30, 12000, 400
_RUN = re.compile(r"(?<!\d)\+?\d[\d\s\-().]{6,}\d(?!\d)")


# --- telefon ---

def _valid(p: str) -> bool:
    return len(p) == 12 and p.startswith("994") and p[3:5] in PREFIXES


def extract_phones(text: str | None) -> list[str]:
    """Mətndəki Azərbaycan nömrələri (994XXXXXXXXX), təkrarsız, görünmə sırası ilə.
    0XX XXX XX XX, 0XXXXXXXXX, +994…, 994…, boşluq/tire/mötərizə ilə. Uzun rəqəm sətirləri (kart, id) sayılmır."""
    out: list[str] = []
    for m in _RUN.finditer(text or ""):
        d = re.sub(r"\D", "", m.group())
        found: list[str] = []
        whole = normalize(d)
        if _valid(whole):
            found = [whole]
        else:  # yan-yana bir neçə nömrə: yalnız 994… və ya 0… ilə başlayanlar, ardıcıl
            i = 0
            while i < len(d):
                if d.startswith("994", i) and _valid(d[i:i + 12]):
                    found.append(d[i:i + 12])
                    i += 12
                elif d[i] == "0" and _valid(normalize(d[i:i + 10])):
                    found.append(normalize(d[i:i + 10]))
                    i += 10
                else:
                    break
        for p in found:
            if p != STUDIO and p not in out:
                out.append(p)
    return out


# --- yığım ---

def ig_handle(v: str | None) -> str:
    """@ad, instagram.com/ad/?igsh=… → ad (kiçik hərflə)."""
    s = (v or "").strip().lower()
    s = re.sub(r"^https?://", "", s)
    s = re.sub(r"^(www\.)?instagram\.com/", "", s)
    s = s.split("?")[0].split("#")[0].strip("/ ").lstrip("@")
    return s.split("/")[0]


def _dt(v) -> datetime | None:
    if isinstance(v, datetime):
        return aware(v)
    try:
        return aware(datetime.fromisoformat(re.sub(r"([+-]\d\d)(\d\d)$", r"\1:\2", str(v).replace("Z", "+00:00"))))
    except ValueError:
        return None


class _Groups:
    """Birləşmə açarları (p:telefon, u:ig_ad, s:igsid, c:client_id, w:wa_kontakt) üzrə union-find."""

    def __init__(self):
        self.parent: dict[str, str] = {}
        self.records: list[tuple[list[str], dict]] = []

    def find(self, k: str) -> str:
        self.parent.setdefault(k, k)
        while self.parent[k] != k:
            self.parent[k] = self.parent[self.parent[k]]
            k = self.parent[k]
        return k

    def add(self, keys: list[str], rec: dict) -> None:
        keys = [k for k in keys if k]
        if not keys:
            return
        for k in keys[1:]:
            self.parent[self.find(k)] = self.find(keys[0])
        self.find(keys[0])
        self.records.append((keys, rec))


def collect(db: DB, ig_archive: dict | None = None, wa_archive: dict | None = None) -> list[dict]:
    """Şəxs paketlərinin siyahısı. Hər paket: phone, phones_found, ig_username, igsid, client_id, sources (sıralı list),
    msgs [(vaxt, 'Müştəri'|'Y Pod', mətn)], msg_count, first_contact_at, last_contact_at, facts, transcript."""
    personal = set(db.scalars(select(KnownContact.phone).where(KnownContact.kind == "personal")))
    g = _Groups()
    own_id = (getattr(settings, "IG_USER_ID", "") or "")
    own_names: set[str] = set()

    def from_text(msgs: list[tuple]) -> list[str]:
        found: list[str] = []
        for _, who, text in msgs:
            if who == "Müştəri":
                found += [p for p in extract_phones(text) if p not in found]  # şəxsi nömrə də açar olur: paket çıxarılır
        return found

    # Instagram arxivi
    if ig_archive:
        me = ig_archive.get("me") or {}
        if isinstance(me, dict):
            own_id = str(me.get("id") or own_id)
            own_names.add(str(me.get("username") or "").lower())
        elif me:  # real arxivdə "me" yalnız öz hesabımızın id-sidir (sətir)
            own_id = str(me)
        for conv in ig_archive.get("conversations") or []:
            others = [p for p in conv.get("participants") or []
                      if str(p.get("id")) != own_id and str(p.get("username") or "").lower() not in own_names - {""}]
            if not others:
                continue
            who_id, who_name = str(others[0].get("id") or ""), str(others[0].get("username") or "").lower()
            msgs = []
            for m in conv.get("messages") or []:
                t, text = _dt(m.get("created_time")), (m.get("message") or "").strip()
                if not t or not text:
                    continue
                f = m.get("from") or {}
                mine = str(f.get("id")) == own_id or str(f.get("username") or "").lower() in own_names - {""}
                msgs.append((t, "Y Pod" if mine else "Müştəri", text))
            found = from_text(msgs)
            g.add([f"s:{who_id}" if who_id else "", f"u:{who_name}" if who_name else ""] + [f"p:{p}" for p in found],
                  {"src": "ig", "igsid": who_id, "ig_username": who_name, "msgs": msgs, "found": found})

    # canlı Instagram DM
    threads: dict[str, list[SocialItem]] = {}
    for it in db.scalars(select(SocialItem).where(SocialItem.channel == "instagram", SocialItem.kind == "dm")
                         .order_by(SocialItem.id)):
        threads.setdefault(it.thread_id, []).append(it)
    for sid, items in threads.items():
        if sid == own_id:
            continue
        msgs = []
        for it in items:
            msgs.append((aware(it.created_at), "Müştəri", it.text))
            if it.status == "sent" and it.draft_text:
                msgs.append((aware(it.decided_at or it.created_at), "Y Pod", it.draft_text))
        user = next((ig_handle(i.author) for i in reversed(items) if i.author), "")
        found = from_text(msgs)
        g.add([f"s:{sid}", f"u:{user}" if user else ""] + [f"p:{p}" for p in found],
              {"src": "ig", "igsid": sid, "ig_username": user, "msgs": msgs, "found": found})

    # WhatsApp
    convs = {c.contact_id: c for c in db.scalars(select(WaConversation))}
    for ct in db.scalars(select(WaContact)):
        p = normalize(ct.phone)
        msgs = []
        c = convs.get(ct.id)
        if c:
            for m in db.scalars(select(WaMessage).where(WaMessage.conversation_id == c.id)
                                .order_by(WaMessage.created_at, WaMessage.id)):
                text = (m.text or m.transcript or "").strip()
                if text:
                    msgs.append((aware(m.created_at), "Müştəri" if m.direction == "in" else "Y Pod", text))
        g.add([f"p:{p}" if p else f"w:{ct.id}"], {"src": "wa", "phone": p, "wa_name": ct.name or "", "msgs": msgs})

    # oflayn WhatsApp Business arxivi: {"contacts": [{"phone", "name", "msgs": [[vaxt, "Müştəri"|"Y Pod", mətn]]}]}
    for ct in (wa_archive or {}).get("contacts") or []:
        p = normalize(str(ct.get("phone") or ""))
        if not p or p == STUDIO:
            continue
        msgs = []
        for m in ct.get("msgs") or []:
            if not isinstance(m, (list, tuple)) or len(m) < 3:
                continue
            t, text = _dt(m[0]), str(m[2] or "").strip()
            if t and text:
                msgs.append((t, "Y Pod" if m[1] == "Y Pod" else "Müştəri", text))
        g.add([f"p:{p}"], {"src": "wa", "phone": p, "wa_name": str(ct.get("name") or "").strip(), "msgs": msgs})

    # app müştəriləri
    done = {cid: last for cid, last in db.execute(select(Shoot.client_id, func.max(Shoot.starts_at))
                                                  .where(Shoot.status == "completed").group_by(Shoot.client_id))}
    for cl in db.scalars(select(Client)):
        p, u = normalize(cl.phone), ig_handle(cl.instagram)
        g.add([f"c:{cl.id}", f"p:{p}" if p else "", f"u:{u}" if u else ""],
              {"src": "app", "phone": p, "client": cl, "done": cl.id in done, "last_shoot": aware(done[cl.id]) if cl.id in done else None})

    # leadlər (telefonu kontaktdan və ya özündən)
    wa_phone = {c.id: normalize(c.phone) for c in db.scalars(select(WaContact))}
    for ld in db.scalars(select(Lead).order_by(Lead.id)):
        p = normalize(ld.phone) or wa_phone.get(ld.contact_id, "")
        g.add([f"p:{p}" if p else f"w:{ld.contact_id}"], {"src": "wa", "phone": p, "lead": ld})

    # telefon kontaktları (müştəri)
    for k in db.scalars(select(KnownContact).where(KnownContact.kind == "customer")):
        g.add([f"p:{k.phone}"], {"src": "contacts", "phone": k.phone})

    groups: dict[str, list[dict]] = {}
    keysets: dict[str, set[str]] = {}
    for keys, rec in g.records:
        root = g.find(keys[0])
        groups.setdefault(root, []).append(rec)
        keysets.setdefault(root, set()).update(keys)

    out = []
    for root, recs in groups.items():
        if any(k[2:] in personal for k in keysets[root] if k.startswith("p:")):
            continue
        out.append(_bundle(recs))
    return out


_ORDER = {"ig": 0, "wa": 1, "app": 2, "contacts": 3}


def _bundle(recs: list[dict]) -> dict:
    own = [r["phone"] for r in recs if r.get("phone") and r["src"] in ("app", "wa", "contacts")]
    own = list(dict.fromkeys(own))
    found = [p for r in recs for p in r.get("found", []) if p not in own]
    found = list(dict.fromkeys(found))
    msgs, seen = [], set()
    for r in recs:
        for t, who, text in r.get("msgs", []):
            key = (who, text[:200], t.strftime("%Y%m%d%H%M"))
            if key not in seen:  # arxiv və canlı yazı üst-üstə düşəndə təkrar sayılmasın
                seen.add(key)
                msgs.append((t, who, text))
    msgs.sort(key=lambda m: m[0])
    client = next((r["client"] for r in recs if r.get("client")), None)
    leads = [r["lead"] for r in recs if r.get("lead")]
    ig = next((r for r in recs if r["src"] == "ig"), {})
    facts = {"client_name": client.full_name if client else "", "profession": (client.profession or "") if client else "",
             "workplace": (client.workplace or "") if client else "", "completed": any(r.get("done") for r in recs),
             "last_shoot": max((r["last_shoot"] for r in recs if r.get("last_shoot")), default=None),
             "lead_service": next((l.service for l in reversed(leads) if l.service), ""),
             "lead_name": next((l.name for l in reversed(leads) if l.name), ""),
             "wa_name": next((r["wa_name"] for r in recs if r.get("wa_name")), "")}
    ig_user = next((r["ig_username"] for r in recs if r.get("ig_username")), "")
    if not ig_user and client and client.instagram:
        ig_user = ig_handle(client.instagram)
    first = msgs[0][0] if msgs else None
    last = msgs[-1][0] if msgs else None
    if not msgs:  # yazışma yoxdur: client/lead yaradılma vaxtı
        ts = [aware(x.created_at) for x in ([client] if client else []) + leads]
        first, last = (min(ts), max(ts)) if ts else (None, None)
    return {"phone": own[0] if own else (found[0] if found else None), "phones_found": found,
            "ig_username": ig_user or None, "igsid": next((r["igsid"] for r in recs if r.get("igsid")), None),
            "client_id": client.id if client else None,
            "sources": sorted({r["src"] for r in recs}, key=_ORDER.get), "msgs": msgs, "msg_count": len(msgs),
            "first_contact_at": first, "last_contact_at": last, "facts": facts, "transcript": transcript(msgs)}


def transcript(msgs: list[tuple]) -> str:
    """Xronoloji mətn, gün dəyişəndə «— YYYY-MM-DD —» başlığı: ilk 5 + ortadan bərabər seçmə (≤30) + son mesajlar,
    cəmi ≤120 mesaj və ≤12000 simvol. Uzun söhbətdə keçmiş də görünsün deyə orta hissə seçmə ilə saxlanır."""
    head, rest = msgs[:HEAD_MSGS], msgs[HEAD_MSGS:]
    tail = rest[-(MAX_MSGS - HEAD_MSGS - MID_MSGS):]
    middle = rest[:len(rest) - len(tail)]
    mid = [middle[i * len(middle) // MID_MSGS] for i in range(MID_MSGS)] if len(middle) > MID_MSGS else middle
    line = lambda m: f"{m[1]}: {m[2].replace(chr(10), ' ')[:MAX_LINE]}"
    size = lambda: sum(len(line(m)) + 14 for m in head + mid + tail)
    while size() > MAX_CHARS and (mid or len(tail) > 1):
        if mid and len(mid) * 3 >= len(tail):
            mid = mid[1::2] if len(mid) > 1 else []
        else:
            tail.pop(0)
    out, day = [], None

    def add(ms: list[tuple]) -> None:
        nonlocal day
        for m in ms:
            d = m[0].astimezone(BAKU).strftime("%Y-%m-%d")
            if d != day:
                out.append(f"— {d} —")
                day = d
            out.append(line(m))

    add(head)
    if len(middle) > len(mid):
        out.append(f"[… {len(middle) - len(mid)} mesaj buraxıldı, aşağıda ortadan seçmə …]" if mid else
                   f"[… {len(middle)} mesaj buraxıldı …]")
    add(mid)
    if mid and len(middle) > len(mid):
        out.append("[… son mesajlar …]")
    add(tail)
    return "\n".join(out)


# --- AI kartı ---

CARD_SYSTEM = """Sən Y Pod podcast və video studiyasının CRM köməkçisisən. Aşağıda bir potensial və ya real müştərinin Instagram/WhatsApp yazışması verilir («Müştəri» = o, «Y Pod» = studiya). Yazışmadan həmin şəxsin kartını çıxar.

Qaydalar:
- Yalnız yazışmada və ya «Məlum məlumat» bölməsində açıq yazılanı götür. Bilmədiyin sahəni boş sətir ("") burax, heç nə uydurma.
- Hər şey Azərbaycan dilində, qısa.
- full_name: şəxsin adı. profession: peşəsi. workplace: işlədiyi yer. reason: niyə çəkiliş istəyir (məqsəd). service: hansı xidmət (podkast, Reels, studiya icarəsi, korporativ və s.). need: konkret istəyi (neçə nəfər, tarix, büdcə, montaj və s.).
- phones: yazışmada müştərinin verdiyi telefon nömrələri (siyahı; studiyanın öz nömrəsi yox).
- outcome: client (çəkiliş edib/təsdiqləyib), lead (maraqlanıb, hələ yekun yoxdur), lost (imtina edib və ya itib), other (müştəri DEYİL: studiyanın işçisi, Y Pod üçün işləyən təchizatçı/partnyor (montajçı, SMM agentliyi, mühasib və s.) və ya şəxsi/ailə kontaktı; çəkiliş gətirən və ya alan agentlik müştəridir, other deyil), unknown (bəlli deyil).
- Yazışmada günlər «— YYYY-MM-DD —» sətirləri ilə ayrılıb; tarixləri oradan götür.
- last_visit: şəxsin son real çəkilişinin/studiyaya gəlişinin günü (YYYY-MM-DD). Əlamətlər: həmin gün üçün saat razılaşdırılıb və sonra «gəldim/yoldayam», «videolar hazırdır», fayl/link göndərilməsi, çəkilişə görə təşəkkür və ya ödəniş var; «dünən çəkildik» kimi ifadədə günü hesabla. Çəkiliş baş tutmayıbsa və ya heç bir əlamət yoxdursa "".
- last_topic: son söhbətin nə haqqında olduğu və necə bitdiyi, bir qısa cümlə.
- summary: bir cümləlik xülasə.
Cavab yalnız JSON: {"full_name":"","profession":"","workplace":"","reason":"","service":"","need":"","phones":[],"outcome":"","last_visit":"","last_topic":"","summary":""}"""

_TEXT_FIELDS = {"full_name": 120, "profession": 120, "workplace": 160, "reason": 500, "service": 120, "need": 500,
                "last_topic": 300, "summary": 500}


def card_prompt(bundle: dict) -> str:
    f = bundle["facts"]
    known = [(k, v) for k, v in (("Ad", f["client_name"] or f["lead_name"] or f["wa_name"]), ("Peşə", f["profession"]),
                                 ("İş yeri", f["workplace"]), ("Lead xidməti", f["lead_service"]),
                                 ("Çəkiliş edib", "bəli" if f["completed"] else ""),
                                 ("Son çəkiliş", f["last_shoot"].astimezone(BAKU).strftime("%Y-%m-%d") if f.get("last_shoot") else ""))
             if v]
    known_text = "\n".join(f"- {k}: {v}" for k, v in known) or "- yoxdur"
    return f"Məlum məlumat:\n{known_text}\n\nYazışma:\n{bundle['transcript']}"


def parse_card(text: str) -> dict:
    """AI cavabından kart. Sətir sahələri təmizlənir, naməlum outcome → unknown. Oxunmursa ValueError."""
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", (text or "").strip(), flags=re.I)
    i, j = t.find("{"), t.rfind("}")
    if i < 0 or j <= i:
        raise ValueError("JSON tapılmadı")
    try:
        data = json.loads(t[i:j + 1])
    except ValueError as e:
        raise ValueError("JSON oxunmadı") from e
    if not isinstance(data, dict):
        raise ValueError("JSON obyekt deyil")
    card = {k: (data[k].strip()[:n] if isinstance(data.get(k), str) else "") for k, n in _TEXT_FIELDS.items()}
    raw = data.get("phones")
    raw = raw if isinstance(raw, list) else []
    card["phones"] = list(dict.fromkeys(p for v in raw for p in extract_phones(str(v))))
    o = str(data.get("outcome") or "").strip().lower()
    card["outcome"] = o if o in OUTCOMES else "unknown"
    lv = data.get("last_visit")
    card["last_visit"] = lv.strip() if isinstance(lv, str) and re.fullmatch(r"\d{4}-\d\d-\d\d", lv.strip()) else ""
    return card


# --- bazaya yazma ---

def find_person(db: DB, bundle: dict) -> Person | None:
    """Telefon, sonra igsid, sonra ig_username üzrə."""
    for col, val in ((Person.phone, bundle.get("phone")), (Person.igsid, bundle.get("igsid")),
                     (Person.ig_username, bundle.get("ig_username"))):
        if val:
            p = db.scalar(select(Person).where(col == val).order_by(Person.id).limit(1))
            if p:
                return p
    return None


def needs_card(db: DB, bundle: dict, force: bool = False) -> bool:
    """AI lazımdır: yazışma var və (force, ya kart yoxdur, ya da kartdan sonra yeni mesaj gəlib)."""
    if not bundle["msgs"]:
        return False
    p = find_person(db, bundle)
    if force or not p or not p.card_at:
        return True
    return bool(bundle["last_contact_at"] and aware(p.card_at) < bundle["last_contact_at"])


def upsert(db: DB, bundle: dict, card: dict | None, model: str | None = None) -> Person:
    """Bundle-ı (və varsa AI kartını) Person-a yazır; təkrar işlədəndə yenisini yaratmır (flush edir, commit etmir).
    Deterministik məlumat AI-dan üstündür: Client adı/peşəsi, tamamlanmış çəkiliş → client."""
    p = find_person(db, bundle)
    if not p:
        p = Person()
        db.add(p)
    f = bundle["facts"]
    p.phone = bundle["phone"] or p.phone
    p.igsid = bundle["igsid"] or p.igsid
    p.ig_username = bundle["ig_username"] or p.ig_username
    p.client_id = bundle["client_id"]
    p.sources = ",".join(bundle["sources"])
    p.msg_count = bundle["msg_count"]
    p.first_contact_at, p.last_contact_at = bundle["first_contact_at"], bundle["last_contact_at"]
    if card:
        personal = set(db_personal(db))
        phones = [x for x in bundle["phones_found"] + card["phones"] if x not in personal and x != p.phone]
        p.phones_found = ",".join(dict.fromkeys(phones))
        p.reason, p.need, p.summary = card["reason"], card["need"], card["summary"]
        p.last_topic = card.get("last_topic", "")
        p.card_model, p.card_at = model or settings.GEMINI_MODEL, now()
    else:
        p.phones_found = p.phones_found or ",".join(bundle["phones_found"])
    ai = card or {}
    p.display_name = (f["client_name"] or ai.get("full_name") or p.display_name or f["lead_name"] or f["wa_name"]
                      or (("@" + p.ig_username) if p.ig_username else "") or (("+" + p.phone) if p.phone else ""))
    p.profession = f["profession"] or ai.get("profession") or p.profession or ""
    p.workplace = f["workplace"] or ai.get("workplace") or p.workplace or ""
    p.service = f["lead_service"] or ai.get("service") or p.service or ""
    if f["completed"]:
        p.outcome = "client"
    elif card:
        p.outcome = card["outcome"]
    elif p.outcome in (None, "unknown") and f["lead_service"]:
        p.outcome = "lead"
    p.outcome = p.outcome or "unknown"
    if f.get("last_shoot"):  # deterministik: tamamlanmış çəkiliş AI təxmininin üstündədir
        p.last_visit_at = f["last_shoot"]
    elif card:
        p.last_visit_at = _visit_date(card.get("last_visit"))
    db.flush()
    return p


def _visit_date(v: str | None) -> datetime | None:
    """AI-nin «YYYY-MM-DD» tarixi → Bakı günü; yanlış və ya gələcək tarix → None."""
    try:
        d = datetime.strptime(v or "", "%Y-%m-%d").replace(tzinfo=BAKU)
    except ValueError:
        return None
    return d if d <= now() else None


def db_personal(db: DB) -> list[str]:
    return list(db.scalars(select(KnownContact.phone).where(KnownContact.kind == "personal")))
