from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)

from datetime import datetime, timedelta, timezone  # noqa: E402

import pytest  # noqa: E402

from auth import new_card_code  # noqa: E402
from crm import calendar_import as ci, digest  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import Client, Shoot  # noqa: E402

BAKU = timezone(timedelta(hours=4))


@pytest.mark.parametrize("title,shoot", [
    ("Test çəkiliş 2 saat", True), ("Testa Nümunəva 3lü kamera podkast", True), ("Nümunə reels çəkilişi", True),
    ("PM kursuna getmək", False), ("Nümunə görüş", False), ("Şahin çəkiliş", False), ("Studiya icarəsi", True),
])
def test_is_shoot(title, shoot):
    assert ci.is_shoot(title) is shoot


def test_parse_title():
    p = ci.parse("Testa Nümunəva 3lü kamera podkast 170 AZN")
    assert p["name_tokens"][:2] == ["testa", "numuneva"]
    assert (p["kind"], p["tag"], p["cameras"], p["price"]) == ("shoot", "podcast", 3, 170)
    r = ci.parse("Testov Nümunəli reels paketi")
    assert r["name_tokens"] == ["testov", "numuneli"] and r["tag"] == "reels" and r["price"] is None
    assert ci.parse("Testa x. 2 Kamera podkast")["name_tokens"] == ["testa"]
    assert ci.parse("Studiya icarəsi")["kind"] == "studio_rent"


def test_own_title():
    assert ci.is_own("Testa podkast Y Pod") and ci.is_own("Reels Y-Pod ") and not ci.is_own("Y Pod-da görüş")


def test_round_duration():
    assert [ci.round_duration(m) for m in (10, 60, 75, 90, 100)] == [30, 60, 60, 90, 90]


def test_match_only_when_sure():
    idx = [("testa numuneva", "994500000011"), ("test birinci", "994500000012"), ("test ikinci", "994500000013")]
    assert ci.match(["testa", "numuneva"], idx) == ("994500000011", "ok")
    assert ci.match(["test"], idx) == (None, "tək ad")
    assert ci.match(["yoxdur", "adam"], idx) == (None, "namizəd yoxdur")
    idx.append(("testa numuneva", "994500000019"))
    assert ci.match(["testa", "numuneva"], idx) == (None, "bir neçə namizəd")


def test_suggest_unique_first_name():
    firsts = [("birad", "994501"), ("ikiad", "994502"), ("ikiad", "994503")]
    assert ci.suggest(["birad"], firsts) == "994501"
    assert ci.suggest(["ikiad"], firsts) is None
    assert ci.suggest([], firsts) is None


def test_digest_calendar_lines(api, monkeypatch):  # noqa: F811
    day = datetime(2026, 11, 13, 21, 0, tzinfo=BAKU)
    events = [(day.replace(hour=15), day.replace(hour=16), "Testa podkast Y Pod"),
              (day.replace(hour=18), day.replace(hour=19), "Testov reels Y Pod"),
              (day.replace(hour=10), day.replace(hour=12), "Şahin")]
    monkeypatch.setattr(digest.calendar_ics, "titled", lambda a, b: events)
    with SessionLocal() as db:
        c = Client(full_name="Testa Nümunəva", phone="994500000001", card_code=new_card_code())
        db.add(c)
        db.flush()
        db.add(Shoot(client_id=c.id, kind="shoot", tag="podcast", location="studio", starts_at=day.replace(hour=15).astimezone(timezone.utc),
                     duration_min=60, cameras=1))
        db.commit()
        lines = digest.calendar_lines(db, day)
    assert lines[0].startswith("📅 Təqvimdə bu gün 2 «Y Pod» çəkilişi / app-da 1")
    assert len(lines) == 2 and "18:00 Testov reels Y Pod" in lines[1]
