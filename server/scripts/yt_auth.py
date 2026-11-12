"""YouTube kommentləri üçün açarları bir dəfə alır və Railway-ə (servis `app`) yazır. Heç bir açar ekrana çıxmır.

Sahibkar terminalda işlədir (server qovluğunda):
    .venv/bin/python scripts/yt_auth.py

1. Client ID və Client Secret soruşulur (Google Cloud → Credentials → OAuth client, növü «Desktop app»).
2. Brauzer açılır: YouTube kanalının sahibi olan Google hesabı ilə girib icazə verin.
3. Skript refresh token-i və kanal ID-sini alır, dörd dəyişəni Railway-ə yazır (YT_CLIENT_ID, YT_CLIENT_SECRET,
   YT_REFRESH_TOKEN, YT_CHANNEL_ID). Sonuncu yazılış servisi yenidən başladır.
"""
import base64
import getpass
import hashlib
import http.server
import json
import secrets
import subprocess
import sys
import threading
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_URL = "https://oauth2.googleapis.com/token"
CHANNELS_URL = "https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true"
SCOPE = "https://www.googleapis.com/auth/youtube.force-ssl"  # komment oxumaq və cavab yazmaq (crm/youtube.py)


def start_listener(state: str):
    """127.0.0.1-də müvəqqəti server: Google brauzeri bura qaytarır. (nəticə dict-i, redirect_uri, axın)."""
    got: dict = {}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):
            q = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
            if q.get("state", [""])[0] == state:
                got["code"] = q.get("code", [""])[0]
                got["error"] = q.get("error", [""])[0]
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            msg = "Hazırdır, bu pəncərəni bağlayıb terminala qayıdın." if got.get("code") else "Alınmadı, terminala baxın."
            self.wfile.write(f"<h2 style='font-family:sans-serif'>{msg}</h2>".encode())

        def log_message(self, *a):  # URL-də kod var: terminala yazılmasın
            pass

    srv = http.server.HTTPServer(("127.0.0.1", 0), Handler)

    def serve():
        for _ in range(10):  # favicon kimi artıq sorğular da gələ bilər
            if got.get("code") or got.get("error"):
                break
            srv.handle_request()

    t = threading.Thread(target=serve, daemon=True)
    t.start()
    return got, f"http://127.0.0.1:{srv.server_port}", t


def post(url: str, data: dict) -> dict:
    req = urllib.request.Request(url, data=urllib.parse.urlencode(data).encode(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.load(r)
    except urllib.error.HTTPError as e:
        try:
            body = json.loads(e.read() or b"{}")
        except ValueError:
            body = {}
        sys.exit(f"Google xətası: {body.get('error_description') or body.get('error') or e.code}")


def set_var(key: str, value: str, deploy: bool) -> None:
    cmd = ["railway", "variable", "set", key, "--stdin", "-s", "app"] + ([] if deploy else ["--skip-deploys"])
    r = subprocess.run(cmd, input=value, text=True, capture_output=True)
    if r.returncode != 0:
        sys.exit(f"Railway-ə yazılmadı ({key}). Bu qovluqda `railway login` və `railway link` yoxlayın.")
    print(f"  ✓ {key}")


def main() -> None:
    client_id = input("Client ID: ").strip()
    client_secret = getpass.getpass("Client Secret (yazanda görünmür): ").strip()
    if not client_id.endswith(".apps.googleusercontent.com") or not client_secret:
        sys.exit("Client ID və ya Secret düz deyil (Credentials → OAuth client → Desktop app).")
    state = secrets.token_urlsafe(16)
    verifier = secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    got, redirect, t = start_listener(state)
    url = AUTH_URL + "?" + urllib.parse.urlencode({
        "client_id": client_id, "redirect_uri": redirect, "response_type": "code", "scope": SCOPE,
        "access_type": "offline", "prompt": "consent", "state": state,
        "code_challenge": challenge, "code_challenge_method": "S256"})
    print("\nBrauzer açılır. YouTube kanalının sahibi olan hesabla girin və icazə verin.")
    print("«Google hasn't verified this app» çıxsa: Advanced → Go to … (unsafe). Bu sizin öz app-ınızdır.")
    if not webbrowser.open(url):
        print("Brauzer açılmadı, bu linki özünüz açın:\n" + url)
    t.join(timeout=600)
    if not got.get("code"):
        sys.exit(f"İcazə alınmadı ({got.get('error') or 'vaxt bitdi'}).")
    tok = post(TOKEN_URL, {"code": got["code"], "client_id": client_id, "client_secret": client_secret,
                           "redirect_uri": redirect, "grant_type": "authorization_code", "code_verifier": verifier})
    refresh = tok.get("refresh_token")
    if not refresh:
        sys.exit("Refresh token gəlmədi. myaccount.google.com/permissions-də bu app-ın icazəsini silib yenidən işlədin.")
    req = urllib.request.Request(CHANNELS_URL, headers={"Authorization": f"Bearer {tok['access_token']}"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            items = json.load(r).get("items") or []
    except urllib.error.HTTPError as e:
        sys.exit(f"Kanal oxunmadı (HTTP {e.code}). YouTube Data API v3 layihədə Enable edilibmi?")
    if not items:
        sys.exit("Bu Google hesabında YouTube kanalı tapılmadı. Kanalın sahibi olan hesabla yenidən işlədin.")
    channel = items[0]
    print(f"\nKanal: {channel['snippet']['title']}")
    if input("Bu kanaldır? (h/y): ").strip().lower() not in ("h", "hə", "he"):
        sys.exit("Dayandırıldı, heç nə yazılmadı.")
    print("Railway-ə yazılır:")
    set_var("YT_CLIENT_ID", client_id, False)
    set_var("YT_CLIENT_SECRET", client_secret, False)
    set_var("YT_REFRESH_TOKEN", refresh, False)
    set_var("YT_CHANNEL_ID", channel["id"], True)
    print("\nHazırdır. Server 1–2 dəqiqəyə yenidən başlayacaq; yeni YouTube kommentləri Telegram-a qaralama kimi gələcək.")


if __name__ == "__main__":
    main()
