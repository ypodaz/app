"""Mac-də işləyən paylaşım hazırlığı: videoları çevirir, R2-yə yükləyir, manifest hazırlayır, serverə göndərir.

    python scripts/social_prep.py                     # yalnız ffmpeg çevirməsi
    python scripts/social_prep.py --upload            # + R2 (açarlar yalnız env-dən)
    python scripts/social_prep.py --manifest          # captions + videolar + URL-lər → social_manifest.json
    python scripts/social_prep.py --push-import --api https://... --start-date 2026-11-20

--push-import admin sessiyası üçün ADMIN_LOGIN və ADMIN_PASSWORD (açıq parol) env-dən oxuyur.
"""
import argparse
import json
import os
import re
import subprocess
import sys
import unicodedata
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

BASE = Path.home() / "Claude Projects" / "Y Pod Social Media AI"
SRC_DIR = BASE / "out" / "Videolar"
DST_DIR = BASE / "out" / "Videolar-yuklenecek"
CAPTIONS = BASE / "Y Pod Kontent" / "ssenariler" / "aciqlamalar.md"
MANIFEST = BASE / "out" / "social_manifest.json"

NAME_RE = re.compile(r"^(\d+) - Gün (\d+) (Səhər|Axşam) - (.+)\.mp4$")
SLOT_ASCII = {"Səhər": "seher", "Axşam": "axsam"}
SLOT_KEY = {"Səhər": "seher", "Axşam": "axsam"}
REELS_MIN_S, REELS_MAX_S = 3, 90


def nfc(s: str) -> str:
    return unicodedata.normalize("NFC", s)


def list_sources(src: Path = SRC_DIR) -> list[dict]:
    out = []
    for p in sorted(src.glob("*.mp4")):
        m = NAME_RE.match(nfc(p.name))
        if not m:
            print(f"atlandı (ad uyğun deyil): {p.name}")
            continue
        number, day, slot, title = int(m[1]), int(m[2]), m[3], m[4]
        out.append({"number": number, "day": day, "slot": SLOT_KEY[slot], "title": title, "src": p,
                    "file_name": f"{number:02d}-gun-{day}-{SLOT_ASCII[slot]}.mp4"})
    return out


def probe_duration(path: Path) -> float:
    r = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1",
                        str(path)], capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


def convert(src: Path, dst: Path) -> None:
    cmd = ["ffmpeg", "-n", "-loglevel", "error", "-i", str(src),
           "-c:v", "libx264", "-profile:v", "high", "-pix_fmt", "yuv420p", "-crf", "21", "-preset", "slow",
           "-maxrate", "12M", "-bufsize", "24M",
           "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2",
           "-movflags", "+faststart", str(dst)]
    subprocess.run(cmd, check=True)


def run_convert() -> list[dict]:
    DST_DIR.mkdir(parents=True, exist_ok=True)
    items = list_sources()
    for it in items:
        dst = DST_DIR / it["file_name"]
        if dst.exists():
            print(f"{it['file_name']}: artıq var, atlandı")
        else:
            tmp = dst.with_suffix(".part.mp4")  # yarımçıq fayl son adla qalmasın
            tmp.unlink(missing_ok=True)
            convert(it["src"], tmp)
            tmp.rename(dst)
            print(f"{it['file_name']}: çevrildi")
        it["dst"] = dst
        it["duration_s"] = round(probe_duration(dst), 2)
        it["size_mb"] = round(dst.stat().st_size / 1e6, 1)
        if not REELS_MIN_S <= it["duration_s"] <= REELS_MAX_S:
            print(f"XƏBƏRDARLIQ: {it['file_name']} müddəti {it['duration_s']} s (Reels {REELS_MIN_S}–{REELS_MAX_S} s)")
    return items


def upload(items: list[dict]) -> dict[int, str]:
    import boto3  # yalnız --upload üçün lazımdır

    need = ["R2_ACCOUNT_ID", "R2_ACCESS_KEY_ID", "R2_SECRET_ACCESS_KEY", "R2_BUCKET", "R2_PUBLIC_BASE_URL"]
    missing = [k for k in need if not os.environ.get(k)]
    if missing:
        sys.exit("env çatışmır: " + ", ".join(missing))
    s3 = boto3.client("s3", endpoint_url=f"https://{os.environ['R2_ACCOUNT_ID']}.r2.cloudflarestorage.com",
                      aws_access_key_id=os.environ["R2_ACCESS_KEY_ID"],
                      aws_secret_access_key=os.environ["R2_SECRET_ACCESS_KEY"], region_name="auto")
    base = os.environ["R2_PUBLIC_BASE_URL"].rstrip("/")
    urls = {}
    for it in items:
        key = it["file_name"]
        s3.upload_file(str(it["dst"]), os.environ["R2_BUCKET"], key, ExtraArgs={"ContentType": "video/mp4"})
        urls[it["number"]] = f"{base}/{key}"
        print(f"yükləndi: {key}")
    return urls


def build_manifest(items: list[dict], urls: dict[int, str], start_date: str | None = None) -> dict:
    from social import captions

    caps, errors = captions.parse_file(CAPTIONS)
    if errors:
        print("açıqlama xətaları:\n  " + "\n  ".join(errors))
    by_number = {c["number"]: c for c in caps}
    base = os.environ.get("R2_PUBLIC_BASE_URL", "").rstrip("/")
    out = []
    for it in items:
        cap = by_number.get(it["number"])
        if not cap:
            print(f"XƏBƏRDARLIQ: {it['number']} üçün açıqlama tapılmadı, atlandı")
            continue
        url = urls.get(it["number"]) or (f"{base}/{it['file_name']}" if base else None)
        out.append({"number": it["number"], "day": it["day"], "slot": it["slot"], "title": cap["title"],
                    "file_name": it["file_name"], "public_url": url, "duration_s": it.get("duration_s"),
                    "instagram": cap["instagram"], "tiktok": cap["tiktok"],
                    "youtube_title": cap["youtube_title"], "youtube_description": cap["youtube_description"]})
    return {"start_date": start_date, "items": out}


def push_import(manifest: dict, api: str) -> None:
    import httpx

    login, password = os.environ.get("ADMIN_LOGIN"), os.environ.get("ADMIN_PASSWORD")
    if not (login and password):
        sys.exit("ADMIN_LOGIN və ADMIN_PASSWORD env lazımdır")
    api = api.rstrip("/")
    r = httpx.post(f"{api}/api/admin/login", json={"login": login, "password": password}, timeout=30)
    r.raise_for_status()
    token = r.json()["token"]
    r = httpx.post(f"{api}/api/admin/social/import", json=manifest, headers={"Authorization": f"Bearer {token}"},
                   timeout=60)
    print(r.status_code, r.text)
    r.raise_for_status()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--upload", action="store_true")
    ap.add_argument("--manifest", action="store_true")
    ap.add_argument("--push-import", action="store_true")
    ap.add_argument("--api")
    ap.add_argument("--start-date")
    a = ap.parse_args()

    items = run_convert()
    print(f"\n{len(items)} video, cəmi {sum(i['size_mb'] for i in items):.0f} MB")
    urls = upload(items) if a.upload else {}
    if a.manifest or a.push_import:
        manifest = build_manifest(items, urls, a.start_date)
        MANIFEST.write_text(json.dumps(manifest, ensure_ascii=False, indent=1))
        print(f"manifest: {MANIFEST} ({len(manifest['items'])} video)")
        if a.push_import:
            if not (a.api and a.start_date):
                sys.exit("--push-import üçün --api və --start-date lazımdır")
            push_import(manifest, a.api)


if __name__ == "__main__":
    main()
