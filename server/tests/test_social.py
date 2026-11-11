from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import httpx
import pytest

from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)

from sqlalchemy import select  # noqa: E402

import alerts  # noqa: E402
import settings  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import MediaAsset, Setting, SocialPost  # noqa: E402
from social import buffer, captions, schedule, worker  # noqa: E402

CAPTIONS_FILE = (Path.home() / "Claude Projects/Y Pod Social Media AI/Y Pod Kontent/ssenariler/aciqlamalar.md")


@pytest.fixture(autouse=True)
def buffer_cfg(monkeypatch):
    monkeypatch.setattr(settings, "BUFFER_API_KEY", "k")
    monkeypatch.setattr(settings, "BUFFER_ORG_ID", "org1")
    monkeypatch.setattr(settings, "SOCIAL_DAILY_REQUEST_CAP", 80)
    monkeypatch.setattr(buffer, "_backoff_until", 0.0)
    monkeypatch.setattr(worker, "_channels", {"at": 0.0, "map": {}})
    monkeypatch.setattr(worker, "_last_sync", 0.0)

    def no_network(*a, **k):
        raise AssertionError("testdə real HTTP sorğusu göndərilməməlidir")

    monkeypatch.setattr(buffer.httpx, "post", no_network)


# --- captions ---

@pytest.mark.skipif(not CAPTIONS_FILE.exists(), reason="aciqlamalar.md bu kompüterdə yoxdur")
def test_captions_real_file_all_56_sections():
    sections, errors = captions.parse_file(CAPTIONS_FILE)
    assert errors == []
    assert [s["number"] for s in sections] == list(range(1, 57))
    for s in sections:
        assert all(s[k] for k in ("instagram", "tiktok", "youtube_title", "youtube_description"))
    assert next(s for s in sections if s["number"] == 28)["title"] == "Gəl birlikdə girək"  # ⏳ atılır


def test_captions_reports_missing_and_empty_blocks():
    raw = """## 01 · Gün 1 Səhər — Başlıq

Instagram:
```
ig mətn
```

TikTok:
```
```

YouTube başlıq:
```
yt
```
"""
    sections, errors = captions.parse_text(raw)
    assert sections[0]["instagram"] == "ig mətn" and sections[0]["youtube_title"] == "yt"
    assert any("tiktok" in e for e in errors) and any("youtube_description" in e for e in errors)


# --- təqvim ---

def test_schedule_gaps_stay_and_baku_to_utc():
    videos = [{"number": n, "day": (n + 1) // 2, "slot": "seher" if n % 2 else "axsam"} for n in range(25, 41)
              if n not in (28, 36)]
    rows = schedule.generate(videos, date(2026, 11, 20))
    assert len(rows) == 14 * 3 and {r["platform"] for r in rows} == {"instagram", "tiktok", "youtube"}
    assert not [r for r in rows if r["number"] in (28, 36)]
    one = {(r["number"], r["platform"]): r["scheduled_at"] for r in rows}
    # 25 = Gün 13 səhər → 20.11 + 12 gün = 02.12, Bakı 09:00 = UTC 05:00; 26 axşam 20:00 = UTC 16:00
    assert one[(25, "tiktok")] == datetime(2026, 12, 2, 5, 0, tzinfo=timezone.utc)
    assert one[(26, "tiktok")] == datetime(2026, 12, 2, 16, 0, tzinfo=timezone.utc)
    # 29 (Gün 15 səhər) 28-in boş slotundan sonra da öz gününə düşür: 04.12
    assert one[(29, "instagram")] == datetime(2026, 12, 4, 5, 0, tzinfo=timezone.utc)
    assert "facebook" not in {r["platform"] for r in rows}
    assert {r["platform"] for r in schedule.generate(videos[:1], date(2026, 11, 20), ("facebook",))} == {"facebook"}


def item(n, url="https://cdn.test/v.mp4", day=None, slot="seher"):
    return {"number": n, "day": day or n, "slot": slot, "title": f"Video {n}", "file_name": f"{n:02d}.mp4",
            "public_url": url, "duration_s": 40.0, "instagram": f"ig{n}", "tiktok": f"tt{n}",
            "youtube_title": f"yt{n}", "youtube_description": f"ytd{n}"}


def test_import_is_idempotent_and_keeps_text(api):
    with SessionLocal() as db:
        assert schedule.import_items(db, date(2026, 11, 20), [item(1)]) == {"created": 3, "skipped": 0}
        p = db.scalar(select(SocialPost).where(SocialPost.platform == "instagram"))
        p.text = "əl ilə düzəldildi"
        db.commit()
        assert schedule.import_items(db, date(2026, 11, 20), [item(1)]) == {"created": 0, "skipped": 3}
        assert db.scalar(select(SocialPost).where(SocialPost.platform == "instagram")).text == "əl ilə düzəldildi"
        yt = db.scalar(select(SocialPost).where(SocialPost.platform == "youtube"))
        assert yt.text == "ytd1" and yt.title == "yt1"


# --- Buffer müştərisi ---

class FakeHttp:
    def __init__(self, *responses):
        self.responses, self.calls = list(responses), []

    def __call__(self, url, json=None, headers=None, timeout=None):
        self.calls.append({"url": url, "json": json, "headers": headers})
        return self.responses.pop(0)


def ok(data):
    return httpx.Response(200, json={"data": data})


DUE = datetime(2026, 11, 20, 5, 0, tzinfo=timezone.utc)
SUCCESS = ok({"createPost": {"post": {"id": "p1", "dueAt": "2026-11-20T05:00:00.000Z"}}})


@pytest.mark.parametrize("service,expected", [
    ("instagram", {"instagram": {"type": "reel", "shouldShareToFeed": True}}),
    ("youtube", {"youtube": {"title": "Başlıq", "categoryId": "27", "privacy": "public", "madeForKids": False,
                             "notifySubscribers": True}}),
    ("tiktok", {"tiktok": {}}),
])
def test_create_post_body(api, monkeypatch, service, expected):
    fake = FakeHttp(SUCCESS)
    monkeypatch.setattr(buffer.httpx, "post", fake)
    post = buffer.create_post("ch1", service, "mətn", "https://cdn.test/v.mp4", DUE, title="Başlıq",
                              thumbnail_offset_ms=1500)
    assert post["id"] == "p1"
    call = fake.calls[0]
    assert call["url"] == "https://api.buffer.com" and call["headers"]["Authorization"] == "Bearer k"
    inp = call["json"]["variables"]["input"]
    assert inp["channelId"] == "ch1" and inp["text"] == "mətn"
    assert inp["schedulingType"] == "automatic" and inp["mode"] == "customScheduled"
    assert inp["dueAt"] == "2026-11-20T05:00:00.000Z"
    assert inp["assets"] == [{"video": {"url": "https://cdn.test/v.mp4", "metadata": {"thumbnailOffset": 1500}}}]
    assert inp["metadata"] == expected
    assert "PostActionSuccess" in call["json"]["query"] and "MutationError" in call["json"]["query"]


def test_create_post_mutation_error(api, monkeypatch):
    monkeypatch.setattr(buffer.httpx, "post", FakeHttp(ok({"createPost": {"message": "Video çox uzundur"}})))
    with pytest.raises(buffer.BufferError, match="Video çox uzundur"):
        buffer.create_post("ch1", "tiktok", "t", "https://x/v.mp4", DUE)


def test_429_backs_off_without_more_requests(api, monkeypatch):
    fake = FakeHttp(httpx.Response(429, headers={"retry-after": "60"}, json={}), SUCCESS)
    monkeypatch.setattr(buffer.httpx, "post", fake)
    with pytest.raises(buffer.BufferBackoff):
        buffer.get_organizations()
    with pytest.raises(buffer.BufferBackoff):
        buffer.get_organizations()
    assert len(fake.calls) == 1


def test_daily_cap_blocks_requests(api, monkeypatch):
    monkeypatch.setattr(settings, "SOCIAL_DAILY_REQUEST_CAP", 2)
    fake = FakeHttp(ok({"account": {"organizations": []}}), ok({"account": {"organizations": []}}))
    monkeypatch.setattr(buffer.httpx, "post", fake)
    buffer.get_organizations()
    buffer.get_organizations()
    with pytest.raises(buffer.BufferCapReached):
        buffer.get_organizations()
    assert len(fake.calls) == 2 and buffer.requests_today() == 2


# --- dövr ---

@pytest.fixture()
def fake_buffer(monkeypatch):
    class B:
        created = []
        remote: list = []

    def create(channel_id, service, text, url, due, title=None, thumbnail_offset_ms=1000):
        B.created.append({"channel": channel_id, "service": service, "url": url, "due": due})
        return {"id": f"b{len(B.created)}", "dueAt": None}

    B.created, B.remote = [], []
    monkeypatch.setattr(buffer, "get_channels", lambda org: [{"id": f"c-{s}", "service": s, "name": s,
                                                              "isQueuePaused": False}
                                                             for s in ("instagram", "tiktok", "youtube")])
    monkeypatch.setattr(buffer, "create_post", create)
    monkeypatch.setattr(buffer, "get_posts", lambda org, ch, since: B.remote)
    return B


@pytest.fixture()
def alerted(monkeypatch):
    out = []
    monkeypatch.setattr(alerts, "notify", lambda key, text: out.append((key, text)) or True)
    return out


def seed(db, n_videos, start_offset_h=1, step_h=12, url="https://cdn.test/v.mp4", platforms=("tiktok",)):
    t = datetime.now(timezone.utc)
    for n in range(1, n_videos + 1):
        a = MediaAsset(number=n, day=n, slot="seher", title=f"V{n}", file_name=f"{n}.mp4", public_url=url)
        db.add(a)
        db.flush()
        for p in platforms:
            db.add(SocialPost(media_asset_id=a.id, platform=p, text="t", title="x" if p == "youtube" else None,
                              scheduled_at=t + timedelta(hours=start_offset_h + (n - 1) * step_h)))
    db.commit()


def queued_count(db):
    return len(db.scalars(select(SocialPost).where(SocialPost.status == "queued")).all())


def test_disabled_queue_sends_nothing(api, fake_buffer):
    with SessionLocal() as db:
        seed(db, 3)
    worker.tick()
    assert fake_buffer.created == []


def test_queue_caps_at_ten_and_five_days(api, fake_buffer):
    with SessionLocal() as db:
        seed(db, 14, step_h=8)  # 8 saatdan bir: 5 gündə ~15 post, ancaq növbə 10-la məhduddur
        worker.set_queue_enabled(db, True)
        assert worker.fill_queue(db) == 5  # bir dövrdə ən çox 5
        assert worker.fill_queue(db) == 5
        assert worker.fill_queue(db) == 0  # növbə 10-dur
        assert queued_count(db) == 10
        horizon = datetime.now(timezone.utc) + timedelta(days=5)
        assert all(c["due"] <= horizon for c in fake_buffer.created)


def test_does_not_go_beyond_five_days(api, fake_buffer):
    with SessionLocal() as db:
        seed(db, 6, step_h=48)  # 1h, 49h, 97h, 145h(6.04 gün)...
        worker.set_queue_enabled(db, True)
        assert worker.fill_queue(db) == 3


def test_idempotent_no_double_send(api, fake_buffer):
    with SessionLocal() as db:
        seed(db, 2)
        worker.set_queue_enabled(db, True)
        worker.fill_queue(db)
        worker.fill_queue(db)
        assert len(fake_buffer.created) == 2
        # status sıfırlansa da external_id olan post yenidən göndərilmir
        p = db.scalars(select(SocialPost)).first()
        p.status = "planned"
        db.commit()
        worker.fill_queue(db)
        assert len(fake_buffer.created) == 2


def test_missing_public_url_is_skipped(api, fake_buffer):
    with SessionLocal() as db:
        seed(db, 2, url=None)
        worker.set_queue_enabled(db, True)
        assert worker.fill_queue(db) == 0
        assert fake_buffer.created == []
        assert {p.status for p in db.scalars(select(SocialPost))} == {"planned"}


def test_failures_retry_then_error_with_alert(api, fake_buffer, alerted, monkeypatch):
    def boom(*a, **k):
        raise buffer.BufferError("Buffer HTTP 500")

    monkeypatch.setattr(buffer, "create_post", boom)
    with SessionLocal() as db:
        seed(db, 1)
        worker.set_queue_enabled(db, True)
        for _ in range(worker.MAX_ATTEMPTS):
            worker.fill_queue(db)
        p = db.scalar(select(SocialPost))
        assert p.status == "error" and "HTTP 500" in p.error and p.attempts == worker.MAX_ATTEMPTS
    assert len(alerted) == 1 and "Buffer HTTP 500" in alerted[0][1]


def queue_one(db, hours_ago_due=0):
    seed(db, 1)
    p = db.scalar(select(SocialPost))
    p.status, p.external_id = "queued", "b1"
    p.scheduled_at = datetime.now(timezone.utc) - timedelta(hours=hours_ago_due)
    db.commit()
    return p


def test_sync_published_and_error_alert(api, fake_buffer, alerted):
    with SessionLocal() as db:
        seed(db, 2, step_h=1)
        a, b = db.scalars(select(SocialPost).order_by(SocialPost.id)).all()
        a.status, a.external_id = "queued", "ba"
        b.status, b.external_id = "queued", "bb"
        db.commit()
        fake_buffer.remote = [{"id": "ba", "status": "sent", "error": None},
                              {"id": "bb", "status": "error", "error": "Token bitib"}]
        assert worker.sync_status(db) == {"published": 1, "error": 1, "late": 0}
        db.refresh(a), db.refresh(b)
        assert a.status == "published" and b.status == "error" and b.error == "Token bitib"
    assert len(alerted) == 1 and "Token bitib" in alerted[0][1]


def test_late_slot_alerts_once(api, fake_buffer, alerted):
    with SessionLocal() as db:
        queue_one(db, hours_ago_due=1)  # 60 dəqiqə keçib (>45)
        fake_buffer.remote = [{"id": "b1", "status": "scheduled", "error": None}]
        assert worker.sync_status(db)["late"] == 1
        worker.sync_status(db)
        assert len(alerted) == 1
        assert db.get(Setting, f"social_late:{db.scalar(select(SocialPost.id))}")


def test_not_late_within_45_minutes(api, fake_buffer, alerted):
    with SessionLocal() as db:
        p = queue_one(db)
        p.scheduled_at = datetime.now(timezone.utc) - timedelta(minutes=30)
        db.commit()
        fake_buffer.remote = [{"id": "b1", "status": "scheduled", "error": None}]
        assert worker.sync_status(db)["late"] == 0
    assert alerted == []


def test_tick_survives_exceptions(api, fake_buffer, monkeypatch):
    def boom(org):
        raise RuntimeError("partladı")

    monkeypatch.setattr(buffer, "get_channels", boom)
    with SessionLocal() as db:
        worker.set_queue_enabled(db, True)
    worker.tick()  # istisna çölə çıxmır


# --- admin API ---

def test_admin_social_api(api, monkeypatch):
    monkeypatch.setattr(buffer, "get_channels", lambda org: [{"id": "c1", "service": "tiktok", "name": "ypod",
                                                              "isQueuePaused": False}])
    adm = admin_token(api)
    h = bearer(adm)
    assert api.get("/api/admin/social/posts").status_code == 401
    body = {"start_date": "2026-11-20", "items": [item(1, day=1), item(2, day=1, slot="axsam")]}
    assert api.post("/api/admin/social/import", json=body, headers=h).json() == {"created": 6, "skipped": 0}
    assert api.post("/api/admin/social/import", json=body, headers=h).json() == {"created": 0, "skipped": 6}
    posts = api.get("/api/admin/social/posts?from=2026-11-20&to=2026-11-20", headers=h).json()
    assert len(posts) == 6 and posts[0]["scheduled_at"].startswith("2026-11-20T05:00")
    assert len(api.get("/api/admin/social/posts?from=2026-11-21", headers=h).json()) == 0

    pid = posts[0]["id"]
    # Panel Bakı vaxtını +04:00 ilə göndərir: SQLite qurşağı atır, ona görə UTC-yə çevrilib saxlanmalıdır.
    r = api.patch(f"/api/admin/social/posts/{pid}", json={"text": "yeni", "scheduled_at": "2026-11-22T09:30:00+04:00"},
                  headers=h)
    assert r.status_code == 200 and r.json()["text"] == "yeni"
    assert r.json()["scheduled_at"].startswith("2026-11-22T05:30")
    assert api.patch(f"/api/admin/social/posts/{pid}", json={"status": "cancelled"}, headers=h).json()["status"] == "cancelled"
    assert api.patch(f"/api/admin/social/posts/{pid}", json={"text": "x"}, headers=h).status_code == 409
    with SessionLocal() as db:
        q = db.get(SocialPost, posts[1]["id"])
        q.status = "queued"
        db.commit()
    assert api.patch(f"/api/admin/social/posts/{posts[1]['id']}", json={"text": "x"}, headers=h).status_code == 409

    mid = posts[2]["media"]["id"]
    r = api.patch(f"/api/admin/social/media/{mid}", json={"public_url": "https://cdn.test/new.mp4", "cover_offset_ms": 2500},
                  headers=h)
    assert r.json() == {"id": mid, "public_url": "https://cdn.test/new.mp4", "cover_offset_ms": 2500}

    assert api.post("/api/admin/social/queue", json={"enabled": True}, headers=h).json() == {"queue_enabled": True}
    st = api.get("/api/admin/social/status", headers=h).json()
    assert st["queue_enabled"] is True and st["requests_today"] == 0 and st["recent_errors"] == []
    assert st["channels"] == [{"id": "c1", "service": "tiktok", "name": "ypod", "queue_paused": False}]
    assert len(st["next_posts"]) == 5 and pid not in [x["id"] for x in st["next_posts"]]  # ləğv olunan çıxır


def test_admin_social_status_without_key_has_no_channels(api, monkeypatch):
    monkeypatch.setattr(settings, "BUFFER_API_KEY", "")
    st = api.get("/api/admin/social/status", headers=bearer(admin_token(api))).json()
    assert st["channels"] is None and st["queue_enabled"] is False


def test_admin_sync_without_queued_posts(api, fake_buffer):
    r = api.post("/api/admin/social/sync", headers=bearer(admin_token(api)))
    assert r.status_code == 200 and r.json() == {"published": 0, "error": 0, "late": 0}
