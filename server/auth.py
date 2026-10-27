import hashlib
import hmac
import secrets
import time
from collections import defaultdict, deque
from datetime import timedelta
from typing import Optional

from argon2 import PasswordHasher
from argon2.exceptions import VerificationError
from fastapi import Depends, HTTPException, Request
from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DB

import settings
from db import aware, get_db, now
from models import Admin, Client, Invite, PairCode, Session

CLIENT_TTL = timedelta(days=180)
ADMIN_TTL = timedelta(days=30)
INVITE_TTL = timedelta(days=7)
PAIR_TTL = timedelta(minutes=15)
ADMIN_MAX_FAILS = 5
ADMIN_LOCK = timedelta(minutes=15)

ph = PasswordHasher()


def digest(value: str) -> str:
    return hmac.new(settings.SESSION_SECRET.encode(), value.encode(), hashlib.sha256).hexdigest()


def new_card_code() -> str:
    return secrets.token_urlsafe(9)  # 12 simvol


# --- sürət məhdudiyyəti (bir server nüsxəsi üçün yaddaşda kifayətdir) ---

_hits: dict[str, deque] = defaultdict(deque)


def rate_limit(key: str, limit: int, window_s: int) -> None:
    t = time.monotonic()
    q = _hits[key]
    while q and t - q[0] > window_s:
        q.popleft()
    if len(q) >= limit:
        raise HTTPException(429, "Çox cəhd. Bir az sonra yenidən yoxlayın.")
    q.append(t)


def client_ip(request: Request) -> str:
    fwd = request.headers.get("x-forwarded-for", "")
    return fwd.split(",")[0].strip() or (request.client.host if request.client else "")


# --- sessiyalar ---

def create_session(db: DB, kind: str, subject_id: int, user_agent: str = "") -> str:
    token = secrets.token_urlsafe(32)
    ttl = CLIENT_TTL if kind == "client" else ADMIN_TTL
    db.add(Session(subject_type=kind, subject_id=subject_id, token_hash=digest(token),
                   expires_at=now() + ttl, user_agent=user_agent[:255]))
    return token


def _session(request: Request, db: DB, kind: str) -> Session:
    header = request.headers.get("authorization", "")
    if not header.lower().startswith("bearer "):
        raise HTTPException(401, "Giriş lazımdır")
    s = db.scalar(select(Session).where(Session.token_hash == digest(header[7:].strip())))
    if not s or s.subject_type != kind or aware(s.expires_at) <= now():
        raise HTTPException(401, "Giriş lazımdır")
    # Müştəri sessiyası istifadə olunduqca uzanır; bazaya gündə ən çox bir dəfə yazırıq.
    if kind == "client" and now() - aware(s.last_seen_at) > timedelta(days=1):
        s.last_seen_at = now()
        s.expires_at = now() + CLIENT_TTL
        db.commit()
    return s


def current_client(request: Request, db: DB = Depends(get_db)) -> Client:
    client = db.get(Client, _session(request, db, "client").subject_id)
    if not client:
        raise HTTPException(401, "Giriş lazımdır")
    return client


def current_admin(request: Request, db: DB = Depends(get_db)) -> Admin:
    admin = db.get(Admin, _session(request, db, "admin").subject_id)
    if not admin:
        raise HTTPException(401, "Giriş lazımdır")
    return admin


def revoke_client_sessions(db: DB, client_id: int) -> None:
    db.execute(delete(Session).where(Session.subject_type == "client", Session.subject_id == client_id))


# --- dəvət və qoşulma kodu ---

def create_invite(db: DB, client: Client) -> str:
    """Yeni link köhnə linkləri və müştərinin bütün girişlərini bağlayır."""
    for old in db.scalars(select(Invite).where(Invite.client_id == client.id, Invite.used_at.is_(None))):
        old.expires_at = now()
    revoke_client_sessions(db, client.id)
    token = secrets.token_urlsafe(32)
    db.add(Invite(client_id=client.id, token_hash=digest(token), expires_at=now() + INVITE_TTL))
    return token


def redeem_invite(db: DB, token: str) -> Optional[Client]:
    inv = db.scalar(select(Invite).where(Invite.token_hash == digest(token)))
    if not inv or inv.used_at or aware(inv.expires_at) <= now():
        return None
    inv.used_at = now()
    client = db.get(Client, inv.client_id)
    if client and not client.activated_at:
        client.activated_at = now()
    return client


def create_pair_code(db: DB, client_id: int) -> str:
    for old in db.scalars(select(PairCode).where(PairCode.client_id == client_id, PairCode.used_at.is_(None))):
        old.expires_at = now()
    while True:
        code = f"{secrets.randbelow(10**6):06d}"
        clash = db.scalar(select(PairCode).where(PairCode.code_hash == digest(code), PairCode.used_at.is_(None),
                                                 PairCode.expires_at > now()))
        if not clash:
            break
    db.add(PairCode(client_id=client_id, code_hash=digest(code), expires_at=now() + PAIR_TTL))
    return code


def redeem_pair_code(db: DB, code: str) -> Optional[int]:
    rows = db.scalars(select(PairCode).where(PairCode.code_hash == digest(code), PairCode.used_at.is_(None)))
    for pc in rows:
        if aware(pc.expires_at) > now():
            pc.used_at = now()
            return pc.client_id
    return None


# --- admin ---

def ensure_admin(db: DB) -> None:
    """ADMIN_LOGIN və ADMIN_PASSWORD_HASH dəyişənlərindən admini yaradır və ya parolunu yeniləyir."""
    if not (settings.ADMIN_LOGIN and settings.ADMIN_PASSWORD_HASH):
        return
    admin = db.scalar(select(Admin).where(Admin.login == settings.ADMIN_LOGIN))
    if not admin:
        db.add(Admin(login=settings.ADMIN_LOGIN, name=settings.ADMIN_LOGIN, password_hash=settings.ADMIN_PASSWORD_HASH))
    elif admin.password_hash != settings.ADMIN_PASSWORD_HASH:
        admin.password_hash = settings.ADMIN_PASSWORD_HASH
        admin.failed_attempts = 0
        admin.locked_until = None
    db.commit()


def check_admin_password(db: DB, login: str, password: str) -> Optional[Admin]:
    admin = db.scalar(select(Admin).where(Admin.login == login))
    if not admin:
        ph.hash(password)  # vaxta görə login-in mövcudluğu bilinməsin
        return None
    if admin.locked_until and aware(admin.locked_until) > now():
        raise HTTPException(423, "Çox səhv cəhd. 15 dəqiqə sonra yenidən yoxlayın.")
    try:
        ph.verify(admin.password_hash, password)
    except VerificationError:
        admin.failed_attempts += 1
        if admin.failed_attempts >= ADMIN_MAX_FAILS:
            admin.locked_until = now() + ADMIN_LOCK
            admin.failed_attempts = 0
        db.commit()
        return None
    admin.failed_attempts = 0
    admin.locked_until = None
    return admin
