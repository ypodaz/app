from fastapi import APIRouter, Depends, Request
from sqlalchemy import delete
from sqlalchemy.orm import Session as DB

from auth import create_pair_code, current_client, digest
from db import get_db
from models import Client, Session

router = APIRouter(prefix="/api/me")


@router.get("")
def me(client: Client = Depends(current_client)):
    return {"full_name": client.full_name, "card_code": client.card_code}


@router.post("/pair-code")
def pair_code(client: Client = Depends(current_client), db: DB = Depends(get_db)):
    code = create_pair_code(db, client.id)
    db.commit()
    return {"pair_code": code}


@router.post("/logout")
def logout(request: Request, client: Client = Depends(current_client), db: DB = Depends(get_db)):
    token = request.headers["authorization"][7:].strip()
    db.execute(delete(Session).where(Session.token_hash == digest(token)))
    db.commit()
    return {"ok": True}
