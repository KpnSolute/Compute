"""
Inventory Management API Endpoints

Provides endpoints for inventory snapshots, history, and reorder management.
Uses normalized tables: inventory_items, inventory_categories, monthly_inventory, live_inventory.

Endpoints:
- GET /api/inventory - Get inventory snapshot (specific month/year or latest)
- POST /api/inventory - Save inventory snapshot
- GET /api/inventory/items - List/lookup inventory items (with sku_pending/category filters)
- POST /api/inventory/merge - Merge two duplicate items (admin only)
- GET /api/inventory/history - Get past snapshots
- GET /api/inventory/reorders - Get low-stock items
"""

import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, Field
from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user
from backend.inventory_identity import (
    get_new_items_category_id,
    resolve_and_write_item,
)
from backend.periods import weeks_in_month

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


class InventoryItem(BaseModel):
    id: Optional[str] = None
    sku: str
    desc: str
    onHand: Optional[int] = Field(None, ge=0)
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
    # Computed: on_hand (opening) + received - issued = actual ending stock.
    running_total: Optional[int] = None
    sku_pending: Optional[bool] = None
    needs_attention: Optional[bool] = None


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


# _get_auth_user is imported from backend.routes._deps (single source of truth).


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
        w1r = int(_to_float(row.get("w1_received")))
        w2r = int(_to_float(row.get("w2_received")))
        w3r = int(_to_float(row.get("w3_received")))
        w4r = int(_to_float(row.get("w4_received")))
        w1i = int(_to_float(row.get("w1_issued")))
        w2i = int(_to_float(row.get("w2_issued")))
        w3i = int(_to_float(row.get("w3_issued")))
        w4i = int(_to_float(row.get("w4_issued")))
        running_total = max(0, oh + w1r + w2r + w3r + w4r - w1i - w2i - w3i - w4i)
        items.append(
            InventoryItem(
                id=inv_item.get("id"),
                sku=inv_item.get("sku") or "",
                desc=inv_item.get("description") or "",
                onHand=oh,
                par=max(0, int(_to_float(inv_item.get("par_level")))),
                category=cat.get("name") or "",
                price=_to_float(row.get("unit_price")),
                unit=inv_item.get("unit") or "each",
                w1r=w1r,
                w2r=w2r,
                w3r=w3r,
                w4r=w4r,
                w1i=w1i,
                w2i=w2i,
                w3i=w3i,
                w4i=w4i,
                running_total=running_total,
                sku_pending=bool(inv_item.get("sku_pending")),
                needs_attention=bool(inv_item.get("needs_attention")),
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
    "inventory_items!inner(id, sku, description, par_level, unit, sku_pending, needs_attention, "
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

        over_issued_count = sum(
            1
            for row in result.data
            if (
                max(0, int(_to_float(row.get("on_hand"))))
                + int(_to_float(row.get("w1_received")))
                + int(_to_float(row.get("w2_received")))
                + int(_to_float(row.get("w3_received")))
                + int(_to_float(row.get("w4_received")))
            )
            < (
                int(_to_float(row.get("w1_issued")))
                + int(_to_float(row.get("w2_issued")))
                + int(_to_float(row.get("w3_issued")))
                + int(_to_float(row.get("w4_issued")))
            )
        )

        return InventoryResponse(
            id=period_id,
            items=items,
            metadata={
                "month": month,
                "year": year,
                "period": period_id,
                "weeks_in_period": weeks_in_month(month, year),
                "over_issued_count": over_issued_count,
            },
            notes="",
            created_at=created_at or datetime.now(timezone.utc).isoformat(),
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception("Error in get_inventory")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/items")
async def list_inventory_items(
    sku: Optional[str] = Query(None),
    sku_pending: Optional[bool] = Query(None),
    needs_attention: Optional[bool] = Query(None),
    category_id: Optional[str] = Query(None),
    limit: int = Query(200, ge=1, le=2000),
    auth_user: dict = Depends(_get_auth_user),
):
    """List inventory_items with optional filters.

    Supports:
    - sku: exact SKU lookup (returns 0 or 1 item)
    - sku_pending=true: all placeholder MJC- items needing a real SKU
    - needs_attention=true: items with placeholder SKU OR no real category (unified triage flag)
    - category_id: items in a specific category
    """
    try:
        q = supabase_service.table("inventory_items").select(
            "id, sku, description, category_id, unit_price, par_level, unit, active, sku_pending, needs_attention, "
            "inventory_categories(name)"
        )
        if sku:
            q = q.eq("sku", sku)
        if sku_pending is not None:
            q = q.eq("sku_pending", sku_pending)
        if needs_attention is not None:
            q = q.eq("needs_attention", needs_attention)
        if category_id:
            q = q.eq("category_id", category_id)
        q = q.limit(limit)
        result = q.execute()
        items = []
        for row in result.data or []:
            cat_join = row.get("inventory_categories") or {}
            if isinstance(cat_join, list):
                cat_join = cat_join[0] if cat_join else {}
            items.append(
                {
                    "id": row["id"],
                    "sku": row["sku"],
                    "description": row["description"],
                    "category_id": row.get("category_id"),
                    "category": cat_join.get("name") or "",
                    "unit_price": row.get("unit_price"),
                    "par_level": row.get("par_level"),
                    "unit": row.get("unit"),
                    "active": row.get("active"),
                    "sku_pending": row.get("sku_pending"),
                    "needs_attention": row.get("needs_attention"),
                }
            )
        return items
    except Exception as e:
        logger.exception("Error in list_inventory_items")
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


class MergeBody(BaseModel):
    keep_id: str
    remove_id: str


@router.post("/merge")
async def merge_inventory_items(
    body: MergeBody,
    auth_user: dict = Depends(_get_auth_user),
):
    """Merge two duplicate inventory items (admin only).

    Calls admin_merge_items(p_keep, p_remove) via service-role client.
    Moves all references (monthly_inventory, weekly_counts, qr_codes,
    inventory_transactions, item_barcodes, reorder_alerts) from p_remove to
    p_keep, then deletes p_remove. Returns the RPC jsonb result.
    """
    role = (auth_user.get("role") or "").lower()
    if role not in ("admin", "sudo"):
        raise HTTPException(status_code=403, detail="Admin access required.")
    try:
        result = supabase_service.rpc(
            "admin_merge_items",
            {"p_keep": body.keep_id, "p_remove": body.remove_id},
        ).execute()
        return result.data
    except Exception as e:
        logger.exception("Error in merge_inventory_items")
        raise HTTPException(status_code=500, detail=f"Merge failed: {str(e)}")


@router.post("", response_model=InventoryResponse, status_code=201)
async def save_inventory(
    payload: InventorySnapshot, auth_user: dict = Depends(_get_auth_user)
):
    """
    DEPRECATED — direct inventory writes are disabled.

    All inventory changes must go through Source Control (stage -> commit) so
    every change is audited, atomic, and respects the period lock. This endpoint
    used to write `monthly_inventory` directly with no commit record, bypassing
    that audit trail; it is no longer a valid write path. Use the staging flow:
    `POST /api/sc/stage` (operation `inventory_save`) then approve/merge.

    Raises:
        410: always — endpoint retired in favour of Source Control.
    """
    raise HTTPException(
        status_code=410,
        detail=(
            "Direct inventory writes are disabled. Stage the change through "
            "Source Control (operation 'inventory_save') and commit it; that is "
            "the single audited write path."
        ),
    )


async def _save_inventory_retired(payload: "InventorySnapshot", auth_user: dict):
    """Original direct-write implementation, retained (unreachable) for reference."""
    role = (auth_user.get("role") or "").lower()
    if role not in ("admin", "manager", "sudo"):
        raise HTTPException(
            status_code=403,
            detail="Admin/manager access required. Staff must stage changes through Source Control.",
        )

    if not payload.items:
        raise HTTPException(status_code=400, detail="Items list cannot be empty")

    for item in payload.items:
        if (item.onHand is not None and item.onHand < 0) or (
            item.par is not None and item.par < 0
        ):
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
        # Reject writes to published periods unless the caller is admin/manager.
        user_role = (auth_user.get("role") or "").lower()
        if user_role not in ("admin", "manager", "sudo"):
            status_r = (
                supabase_service.table("month_status")
                .select("status")
                .eq("month", db_month)
                .eq("year", year)
                .limit(1)
                .execute()
            )
            status_row = (status_r.data or [None])[0]
            if status_row and status_row.get("status") == "published":
                raise HTTPException(
                    status_code=403,
                    detail=f"Period {month}/{year} is published and cannot be modified",
                )

        # Pre-fetch category name -> id mapping + the Uncategorized triage bucket.
        cat_result = (
            supabase_service.table("inventory_categories").select("id, name").execute()
        )
        category_map = {}
        for c in cat_result.data or []:
            category_map[c["name"]] = c["id"]
        new_items_cat_id = get_new_items_category_id(supabase_service)

        created_at = datetime.now(timezone.utc).isoformat()

        for item in payload.items:
            # Identity resolved by SKU only (sku is NOT NULL + UNIQUE). An
            # unknown/blank category resolves to None so a brand-new item lands
            # in "Uncategorized" for manager review instead of failing or guessing.
            cat_id = category_map.get(item.category)

            inv_item_id, _sku, _created = resolve_and_write_item(
                supabase_service,
                sku=item.sku,
                desc=item.desc,
                category_id=cat_id,
                fallback_category_id=new_items_cat_id,
                price=item.price,
                par=None,  # par is item-level; use dispatch_item_update for par changes
                unit=item.unit or None,
            )
            if not inv_item_id:
                continue

            # Upsert monthly_inventory by item_id + month + year (DB stores 0-indexed month).
            # Weekly columns and on_hand are only written when explicitly provided — omitting them
            # preserves existing data instead of zeroing it on every save (P0.2).
            monthly_fields = {
                "item_id": inv_item_id,
                "month": db_month,
                "year": year,
            }
            # Only write on_hand when explicitly provided in the payload.
            if item.onHand is not None:
                monthly_fields["on_hand"] = item.onHand
            if item.price is not None:
                monthly_fields["unit_price"] = item.price
            for src, col in [
                ("w1r", "w1_received"),
                ("w2r", "w2_received"),
                ("w3r", "w3_received"),
                ("w4r", "w4_received"),
                ("w1i", "w1_issued"),
                ("w2i", "w2_issued"),
                ("w3i", "w3_issued"),
                ("w4i", "w4_issued"),
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
            metadata={
                "month": month,
                "year": year,
                "period": period_id,
                "weeks_in_period": weeks_in_month(month, year),
            },
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
                    metadata={
                        "month": m,
                        "year": y,
                        "period": period_id,
                        "weeks_in_period": weeks_in_month(m, y),
                    },
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

    Returns items where ending on_hand < par_level in the live inventory view, sorted by shortage.

    Returns:
        List of low-stock items

    Raises:
        401: Missing or invalid auth
        500: Database error
    """
    try:
        result = (
            supabase_service.table("live_inventory")
            .select("sku, description, category, on_hand, par_level")
            .execute()
        )

        low_items = []
        for row in result.data or []:
            on_hand = max(0, int(_to_float(row.get("on_hand"))))
            par = max(0, int(_to_float(row.get("par_level"))))
            if par > 0 and on_hand < par:
                low_items.append(
                    LowStockItem(
                        sku=row.get("sku") or "",
                        desc=row.get("description") or "",
                        category=row.get("category") or "",
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


class ItemMetaUpdate(BaseModel):
    par: Optional[int] = Field(None, ge=0)
    unit: Optional[str] = None
    desc: Optional[str] = None
    category: Optional[str] = None
    price: Optional[float] = Field(None, ge=0)
    active: Optional[bool] = None
    new_sku: Optional[str] = None


@router.patch("/items/{sku}")
async def update_item_meta(
    sku: str,
    body: ItemMetaUpdate,
    auth_user: dict = Depends(_get_auth_user),
):
    """Update par_level, unit, description, category, price, active, or SKU on
    inventory_items for a given SKU. par is intentionally bypassed in
    POST /api/inventory to prevent accidental zeroing during bulk saves — this
    endpoint is the explicit manager/admin override.

    When new_sku is provided and is already owned by another item, returns 409
    with the conflicting item's details so the UI can offer a merge.
    """
    role = (auth_user.get("role") or "").lower()
    if role not in ("admin", "manager", "sudo"):
        raise HTTPException(status_code=403, detail="Manager access required.")

    res = (
        supabase_service.table("inventory_items")
        .select("id")
        .eq("sku", sku)
        .limit(1)
        .execute()
    )
    row = (res.data or [None])[0]
    if not row:
        raise HTTPException(status_code=404, detail=f"Item not found: {sku}")

    fields: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if body.par is not None:
        fields["par_level"] = body.par
    if body.unit:
        fields["unit"] = body.unit
    if body.desc is not None:
        fields["description"] = body.desc
    if body.price is not None:
        fields["unit_price"] = body.price
    if body.active is not None:
        fields["active"] = body.active

    new_sku = (body.new_sku or "").strip()
    if new_sku and new_sku != sku:
        # Check for SKU conflict before writing
        conflict_r = (
            supabase_service.table("inventory_items")
            .select("id,sku,description")
            .eq("sku", new_sku)
            .limit(1)
            .execute()
        )
        conflict_row = (conflict_r.data or [None])[0]
        if conflict_row:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": f"SKU '{new_sku}' is already used by another item.",
                    "conflict_id": conflict_row["id"],
                    "conflict_sku": conflict_row["sku"],
                    "conflict_desc": conflict_row["description"],
                },
            )
        fields["sku"] = new_sku

    if body.category:
        cat_r = (
            supabase_service.table("inventory_categories")
            .select("id")
            .eq("name", body.category)
            .limit(1)
            .execute()
        )
        cat_row = (cat_r.data or [None])[0]
        if cat_row:
            fields["category_id"] = cat_row["id"]

    if len(fields) > 1:
        supabase_service.table("inventory_items").update(fields).eq(
            "id", row["id"]
        ).execute()

    return {"sku": new_sku or sku, "updated": [k for k in fields if k != "updated_at"]}


_MONTHS = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
]


class PeriodStatus(BaseModel):
    current_month: int  # 0-indexed real-world month (0=Jan)
    current_year: int
    latest_month: int | None  # newest period present in monthly_inventory
    latest_year: int | None
    next_month: int | None  # the period a rollover would create
    next_year: int | None
    needs_rollover: bool
    current_label: str  # e.g. "June 2026" (real-world)
    latest_label: str  # e.g. "May 2026" (what the app is showing)
    next_label: str  # e.g. "June 2026"


class RolloverRequest(BaseModel):
    message: str | None = None


def _label(month: int | None, year: int | None) -> str:
    if month is None or year is None or not (0 <= month <= 11):
        return ""
    return f"{_MONTHS[month]} {year}"


@router.get("/month-status")
async def get_month_status(
    month: int, year: int, auth_user: dict = Depends(_get_auth_user)
):
    """Return published/open status for a specific period.
    month is 1-indexed (API convention); DB stores 0-indexed.
    """
    db_month = month - 1
    r = (
        supabase_service.table("month_status")
        .select("status")
        .eq("month", db_month)
        .eq("year", year)
        .limit(1)
        .execute()
    )
    status = r.data[0]["status"] if r.data else "open"
    return {
        "month": month,
        "year": year,
        "status": status,
        "published": status == "published",
    }


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
            current_month=current_month,
            current_year=current_year,
            latest_month=None,
            latest_year=None,
            next_month=None,
            next_year=None,
            needs_rollover=False,
            current_label=_label(current_month, current_year),
            latest_label="",
            next_label="",
        )

    lm = int(latest.data[0]["month"])
    ly = int(latest.data[0]["year"])
    if lm >= 11:
        nm, ny = 0, ly + 1
    else:
        nm, ny = lm + 1, ly

    needs = (current_year, current_month) > (ly, lm)
    return PeriodStatus(
        current_month=current_month,
        current_year=current_year,
        latest_month=lm,
        latest_year=ly,
        next_month=nm,
        next_year=ny,
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


# ── Week-status endpoints ──────────────────────────────────────────────────────


class WeekStatusRequest(BaseModel):
    month: int  # 1-indexed
    year: int
    week: int  # 1–5
    status: str  # open | locked | published


@router.get("/week-status")
async def get_week_status(
    month: int = Query(...),
    year: int = Query(...),
    auth_user: dict = Depends(_get_auth_user),
):
    """Return week_status rows for the given period (1-indexed month).
    Weeks with no row in the DB are returned as {status:'open'}.
    """
    from backend.periods import weeks_in_month

    db_month = month - 1
    try:
        r = (
            supabase_service.table("week_status")
            .select("week,status,locked_by,locked_at")
            .eq("month", db_month)
            .eq("year", year)
            .execute()
        )
        db_rows = {row["week"]: row for row in (r.data or [])}
        num_weeks = weeks_in_month(month, year)
        result = []
        for w in range(1, num_weeks + 1):
            if w in db_rows:
                result.append({"week": w, **db_rows[w]})
            else:
                result.append(
                    {"week": w, "status": "open", "locked_by": None, "locked_at": None}
                )
        return result
    except Exception as e:
        logger.exception("Error in get_week_status")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/week-status")
async def set_week_status(
    body: WeekStatusRequest,
    auth_user: dict = Depends(_get_auth_user),
):
    """Lock, unlock, or publish a specific week. Requires manager+."""
    role = (auth_user.get("role") or "").lower()
    if role not in ("admin", "manager", "sudo"):
        raise HTTPException(
            status_code=403, detail="Manager access required to change week status."
        )
    if body.status not in ("open", "locked", "published"):
        raise HTTPException(
            status_code=422, detail="status must be open, locked, or published."
        )
    if body.week not in (1, 2, 3, 4, 5):
        raise HTTPException(status_code=422, detail="week must be 1–5.")
    db_month = body.month - 1
    try:
        supabase_service.rpc(
            "set_week_status",
            {
                "p_month": db_month,
                "p_year": body.year,
                "p_week": body.week,
                "p_status": body.status,
                "p_by": auth_user["id"],
            },
        ).execute()
        return {
            "ok": True,
            "month": body.month,
            "year": body.year,
            "week": body.week,
            "status": body.status,
        }
    except Exception as e:
        logger.exception("Error in set_week_status")
        raise HTTPException(status_code=500, detail=str(e))
