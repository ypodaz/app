from test_auth import admin_token, api, bearer  # noqa: F401,I001  (env-i əvvəl qurur)
from crm_helpers import crm_env, jreply, mk_conv  # noqa: F401,I001

import json  # noqa: E402

import httpx  # noqa: E402
import pytest  # noqa: E402
from sqlalchemy import select  # noqa: E402

import settings  # noqa: E402
from ai import AiError  # noqa: E402
from crm import bot, voice  # noqa: E402
from db import SessionLocal  # noqa: E402
from models import Lead, LeadEvent, WaMessage  # noqa: E402


class _Audio:
    def __init__(self, status=200, content=b"OggS-fake", ctype="audio/ogg; codecs=opus"):
        self.status_code, self.content, self.headers = status, content, {"content-type": ctype}


class _Downloads:
    def __init__(self):
        self.calls, self.resp = [], _Audio()

    def get(self, url, headers=None, **kw):
        self.calls.append((url, dict(headers or {})))
        return self.resp


@pytest.fixture
def downloads(monkeypatch):
    d = _Downloads()
    monkeypatch.setattr(httpx, "get", d.get)
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "g")
    return d


def _audio_conv(url="https://api.kapso.ai/media/abc", kapso_text=None):
    cid, conv_id = mk_conv(text=kapso_text or voice.PLACEHOLDER)
    with SessionLocal() as db:
        m = db.scalar(select(WaMessage).where(WaMessage.conversation_id == conv_id))
        m.type, m.media_url, m.transcript = "audio", url, kapso_text
        db.commit()
    return conv_id


def _audio_msg(db, conv_id):
    return db.scalar(select(WaMessage).where(WaMessage.conversation_id == conv_id, WaMessage.type == "audio"))


def test_voice_transcribed_before_bot_reply(api, crm_env, downloads):
    conv_id = _audio_conv()
    crm_env.gemini("Salam, sabah 2 kameralı çəkiliş olar?", jreply("Bəli, olar."))
    assert bot.handle(conv_id) == "draft"
    with SessionLocal() as db:
        m = _audio_msg(db, conv_id)
        assert m.text == m.transcript == "Salam, sabah 2 kameralı çəkiliş olar?"
    voice_call, bot_call = crm_env.gemini_calls
    assert voice_call[1][0]["parts"][0]["inlineData"]["mimeType"] == "audio/ogg"
    assert "sabah 2 kameralı" in bot_call[1][-1]["parts"][0]["text"]  # bot transkripti görür
    assert downloads.calls[0][1] == {"X-API-Key": "k"}


def test_kapso_key_not_sent_to_other_hosts(api, crm_env, downloads):
    conv_id = _audio_conv(url="https://cdn.example.com/a.ogg")
    crm_env.gemini("salam", jreply("Salam!"))
    bot.handle(conv_id)
    assert downloads.calls[0][1] == {}


def test_failed_transcription_is_tried_once(api, crm_env, downloads):
    downloads.resp = _Audio(status=403)
    conv_id = _audio_conv()
    crm_env.gemini(jreply("Səs aydın deyil, mesaj kimi yaza bilərsiniz? 🙏"))
    bot.handle(conv_id)
    with SessionLocal() as db:
        assert voice.fill_missing(db, conv_id) == 0
        m = _audio_msg(db, conv_id)
        assert m.text == voice.PLACEHOLDER and m.raw[voice.TRIED] is True
    assert len(downloads.calls) == 1 and len(crm_env.gemini_calls) == 1  # səs yenidən sınanmadı


def test_gemini_preferred_over_kapso_transcript(api, crm_env, downloads):
    conv_id = _audio_conv(kapso_text="salam sabah iki kamera ola")  # Kapso-nun zəif transkripti
    crm_env.gemini("Salam, sabah iki kameralı çəkiliş olar?", jreply("Bəli."))
    bot.handle(conv_id)
    with SessionLocal() as db:
        assert _audio_msg(db, conv_id).text == "Salam, sabah iki kameralı çəkiliş olar?"


def test_kapso_transcript_kept_when_gemini_fails(api, crm_env, downloads):
    conv_id = _audio_conv(kapso_text="salam qiymət nədir")
    crm_env.gemini(AiError("down"), jreply("Salam!"))
    bot.handle(conv_id)
    with SessionLocal() as db:
        m = _audio_msg(db, conv_id)
        assert m.text == m.transcript == "salam qiymət nədir"


def test_instagram_and_found_via_saved_to_notes(api, crm_env):
    cid, conv_id = mk_conv(text="Instagram-da gördüm sizi, səhifəm @leyla.psix")
    crm_env.gemini(jreply("Çox sağ olun 😊", lead={"instagram": "@leyla.psix", "found_via": "Instagram"}))
    bot.handle(conv_id)
    with SessionLocal() as db:
        lead = db.scalar(select(Lead))
        assert lead.notes == "Instagram: @leyla.psix\nHaradan tapıb: instagram"
        assert "haradan tapıb: instagram" in bot._lead_text(lead)
        events = [e.data for e in db.scalars(select(LeadEvent).where(LeadEvent.kind == "update"))]
        assert {"found_via": [None, "instagram"]} in events


def test_found_via_template_or_unknown_not_saved():
    for raw in ("instagram|tiktok|youtube|reklam|tanis|google|diger|null", "radio"):
        assert bot.parse_reply(json.dumps(jreply(lead={"found_via": raw})))["lead"]["found_via"] is None
    assert bot.parse_reply(json.dumps(jreply(lead={"found_via": "tanis"})))["lead"]["found_via"] == "tanis"


def test_set_note_replaces_existing_line():
    lead = Lead(notes="Zəng etdi\nHaradan tapıb: google")
    bot._set_note(lead, "Haradan tapıb", "tanis")
    assert lead.notes == "Zəng etdi\nHaradan tapıb: tanis"
