from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional
from backend.routes import supabase

router = APIRouter(prefix="/api/events", tags=["events"])


class EventCreate(BaseModel):
    title: str
    date: str
    cat: str
    theme: Optional[str] = ""
    description: Optional[str] = ""
    menu: Optional[dict] = None


@router.get("")
async def list_events():
    result = supabase.table("events").select("*").order("date").execute()
    return result.data


@router.post("")
async def create_event(event: EventCreate):
    payload = event.model_dump(exclude_none=True)
    result = supabase.table("events").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create event")
    return result.data[0]
