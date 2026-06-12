"""
Inventory Management API Endpoints

Provides endpoints for inventory snapshots, history, and reorder management.
Uses normalized tables: inventory_items, inventory_categories, monthly_inventory, live_inventory.

Endpoints:
- GET /api/inventory - Get inventory snapshot (specific month/year or latest)
- POST /api/inventory - Save inventory snapshot
- GET /api/inventory/history - Get past snapshots
- GET /api/inventory/reorders - Get low-stock items
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Header, Depends
from pydantic import BaseModel, Field
from backend.routes import supabase_service, jwt_validator
from backend.inventory_identity import (
    get_new_items_category_id,
    resolve_and_write_item,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


class InventoryItem(BaseModel):
    sku: str
    desc: str
    onHand: int = Field(0, ge=0)
    # Optional so a save that does not include par does NOT zero the shared
    # inventory_items.par_level (which would corrupt par across every period).
    par: Optional[int] = Field(None, ge=0)
    category: str
    price: Optional[float] = Field(None, ge=0)
    unit: str = "each"
    w1r: Optional[int] = None
    w2r: Optional[int] = None
    w3r: Optional[int] = None
    w4r: Optional[int] = None
    w1i: Optional[int] = None
    w2i: Optional[int] = None
    w3i: Optional[int] = None
    w4i: Optional[int] = None


class InventorySnapshot(BaseModel):
    items: list[InventoryItem]
    metadata: dict = Field(default_factory=dict)
    notes: str = ""


class InventoryResponse(BaseModel):
    id: str
    items: list[InventoryItem]
    metadata: dict
    notes: str
    created_at: str


class LowStockItem(BaseModel):
    sku: str
    desc: str
    category: str
    onHand: int
    par: int
    short: int


async def _get_auth_user(authorization: str = Header("")) -> dict:
    """
    Extract authenticated user from Bearer token.

    Supports both Supabase JWT and PIN-based tokens.

    Raises:
        401: Missing or invalid token
    """
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    # Handle PIN-based tokens
    if token.startswith("pin_"):
        user_id = token.replace("pin_", "")
        try:
            result = (
                supabase_service.table("user_profiles")
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

    # Handle Supabase JWT tokens
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")

    try:
        result = (
            supabase_service.table("user_profiles")
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


def _to_float(v, default=0.0) -> float:
    try:
        return float(v) if v is not None else default
    except (ValueError, TypeError):
        return default


def _flatten_rows(rows: list[dict]) -> list[InventoryItem]:
    """Flatten nested Supabase join result into InventoryItem list."""
    items = []
    for row in rows:
        inv_item = row.get("inventory_items") or {}
        cat = inv_item.get("inventory_categories") or {}
        oh = max(0, int(_to_float(row.get("on_hand"))))
        items.append(
            InventoryItem(
                sku=inv_item.get("sku") or "",
                desc=inv_item.get("description") or "",
                onHand=oh,
                par=max(0, int(_to_float(inv_item.get("par_level")))),
                category=cat.get("name") or "",
                price=_to_float(row.get("unit_price")),
                unit=inv_item.get("unit") or "each",
                w1r=int(_to_float(row.get("w1_received"))),
                w2r=int(_to_float(row.get("w2_received"))),
                w3r=int(_to_float(row.get("w3_received"))),
                w4r=int(_to_float(row.get("w4_received"))),
                w1i=int(_to_float(row.get("w1_issued"))),
                w2i=int(_to_float(row.get("w2_issued"))),
                w3i=int(_to_float(row.get("w3_issued"))),
                w4i=int(_to_float(row.get("w4_issued"))),
            )
        )
    return items


def _serialize_dt(dt) -> str:
    if dt is None:
        return ""
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return str(dt)


_JOIN_SELECT = (
    "id, month, year, on_hand, "
    "w1_received, w2_received, w3_received, w4_received, "
    "w1_issued, w2_issued, w3_issued, w4_issued, "
    "unit_price, created_at, "
    "inventory_items!inner(sku, description, par_level, unit, "
    "  inventory_categories!inner(name)"
    ")"
)


@router.get("", response_model=InventoryResponse)
async def get_inventory(
    month: int = Query(None),
    year: int = Query(None),
    auth_user: dict = Depends(_get_auth_user),
):
    """
    Get inventory snapshot for a specific month/year or latest.

    Requires: Valid authentication token

    Query Parameters:
    - month: Month (1-12) for specific period
    - year: Year (YYYY) for specific period
    - If both provided, returns snapshot for that month; else returns latest

    Returns:
        Inventory snapshot with items grouped by category

    Raises:
        401: Missing or invalid auth
        404: No inventory found
        500: Database error
    """
    try:
        if month is not None and year is not None:
            if month < 1 or month > 12:
                raise HTTPException(status_code=400, detail="Month must be 1-12")
            db_month = month - 1  # API uses 1-indexed, DB uses 0-indexed
        else:
            latest = (
                supabase_service.table("monthly_inventory")
                .select("month, year")
                .order("year", desc=True)
                .order("month", desc=True)
                .limit(1)
                .execute()
            )
            if not latest.data:
                raise HTTPException(status_code=404, detail="No inventory found")
            db_month = latest.data[0]["month"]  # 0-indexed from DB
            month = db_month + 1  # Convert to 1-indexed for response
            year = latest.data[0]["year"]

        result = (
            supabase_service.table("monthly_inventory")
            .select(_JOIN_SELECT)
            .eq("month", db_month)
            .eq("year", year)
            .order("sku", foreign_table="inventory_items")
            .execute()
        )

        if not result.data:
            raise HTTPException(status_code=404, detail="Inventory not found")

        items = _flatten_rows(result.data)
        period_id = f"{year}-{month:02d}"
        created_at = _serialize_dt(result.data[0].get("created_at"))

        return InventoryResponse(
            id=period_id,
            items=items,
            metadata={"month": month, "year": year, "period": period_id},
            notes="",
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in get_inventory")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.post("", response_model=InventoryResponse, status_code=201)
async def save_inventory(
    payload: InventorySnapshot, auth_user: dict = Depends(_get_auth_user)
):
    """
    Save a new inventory snapshot.

    Requires: Valid authentication token (manager or admin recommended)

    Request Body:
    - items: List of inventory items
    - metadata: Optional metadata dict (can contain month/year)
    - notes: Optional notes about this snapshot

    Returns:
        Created inventory snapshot

    Raises:
        400: Invalid input
        401: Missing or invalid auth
        500: Database error
    """
    if not payload.items:
        raise HTTPException(status_code=400, detail="Items list cannot be empty")

    for item in payload.items:
        # Guard before comparing: item.par is Optional, so `item.par < 0` on a
        # None par would raise TypeError → 500 (v1.8.5 latent bug).
        if item.onHand < 0 or (item.par is not None and item.par < 0):
            raise HTTPException(
                status_code=400, detail="onHand and par must be non-negative"
            )

    meta = payload.metadata or {}
    month = meta.get("month")  # 1-indexed from frontend
    year = meta.get("year")
    if month is None or year is None:
        now = datetime.now(timezone.utc)
        month = month or now.month  # 1-indexed
        year = year or now.year

    if month < 1 or month > 12:
        raise HTTPException(status_code=400, detail="Month must be 1-12")

    db_month = month - 1  # Convert 1-indexed → 0-indexed for DB

    try:
        # Pre-fetch category name -> id mapping + the New Items review bucket.
        cat_result = supabase_service.table("inventory_categories").select("id, name").execute()
        category_map = {}
        for c in cat_result.data or []:
            category_map[c["name"]] = c["id"]
        new_items_cat_id = get_new_items_category_id(supabase_service)

        created_at = datetime.now(timezone.utc).isoformat()

        for item in payload.items:
            # Identity resolved by SKU only (sku is now NOT NULL + UNIQUE). An
            # unknown/blank category resolves to None so a brand-new item lands
            # in "New Items" for manager review instead of failing or guessing.
            cat_id = category_map.get(item.category)

            inv_item_id, _sku, _created = resolve_and_write_item(
                supabase_service,
                sku=item.sku,
                desc=item.desc,
                category_id=cat_id,
                fallback_category_id=new_items_cat_id,
                price=item.price,
                par=item.par,
                unit=item.unit or None,
            )
            if not inv_item_id:
                continue

            # Upsert monthly_inventory by item_id + month + year (DB stores 0-indexed month).
            # Weekly columns are only written when explicitly provided — omitting them
            # preserves existing W1-W4 data instead of zeroing it on every save (P0.2).
            monthly_fields = {
                "item_id": inv_item_id,
                "month": db_month,
                "year": year,
                "on_hand": item.onHand,
            }
            if item.price is not None:
                monthly_fields["unit_price"] = item.price
            for src, col in [
                ("w1r", "w1_received"), ("w2r", "w2_received"),
                ("w3r", "w3_received"), ("w4r", "w4_received"),
                ("w1i", "w1_issued"),   ("w2i", "w2_issued"),
                ("w3i", "w3_issued"),   ("w4i", "w4_issued"),
            ]:
                val = getattr(item, src)
                if val is not None:
                    monthly_fields[col] = val
            supabase_service.table("monthly_inventory").upsert(
                monthly_fields,
                on_conflict="item_id,month,year",
            ).execute()

        # Rebuild and return the full snapshot
        result = (
            supabase_service.table("monthly_inventory")
            .select(_JOIN_SELECT)
            .eq("month", db_month)
            .eq("year", year)
            .order("sku", foreign_table="inventory_items")
            .execute()
        )

        items = _flatten_rows(result.data or [])
        period_id = f"{year}-{month:02d}"

        return InventoryResponse(
            id=period_id,
            items=items,
            metadata={"month": month, "year": year, "period": period_id},
            notes=payload.notes,
            created_at=created_at,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in save_inventory")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/history", response_model=list[InventoryResponse])
async def get_inventory_history(
    limit: int = Query(10, ge=1, le=100), auth_user: dict = Depends(_get_auth_user)
):
    """
    Get historical inventory snapshots.

    Requires: Valid authentication token

    Query Parameters:
    - limit: Maximum snapshots to return (1-100, default 10)

    Returns:
        List of inventory snapshots ordered by date descending

    Raises:
        401: Missing or invalid auth
        500: Database error
    """
    try:
        # Get distinct (month, year) pairs ordered desc
        periods = (
            supabase_service.table("monthly_inventory")
            .select("month, year")
            .order("year", desc=True)
            .order("month", desc=True)
            .execute()
        )

        if not periods.data:
            return []

        # Deduplicate in Python
        seen = set()
        distinct = []
        for p in periods.data:
            key = (p["year"], p["month"])
            if key not in seen:
                seen.add(key)
                distinct.append(p)
                if len(distinct) >= limit:
                    break

        snapshots = []
        for p in distinct:
            y, db_m = p["year"], p["month"]  # db_m is 0-indexed
            result = (
                supabase_service.table("monthly_inventory")
                .select(_JOIN_SELECT)
                .eq("month", db_m)
                .eq("year", y)
                .order("sku", foreign_table="inventory_items")
                .execute()
            )
            if not result.data:
                continue

            items = _flatten_rows(result.data)
            m = db_m + 1  # 1-indexed for display
            period_id = f"{y}-{m:02d}"
            created_at = _serialize_dt(result.data[0].get("created_at"))

            snapshots.append(
                InventoryResponse(
                    id=period_id,
                    items=items,
                    metadata={"month": m, "year": y, "period": period_id},
                    notes="",
                    created_at=created_at or "",
                )
            )

        return snapshots

    except Exception as e:
        logger.exception("Error in get_inventory_history")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/reorders", response_model=list[LowStockItem])
async def get_reorders(auth_user: dict = Depends(_get_auth_user)):
    """
    Get low-stock items requiring reorder.

    Requires: Valid authentication token

    Returns items where on_hand < par_level in the latest month, sorted by shortage.

    Returns:
        List of low-stock items

    Raises:
        401: Missing or invalid auth
        500: Database error
    """
    try:
        latest = (
            supabase_service.table("monthly_inventory")
            .select("month, year")
            .order("year", desc=True)
            .order("month", desc=True)
            .limit(1)
            .execute()
        )
        if not latest.data:
            return []
        month = latest.data[0]["month"]
        year = latest.data[0]["year"]

        result = (
            supabase_service.table("monthly_inventory")
            .select(
                "on_hand, "
                "inventory_items!inner(sku, description, par_level, "
                "  inventory_categories!inner(name))"
            )
            .eq("month", month)
            .eq("year", year)
            .execute()
        )

        low_items = []
        for row in result.data or []:
            inv_item = row.get("inventory_items") or {}
            cat = inv_item.get("inventory_categories") or {}
            on_hand = max(0, row.get("on_hand", 0) or 0)
            par = max(0, inv_item.get("par_level", 0) or 0)
            if par > 0 and on_hand < par:
                low_items.append(
                    LowStockItem(
                        # `.get(k, "")` still returns None when the column exists but is null,
                        # which fails LowStockItem's str fields → 500. Coalesce with `or ""`.
                        sku=inv_item.get("sku") or "",
                        desc=inv_item.get("description") or "",
                        category=cat.get("name") or "",
                        onHand=on_hand,
                        par=par,
                        short=par - on_hand,
                    )
                )

        low_items.sort(key=lambda x: x.short, reverse=True)
        return low_items

    except Exception as e:
        logger.exception("Error in get_reorders")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


_MONTHS = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
]


class PeriodStatus(BaseModel):
    current_month: int          # 0-indexed real-world month (0=Jan)
    current_year: int
    latest_month: int | None    # newest period present in monthly_inventory
    latest_year: int | None
    next_month: int | None      # the period a rollover would create
    next_year: int | None
    needs_rollover: bool
    current_label: str          # e.g. "June 2026" (real-world)
    latest_label: str           # e.g. "May 2026" (what the app is showing)
    next_label: str             # e.g. "June 2026"


class RolloverRequest(BaseModel):
    message: str | None = None


def _label(month: int | None, year: int | None) -> str:
    if month is None or year is None or not (0 <= month <= 11):
        return ""
    return f"{_MONTHS[month]} {year}"


@router.get("/period-status", response_model=PeriodStatus)
async def get_period_status(auth_user: dict = Depends(_get_auth_user)):
    """Compare the current real-world month to the latest inventory period.

    Months are 0-indexed (0=Jan) to match monthly_inventory and the frontend.
    `needs_rollover` is True when the real month is newer than the latest period
    stored in the DB — i.e. the cafeteria has moved into a new month but no
    rollover happened, so users are still looking at the previous month.
    """
    now = datetime.now(timezone.utc)
    current_month = now.month - 1  # 0-indexed to match the DB/JS convention
    current_year = now.year

    latest = (
        supabase_service.table("monthly_inventory")
        .select("month, year")
        .order("year", desc=True)
        .order("month", desc=True)
        .limit(1)
        .execute()
    )
    if not latest.data:
        return PeriodStatus(
            current_month=current_month, current_year=current_year,
            latest_month=None, latest_year=None,
            next_month=None, next_year=None,
            needs_rollover=False,
            current_label=_label(current_month, current_year),
            latest_label="", next_label="",
        )

    lm = int(latest.data[0]["month"])
    ly = int(latest.data[0]["year"])
    if lm >= 11:
        nm, ny = 0, ly + 1
    else:
        nm, ny = lm + 1, ly

    needs = (current_year, current_month) > (ly, lm)
    return PeriodStatus(
        current_month=current_month, current_year=current_year,
        latest_month=lm, latest_year=ly,
        next_month=nm, next_year=ny,
        needs_rollover=needs,
        current_label=_label(current_month, current_year),
        latest_label=_label(lm, ly),
        next_label=_label(nm, ny),
    )


@router.post("/rollover")
async def rollover_period(
    body: RolloverRequest, auth_user: dict = Depends(_get_auth_user)
):
    """Roll the latest inventory month forward to the next month (manager+ only).

    Wraps the `perform_rollover()` SECURITY DEFINER function via the service-role
    client: opens the next month, copies each item's ending on_hand into the new
    month's opening balance, and publishes the old month.
    """
    role = (auth_user.get("role") or "").lower()
    if role not in ("admin", "manager", "sudo"):
        raise HTTPException(
            status_code=403, detail="Manager access required to roll over the month."
        )

    latest = (
        supabase_service.table("monthly_inventory")
        .select("month, year")
        .order("year", desc=True)
        .order("month", desc=True)
        .limit(1)
        .execute()
    )
    if not latest.data:
        raise HTTPException(
            status_code=400, detail="No inventory period exists to roll over from."
        )
    from_month = int(latest.data[0]["month"])
    from_year = int(latest.data[0]["year"])

    try:
        result = supabase_service.rpc(
            "perform_rollover",
            {
                "p_from_month": from_month,
                "p_from_year": from_year,
                "p_rolled_by": auth_user["id"],
                "p_message": body.message,
            },
        ).execute()
        return {"ok": True, "result": result.data}
    except Exception as e:
        logger.exception("Error in rollover_period")
        raise HTTPException(status_code=500, detail=f"Rollover failed: {str(e)}")
