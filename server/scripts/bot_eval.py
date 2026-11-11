"""WhatsApp botunu sınaq ssenariləri ilə yoxlayır və nəticəni Biznes CRM/bot-sinaq.md-yə yazır.

    cd server && .venv/bin/python scripts/bot_eval.py [--limit N] [--mock] [--out fayl.md]

Real rejimdə Gemini açarı settings-dən gəlir, sorğular arasında 1 saniyə gözlənir; 429 və ya 403 olarsa dayanır və
bunu fayla yazır. `--mock` saxta modeldir (testlər üçün). Ssenarilər `/api/admin/bot/test` ilə eyni `bot.simulate`
funksiyası ilə işlənir; baza müvəqqəti yaddaşdadır (FAQ boş, canlı baza oxunmur).
"""
import argparse
import json
import re
import sys
import time
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from sqlalchemy import create_engine  # noqa: E402
from sqlalchemy.orm import sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

import ai  # noqa: E402
import settings  # noqa: E402
from crm import bot, bot_prompt  # noqa: E402
from db import Base  # noqa: E402

CRM_DIR = Path.home() / "Claude Projects/Biznes CRM"
SCENARIOS = CRM_DIR / "tapsiriqlar/bot-ssenariler.json"
OUT = CRM_DIR / "bot-sinaq.md"

EN_WORDS = {"the", "you", "your", "our", "we", "is", "are", "and", "to", "of", "hello", "hi", "studio", "located",
            "price", "per", "hour", "welcome", "can", "please", "address", "open", "team", "will"}
TR_WORDS = {"merhaba", "fiyat", "için", "çekim", "evet", "size", "ve", "gün", "tamam", "yardımcı", "bir", "olarak",
            "stüdyo", "saat", "fiyatı", "ekibimiz", "çok", "değil", "mı", "mi"}
AZ_WORDS = {"və", "üçün", "siz", "salam", "çəkiliş", "xidmət", "saat", "komanda", "montaj", "sizə", "olar", "bəli",
            "yoxlayıb", "ünvan", "gün", "təşəkkür"}


def detect_lang(text: str) -> str | None:
    """Sadə evristika: kiril → ru; ə hərfi və ya az sözləri → az; türk/ingilis söz işarələri."""
    letters = [c for c in text if c.isalpha()]
    if letters and sum("Ѐ" <= c <= "ӿ" for c in letters) / len(letters) > 0.3:
        return "ru"
    words = set(re.findall(r"[^\W\d_]+", text.lower()))
    if "ə" in text.lower() or len(words & AZ_WORDS) >= 2:
        return "az"
    scores = {"tr": len(words & TR_WORDS), "en": len(words & EN_WORDS), "az": len(words & AZ_WORDS)}
    best = max(scores, key=scores.get)
    return best if scores[best] else None


def sentences(text: str) -> int:
    return len([p for p in re.split(r"[.!?]+(?:\s+|$)", text.strip()) if p.strip()])


def check(res: dict, expect: dict, global_bad: list[str]) -> list[str]:
    """Pozuntuların siyahısı (boşdursa ssenari keçdi)."""
    bad = []
    reply = res["reply"]
    low = reply.lower()
    if res.get("filtered"):
        bad.append(f"filtrə düşdü: {res['filtered']}")
    if "handoff" in expect and res["handoff"] != expect["handoff"]:
        bad.append(f"handoff={res['handoff']} (gözlənən {expect['handoff']})")
    if "handoff_reason" in expect and res["handoff_reason"] != expect["handoff_reason"]:
        bad.append(f"handoff_reason={res['handoff_reason']} (gözlənən {expect['handoff_reason']})")
    if "language" in expect:
        lang = detect_lang(reply) or res.get("language")
        if lang != expect["language"]:
            bad.append(f"dil={lang} (gözlənən {expect['language']})")
    if expect.get("must_contain_any") and not any(w.lower() in low for w in expect["must_contain_any"]):
        bad.append("heç biri yoxdur: " + ", ".join(expect["must_contain_any"]))
    gb = [w for w in global_bad if not (expect.get("language") == "tr" and w in ("ekip", "kesin", " için"))]
    for w in [*expect.get("must_not_contain", []), *gb]:
        if w.lower() in low:
            bad.append(f"qadağan: «{w.strip()}»")
    if "max_sentences" in expect and sentences(reply) > expect["max_sentences"]:
        bad.append(f"{sentences(reply)} cümlə (limit {expect['max_sentences']})")
    if "max_questions" in expect and reply.count("?") > expect["max_questions"]:
        bad.append(f"{reply.count('?')} sual (limit {expect['max_questions']})")
    for k, v in (expect.get("lead") or {}).items():
        if res["lead"].get(k) != v:
            bad.append(f"lead.{k}={res['lead'].get(k)} (gözlənən {v})")
    if "unanswered" in expect and bool(res["unanswered_question"]) != expect["unanswered"]:
        bad.append(f"unanswered_question={'var' if res['unanswered_question'] else 'yoxdur'}")
    if re.search(r"\d{12,}", re.sub(r"[\s\-]", "", reply)):
        bad.append("kart nömrəsi ehtimalı (12+ rəqəm)")
    return bad


def mock_generate(system, contents, tools=None, max_tokens=900):
    """Saxta model: hər suala eyni qısa cavab (yalnız boru kəmərini yoxlamaq üçün)."""
    out = {"reply": "Salam! Mən Y Pod-un virtual köməkçisiyəm. Podkast çəkilişi 70 AZN-dən başlayır.", "language": "az",
           "handoff": False, "handoff_reason": None, "intent": "qiymet",
           "lead": {"name": None, "service": "podkast", "preferred_date": None, "people": None, "cameras": None,
                    "editing": None}, "stage": "maraqlanir", "unanswered_question": None}
    return {"content": {"parts": [{"text": json.dumps(out, ensure_ascii=False)}]}, "usage": (0, 0)}


_last_status = {"code": None}


def _track_status(real_post):
    def post(*a, **k):
        r = real_post(*a, **k)
        _last_status["code"] = r.status_code
        return r
    return post


def esc(v: str, n: int = 300) -> str:
    v = " ⏎⏎ ".join(" ".join(p.split()) for p in str(v).split("\n\n"))  # ⏎⏎ = iki ayrı mesaj
    return (v[:n] + "…" if len(v) > n else v).replace("|", "\\|")


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--mock", action="store_true")
    ap.add_argument("--limit", type=int)
    ap.add_argument("--out", type=Path, default=OUT)
    ap.add_argument("--scenarios", type=Path, default=SCENARIOS)
    args = ap.parse_args(argv)

    data = json.loads(args.scenarios.read_text(encoding="utf-8"))
    scenarios = data["scenarios"][:args.limit] if args.limit else data["scenarios"]
    global_bad = data.get("global_must_not_contain", [])
    engine = create_engine("sqlite://", poolclass=StaticPool, connect_args={"check_same_thread": False})
    Base.metadata.create_all(engine)
    if not args.mock and not settings.GEMINI_API_KEY:
        print("GEMINI_API_KEY yoxdur")
        return 2
    orig_generate, orig_post = ai.generate, ai.httpx.post
    ai.generate = mock_generate if args.mock else orig_generate
    ai.httpx.post = orig_post if args.mock else _track_status(orig_post)
    try:
        return run(args, scenarios, data, global_bad, engine)
    finally:  # testlərdə sızmasın
        ai.generate, ai.httpx.post = orig_generate, orig_post


def run(args, scenarios, data, global_bad, engine) -> int:

    rows, passed, stopped = [], 0, None
    with sessionmaker(engine)() as db:
        for i, sc in enumerate(scenarios):
            if i and not args.mock:
                time.sleep(1)
            _last_status["code"] = None
            try:
                res = bot.simulate(db, [(h["role"], h["text"]) for h in sc.get("history", [])], sc["message"],
                                   now_dt=bot.parse_now(sc.get("now")), slots_list=sc.get("slots"),
                                   first_message=sc.get("first_message", False))
            except ai.AiError as e:
                if _last_status["code"] in (429, 403):
                    stopped = f"HTTP {_last_status['code']} səbəbi ilə ssenari {sc['id']}-də dayandırıldı " \
                              f"({len(scenarios) - i} ssenari işlənmədi)"
                    break
                rows.append((sc, ["AI xətası: " + str(e)], ""))
                continue
            bad = check(res, sc.get("expect", {}), global_bad)
            passed += not bad
            rows.append((sc, bad, res["reply"]))

    done = len(rows)
    lines = [f"# Bot sınağı (prompt v{bot_prompt.VERSION})", "",
             f"Tarix: {datetime.now():%Y-%m-%d %H:%M}. Model: {'saxta (--mock)' if args.mock else settings.GEMINI_MODEL}. "
             f"Ssenari: {done}/{len(data['scenarios'])}.", ""]
    if stopped:
        lines += [f"**⚠ {stopped}.**", ""]
    lines += ["| id | ad | nəticə | səbəb | botun cavabı |", "|---|---|---|---|---|"]
    for sc, bad, reply in rows:
        lines.append(f"| {sc['id']} | {esc(sc['name'], 60)} | {'✅ keçdi' if not bad else '❌ düşdü'} | "
                     f"{esc('; '.join(bad), 200)} | {esc(reply)} |")
    pct = round(100 * passed / done) if done else 0
    lines += ["", f"**Ümumi: {passed}/{done} keçdi ({pct}%).**", ""]
    args.out.write_text("\n".join(lines), encoding="utf-8")
    print(f"{passed}/{done} keçdi ({pct}%) → {args.out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
