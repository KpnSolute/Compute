import json
from datetime import date, datetime, timedelta, timezone
from uuid import uuid4

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from pydantic import BaseModel

from backend.periods import business_now
from backend.kpnsolute_events import publish_menu_cycle, publish_menu_day
from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user, _require_manager

router = APIRouter(prefix="/api/menu", tags=["menu"])

# Legacy compat route (`GET /api/menu/{day}`) uses short weekday keys; index 0 = Sunday = cycle day 1.
LEGACY_DAY_INDEX = {
    "Sun": 0,
    "Mon": 1,
    "Tue": 2,
    "Wed": 3,
    "Thu": 4,
    "Fri": 5,
    "Sat": 6,
}

ANCHOR_SETTING_KEY = "menu_cycle_anchor_date"
CYCLE_LENGTH = 28


class SlotUpdate(BaseModel):
    item_id: str | None = None
    item_name: str | None = None
    active: bool | None = None


class SlotCreate(BaseModel):
    meal_group: str
    meal_period: str
    slot_name: str
    item_id: str | None = None
    item_name: str | None = None
    slot_order: int | None = None


class SettingsUpdate(BaseModel):
    anchor_date: str


class SuggestionStatusUpdate(BaseModel):
    status: str


VALID_SUGGESTION_STATUS = {"new", "reviewed", "applied", "dismissed"}


# ---------------------------------------------------------------------------
# Shared cycle-math helpers (also imported by backend.routes.public_menu).
# ---------------------------------------------------------------------------


def _get_anchor_date() -> date:
    r = (
        supabase_service.table("app_settings")
        .select("setting_value")
        .eq("setting_key", ANCHOR_SETTING_KEY)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(
            status_code=500, detail="menu_cycle_anchor_date is not configured"
        )
    raw = r.data[0]["setting_value"]
    # setting_value is jsonb; supabase-py returns the decoded value (plain 'YYYY-MM-DD'
    # string), but tolerate a JSON-encoded '"YYYY-MM-DD"' from other writers.
    if isinstance(raw, str):
        if raw.startswith('"'):
            try:
                raw = json.loads(raw)
            except (json.JSONDecodeError, TypeError):
                raise HTTPException(
                    status_code=500,
                    detail="menu_cycle_anchor_date has an invalid JSON-encoded value",
                )
        try:
            return date.fromisoformat(raw)
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=500,
                detail="menu_cycle_anchor_date is not a valid ISO date string",
            )
    raise HTTPException(
        status_code=500,
        detail="menu_cycle_anchor_date has an unexpected type",
    )


def _cycle_day_for_date(d: date, anchor: date | None = None) -> int:
    """1-28 cycle day for calendar date `d`. Cycle day 1 falls on `anchor` (a Sunday)."""
    anchor = anchor or _get_anchor_date()
    return ((d - anchor).days % CYCLE_LENGTH) + 1


def _fetch_item_names(item_ids: set[str]) -> dict[str, str]:
    if not item_ids:
        return {}
    r = (
        supabase_service.table("menu_items")
        .select("id,name")
        .in_("id", list(item_ids))
        .execute()
    )
    return {row["id"]: row["name"] for row in (r.data or [])}


def _fetch_day_row(cycle_day: int) -> dict:
    r = (
        supabase_service.table("menu_cycle_days")
        .select("*")
        .eq("cycle_day", cycle_day)
        .limit(1)
        .execute()
    )
    if not r.data:
        raise HTTPException(status_code=404, detail=f"No cycle day {cycle_day}")
    return r.data[0]


def _fetch_day_slots(cycle_day: int) -> list[dict]:
    r = (
        supabase_service.table("menu_cycle_slots")
        .select("*")
        .eq("cycle_day", cycle_day)
        .order("service_order")
        .order("slot_order")
        .execute()
    )
    return r.data or []


def _slot_payload(s: dict, item_names: dict[str, str]) -> dict:
    return {
        "record_id": s["record_id"],
        "meal_group": s["meal_group"],
        "meal_period": s["meal_period"],
        "service_order": s["service_order"],
        "slot_order": s["slot_order"],
        "slot_name": s["slot_name"],
        "item_id": s.get("item_id"),
        "item_name": item_names.get(s.get("item_id")),
        "active": s.get("active"),
    }


def _single_slot_payload(slot: dict) -> dict:
    item_names = _fetch_item_names({slot["item_id"]} if slot.get("item_id") else set())
    return _slot_payload(slot, item_names)


def _build_day_payload(cycle_day: int) -> dict:
    day_row = _fetch_day_row(cycle_day)
    slots = _fetch_day_slots(cycle_day)
    item_names = _fetch_item_names({s["item_id"] for s in slots if s.get("item_id")})
    return {
        "cycle_day": day_row["cycle_day"],
        "cycle_week": day_row["cycle_week"],
        "day_of_week": day_row["day_of_week"],
        "zone": day_row.get("zone"),
        "morning_service": day_row.get("morning_service"),
        "midday_service": day_row.get("midday_service"),
        "evening_service": day_row.get("evening_service"),
        "active": day_row.get("active"),
        "slots": [_slot_payload(s, item_names) for s in slots],
    }


def _menu_day_event_payload(cycle_day: int) -> dict:
    day = _build_day_payload(cycle_day)
    today = business_now().date()
    service_date = today + timedelta(
        days=(cycle_day - _cycle_day_for_date(today)) % CYCLE_LENGTH
    )
    meals: dict[str, list[dict]] = {}
    for slot in day["slots"]:
        if not slot.get("active") or not slot.get("item_name"):
            continue
        meals.setdefault(slot["meal_period"], []).append(
            {
                "slot_name": slot["slot_name"],
                "item_name": slot["item_name"],
                "item_id": slot.get("item_id"),
            }
        )
    return {
        "rotation_id": "primary",
        "anchor_date": _get_anchor_date().isoformat(),
        "date": service_date.isoformat(),
        "cycle_day": day["cycle_day"],
        "cycle_week": day["cycle_week"],
        "day_of_week": day["day_of_week"],
        "meals": meals,
    }


def _menu_cycle_event_payload() -> dict:
    return {
        "rotation_id": "primary",
        "anchor_date": _get_anchor_date().isoformat(),
        "days": [
            _menu_day_event_payload(cycle_day)
            for cycle_day in range(1, CYCLE_LENGTH + 1)
        ],
    }


def _resolve_item(item_id: str | None, item_name: str | None) -> str | None:
    """Return an item_id, creating a new menu_items row if only a name was given."""
    if item_id:
        return item_id
    if not item_name:
        return None
    item_key = item_name.strip().upper()
    existing = (
        supabase_service.table("menu_items")
        .select("id")
        .eq("item_key", item_key)
        .limit(1)
        .execute()
    )
    if existing.data:
        return existing.data[0]["id"]
    max_r = (
        supabase_service.table("menu_items")
        .select("id")
        .order("id", desc=True)
        .limit(1)
        .execute()
    )
    next_num = 1
    if max_r.data:
        last_id = max_r.data[0]["id"]
        try:
            next_num = int(last_id.split("-")[1]) + 1
        except (IndexError, ValueError):
            next_num = 1
    new_id = f"MENU-{next_num:04d}"
    supabase_service.table("menu_items").insert(
        {"id": new_id, "name": item_name.strip(), "item_key": item_key, "active": True}
    ).execute()
    return new_id


def _actor_name(auth_user: dict) -> str:
    return auth_user.get("username") or auth_user.get("display_name") or "api"


# meal_period → meal_group for slots created outside the original import.
GROUP_FOR_PERIOD = {
    "Breakfast": "Morning",
    "Brunch": "Morning",
    "Short Order": "Short Order",
    "Lunch": "Midday",
    "Dinner": "Evening",
}


def legacy_target_cycle_day(day: str) -> int:
    """Cycle day in the CURRENT cycle week matching short weekday `day` (Sun..Sat)."""
    today_cycle_day = _cycle_day_for_date(business_now().date())
    current_week = (today_cycle_day - 1) // 7
    return current_week * 7 + LEGACY_DAY_INDEX[day] + 1


def legacy_day_menu(day: str) -> dict[str, list[str]]:
    """Active item names grouped by meal_period for the legacy short-weekday view.

    Shared by the legacy GET route and the AI data-entry pipeline (ai/tools.py,
    ai/diff.py, staging/dispatch.py)."""
    slots = _fetch_day_slots(legacy_target_cycle_day(day))
    item_names = _fetch_item_names({s["item_id"] for s in slots if s.get("item_id")})
    data: dict[str, list[str]] = {}
    for s in slots:
        if not s.get("active"):
            continue
        name = item_names.get(s.get("item_id"))
        if name:
            data.setdefault(s["meal_period"], []).append(name)
    return data


# ---------------------------------------------------------------------------
# Cycle overview / day / today
# ---------------------------------------------------------------------------


@router.get("/cycle/overview")
async def cycle_overview(auth_user: dict = Depends(_get_auth_user)):
    anchor = _get_anchor_date()
    today = business_now().date()
    today_cycle_day = _cycle_day_for_date(today, anchor)
    days_r = (
        supabase_service.table("menu_cycle_days")
        .select("*")
        .order("cycle_day")
        .execute()
    )
    days = [
        {
            "cycle_day": d["cycle_day"],
            "cycle_week": d["cycle_week"],
            "day_of_week": d["day_of_week"],
            "zone": d.get("zone"),
            "morning_service": d.get("morning_service"),
            "midday_service": d.get("midday_service"),
            "evening_service": d.get("evening_service"),
            "active": d.get("active"),
        }
        for d in (days_r.data or [])
    ]
    return {
        "anchor_date": anchor.isoformat(),
        "today": {"date": today.isoformat(), "cycle_day": today_cycle_day},
        "days": days,
    }


@router.get("/cycle/day/{n}")
async def cycle_day(n: int, auth_user: dict = Depends(_get_auth_user)):
    if not 1 <= n <= CYCLE_LENGTH:
        raise HTTPException(status_code=400, detail="cycle_day must be 1-28")
    return _build_day_payload(n)


@router.get("/today")
async def menu_today(auth_user: dict = Depends(_get_auth_user)):
    today = business_now().date()
    cycle_day_num = _cycle_day_for_date(today)
    payload = _build_day_payload(cycle_day_num)
    payload["date"] = today.isoformat()
    return payload


# ---------------------------------------------------------------------------
# Slot mutation
# ---------------------------------------------------------------------------


@router.put("/slot/{record_id}")
async def update_slot(
    record_id: str,
    body: SlotUpdate,
    background_tasks: BackgroundTasks,
    auth_user: dict = Depends(_require_manager),
):
    existing = (
        supabase_service.table("menu_cycle_slots")
        .select("*")
        .eq("record_id", record_id)
        .limit(1)
        .execute()
    )
    if not existing.data:
        raise HTTPException(status_code=404, detail=f"Unknown slot {record_id}")

    updates: dict = {}
    if body.item_id or body.item_name:
        resolved = _resolve_item(body.item_id, body.item_name)
        if resolved:
            updates["item_id"] = resolved
    if body.active is not None:
        updates["active"] = body.active
    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates["updated_by"] = _actor_name(auth_user)
    updates["updated_at"] = datetime.now(timezone.utc).isoformat()

    result = (
        supabase_service.table("menu_cycle_slots")
        .update(updates)
        .eq("record_id", record_id)
        .execute()
    )
    response = _single_slot_payload(result.data[0])
    background_tasks.add_task(
        publish_menu_day, _menu_day_event_payload(existing.data[0]["cycle_day"])
    )
    return response


@router.post("/cycle/day/{n}/slots")
async def create_slot(
    n: int,
    body: SlotCreate,
    background_tasks: BackgroundTasks,
    auth_user: dict = Depends(_require_manager),
):
    if not 1 <= n <= CYCLE_LENGTH:
        raise HTTPException(status_code=400, detail="cycle_day must be 1-28")

    item_id = _resolve_item(body.item_id, body.item_name)

    slot_order = body.slot_order
    if slot_order is None:
        max_r = (
            supabase_service.table("menu_cycle_slots")
            .select("slot_order")
            .eq("cycle_day", n)
            .eq("meal_period", body.meal_period)
            .order("slot_order", desc=True)
            .limit(1)
            .execute()
        )
        slot_order = (max_r.data[0]["slot_order"] + 1) if max_r.data else 1

    record_id = f"MJCC28-D{n:02d}-CUSTOM-{uuid4().hex[:6].upper()}"
    now = datetime.now(timezone.utc).isoformat()
    row = {
        "record_id": record_id,
        "cycle_day": n,
        "meal_group": body.meal_group,
        "meal_period": body.meal_period,
        "service_order": 0,
        "slot_order": slot_order,
        "slot_name": body.slot_name,
        "item_id": item_id,
        "active": True,
        "updated_by": _actor_name(auth_user),
        "updated_at": now,
    }
    result = supabase_service.table("menu_cycle_slots").insert(row).execute()
    response = _single_slot_payload(result.data[0])
    background_tasks.add_task(publish_menu_day, _menu_day_event_payload(n))
    return response


# ---------------------------------------------------------------------------
# Item lookup, settings, suggestions
# ---------------------------------------------------------------------------


@router.get("/items")
async def list_items(q: str = "", auth_user: dict = Depends(_get_auth_user)):
    query = (
        supabase_service.table("menu_items").select("id,name,active").eq("active", True)
    )
    if q:
        query = query.ilike("name", f"%{q}%")
    result = query.order("name").limit(50).execute()
    return result.data or []


@router.get("/settings")
async def get_settings(auth_user: dict = Depends(_get_auth_user)):
    return {"anchor_date": _get_anchor_date().isoformat()}


@router.put("/settings")
async def update_settings(
    body: SettingsUpdate,
    background_tasks: BackgroundTasks,
    auth_user: dict = Depends(_require_manager),
):
    try:
        parsed = date.fromisoformat(body.anchor_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="anchor_date must be YYYY-MM-DD")
    if parsed.weekday() != 6:
        raise HTTPException(status_code=400, detail="anchor_date must be a Sunday")
    # Plain string — PostgREST encodes it as a jsonb string; json.dumps here would double-encode.
    supabase_service.table("app_settings").update(
        {"setting_value": parsed.isoformat()}
    ).eq("setting_key", ANCHOR_SETTING_KEY).execute()
    background_tasks.add_task(publish_menu_cycle, _menu_cycle_event_payload())
    return {"anchor_date": parsed.isoformat()}


@router.post("/events/publish-cycle", status_code=202)
async def publish_cycle_event(
    background_tasks: BackgroundTasks,
    auth_user: dict = Depends(_require_manager),
):
    background_tasks.add_task(publish_menu_cycle, _menu_cycle_event_payload())
    return {
        "accepted": True,
        "event_type": "com.kpnsolute.compute.menu.cycle.updated.v1",
    }


@router.get("/suggestions")
async def list_suggestions(status: str = "", auth_user: dict = Depends(_get_auth_user)):
    query = supabase_service.table("menu_suggestions").select("*")
    if status:
        query = query.eq("status", status)
    result = query.order("created_at", desc=True).execute()
    return result.data or []


@router.put("/suggestions/{suggestion_id}")
async def update_suggestion(
    suggestion_id: str,
    body: SuggestionStatusUpdate,
    auth_user: dict = Depends(_require_manager),
):
    if body.status not in VALID_SUGGESTION_STATUS:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {sorted(VALID_SUGGESTION_STATUS)}",
        )
    result = (
        supabase_service.table("menu_suggestions")
        .update({"status": body.status})
        .eq("id", suggestion_id)
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    return result.data[0]


# ---------------------------------------------------------------------------
# Legacy compat — GET/POST /api/menu/{day}. Declared LAST so literal routes
# above (cycle/*, today, slot/*, items, settings, suggestions) match first.
# ---------------------------------------------------------------------------


@router.get("/{day}")
async def get_menu_legacy(day: str, auth_user: dict = Depends(_get_auth_user)):
    if day not in LEGACY_DAY_INDEX:
        raise HTTPException(status_code=400, detail=f"Invalid day: {day}")

    day_row = _fetch_day_row(legacy_target_cycle_day(day))
    data = legacy_day_menu(day)
    return {
        "id": day,
        "data": data,
        "sides": {k: [] for k in data},
        "day_of_week": day_row["day_of_week"],
    }


@router.post("/{day}")
async def update_menu_legacy(day: str, auth_user: dict = Depends(_get_auth_user)):
    raise HTTPException(status_code=410, detail="Use PUT /api/menu/slot/{record_id}")
