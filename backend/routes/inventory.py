from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel
from backend.routes import supabase

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


class InventoryPayload(BaseModel):
    id: int
    data: dict
    synced_by: str = "api"


@router.get("")
async def get_inventory(month: int = Query(None), year: int = Query(None)):
    if month is not None and year is not None:
        period = year * 100 + month
        result = supabase.table("inventory_sync").select("*").eq("id", period).execute()
    else:
        result = (
            supabase.table("inventory_sync")
            .select("*")
            .order("id", desc=True)
            .limit(1)
            .execute()
        )

    if not result.data:
        raise HTTPException(status_code=404, detail="Inventory not found")

    return result.data


@router.post("")
async def push_inventory(payload: InventoryPayload):
    result = (
        supabase.table("inventory_sync")
        .upsert(
            {
                "id": payload.id,
                "data": payload.data,
                "synced_by": payload.synced_by,
            }
        )
        .execute()
    )
    return result.data


@router.get("/reorders")
async def get_reorders():
    result = (
        supabase.table("inventory_sync")
        .select("*")
        .order("id", desc=True)
        .limit(1)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=404, detail="No inventory found")

    inventory = result.data[0]
    data = inventory.get("data", {})

    low_items = []
    for category, items in data.items():
        for item in items:
            if item.get("onHand", 0) < item.get("par", 0):
                low_items.append(
                    {
                        "category": category,
                        "sku": item.get("sku"),
                        "desc": item.get("desc"),
                        "onHand": item.get("onHand"),
                        "par": item.get("par"),
                        "short": item.get("par", 0) - item.get("onHand", 0),
                    }
                )

    return low_items
