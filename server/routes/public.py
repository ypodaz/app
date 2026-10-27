from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session as DB

from auth import (check_admin_password, client_ip, create_pair_code, create_session, rate_limit,
                  redeem_invite, redeem_pair_code)
from db import get_db

router = APIRouter(prefix="/api")


class TokenIn(BaseModel):
    token: str = Field(min_length=20, max_length=100)


class CodeIn(BaseModel):
    code: str = Field(pattern=r"^\d{6}$")


class LoginIn(BaseModel):
    login: str = Field(min_length=1, max_length=64)
    password: str = Field(min_length=1, max_length=200)


@router.post("/auth/redeem")
def redeem(body: TokenIn, request: Request, db: DB = Depends(get_db)):
    rate_limit("redeem:" + client_ip(request), 20, 900)
    client = redeem_invite(db, body.token)
    if not client:
        raise HTTPException(400, "Link etibarsızdır və ya artıq istifadə olunub. Studiyadan yeni link istəyin.")
    token = create_session(db, "client", client.id, request.headers.get("user-agent", ""))
    code = create_pair_code(db, client.id)
    db.commit()
    return {"token": token, "pair_code": code, "full_name": client.full_name}


@router.post("/auth/pair")
def pair(body: CodeIn, request: Request, db: DB = Depends(get_db)):
    rate_limit("pair:" + client_ip(request), 10, 900)
    client_id = redeem_pair_code(db, body.code)
    if not client_id:
        db.rollback()
        raise HTTPException(400, "Kod səhvdir və ya vaxtı keçib.")
    token = create_session(db, "client", client_id, request.headers.get("user-agent", ""))
    db.commit()
    return {"token": token}


@router.post("/admin/login")
def admin_login(body: LoginIn, request: Request, db: DB = Depends(get_db)):
    rate_limit("login:" + client_ip(request), 20, 900)
    admin = check_admin_password(db, body.login, body.password)
    if not admin:
        raise HTTPException(400, "Login və ya parol səhvdir.")
    token = create_session(db, "admin", admin.id, request.headers.get("user-agent", ""))
    db.commit()
    return {"token": token, "name": admin.name}
