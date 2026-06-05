from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from typing import Optional
from backend.routes import supabase_service, jwt_validator

router = APIRouter(prefix="/api/events", tags=["events"])


class EventCreate(BaseModel):
    title: str
    date: str
    cat: str
    theme: Optional[str] = ""
    description: Optional[str] = ""
    suggested_menu: Optional[str] = None


async def _get_auth_user(authorization: str = Header("")) -> dict:
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")
    if token.startswith("pin_"):
        user_id = token.replace("pin_", "")
        try:
            r = (
                supabase_service.table("user_profiles")
                .select("*")
                .eq("id", user_id)
                .single()
                .execute()
            )
            user = r.data if r.data else None
        except Exception:
            user = None
        if not user or not user.get("active"):
            raise HTTPException(status_code=401, detail="Invalid session")
        return user
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")
    try:
        r = (
            supabase_service.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        user = r.data if r.data else None
    except Exception:
        user = None
    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return user


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
