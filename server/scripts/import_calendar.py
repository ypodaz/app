"""Keçmiş çəkilişləri Apple təqvimindən app-a köçürür (bir dəfəlik, təkrar işə salmaq təhlükəsizdir).

    railway connect Postgres --tunnel-only --port 15432   # ayrı terminalda
    cd server && railway run .venv/bin/python scripts/import_calendar.py --old-ics-file /yol/kohne-teqvim.txt \\
        --unmatched /yol/teqvim-uygunlasmayan.csv [--apply]

Mənbə: indiki ICS (settings.APPLE_CAL_ICS_URL) + köhnə ICS (fayldakı ilk webcal/https linki; link çap olunmur).
Yalnız keçmiş hadisələr; çəkiliş sözü olmayanlar yalnız sahibkar təsdiqləsə yazılır; «Şahin» (sub-icarə) çıxır; app-da ±60 dəq içində çəkiliş varsa keçilir.
Ad yalnız əmin olanda müştəriyə bağlanır (crm.calendar_import.match); qalanı CSV-yə düşür (chmod 600, repoya yox).
CSV-də «telefon» təklifdir (ad «Y Pod» kontaktlarında tək olanda). Sahibkar yoxlayıb «bağla» sütununa «+» qoyur
(telefonu özü də yaza bilər), sonra: --confirm həmin.csv --unmatched yeni.csv --apply.
Yazılan çəkiliş: completed, keşbek yazılmır, bildiriş, rəy sorğusu, montaj növbəsi yoxdur.
--apply olmadan heç nə yazılmır, yalnız saylar çıxır (ad, telefon, başlıq çap olunmur).
"""
import argparse
import csv
import os
import re
import sys
from collections import Counter
from datetime import datetime, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import httpx  # noqa: E402
import icalendar  # noqa: E402
import recurring_ical_events  # noqa: E402
from sqlalchemy import select  # noqa: E402

import settings  # noqa: E402
from auth import new_card_code  # noqa: E402
from crm import calendar_import as ci  # noqa: E402
from crm.contacts import normalize  # noqa: E402
from db import SessionLocal, aware, now  # noqa: E402
from models import Client, KnownContact, Person, Shoot  # noqa: E402
from views import BAKU  # noqa: E402

NOTE = "Təqvim arxivi (köçürülüb)"
SOURCE = "calendar-archive"


def _load(url: str):
    url = "https://" + url[len("webcal://"):] if url.startswith("webcal://") else url
    r = httpx.get(url, timeout=60, follow_redirects=True)
    r.raise_for_status()
    return icalendar.Calendar.from_ical(r.content)


def events(urls: list[str], until: datetime) -> list[tuple[datetime, datetime, str]]:
    """Vaxtlı, ləğv olunmamış, 0–10 saatlıq hadisələr; eyni (başlanğıc, son, başlıq) bir dəfə."""
    seen: dict = {}
    for url in urls:
        for e in recurring_ical_events.of(_load(url)).between(datetime(2020, 1, 1, tzinfo=BAKU), until):
            a, b = e.start, e.end
            if not isinstance(a, datetime) or str(e.get("STATUS", "")).upper() == "CANCELLED":
                continue
            a = a.astimezone(BAKU) if a.tzinfo else a.replace(tzinfo=BAKU)
            b = (b.astimezone(BAKU) if b.tzinfo else b.replace(tzinfo=BAKU)) if isinstance(b, datetime) else a
            if not timedelta(0) < b - a <= timedelta(hours=10) or b > until:
                continue
            title = " ".join(str(e.get("SUMMARY", "")).split())
            seen.setdefault((a, b, title.lower()), (a, b, title))
    return sorted(seen.values())


def name_index(db) -> tuple[list[tuple[str, str]], list[tuple[str, str]]]:
    """(tam adlar, «Y Pod» kontaktlarının adları). Kontaktlarda soyad saxlanmır, ona görə onlar yalnız təklifdir."""
    idx = [(ci.fold(c.full_name), normalize(c.phone)) for c in db.scalars(select(Client)) if c.phone]
    idx += [(ci.fold(p.display_name), p.phone) for p in db.scalars(select(Person).where(Person.phone.is_not(None)))]
    firsts = [(ci.fold(re.sub(r"y\s*-?\s*pod", " ", k.first_name, flags=re.I)), k.phone)
              for k in db.scalars(select(KnownContact).where(KnownContact.kind == "customer"))]
    return [(n, p) for n, p in idx if n and p], [(n, p) for n, p in firsts if n and p]


def confirmed(path: Path | None) -> dict[tuple[str, str, str], str]:
    """Sahibkarın yoxladığı CSV: «bağla» sütununda «+» olan sətir → telefon (təklif və ya özü yazdığı)."""
    if not path or not path.exists():
        return {}
    out = {}
    with open(path, encoding="utf-8") as f:
        for r in csv.DictReader(f):
            if (r.get("bağla") or "").strip() == "+" and normalize(r.get("telefon")):
                out[(r["tarix"], r["saat"], r["başlıq"])] = normalize(r["telefon"])
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--old-ics-file", type=Path)
    ap.add_argument("--unmatched", type=Path, required=True)
    ap.add_argument("--confirm", type=Path, help="sahibkarın «bağla»=«+» qoyduğu CSV (əvvəlki --unmatched)")
    ap.add_argument("--apply", action="store_true")
    a = ap.parse_args()
    urls = [settings.APPLE_CAL_ICS_URL.strip()] if settings.APPLE_CAL_ICS_URL.strip() else []
    if a.old_ics_file:
        m = re.search(r"(?:webcal|https)://\S+", a.old_ics_file.read_text(encoding="utf-8"))
        if m:
            urls.append(m.group(0))
    t = now()
    evs = events(urls, t)
    stat: Counter = Counter()
    unmatched, extra = [], []
    ok = confirmed(a.confirm)
    with SessionLocal() as db:
        idx, firsts = name_index(db)
        app_starts = [aware(s) for s in db.scalars(select(Shoot.starts_at))]
        clients = {normalize(c.phone): c for c in db.scalars(select(Client)) if c.phone}
        for start, end, title in evs:
            stat["hadisə"] += 1
            if ci.is_skipped(title):
                stat["şahin (sub-icarə)"] += 1
                continue
            day, hm = start.strftime("%Y-%m-%d"), start.strftime("%H:%M")
            if any(abs(s - start) <= timedelta(minutes=60) for s in app_starts):
                stat["app-da artıq var"] += 1
                continue
            info = ci.parse(title)
            if not ci.is_shoot(title) and (day, hm, title) not in ok:
                stat["çəkiliş sözü yoxdur (CSV-nin sonunda)"] += 1
                extra.append([day, hm, int((end - start).total_seconds() // 60), title, "çəkiliş sözü yoxdur",
                              ci.suggest(info["name_tokens"], firsts) or "", ""])
                continue
            phone, why = ci.match(info["name_tokens"], idx)
            if not phone and (day, hm, title) in ok:
                phone, why = ok[(day, hm, title)], "sahibkar təsdiqlədi"
                stat["sahibkarın təsdiqi ilə"] += 1
            if not phone:
                stat[f"uyğunlaşmadı: {why}"] += 1
                hint = ci.suggest(info["name_tokens"], firsts)
                stat["təklif var"] += bool(hint)
                unmatched.append([day, hm, int((end - start).total_seconds() // 60), title, why, hint or "", ""])
                continue
            stat["yazılır"] += 1
            if not a.apply:
                continue
            client = clients.get(phone)
            if client is None:
                name = " ".join(w.capitalize() for w in info["name_tokens"][:2])
                client = Client(full_name=name, phone=phone, card_code=new_card_code(),
                                winback_at=t, cashback_nudge_at=t, review_asked_at=t)
                db.add(client)
                db.flush()
                clients[phone] = client
                stat["yeni müştəri"] += 1
            minutes = ci.round_duration((end - start).total_seconds() / 60)
            total = (info["price"] or 0) * 100
            db.add(Shoot(client_id=client.id, kind=info["kind"], tag=info["tag"], location="studio",
                         starts_at=start, duration_min=minutes, prep_min=0, cameras=info["cameras"],
                         title=title[:120], note=NOTE, source_note=SOURCE, status="completed", production="none",
                         delivered_at=end, feedback_asked_at=t, reminded_at=t, closed_at=end, total=total,
                         price_base=total))
            app_starts.append(start)
        if a.apply:
            db.commit()
    a.unmatched.parent.mkdir(parents=True, exist_ok=True)
    with open(a.unmatched, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["tarix", "saat", "dəqiqə", "başlıq", "səbəb", "telefon", "bağla"])
        w.writerows(unmatched + extra)
    os.chmod(a.unmatched, 0o600)
    print("Rejim:", "YAZILDI" if a.apply else "dry-run (heç nə yazılmadı)")
    for k, n in sorted(stat.items()):
        print(f"  {k}: {n}")


if __name__ == "__main__":
    main()
