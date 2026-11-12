"""Apple təqvimindəki keçmiş çəkilişləri app-a köçürmək üçün saf məntiq (scripts/import_calendar.py).
Başlıqdan iş növü, kamera, qiymət və ad çıxarılır; ad yalnız əmin olanda (2+ söz, bir telefon) müştəriyə bağlanır.
Şəbəkə və baza işi skriptdədir. Başlıqlar loglanmır."""
import re

SHOOT_RE = re.compile(r"çəkiliş|cekilis|çekiliş|podkas|podcast|reels?\b|rils|kamera|intervü|interviu|müsahib|icarə|"
                      r"green\s*scr|studiya|video", re.I)
SKIP_RE = re.compile(r"şahin|sahin", re.I)  # sub-icarə: müştəri çəkilişi deyil (sahibkar, 2026-11-13)
OWN_RE = re.compile(r"y\s*-?\s*pod\s*$", re.I)  # sahibkarın öz çəkilişləri başlığı «… Y Pod» ilə bitir
RENT_RE = re.compile(r"icarə|özü\s*çək", re.I)
REELS_RE = re.compile(r"reels?\b|rils", re.I)
PODCAST_RE = re.compile(r"podkas|podcast|intervü|müsahib", re.I)
CAM_RE = re.compile(r"(\d)\s*-?\s*(?:lü|lu|li|lı)?\s*kamera", re.I)
PRICE_RE = re.compile(r"(\d{2,4})\s*(?:azn|manat|₼)", re.I)

# addan sonra gələn, ad olmayan sözlər (qatlanmış yazılışla müqayisə olunur)
FILLER = {
    "cekilis", "cekilisi", "cekilisler", "podkast", "podkas", "podcast", "reels", "reel", "rils", "kamera", "kameralı",
    "kamerali", "paket", "paketi", "video", "videolar", "saat", "saatliq", "neferlik", "nefer", "xanim", "x", "bey", "b",
    "muellim", "m", "intervu", "musahibe", "icare", "studiya", "green", "screen", "scren", "lu", "li", "ve", "ile",
    "y", "pod", "ypod", "ucun", "tam", "yeni", "qisa", "ozu", "ceker",
}

_FOLD = str.maketrans({"ə": "e", "ı": "i", "ö": "o", "ü": "u", "ş": "s", "ç": "c", "ğ": "g", "İ": "i", "Ə": "e",
                       "Ö": "o", "Ü": "u", "Ş": "s", "Ç": "c", "Ğ": "g", "I": "i"})


def fold(s: str | None) -> str:
    """Müqayisə üçün: kiçik hərf, az hərfləri latına, yalnız hərf və boşluq."""
    s = (s or "").translate(_FOLD).lower()
    return " ".join(re.sub(r"[^a-z\s]", " ", s).split())


def is_shoot(title: str) -> bool:
    return bool(SHOOT_RE.search(title or "")) and not SKIP_RE.search(title or "")


def is_skipped(title: str) -> bool:
    return bool(SKIP_RE.search(title or ""))


def is_own(title: str) -> bool:
    return bool(OWN_RE.search((title or "").strip()))


def parse(title: str) -> dict:
    """Başlıqdan: kind (shoot | studio_rent), tag (podcast | reels | other), cameras, price (AZN və ya None), name_tokens."""
    t = title or ""
    cam = CAM_RE.search(t)
    price = PRICE_RE.search(t)
    tokens = [w for w in fold(re.sub(r"\d+\S*", " ", t)).split() if w not in FILLER and len(w) > 1]
    return {
        "kind": "studio_rent" if RENT_RE.search(t) else "shoot",
        "tag": "reels" if REELS_RE.search(t) else "podcast" if PODCAST_RE.search(t) else "other",
        "cameras": min(3, max(1, int(cam.group(1)))) if cam else 1,
        "price": int(price.group(1)) if price else None,
        "name_tokens": tokens[:3],
    }


def round_duration(minutes: float) -> int:
    """Ən yaxın 30 dəqiqəyə, ən azı 30."""
    return max(30, int(round(minutes / 30)) * 30)


def suggest(name_tokens: list[str], first_names: list[tuple[str, str]]) -> str | None:
    """Sahibkarın yoxlaması üçün təklif (avtomatik yazılmır): ilk söz «Y Pod» kontaktlarında tək bir telefonun adıdırsa."""
    if not name_tokens:
        return None
    phones = {p for n, p in first_names if p and n == name_tokens[0]}
    return phones.pop() if len(phones) == 1 else None


def match(name_tokens: list[str], index: list[tuple[str, str]]) -> tuple[str | None, str]:
    """index: [(qatlanmış tam ad, telefon)]. Qaytarır (telefon, səbəb).
    Yalnız 2+ sözlü ad və onun ilk iki sözü ilə başlayan namizədlərin hamısı eyni telefondursa bağlanır."""
    if len(name_tokens) < 2:
        return None, "tək ad"
    key = " ".join(name_tokens[:2])
    phones = {p for n, p in index if p and (n == key or n.startswith(key + " "))}
    if not phones:
        return None, "namizəd yoxdur"
    if len(phones) > 1:
        return None, "bir neçə namizəd"
    return phones.pop(), "ok"
