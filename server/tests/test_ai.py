import copy

import pytest
from test_api_faza1 import make_shoot, new_client, soon  # noqa: F401,I001  (env-i əvvəl qurur)
from test_auth import admin_token, api, bearer  # noqa: F401,I001

import ai  # noqa: E402
import settings  # noqa: E402


class FakeGemini:
    """httpx.post əvəzi: növbədəki cavabları qaytarır, göndərilən body-ləri saxlayır."""

    def __init__(self, *replies):
        self.replies, self.sent = list(replies), []

    def __call__(self, url, json=None, timeout=None, headers=None):
        self.sent.append(copy.deepcopy(json))
        parts = self.replies.pop(0)
        return type("R", (), {"status_code": 200, "json": lambda _s: {
            "candidates": [{"content": {"role": "model", "parts": parts}}],
            "usageMetadata": {"promptTokenCount": 100, "candidatesTokenCount": 20}}})()


def call(name, **args):
    return [{"functionCall": {"name": name, "args": args}}]


@pytest.fixture()
def gemini(monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "test")
    ai._minute.clear()

    def use(*replies):
        fake = FakeGemini(*replies)
        monkeypatch.setattr(ai.httpx, "post", fake)
        return fake
    return use


def test_client_ai_disabled_without_key(api, monkeypatch):
    monkeypatch.setattr(settings, "GEMINI_API_KEY", "")
    adm = admin_token(api)
    _, tok = new_client(api, adm, "Aysel Məmmədova")
    assert api.get("/api/me/ai", headers=bearer(tok)).json()["enabled"] is False
    r = api.post("/api/me/ai", json={"text": "Salam"}, headers=bearer(tok))
    assert r.status_code == 503 and r.json()["detail"] == "AI hələ qoşulmayıb"


def test_client_ai_reply_history_whatsapp_and_context(api, gemini):
    adm = admin_token(api)
    cid, tok = new_client(api, adm, "Aysel Məmmədova")
    make_shoot(api, adm, cid)
    fake = gemini([{"text": "Bu barədə studiyaya yazın. [WHATSAPP]"}], [{"text": "Bəli."}])
    r = api.post("/api/me/ai", json={"text": "Behi necə ödəyim?"}, headers=bearer(tok)).json()
    assert r == {"text": "Bu barədə studiyaya yazın.", "whatsapp": True, "remaining": 29}
    system = fake.sent[0]["systemInstruction"]["parts"][0]["text"]
    assert "Aysel" in system and "Beh gözlənilir" in system and "tools" not in fake.sent[0]
    api.post("/api/me/ai", json={"text": "Sağ olun"}, headers=bearer(tok))
    assert [c["role"] for c in fake.sent[1]["contents"]] == ["user", "model", "user"]
    h = api.get("/api/me/ai", headers=bearer(tok)).json()
    assert [m["text"] for m in h["messages"]] == ["Behi necə ödəyim?", "Bu barədə studiyaya yazın.", "Sağ olun", "Bəli."]
    assert h["remaining"] == 28


def test_client_ai_minute_limit(api, gemini):
    adm = admin_token(api)
    _, tok = new_client(api, adm, "Aysel Məmmədova")
    gemini(*[[{"text": "ok"}]] * 7)
    codes = [api.post("/api/me/ai", json={"text": "?"}, headers=bearer(tok)).status_code for _ in range(7)]
    assert codes == [200] * 6 + [429]


def test_assistant_new_client_and_shoot_proposals(api, gemini):
    adm = admin_token(api)
    day = soon(days=3)[:10]
    fake = gemini(
        call("find_clients", query="Nigar"),
        call("propose_create_client", full_name="Nigar Əliyeva", phone="050 111 22 33")
        + call("propose_create_shoot", new_client_index=0, date=day, start="10:00", end="11:30", kind="reels_pack",
               discount_azn=50),
        [{"text": "Nigar üçün yeni müştəri və Reels paketi təklif edirəm."}])
    r = api.post("/api/admin/assistant", json={"text": "Nigar Əliyeva yeni müştəridir, reels paketi"},
                 headers=bearer(adm))
    assert r.status_code == 200, r.text
    out = r.json()
    assert out["reply"].startswith("Nigar") and out["remaining"] == 199
    c, s = out["proposals"]
    assert (c["action"], c["method"], c["path"]) == ("create_client", "POST", "/admin/clients")
    assert s["body"]["client_id"] == {"$ref": 0} and s["body"]["duration_min"] == 90
    assert s["body"]["discount"] == 5000 and "100,00 AZN" in s["summary"] or "100 AZN" in s["summary"]
    # funksiya cavabları Gemini-yə qayıdır, model məzmunu olduğu kimi geri göndərilir
    last = fake.sent[2]["contents"]
    assert last[-2]["parts"][0]["functionCall"]["name"] == "propose_create_client"
    assert last[-1]["parts"][1]["functionResponse"]["response"]["proposal_index"] == 1
    # heç nə yazılmayıb
    assert api.get("/api/admin/clients", headers=bearer(adm)).json() == [] or \
        all(x["full_name"] != "Nigar Əliyeva" for x in api.get("/api/admin/clients", headers=bearer(adm)).json())


def test_assistant_proposal_bodies_are_accepted_by_routes(api, gemini):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Aysel Məmmədova")
    s = make_shoot(api, adm, cid)
    day = s["starts_at"][:10]
    gemini(call("list_shoots", date=day),
           call("propose_shoot_action", shoot_id=s["id"], action="deposit")
           + call("propose_update_client", client_id=cid, phone="050 999 88 77")
           + call("propose_create_shoot", client_id=cid, date=day, start="18:00", duration_min=60,
                  kind="studio_rent", discount_percent=10),
           [{"text": "Hazırdır."}])
    out = api.post("/api/admin/assistant", json={"text": "Ayselin behini yaz"}, headers=bearer(adm)).json()
    dep, upd, rent = out["proposals"]
    assert dep["body"] == {"amount": 12000}
    assert rent["body"]["discount"] == 500 and rent["body"]["cameras"] == 0
    for p in (dep, upd, rent):
        r = api.request(p["method"], "/api" + p["path"], json=p["body"], headers=bearer(adm))
        assert r.status_code == 200, (p["action"], r.text)


def test_assistant_audio_and_bad_tool(api, gemini):
    adm = admin_token(api)
    fake = gemini(call("drop_tables"), call("find_clients", query="Zz"), [{"text": "Eşitdim: test"}])
    r = api.post("/api/admin/assistant", json={"audio": "AAAA", "mime": "audio/webm;codecs=opus"},
                 headers=bearer(adm)).json()
    assert r["reply"] == "Eşitdim: test" and r["proposals"] == []
    user = fake.sent[0]["contents"][-1]["parts"]
    assert user == [{"inlineData": {"mimeType": "audio/webm", "data": "AAAA"}}]
    assert fake.sent[1]["contents"][-1]["parts"][0]["functionResponse"]["response"] == {"error": "Belə alət yoxdur"}
    bad = api.post("/api/admin/assistant", json={"audio": "AAAA", "mime": "video/mp4"}, headers=bearer(adm))
    assert bad.status_code == 422
    assert api.post("/api/admin/assistant", json={"text": " "}, headers=bearer(adm)).status_code == 422


def test_assistant_edit_shoot_keeps_unchanged_fields(api, gemini):
    adm = admin_token(api)
    cid, _ = new_client(api, adm, "Zərifə Abbasova")
    s = make_shoot(api, adm, cid)
    gemini(call("propose_edit_shoot", shoot_id=s["id"], duration_min=180, cameras=3),
           [{"text": "Hazırdır."}])
    out = api.post("/api/admin/assistant", json={"text": "Zərifənin çəkilişini 3 saat, 3 kamera et"},
                   headers=bearer(adm)).json()
    (p,) = out["proposals"]
    assert p["method"] == "PATCH" and p["path"] == f"/admin/shoots/{s['id']}"
    assert p["body"]["duration_min"] == 180 and p["body"]["cameras"] == 3
    assert p["body"]["kind"] == s["kind"] and p["body"]["editing"] == s["editing"]
    assert "3 saat" in p["summary"] and "3 kamera" in p["summary"]
    r = api.request(p["method"], "/api" + p["path"], json=p["body"], headers=bearer(adm))
    assert r.status_code == 200, r.text
    assert r.json()["total"] > s["total"]
