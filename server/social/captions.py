"""aciqlamalar.md oxuyucusu: hər video üçün Instagram, TikTok, YouTube başlığı və təsviri.

Bölmə başlığı: `## NN · Gün X Səhər|Axşam — Başlıq` (başlığın sonunda ⏳ ola bilər).
Etiketdən sonra gələn ``` bloku mətndir. Facebook mətni Instagram ilə eynidir (ayrıca saxlanmır).
"""
import re
import unicodedata
from pathlib import Path

HEADER_RE = re.compile(r"^## (\d+) · Gün (\d+) (Səhər|Axşam) — (.+?)\s*$")
LABELS = {"Instagram:": "instagram", "TikTok:": "tiktok", "YouTube başlıq:": "youtube_title",
          "YouTube təsvir:": "youtube_description"}
SLOTS = {"Səhər": "seher", "Axşam": "axsam"}


def parse_text(raw: str) -> tuple[list[dict], list[str]]:
    """(bölmələr, xətalar). Boş və ya çatışmayan blok xətalar siyahısına düşür, bölmə yenə də qaytarılır."""
    sections, errors = [], []
    cur = None
    label = None  # gözlənilən blokun açarı
    in_block = False
    buf: list[str] = []
    for line in unicodedata.normalize("NFC", raw).splitlines():
        if not in_block:
            m = HEADER_RE.match(line)
            if m:
                title = m[4].replace("⏳", "").strip()
                cur = {"number": int(m[1]), "day": int(m[2]), "slot": SLOTS[m[3]], "title": title,
                       **{k: "" for k in LABELS.values()}}
                sections.append(cur)
                label = None
            elif line.startswith("## "):
                errors.append(f"başlıq tanınmadı: {line[:60]}")
                cur = label = None
            elif cur is not None and line.strip() in LABELS:
                label = LABELS[line.strip()]
            elif cur is not None and label and line.strip() == "```":
                in_block, buf = True, []
        elif line.strip() == "```":
            cur[label] = "\n".join(buf).strip()
            in_block, label = False, None
        else:
            buf.append(line)
    if in_block:
        errors.append("bağlanmamış ``` bloku faylın sonunda")
    for s in sections:
        for key in LABELS.values():
            if not s[key]:
                errors.append(f"{s['number']:02d}: «{key}» boşdur və ya yoxdur")
    numbers = [s["number"] for s in sections]
    for n in sorted({n for n in numbers if numbers.count(n) > 1}):
        errors.append(f"{n:02d}: nömrə təkrarlanır")
    return sections, errors


def parse_file(path: Path) -> tuple[list[dict], list[str]]:
    return parse_text(Path(path).read_text(encoding="utf-8"))
