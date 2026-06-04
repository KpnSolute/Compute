import json
from datetime import datetime
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
from backend.routes import supabase, jwt_validator

router = APIRouter(prefix="/api/menu", tags=["menu"])

VALID_DAYS = {"Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"}

MEAL_PERIODS = {
    "Mon": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Tue": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Wed": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Thu": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Fri": ["Breakfast", "Lunch", "Dinner", "Snack"],
    "Sat": ["Brunch", "Dinner", "Snack"],
    "Sun": ["Brunch", "Dinner", "Snack"],
}


class MenuUpdate(BaseModel):
    data: dict
    updated_by: str = "api"


async def _get_auth_user(authorization: str = Header("")) -> dict:
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    if token.startswith("pin_"):
        user_id = token.replace("pin_", "")
        try:
            result = (
                supabase.table("user_profiles")
                .select("*")
                .eq("id", user_id)
                .single()
                .execute()
            )
            user = result.data if result.data else None
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
        result = (
            supabase.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        user = result.data if result.data else None
    except Exception:
        user = None

    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user


def _get_active_cycle() -> str | None:
    result = (
        supabase.table("menu_cycles").select("id").eq("active", True).limit(1).execute()
    )
    if result.data:
        return result.data[0]["id"]
    return None


def _parse_items(items_field) -> list:
    if items_field is None:
        return []
    if isinstance(items_field, list):
        return items_field
    if isinstance(items_field, str):
        if items_field.startswith("["):
            try:
                return json.loads(items_field)
            except (json.JSONDecodeError, ValueError):
                pass
        return [s.strip() for s in items_field.split("|") if s.strip()]
    return []


@router.get("/{day}")
async def get_menu(day: str, auth_user: dict = Depends(_get_auth_user)):
    if day not in VALID_DAYS:
        raise HTTPException(status_code=400, detail=f"Invalid day: {day}")

    cycle_id = _get_active_cycle()
    if not cycle_id:
        return {"id": day, "data": {p: [] for p in MEAL_PERIODS[day]}}

    result = (
        supabase.table("menu_entries")
        .select("*")
        .eq("day_of_week", day)
        .eq("cycle_id", cycle_id)
        .execute()
    )

    data = {p: [] for p in MEAL_PERIODS[day]}
    if result.data:
        for row in result.data:
            meal_type = row.get("meal_type")
            if meal_type not in data:
                continue
            data[meal_type] = _parse_items(row.get("items"))

    return {"id": day, "data": data}


@router.post("/{day}")
async def update_menu(
    day: str, body: MenuUpdate, auth_user: dict = Depends(_get_auth_user)
):
    if day not in VALID_DAYS:
        raise HTTPException(status_code=400, detail=f"Invalid day: {day}")

    cycle_id = _get_active_cycle()
    if not cycle_id:
        raise HTTPException(status_code=404, detail="No active menu cycle found")

    now = datetime.utcnow().isoformat()

    supabase.table("menu_entries").delete().eq("day_of_week", day).eq(
        "cycle_id", cycle_id
    ).execute()

    inserts = []
    periods = MEAL_PERIODS[day]
    for sort_order, meal_type in enumerate(periods):
        items = body.data.get(meal_type, [])
        # menu_entries.items is a text column — serialize lists as JSON strings.
        inserts.append(
            {
                "cycle_id": cycle_id,
                "week_number": 1,
                "day_of_week": day,
                "meal_type": meal_type,
                "items": json.dumps(items if isinstance(items, list) else []),
                "sort_order": sort_order,
                "created_at": now,
                "updated_at": now,
            }
        )

    if inserts:
        result = supabase.table("menu_entries").insert(inserts).execute()
        return result.data

    return []
