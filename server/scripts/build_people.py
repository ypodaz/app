"""Müştəri bazasını qurur: IG arxivi, WhatsApp, app və leadlərdən şəxsləri birləşdirir, Gemini ilə kart çıxarır.

    railway connect Postgres --tunnel-only --port 15432   # ayrı terminalda, DATABASE_URL buradan gəlir
    cd server && DATABASE_URL=... railway run .venv/bin/python scripts/build_people.py \\
        --ig-archive /yol/ig-arxiv.json [--limit N] [--dry-run] [--force]

--dry-run: AI çağırmır, bazaya yazmır; yalnız say çıxarır (ad, telefon, mətn çıxmır).
Kartı olan və kartdan sonra yeni mesajı olmayan şəxs keçilir (--force: hamısı yenidən).
GEMINI_API_KEY mühitdən gəlir. Arxiv faylı repoya düşməsin.
"""
import argparse
import json
import sys
import time
from collections import Counter
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import ai  # noqa: E402
from crm import people  # noqa: E402
from db import SessionLocal  # noqa: E402

PAUSE = 0.5  # çağırışlar arası saniyə


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--ig-archive", type=Path)
    ap.add_argument("--limit", type=int)
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--force", action="store_true")
    a = ap.parse_args()
    archive = json.loads(a.ig_archive.read_text(encoding="utf-8")) if a.ig_archive else None
    with SessionLocal() as db:
        bundles = people.collect(db, archive)
        todo = [b for b in bundles if people.needs_card(db, b, a.force)]
        if a.limit:
            todo = todo[:a.limit]
        by_src = Counter("+".join(b["sources"]) for b in bundles)
        print(f"Şəxs: {len(bundles)}; AI lazım: {len(todo)}")
        for k, n in sorted(by_src.items()):
            print(f"  {k}: {n}")
        if a.dry_run:
            print(f"Təxmini giriş: {sum(len(people.card_prompt(b)) for b in todo)} simvol")
            return
        for b in bundles:  # yazışması olmayanlar AI-sız yazılır
            if not b["msgs"]:
                people.upsert(db, b, None)
        db.commit()
        done = failed = chars_in = chars_out = 0
        for b in todo:
            prompt = people.card_prompt(b)
            try:
                out = ai.generate(people.CARD_SYSTEM, [{"role": "user", "parts": [{"text": prompt}]}],
                                  max_tokens=1000, json_mode=True)
                text = ai.text_of(out["content"])
                card = people.parse_card(text)
            except (ai.AiError, ValueError):
                failed += 1
                continue
            chars_in += len(prompt) + len(people.CARD_SYSTEM)
            chars_out += len(text)
            people.upsert(db, b, card)
            db.commit()
            done += 1
            if done % 10 == 0:
                print(f"  {done}/{len(todo)}")
            time.sleep(PAUSE)
        print(f"Hazır: {done}, xəta: {failed}; təxmini giriş {chars_in}, çıxış {chars_out} simvol")


if __name__ == "__main__":
    main()
