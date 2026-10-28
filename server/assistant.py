"""Adminin səsli köməkçisi: Gemini-nin alət çağırışlarını icra edir.

Oxuyan alətlər (find_clients, list_shoots) burada işləyir. Yazan alətlər heç nə yazmır: hər biri
«təklif» qaytarır — admin API-sinin hansı ünvanına hansı body ilə müraciət ediləcəyi və insan dilində
xülasə. Admin ekranda «Təsdiqlə» basanda frontend həmin sorğunu göndərir, yoxlamanı mövcud route-lar edir.
"""

from datetime import date, datetime, time, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import ai
import booking
import money
from db import aware, now
from models import Block, Client, Shoot
from views import BAKU, day_bounds, payment_line

MAX_ROUNDS = 6
KIND = {"shoot": "Çəkiliş", "reels_pack": "Reels paketi", "studio_rent": "Studiya icarəsi"}
TAG = {"podcast": "Podcast", "reels": "Reels", "other": "Digər"}
_FOLD = str.maketrans("əıöüşçğ", "eiouscg")


def _fold(s: str) -> str:
    return s.casefold().translate(_FOLD)


def _azn(v) -> int:
    return round(float(v) * 100)


def _when(d: str, hm: str) -> datetime:
    try:
        return datetime.combine(date.fromisoformat(d), time.fromisoformat(hm), BAKU)
    except (TypeError, ValueError) as e:
        raise booking.Rejected("Tarix və ya saat başa düşülmədi") from e


def _label(dt: datetime) -> str:
    t = aware(dt).astimezone(BAKU)
    return f"{ai.WD[t.weekday()]} {t:%d.%m} · {t:%H:%M}"


class Run:
    def __init__(self, db: DB):
        self.db = db
        self.proposals: list[dict] = []

    def _propose(self, action: str, method: str, path: str, body: dict, summary: str, warning: str = "") -> dict:
        self.proposals.append({"index": len(self.proposals), "action": action, "method": method, "path": path,
                               "body": body, "summary": summary, "warning": warning})
        return {"ok": True, "proposal_index": len(self.proposals) - 1, "summary": summary}

    def _client(self, cid) -> Client:
        c = self.db.get(Client, int(cid)) if cid is not None else None
        if not c:
            raise booking.Rejected("Müştəri tapılmadı, əvvəl find_clients çağır")
        return c

    def _shoot(self, sid) -> Shoot:
        s = self.db.get(Shoot, int(sid))
        if not s:
            raise booking.Rejected("Çəkiliş tapılmadı, əvvəl list_shoots çağır")
        return s

    # --- alətlər ---

    def find_clients(self, query: str = "") -> dict:
        q, digits = _fold(query.strip()), "".join(ch for ch in query if ch.isdigit())
        hits = []
        for c in self.db.scalars(select(Client).order_by(Client.full_name)):
            name = _fold(c.full_name)
            phone = "".join(ch for ch in c.phone if ch.isdigit())
            if (q and (q in name or all(w in name for w in q.split()))) or (len(digits) >= 4 and digits in phone):
                hits.append({"client_id": c.id, "full_name": c.full_name, "phone": c.phone})
        return {"clients": hits[:10], "count": len(hits)}

    def list_shoots(self, date: str = "") -> dict:
        try:
            d = datetime.fromisoformat(date).date()
        except ValueError:
            return {"error": "Tarix YYYY-MM-DD olmalıdır"}
        a, b = day_bounds(d)
        rows = self.db.scalars(select(Shoot).where(Shoot.starts_at >= a, Shoot.starts_at < b)
                               .order_by(Shoot.starts_at)).all()
        names = {c.id: c.full_name for c in self.db.scalars(select(Client).where(
            Client.id.in_({s.client_id for s in rows})))}
        out = [{"shoot_id": s.id, "client": names[s.client_id], "start": f"{aware(s.starts_at).astimezone(BAKU):%H:%M}",
                "duration_min": s.duration_min, "kind": s.kind, "status": s.status, "payment": payment_line(s),
                "deposit_expected_azn": s.deposit_expected / 100} for s in rows]
        blocks = [{"block_id": bl.id, "start": f"{aware(bl.starts_at).astimezone(BAKU):%H:%M}",
                   "end": f"{aware(bl.ends_at).astimezone(BAKU):%H:%M}", "reason": bl.reason}
                  for bl in self.db.scalars(select(Block).where(Block.starts_at < b, Block.ends_at > a))]
        return {"shoots": out, "blocks": blocks}

    def propose_create_client(self, full_name: str = "", phone: str = "") -> dict:
        full_name = full_name.strip()
        if len(full_name) < 2:
            return {"error": "Ad lazımdır"}
        same = self.find_clients(full_name)["clients"]
        warn = f"Bu adda müştəri artıq var: {same[0]['full_name']}" if same else ""
        return self._propose("create_client", "POST", "/admin/clients", {"full_name": full_name, "phone": phone.strip()},
                             f"Yeni müştəri: {full_name}" + (f" · {phone.strip()}" if phone.strip() else ""), warn)

    def propose_update_client(self, client_id=None, full_name=None, phone=None, notes=None) -> dict:
        c = self._client(client_id)
        body = {k: v.strip() for k, v in (("full_name", full_name), ("phone", phone), ("notes", notes)) if v}
        if not body:
            return {"error": "Nəyi dəyişmək lazım olduğu deyilməyib"}
        label = {"full_name": "ad", "phone": "telefon", "notes": "qeyd"}
        parts = ", ".join(f"{label[k]}: {getattr(c, k) or '—'} → {v}" for k, v in body.items())
        return self._propose("update_client", "PATCH", f"/admin/clients/{c.id}", body, f"{c.full_name}: {parts}")

    def propose_create_shoot(self, date: str = "", start: str = "", end: str | None = None, duration_min=None,
                             client_id=None, new_client_index=None, kind="shoot", tag="podcast", location="studio",
                             address=None, cameras=1, editing=False, reels_count=0, discount_azn=None,
                             discount_percent=None, discount_note=None, prep_min=15, wrap_min=0, note=None,
                             title=None) -> dict:
        starts = _when(date, start)
        if end:
            duration = int((_when(date, end) - starts).total_seconds() // 60)
        else:
            duration = int(duration_min or 60)
        if kind == "studio_rent":
            cameras, editing, reels_count, location, tag = 0, False, 0, "studio", "other"
        if kind == "reels_pack":
            editing, reels_count, tag = False, 0, "reels"
        if new_client_index is not None:
            idx = int(new_client_index)
            if not (0 <= idx < len(self.proposals) and self.proposals[idx]["action"] == "create_client"):
                return {"error": "new_client_index yanlışdır"}
            ref, who = {"$ref": idx}, self.proposals[idx]["body"]["full_name"]
        else:
            c = self._client(client_id)
            ref, who = c.id, c.full_name
        try:
            gross = money.price(kind=kind, location=location, cameras=int(cameras), duration_min=duration,
                                editing=bool(editing), reels_count=int(reels_count or 0)).gross
            discount = (money.percent(gross, int(round(float(discount_percent)))) if discount_percent
                        else _azn(discount_azn) if discount_azn else 0)
            p = money.price(kind=kind, location=location, cameras=int(cameras), duration_min=duration,
                            editing=bool(editing), reels_count=int(reels_count or 0), discount=discount)
        except ValueError as e:
            return {"error": str(e)}
        body = {"client_id": ref, "starts_at": starts.isoformat(), "duration_min": duration, "kind": kind, "tag": tag,
                "location": location, "address": address, "cameras": int(cameras), "editing": bool(editing),
                "reels_count": int(reels_count or 0), "discount": discount,
                "discount_note": discount_note if discount else None, "prep_min": int(prep_min),
                "wrap_min": int(wrap_min), "note": note, "title": title}
        what = KIND[kind] + (f" · {TAG[tag]}" if kind == "shoot" else "")
        extra = []
        if kind == "shoot":
            extra.append(f"{cameras} kamera" + (" · sizin məkanda" if location == "onsite" else ""))
            if editing:
                extra.append("montaj" + (f" + {reels_count} Reels" if reels_count else ""))
        end_t = starts + timedelta(minutes=duration)
        money_part = money.fmt(p.total) + (f" (endirim {money.fmt(discount)})" if discount else "")
        summary = (f"{who} · {_label(starts)}–{end_t:%H:%M} · {what}" + "".join(f" · {x}" for x in extra)
                   + f" · {money_part}, beh {money.fmt(money.deposit_expected(p.total, 0, False))}")
        clash = booking.conflicts(self.db, starts_at=starts, duration_min=duration, prep_min=int(prep_min),
                                  wrap_min=int(wrap_min))
        warn = f"Bu vaxt {len(clash)} başqa qeydlə üst-üstə düşür (hazırlıq/yığışdırma daxil)" if clash else ""
        return self._propose("create_shoot", "POST", "/admin/shoots", body, summary, warn)

    def propose_shoot_action(self, shoot_id=None, action="", amount_azn=None, duration_min=None, paid_method=None,
                             new_date=None, new_start=None) -> dict:
        s = self._shoot(shoot_id)
        who = self.db.get(Client, s.client_id).full_name
        head = f"{who} · {_label(s.starts_at)}"
        if s.status != "confirmed":
            return {"error": "Bu çəkiliş artıq bağlanıb və ya ləğv olunub"}
        if action == "deposit":
            amount = _azn(amount_azn) if amount_azn else s.deposit_expected
            return self._propose("deposit", "POST", f"/admin/shoots/{s.id}/deposit", {"amount": amount},
                                 f"{head}: beh alındı {money.fmt(amount)}")
        if action == "close":
            dur = int(duration_min or s.duration_min)
            body = {"duration_min": dur, "paid_method": paid_method or "cash"}
            return self._propose("close", "POST", f"/admin/shoots/{s.id}/close", body,
                                 f"{head}: çəkilişi bağla ({money.fmt_hours(dur)}, "
                                 f"{'kart' if paid_method == 'card' else 'nağd'})")
        if action == "cancel":
            window = money.cancel_window(aware(s.starts_at), now())
            c = money.cancellation(window=window, deposit_paid=s.deposit_amount if s.deposit_received_at else 0,
                                   cashback_used=s.cashback_used)
            note = "24 saatdan çox qalıb" if window == "gt24" else "24 saatdan az qalıb"
            return self._propose("cancel", "POST", f"/admin/shoots/{s.id}/cancel", {},
                                 f"{head}: ləğv et · {note} · qaytarılacaq {money.fmt(c.refund)}, "
                                 f"tutulur {money.fmt(c.retained)}")
        if action == "no_show":
            return self._propose("no_show", "POST", f"/admin/shoots/{s.id}/no-show", {}, f"{head}: gəlmədi")
        if action == "reschedule":
            if not new_start:
                return {"error": "Yeni saat lazımdır"}
            d = new_date or f"{aware(s.starts_at).astimezone(BAKU):%Y-%m-%d}"
            ns = _when(d, new_start)
            return self._propose("reschedule", "POST", f"/admin/shoots/{s.id}/reschedule",
                                 {"starts_at": ns.isoformat()}, f"{head}: vaxtı dəyiş → {_label(ns)}")
        return {"error": "Naməlum əməliyyat"}

    def propose_block(self, date: str = "", start: str = "", end: str = "", reason=None) -> dict:
        a, b = _when(date, start), _when(date, end)
        if b <= a:
            return {"error": "Bitmə başlanğıcdan sonra olmalıdır"}
        return self._propose("block", "POST", "/admin/blocks",
                             {"starts_at": a.isoformat(), "ends_at": b.isoformat(), "reason": reason},
                             f"Vaxtı blokla · {_label(a)}–{b:%H:%M}" + (f" · {reason}" if reason else ""))

    def call(self, name: str, args: dict) -> dict:
        fn = getattr(self, name, None) if name in {t["name"] for t in ai.ADMIN_TOOLS} else None
        if not fn:
            return {"error": "Belə alət yoxdur"}
        try:
            return fn(**args)
        except booking.Rejected as e:
            return {"error": str(e)}
        except (TypeError, ValueError):
            return {"error": "Parametrlər başa düşülmədi"}


def run(db: DB, history: list[dict], text: str = "", audio: tuple[str, str] | None = None) -> dict:
    """history: [{"role": "user"|"model", "text": ...}]. audio: (mime, base64).
    Cavab: {"reply", "proposals", "usage"}."""
    system = ai.ADMIN_RULES + "\n\n" + ai.admin_context()
    if audio:
        system += "\nSəsli əmrdə cavabın ilk sətrinə eşitdiyini yaz: «Eşitdim: …»."
    contents = [{"role": h["role"], "parts": [{"text": h["text"]}]} for h in history[-10:]]
    parts = [{"text": text}] if text else []
    if audio:
        parts.append({"inlineData": {"mimeType": audio[0], "data": audio[1]}})
    contents.append({"role": "user", "parts": parts})
    r, used_in, used_out = Run(db), 0, 0
    for _ in range(MAX_ROUNDS):
        out = ai.generate(system, contents, ai.ADMIN_TOOLS, max_tokens=2048)
        used_in, used_out = used_in + out["usage"][0], used_out + out["usage"][1]
        calls = [p["functionCall"] for p in out["content"].get("parts", []) if "functionCall" in p]
        if not calls:
            return {"reply": ai.text_of(out["content"]), "proposals": r.proposals, "usage": (used_in, used_out)}
        contents.append(out["content"])
        contents.append({"role": "user", "parts": [
            {"functionResponse": {"name": c["name"], "response": r.call(c["name"], c.get("args") or {})}}
            for c in calls]})
    return {"reply": "Əmr çox mürəkkəb oldu, daha qısa deyin.", "proposals": r.proposals,
            "usage": (used_in, used_out)}
