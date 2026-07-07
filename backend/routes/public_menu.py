"""Public, unauthenticated menu endpoints for lunchvoice.com and similar consumers.

No bearer auth on GET routes — the cycle menu is public info for students.
POST /suggestions is protected by a shared `X-Api-Key` header (env MENU_API_KEY).
"""

import os
from datetime import date

from fastapi import APIRouter, Header, HTTPException, Query
from pydantic import BaseModel, Field

from backend.periods import business_now
from backend.routes import supabase_service
from backend.routes.menu import (
    CYCLE_LENGTH,
    _build_day_payload,
    _cycle_day_for_date,
    _fetch_item_names,
    _get_anchor_date,
)

router = APIRouter(prefix="/api/public/menu", tags=["public-menu"])


def _hour_value(row: dict, key: str) -> float | None:
    raw = row.get(key)
    if raw is None:
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


def _meal_period_status(now=None) -> dict:
    now = now or business_now()
    rows = (
        supabase_service.table("meal_periods")
        .select("meal,label,open_hour,close_hour,sort_order")
        .order("sort_order")
        .execute()
        .data
        or []
    )
    periods = []
    current = None
    next_period = None
    now_hour = now.hour + (now.minute / 60)
    for row in rows:
        open_hour = _hour_value(row, "open_hour")
        close_hour = _hour_value(row, "close_hour")
        item = {
            "meal": row.get("meal"),
            "label": row.get("label") or row.get("meal"),
            "open_hour": open_hour,
            "close_hour": close_hour,
            "sort_order": row.get("sort_order") or 0,
        }
        if open_hour is not None and close_hour is not None:
            item["active"] = open_hour <= now_hour < close_hour
            if item["active"] and current is None:
                current = item
            if now_hour < open_hour and next_period is None:
                next_period = item
        else:
            item["active"] = False
        periods.append(item)
    return {
        "now": now.isoformat(),
        "current_period": current,
        "next_period": next_period,
        "periods": periods,
    }


def _compact_day_payload(
    day_row: dict, slots: list[dict], item_names: dict[str, str]
) -> dict:
    meals: dict[str, list[dict]] = {}
    for s in slots:
        if not s.get("active"):
            continue
        name = item_names.get(s.get("item_id"))
        if not name:
            continue
        meals.setdefault(s["meal_period"], []).append(
            {"slot_name": s["slot_name"], "item_name": name}
        )
    return {
        "cycle_day": day_row["cycle_day"],
        "day_of_week": day_row["day_of_week"],
        "meals": meals,
    }


def _public_day_for_date(d: date) -> dict:
    day_payload = _build_day_payload(_cycle_day_for_date(d))
    meals: dict[str, list[dict]] = {}
    for s in day_payload["slots"]:
        if not s["active"] or not s["item_name"]:
            continue
        meals.setdefault(s["meal_period"], []).append(
            {"slot_name": s["slot_name"], "item_name": s["item_name"]}
        )
    payload = {
        "date": d.isoformat(),
        "cycle_day": day_payload["cycle_day"],
        "cycle_week": day_payload["cycle_week"],
        "day_of_week": day_payload["day_of_week"],
        "meals": meals,
    }
    if d == business_now().date():
        payload["service_status"] = _meal_period_status()
    return payload


@router.get("/today")
async def public_today():
    try:
        return _public_day_for_date(business_now().date())
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Menu data error: {e}")


@router.get("/date/{iso_date}")
async def public_date(iso_date: str):
    try:
        d = date.fromisoformat(iso_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="date must be YYYY-MM-DD")
    return _public_day_for_date(d)


@router.get("/cycle")
async def public_cycle(include_stats: bool = False):
    anchor = _get_anchor_date()
    days_r = (
        supabase_service.table("menu_cycle_days")
        .select("*")
        .order("cycle_day")
        .execute()
    )
    days_by_num = {d["cycle_day"]: d for d in (days_r.data or [])}
    slots_r = (
        supabase_service.table("menu_cycle_slots")
        .select("*")
        .order("cycle_day")
        .order("service_order")
        .order("slot_order")
        .execute()
    )
    slots = slots_r.data or []
    item_names = _fetch_item_names({s["item_id"] for s in slots if s.get("item_id")})

    slots_by_day: dict[int, list[dict]] = {}
    for s in slots:
        slots_by_day.setdefault(s["cycle_day"], []).append(s)

    days = [
        _compact_day_payload(days_by_num[n], slots_by_day.get(n, []), item_names)
        for n in range(1, CYCLE_LENGTH + 1)
        if n in days_by_num
    ]
    if include_stats:
        stats_by_day: dict[int, list[dict]] = {}
        rows = (
            supabase_service.table("menu_feedback_summary").select("*").execute().data
            or []
        )
        for row in rows:
            stats_by_day.setdefault(row["cycle_day"], []).append(row)
        for day in days:
            day["feedback"] = sorted(
                stats_by_day.get(day["cycle_day"], []), key=_feedback_sort_key
            )
    return {"anchor_date": anchor.isoformat(), "days": days}


def _feedback_sort_key(row: dict) -> tuple[int, float]:
    return (-(row.get("response_count") or 0), -(row.get("avg_rating") or 0))


@router.get("/stats")
async def public_menu_stats(limit: int = Query(10, ge=1, le=100)):
    rows = (
        supabase_service.table("menu_feedback_summary").select("*").execute().data or []
    )
    rows = sorted(rows, key=_feedback_sort_key)
    return {"rows": rows, "top_meals": rows[:limit]}


class SuggestionCreate(BaseModel):
    suggested_item: str = Field(..., max_length=200)
    cycle_day: int | None = Field(None, ge=1, le=28)
    meal_period: str | None = None
    slot_name: str | None = None
    notes: str | None = Field(None, max_length=1000)
    submitted_by: str | None = None
    source: str | None = None


@router.post("/suggestions")
async def public_create_suggestion(body: SuggestionCreate, x_api_key: str = Header("")):
    expected = os.getenv("MENU_API_KEY")
    if not expected:
        raise HTTPException(status_code=503, detail="MENU_API_KEY is not configured")
    if x_api_key != expected:
        raise HTTPException(status_code=403, detail="Invalid API key")

    payload = body.model_dump(exclude_none=True)
    if not payload.get("source"):
        payload["source"] = "lunchvoice"
    result = supabase_service.table("menu_suggestions").insert(payload).execute()
    if not result.data:
        raise HTTPException(status_code=500, detail="Failed to create suggestion")
    return {"id": result.data[0]["id"]}
