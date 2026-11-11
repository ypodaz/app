"""Mac Contacts ixracını `known_contacts` cədvəlinə yazır (upsert, DATABASE_URL). Təkrar işlətmək olar:

    cd server && .venv/bin/python scripts/import_contacts.py kontaktlar.json --dry-run   # yalnız saylar
    cd server && DATABASE_URL=... .venv/bin/python scripts/import_contacts.py kontaktlar.json

Fayl: [[ad, [nömrələr...]], ...]. Adında «Y Pod» olan → customer (yalnız ilk ad saxlanır), qalanı → personal (ad
saxlanmır). Eyni nömrə həm customer, həm personal olsa customer qalib gəlir. Heç bir ad çap olunmur.
Silinmiş kontaktlar bazadan silinmir.
"""
import argparse
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from crm.contacts import normalize  # noqa: E402

YPOD = re.compile(r"y\s*-?\s*pod", re.I)


def first_name(name: str) -> str:
    """«Leyla Həsənova Y Pod» → «Leyla»: Y Pod hissəsi atılır, ilk söz götürülür."""
    words = [w.strip("-–—,.()|/") for w in YPOD.sub(" ", name).split()]
    return next((w for w in words if w), "")[:60]


def parse(entries: list) -> dict[str, tuple[str, str]]:
    """[[ad, [nömrələr]]] → {nömrə: (customer|personal, ilk ad)}."""
    out: dict[str, tuple[str, str]] = {}
    for name, phones in entries:
        name = str(name or "")
        row = ("customer", first_name(name)) if YPOD.search(name) else ("personal", "")
        for p in phones or []:
            p = normalize(str(p))
            if len(p) < 7:
                continue
            if p not in out or (row[0] == "customer" and out[p][0] == "personal"):
                out[p] = row
    return out


def counts(rows: dict[str, tuple[str, str]]) -> dict[str, int]:
    return {"customer": sum(k == "customer" for k, _ in rows.values()),
            "personal": sum(k == "personal" for k, _ in rows.values()),
            "xarici": sum(not p.startswith("994") for p in rows)}


def upsert(rows: dict[str, tuple[str, str]]) -> int:
    from db import SessionLocal
    from models import KnownContact
    with SessionLocal() as db:
        existing = {k.phone: k for k in db.query(KnownContact).all()}
        changed = 0
        for phone, (kind, name) in rows.items():
            k = existing.get(phone)
            if not k:
                db.add(KnownContact(phone=phone, kind=kind, first_name=name))
                changed += 1
            elif (k.kind, k.first_name) != (kind, name):
                k.kind, k.first_name = kind, name
                changed += 1
        db.commit()
        return changed


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("file")
    ap.add_argument("--dry-run", action="store_true", help="bazaya yazmır, yalnız sayları çap edir")
    args = ap.parse_args()
    rows = parse(json.loads(Path(args.file).read_text(encoding="utf-8")))
    c = counts(rows)
    print(f"nömrə: {len(rows)}  customer: {c['customer']}  personal: {c['personal']}  xarici: {c['xarici']}")
    if not args.dry_run:
        print(f"yazıldı (yeni və ya dəyişən): {upsert(rows)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
