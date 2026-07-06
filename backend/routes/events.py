from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import Optional
from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user, _require_assistant

router = APIRouter(prefix="/api/events", tags=["events"])


class EventCreate(BaseModel):
    title: str
    date: str
    cat: str
    theme: Optional[str] = ""
    description: Optional[str] = ""
    suggested_menu: Optional[str] = None


# _get_auth_user imported from backend.routes._deps (single source of truth).


@router.get("")
async def list_events(auth_user: dict = Depends(_get_auth_user)):
    result = supabase_service.table("events").select("*").order("date").execute()
    return result.data


@router.post("")
async def create_event(event: EventCreate, auth_user: dict = Depends(_get_auth_user)):
    payload = event.model_dump(exclude_none=True)
    result = supabase_service.table("events").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create event")
    return result.data[0]


@router.delete("/{event_id}")
async def delete_event(event_id: str, auth_user: dict = Depends(_require_assistant)):
    result = supabase_service.table("events").delete().eq("id", event_id).execute()
    if not result.data:
        raise HTTPException(status_code=404, detail="Event not found")
    return {"deleted": True, "id": event_id}
