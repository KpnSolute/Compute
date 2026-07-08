"""
Cost Manager API Endpoints

Analytical/budgeting layer over data already tracked elsewhere: inventory
value columns on monthly_inventory (opening/pulled/received/ending value)
and purchase spend on invoices (net_total). Adds one small table,
cost_budgets, holding the manager-set monthly government allotment.

Endpoints:
- GET /api/cost/budget - Get the budget row for a month/year
- POST /api/cost/budget - Upsert the budget for a month/year (manager+)
- GET /api/cost/summary - Category breakdown + spend-vs-budget for a period
- GET /api/cost/trend - Trailing N months of total spend vs. budget
- GET /api/cost/averages - Historical average pull cost / reviewable spend
"""

import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.periods import to_db_month, to_ui_month
from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user, _require_admin_or_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cost", tags=["cost"])

_INV_JOIN_SELECT = (
    "opening_value, pulled_value, received_value, ending_value, "
    "inventory_items!inner(category_id, inventory_categories!inner(id, name, color, icon))"
)

# How many trailing months /trend and /averages look back by default.
_DEFAULT_TREND_MONTHS = 6


class CostBudgetIn(BaseModel):
    month: int = Field(..., ge=1, le=12)
    year: int
    gov_allotment: float = Field(..., ge=0)
    planned_pull_amount: Optional[float] = None
    planned_reviewable_amount: Optional[float] = None
    notes: Optional[str] = None


class CostBudgetResponse(BaseModel):
    id: str
    month: int
    year: int
    gov_allotment: float
    planned_pull_amount: Optional[float] = None
    planned_reviewable_amount: Optional[float] = None
    notes: Optional[str] = None
    created_by: Optional[str] = None
    created_at: str
    updated_at: str


def _budget_response(row: dict) -> CostBudgetResponse:
    row = dict(row)
    row["month"] = to_ui_month(row["month"])
    return CostBudgetResponse(**row)


def _get_budget_row(db_month: int, year: int) -> Optional[dict]:
    r = (
        supabase_service.table("cost_budgets")
        .select("*")
        .eq("month", db_month)
        .eq("year", year)
        .limit(1)
        .execute()
    )
    return r.data[0] if r.data else None


def _period_totals(db_month: int, year: int) -> dict:
    """Aggregate monthly_inventory value columns (by category) + invoice spend for a period."""
    try:
        inv_r = (
            supabase_service.table("monthly_inventory")
            .select(_INV_JOIN_SELECT)
            .eq("month", db_month)
            .eq("year", year)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    categories: dict[str, dict] = {}
    total_starting = total_pulled = total_received = total_ending = 0.0
    for row in inv_r.data or []:
        item = row.get("inventory_items") or {}
        cat = item.get("inventory_categories") or {}
        cat_id = cat.get("id") or "uncategorized"
        bucket = categories.setdefault(
            cat_id,
            {
                "category_id": cat_id,
                "name": cat.get("name") or "Uncategorized",
                "color": cat.get("color"),
                "icon": cat.get("icon"),
                "opening_value": 0.0,
                "pulled_value": 0.0,
                "received_value": 0.0,
                "ending_value": 0.0,
            },
        )
        opening = float(row.get("opening_value") or 0)
        pulled = float(row.get("pulled_value") or 0)
        received = float(row.get("received_value") or 0)
        ending = float(row.get("ending_value") or 0)
        bucket["opening_value"] += opening
        bucket["pulled_value"] += pulled
        bucket["received_value"] += received
        bucket["ending_value"] += ending
        total_starting += opening
        total_pulled += pulled
        total_received += received
        total_ending += ending

    try:
        inv_totals_r = (
            supabase_service.table("invoices")
            .select("net_total")
            .eq("month", db_month)
            .eq("year", year)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    reviewable_spend = sum(float(r.get("net_total") or 0) for r in (inv_totals_r.data or []))
    total_spend = total_pulled + reviewable_spend

    return {
        "category_breakdown": sorted(categories.values(), key=lambda c: c["name"]),
        "total_starting": round(total_starting, 2),
        "total_pulled": round(total_pulled, 2),
        "total_received": round(total_received, 2),
        "total_ending": round(total_ending, 2),
        "reviewable_spend": round(reviewable_spend, 2),
        "total_spend": round(total_spend, 2),
    }


def _walk_back(db_month: int, year: int) -> tuple[int, int]:
    """Previous (db_month, year), db_month is 0-indexed."""
    if db_month == 0:
        return 11, year - 1
    return db_month - 1, year


@router.get("/budget", response_model=Optional[CostBudgetResponse])
async def get_budget(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(...),
    auth_user: dict = Depends(_get_auth_user),
):
    """Get the cost_budgets row for a month/year, or null if none set yet."""
    row = _get_budget_row(to_db_month(month), year)
    return _budget_response(row) if row else None


@router.post("/budget", response_model=CostBudgetResponse, status_code=201)
async def save_budget(
    body: CostBudgetIn,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Upsert the government-allotment budget for a month/year. Manager+ only."""
    record = {
        "month": to_db_month(body.month),
        "year": body.year,
        "gov_allotment": body.gov_allotment,
        "planned_pull_amount": body.planned_pull_amount,
        "planned_reviewable_amount": body.planned_reviewable_amount,
        "notes": body.notes,
        "created_by": auth_user["id"],
    }
    try:
        result = supabase_service.table("cost_budgets").upsert(record, on_conflict="month,year").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=500, detail="Failed to save budget")
    return _budget_response(row)


@router.get("/summary")
async def get_summary(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(...),
    auth_user: dict = Depends(_get_auth_user),
):
    """Category breakdown + total spend vs. the period's budget."""
    db_month = to_db_month(month)
    totals = _period_totals(db_month, year)
    budget_row = _get_budget_row(db_month, year)
    gov_allotment = float(budget_row["gov_allotment"]) if budget_row else 0.0
    pct_used = round((totals["total_spend"] / gov_allotment) * 100, 1) if gov_allotment > 0 else None

    return {
        "budget": _budget_response(budget_row) if budget_row else None,
        "pct_used": pct_used,
        **totals,
    }


@router.get("/trend")
async def get_trend(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(...),
    months: int = Query(_DEFAULT_TREND_MONTHS, ge=1, le=24),
    auth_user: dict = Depends(_get_auth_user),
):
    """Trailing N months (inclusive of month/year) of total spend vs. budget, oldest first."""
    points = []
    db_month, cur_year = to_db_month(month), year
    for _ in range(months):
        totals = _period_totals(db_month, cur_year)
        budget_row = _get_budget_row(db_month, cur_year)
        points.append(
            {
                "month": to_ui_month(db_month),
                "year": cur_year,
                "total_spend": totals["total_spend"],
                "gov_allotment": float(budget_row["gov_allotment"]) if budget_row else None,
            }
        )
        db_month, cur_year = _walk_back(db_month, cur_year)
    points.reverse()
    return points


@router.get("/averages")
async def get_averages(
    months: int = Query(_DEFAULT_TREND_MONTHS, ge=1, le=24),
    auth_user: dict = Depends(_get_auth_user),
):
    """Average pull cost and average reviewable spend across the trailing N months with data."""
    from backend.periods import business_now

    now = business_now()
    db_month, cur_year = to_db_month(now.month), now.year
    pull_values, reviewable_values = [], []
    for _ in range(months):
        totals = _period_totals(db_month, cur_year)
        if totals["total_pulled"] or totals["reviewable_spend"]:
            pull_values.append(totals["total_pulled"])
            reviewable_values.append(totals["reviewable_spend"])
        db_month, cur_year = _walk_back(db_month, cur_year)

    avg_pull = round(sum(pull_values) / len(pull_values), 2) if pull_values else 0.0
    avg_reviewable = round(sum(reviewable_values) / len(reviewable_values), 2) if reviewable_values else 0.0
    return {
        "avg_pull_amount": avg_pull,
        "avg_reviewable_amount": avg_reviewable,
        "months_sampled": len(pull_values),
    }
