from datetime import datetime
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from backend.routes import supabase

router = APIRouter(prefix="/api/menu", tags=["menu"])


class MenuUpdate(BaseModel):
    data: dict
    updated_by: str = "api"


VALID_DAYS = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}


@router.get("/{day}")
async def get_menu(day: str):
    if day not in VALID_DAYS:
        raise HTTPException(status_code=400, detail=f"Invalid day: {day}")

    result = supabase.table("cycle_menu").select("*").eq("id", day).execute()

    if not result.data:
        return {"id": day, "data": None}

    return result.data[0]


@router.post("/{day}")
async def update_menu(day: str, body: MenuUpdate):
    if day not in VALID_DAYS:
        raise HTTPException(status_code=400, detail=f"Invalid day: {day}")

    now = datetime.utcnow().isoformat()
    result = (
        supabase.table("cycle_menu")
        .upsert(
            {
                "id": day,
                "data": body.data,
                "updated_by": body.updated_by,
                "updated_at": now,
            }
        )
        .execute()
    )
    return result.data
