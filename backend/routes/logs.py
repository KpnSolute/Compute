from datetime import datetime
from fastapi import APIRouter
from pydantic import BaseModel
from backend.routes import supabase

router = APIRouter(prefix="/api/logs", tags=["logs"])


class LogUpsert(BaseModel):
    data: dict
    updated_by: str = "api"


@router.get("/{key}")
async def get_log(key: str):
    result = supabase.table("haccp_logs").select("*").eq("id", key).execute()

    if not result.data:
        return {"id": key, "data": None}

    return result.data[0]


@router.post("/{key}")
async def upsert_log(key: str, body: LogUpsert):
    now = datetime.utcnow().isoformat()
    result = (
        supabase.table("haccp_logs")
        .upsert(
            {
                "id": key,
                "data": body.data,
                "updated_by": body.updated_by,
                "updated_at": now,
            }
        )
        .execute()
    )
    return result.data
