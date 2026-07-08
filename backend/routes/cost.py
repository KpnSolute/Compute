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
- GET/POST/PATCH/DELETE /api/cost/line-items - Customizable Task-ID budget
  line items (cost or revenue), internalizing the org's external
  "Department Budget Report" format, scoped to a Nov-Oct fiscal year.
- PUT /api/cost/line-items/{id}/actual - Manual monthly actual entry
  for line items without an auto_source.
"""

import calendar
import logging
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend import inventory_formulas as fi
from backend.periods import to_db_month, to_ui_month
from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user, _require_admin_or_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cost", tags=["cost"])

_INV_JOIN_SELECT = (
    "opening_oh, w1_received, w2_received, w3_received, w1_pulled, w2_pulled, w3_pulled, "
    "unit_price, opening_unit_cost, opening_value, received_value, pulled_value, "
    "inventory_items!inner(category_id, inventory_categories!inner(id, name, color, icon))"
)
# Per-item dollar values are computed the exact same way GET /api/inventory does
# (backend/routes/inventory.py::_flatten_rows): trust the stored *_value column
# when present, otherwise fall back to the canonical inventory_formulas.py
# helpers. Confirmed live that 42/333 rows had a NULL opening_value (and
# therefore ending_value) for one period — a plain `sum(opening_value)` silently
# counted those as $0 instead of their real computed value, undercounting
# Cost Manager's totals against the Dashboard's own figures. Never trust a
# nullable stored column without this fallback.

# How many trailing months /trend and /averages look back by default.
_DEFAULT_TREND_MONTHS = 6


class CostBudgetIn(BaseModel):
    month: int = Field(..., ge=1, le=12)
    year: int
    gov_allotment: float = Field(..., ge=0)
    w1_planned_pull: Optional[float] = None
    w2_planned_pull: Optional[float] = None
    w3_planned_pull: Optional[float] = None
    w1_planned_renewable: Optional[float] = None
    w2_planned_renewable: Optional[float] = None
    w3_planned_renewable: Optional[float] = None
    notes: Optional[str] = None


class CostBudgetResponse(BaseModel):
    id: str
    month: int
    year: int
    gov_allotment: float
    w1_planned_pull: Optional[float] = None
    w2_planned_pull: Optional[float] = None
    w3_planned_pull: Optional[float] = None
    w1_planned_renewable: Optional[float] = None
    w2_planned_renewable: Optional[float] = None
    w3_planned_renewable: Optional[float] = None
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
        oh = max(0, int(fi.num(row.get("opening_oh"))))
        total_recv_qty = fi.total_received(row.get("w1_received"), row.get("w2_received"), row.get("w3_received"))
        total_pull_qty = fi.total_pulled(row.get("w1_pulled"), row.get("w2_pulled"), row.get("w3_pulled"))
        price = fi.num(row.get("unit_price"))
        opening_unit_cost = fi.num(row.get("opening_unit_cost")) or price

        stored_opening = row.get("opening_value")
        opening = float(stored_opening) if stored_opening is not None else fi.opening_value(oh, opening_unit_cost)
        stored_received = row.get("received_value")
        received = float(stored_received) if stored_received is not None else fi.received_value(total_recv_qty, price)
        stored_pulled = row.get("pulled_value")
        pulled = float(stored_pulled) if stored_pulled is not None else fi.pulled_value(total_pull_qty, price)
        ending = fi.ending_value(opening, received, pulled)
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
    # What's actually taken out of the government allotment is inventory activity
    # itself — whatever is received (delivered/bought this period) plus whatever
    # is pulled (drawn from stock and used) — not the separate invoices table.
    # reviewable_spend is still returned (Budget Line Items can auto-track it
    # as its own line item), it just no longer feeds the top-level ceiling math.
    total_spend = total_received + total_pulled

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


def _fy_start_year(ui_month: int, year: int) -> int:
    """This org's fiscal year runs Nov-Oct. Returns the calendar year it starts in."""
    return year if ui_month >= 11 else year - 1


def _month_date_range(db_month: int, year: int) -> tuple[str, str]:
    """First/last calendar date (YYYY-MM-DD) for a 0-indexed db_month/year."""
    ui_month = to_ui_month(db_month)
    last_day = calendar.monthrange(year, ui_month)[1]
    return f"{year:04d}-{ui_month:02d}-01", f"{year:04d}-{ui_month:02d}-{last_day:02d}"


def _auto_actual(auto_source: str, db_month: int, year: int) -> float:
    """Live-computed actual for a line item linked to an existing data source."""
    if auto_source == "pulled":
        return _period_totals(db_month, year)["total_pulled"]
    if auto_source == "received":
        return _period_totals(db_month, year)["total_received"]
    if auto_source == "renewable":
        return _period_totals(db_month, year)["reviewable_spend"]
    if auto_source == "snack_bar_revenue":
        start, end = _month_date_range(db_month, year)
        try:
            r = (
                supabase_service.table("snack_bar_sales")
                .select("register_sales")
                .gte("business_date", start)
                .lte("business_date", end)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        return sum(float(row.get("register_sales") or 0) for row in (r.data or []))
    return 0.0


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
        "w1_planned_pull": body.w1_planned_pull,
        "w2_planned_pull": body.w2_planned_pull,
        "w3_planned_pull": body.w3_planned_pull,
        "w1_planned_renewable": body.w1_planned_renewable,
        "w2_planned_renewable": body.w2_planned_renewable,
        "w3_planned_renewable": body.w3_planned_renewable,
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


class BudgetLineItemIn(BaseModel):
    task_id: Optional[str] = None
    description: str = Field(..., min_length=1)
    line_type: str = Field("cost", pattern="^(cost|revenue)$")
    annual_budget: float = Field(..., ge=0)
    auto_source: Optional[str] = Field(None, pattern="^(pulled|received|renewable|snack_bar_revenue)$")
    sort_order: int = 0


class BudgetLineItemResponse(BaseModel):
    id: str
    fy_start_year: int
    task_id: Optional[str] = None
    description: str
    line_type: str
    annual_budget: float
    auto_source: Optional[str] = None
    sort_order: int
    active: bool
    created_by: Optional[str] = None
    created_at: str
    updated_at: str


class LineItemActualIn(BaseModel):
    actual_amount: float = Field(..., ge=0)


@router.get("/line-items")
async def get_line_items(
    month: int = Query(..., ge=1, le=12),
    year: int = Query(...),
    auth_user: dict = Depends(_get_auth_user),
):
    """
    List active budget line items for the fiscal year (Nov-Oct) containing month/year,
    each enriched with the current period's monthly_budget (annual/12), monthly_actual
    (auto-computed for linked line items, manually entered otherwise), variance, and status.
    """
    db_month = to_db_month(month)
    fy = _fy_start_year(month, year)
    try:
        r = (
            supabase_service.table("budget_line_items")
            .select("*")
            .eq("fy_start_year", fy)
            .eq("active", True)
            .order("line_type")
            .order("sort_order")
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    items = r.data or []
    if not items:
        return []

    manual_ids = [it["id"] for it in items if not it.get("auto_source")]
    actuals_map: dict[str, float] = {}
    if manual_ids:
        try:
            ar = (
                supabase_service.table("budget_line_actuals")
                .select("line_item_id, actual_amount")
                .in_("line_item_id", manual_ids)
                .eq("month", db_month)
                .eq("year", year)
                .execute()
            )
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
        actuals_map = {row["line_item_id"]: float(row["actual_amount"]) for row in (ar.data or [])}

    results = []
    for it in items:
        monthly_budget = round(float(it["annual_budget"]) / 12, 2)
        auto_source = it.get("auto_source")
        if auto_source:
            actual = round(_auto_actual(auto_source, db_month, year), 2)
        elif it["id"] in actuals_map:
            actual = round(actuals_map[it["id"]], 2)
        else:
            actual = None

        if actual is None:
            variance = None
            status = "pending"
        else:
            variance = round(actual - monthly_budget, 2)
            if monthly_budget <= 0:
                status = "on_track"
            elif actual > monthly_budget * 1.10:
                status = "over_budget"
            elif actual < monthly_budget * 0.5:
                status = "under_budget"
            else:
                status = "on_track"

        results.append({
            **it,
            "monthly_budget": monthly_budget,
            "monthly_actual": actual,
            "variance": variance,
            "status": status,
        })
    return results


@router.post("/line-items", response_model=BudgetLineItemResponse, status_code=201)
async def create_line_item(
    body: BudgetLineItemIn,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(...),
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Create a budget line item in the fiscal year containing month/year. Manager+ only."""
    record = {
        "fy_start_year": _fy_start_year(month, year),
        "task_id": body.task_id,
        "description": body.description,
        "line_type": body.line_type,
        "annual_budget": body.annual_budget,
        "auto_source": body.auto_source,
        "sort_order": body.sort_order,
        "created_by": auth_user["id"],
    }
    try:
        result = supabase_service.table("budget_line_items").insert(record).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create line item")
    return row


@router.patch("/line-items/{item_id}", response_model=BudgetLineItemResponse)
async def update_line_item(
    item_id: str,
    body: BudgetLineItemIn,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Update a budget line item. Manager+ only."""
    record = {
        "task_id": body.task_id,
        "description": body.description,
        "line_type": body.line_type,
        "annual_budget": body.annual_budget,
        "auto_source": body.auto_source,
        "sort_order": body.sort_order,
    }
    try:
        result = (
            supabase_service.table("budget_line_items")
            .update(record)
            .eq("id", item_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=404, detail="Line item not found")
    return row


@router.delete("/line-items/{item_id}", status_code=204)
async def delete_line_item(
    item_id: str,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Delete a budget line item and its manual actuals (cascade). Manager+ only."""
    try:
        supabase_service.table("budget_line_items").delete().eq("id", item_id).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.put("/line-items/{item_id}/actual")
async def set_line_item_actual(
    item_id: str,
    body: LineItemActualIn,
    month: int = Query(..., ge=1, le=12),
    year: int = Query(...),
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Set/update a manual line item's actual spend for a month. Manager+ only."""
    try:
        item_r = (
            supabase_service.table("budget_line_items")
            .select("auto_source")
            .eq("id", item_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    item_row = item_r.data[0] if item_r.data else None
    if not item_row:
        raise HTTPException(status_code=404, detail="Line item not found")
    if item_row.get("auto_source"):
        raise HTTPException(status_code=400, detail="This line item is auto-computed and cannot be manually edited")

    record = {
        "line_item_id": item_id,
        "month": to_db_month(month),
        "year": year,
        "actual_amount": body.actual_amount,
        "updated_by": auth_user["id"],
    }
    try:
        result = (
            supabase_service.table("budget_line_actuals")
            .upsert(record, on_conflict="line_item_id,month,year")
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=500, detail="Failed to save actual")
    return row
