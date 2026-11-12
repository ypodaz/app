"""Müştəri bazası API: axtarış və detal (scripts/build_people.py ilə qurulur)."""
from typing import Literal

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session as DB

from auth import current_admin
from db import get_db
from models import Person
from views import iso

router = APIRouter(prefix="/api/admin", dependencies=[Depends(current_admin)])


def person_out(p: Person) -> dict:
    return {"id": p.id, "display_name": p.display_name, "phone": p.phone, "ig_username": p.ig_username,
            "client_id": p.client_id, "profession": p.profession, "workplace": p.workplace, "reason": p.reason,
            "service": p.service, "need": p.need, "phones_found": [x for x in p.phones_found.split(",") if x],
            "summary": p.summary, "outcome": p.outcome, "sources": [x for x in p.sources.split(",") if x],
            "msg_count": p.msg_count, "first_contact_at": iso(p.first_contact_at),
            "last_contact_at": iso(p.last_contact_at), "card_at": iso(p.card_at),
            "wa_link": f"https://wa.me/{p.phone}" if p.phone else None,
            "ig_link": f"https://ig.me/m/{p.ig_username}" if p.ig_username else None}


@router.get("/people")
def people_list(q: str | None = None, outcome: Literal["client", "lead", "lost", "unknown"] | None = None,
                source: Literal["ig", "wa", "app", "contacts"] | None = None, limit: int = Query(50, ge=1, le=200),
                offset: int = Query(0, ge=0), db: DB = Depends(get_db)):
    stmt = select(Person)
    if outcome:
        stmt = stmt.where(Person.outcome == outcome)
    if source:  # sources vergüllə yazılıb: ,ig,wa, içində axtar
        stmt = stmt.where(("," + Person.sources + ",").like(f"%,{source},%"))
    if q and q.strip():
        like = f"%{q.strip()}%"
        digits = "".join(c for c in q if c.isdigit())
        conds = [Person.display_name.ilike(like), Person.ig_username.ilike(like), Person.profession.ilike(like),
                 Person.workplace.ilike(like), Person.service.ilike(like), Person.summary.ilike(like)]
        if len(digits) >= 4:  # telefon: sondakı rəqəmlər
            conds.append(Person.phone.like(f"%{digits[-9:]}%"))
        stmt = stmt.where(or_(*conds))
    total = db.scalar(select(func.count()).select_from(stmt.subquery()))
    rows = db.scalars(stmt.order_by(Person.last_contact_at.desc().nulls_last(), Person.id.desc())
                      .limit(limit).offset(offset)).all()
    return {"items": [person_out(p) for p in rows], "total": total}


@router.get("/people/{person_id}")
def person_get(person_id: int, db: DB = Depends(get_db)):
    p = db.get(Person, person_id)
    if not p:
        raise HTTPException(404, "Şəxs tapılmadı")
    return person_out(p)
