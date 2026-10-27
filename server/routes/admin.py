import re
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session as DB

import settings
from auth import create_invite, current_admin, new_card_code
from db import get_db
from models import Admin, Client

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])


class ClientIn(BaseModel):
    full_name: str = Field(min_length=2, max_length=120)
    phone: str = Field(default="", max_length=32)


def client_out(c: Client) -> dict:
    return {"id": c.id, "full_name": c.full_name, "phone": c.phone, "activated": c.activated_at is not None}


def wa_number(phone: str) -> str:
    """055 530 35 32 → 994555303532"""
    d = re.sub(r"\D", "", phone)
    if d.startswith("0") and len(d) == 10:
        d = "994" + d[1:]
    return d


@router.get("/clients")
def list_clients(db: DB = Depends(get_db)):
    return [client_out(c) for c in db.scalars(select(Client).order_by(Client.full_name))]


@router.post("/clients")
def add_client(body: ClientIn, db: DB = Depends(get_db)):
    c = Client(full_name=body.full_name.strip(), phone=body.phone.strip(), card_code=new_card_code())
    db.add(c)
    db.commit()
    return client_out(c)


@router.post("/clients/{client_id}/invite")
def invite(client_id: int, db: DB = Depends(get_db)):
    c = db.get(Client, client_id)
    if not c:
        raise HTTPException(404, "Müştəri tapılmadı")
    url = settings.APP_URL + "?i=" + create_invite(db, c)
    db.commit()
    text = f"Salam, {c.full_name}! Y Pod app-ına giriş linkiniz (7 gün etibarlıdır): {url}"
    number = wa_number(c.phone)
    return {"url": url, "whatsapp_url": f"https://wa.me/{number}?text={quote(text)}" if number else None}


@router.get("/cards/{card_code}")
def by_card(card_code: str, db: DB = Depends(get_db)):
    c = db.scalar(select(Client).where(Client.card_code == card_code))
    if not c:
        raise HTTPException(404, "Kart tapılmadı")
    return client_out(c)


@router.get("/whoami")
def whoami(admin: Admin = Depends(current_admin)):
    return {"name": admin.name}
