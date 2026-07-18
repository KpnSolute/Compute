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
from backend.routes._deps import (
    _get_auth_user,
    _require_admin_or_manager,
    ensure_pr_for_entries,
)
from backend.inventory_identity import (
    get_new_items_category_id,
    resolve_and_write_item,
)
from backend import inventory_formulas as fi
from backend.periods import business_now, weeks_in_month

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/inventory", tags=["inventory"])


class InventoryItem(BaseModel):
    id: Optional[str] = None
    sku: str
    desc: str
    onHand: Optional[int] = Field(None, ge=0)
    par: Optional[int] = Field(None, ge=0)
    category: str
    price: Optional[float] = Field(None, ge=0)
    unit: str = "each"
    status: str = "active"
    w1r: Optional[int] = None
    w2r: Optional[int] = None
    w3r: Optional[int] = None
    w1p: Optional[int] = None
    w2p: Optional[int] = None
    w3p: Optional[int] = None
    # Computed: opening_oh + received - pulled = ending stock
    running_total: Optional[int] = None
    totalReceived: Optional[int] = None
    totalPulled: Optional[int] = None
    closingQty: Optional[int] = None
    value: Optional[float] = None
    openingUnitCost: Optional[float] = None
    openingValue: Optional[float] = None
    receivedValue: Optional[float] = None
    pulledValue: Optional[float] = None
    endingValue: Optional[float] = None
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
        item_id = inv_item.get("id") or row.get("item_id")
        oh = max(0, int(fi.num(row.get("opening_oh"))))
        w1r = int(fi.num(row.get("w1_received")))
        w2r = int(fi.num(row.get("w2_received")))
        w3r = int(fi.num(row.get("w3_received")))
        w1p = int(fi.num(row.get("w1_pulled")))
        w2p = int(fi.num(row.get("w2_pulled")))
        w3p = int(fi.num(row.get("w3_pulled")))
        # Derived columns via the canonical template formulas (single source).
        total_received = int(fi.total_received(w1r, w2r, w3r))
        total_pulled = int(fi.total_pulled(w1p, w2p, w3p))
        running_total = int(fi.ending_qty(oh, total_received, total_pulled))
        price = _to_float(row.get("unit_price"))
        opening_unit_cost = _to_float(row.get("opening_unit_cost"), price)
        opening_value = _to_float(
            row.get("opening_value"), fi.opening_value(oh, opening_unit_cost)
        )
        received_value = _to_float(
            row.get("received_value"), fi.received_value(total_received, price)
        )
        pulled_value = _to_float(
            row.get("pulled_value"), fi.pulled_value(total_pulled, price)
        )
        ending_value = _to_float(
            row.get("ending_value"),
            fi.ending_value(opening_value, received_value, pulled_value),
        )
        items.append(
            InventoryItem(
                id=item_id,
                sku=inv_item.get("sku") or "",
                desc=inv_item.get("description") or "",
                onHand=oh,
                par=max(0, int(_to_float(inv_item.get("par_level")))),
                category=cat.get("name") or "",
                price=price,
                unit=inv_item.get("unit") or "each",
                status=row.get("status") or "active",
                w1r=w1r,
                w2r=w2r,
                w3r=w3r,
                w1p=w1p,
                w2p=w2p,
                w3p=w3p,
                running_total=running_total,
                totalReceived=total_received,
                totalPulled=total_pulled,
                closingQty=running_total,
                value=ending_value,
                openingUnitCost=opening_unit_cost,
                openingValue=opening_value,
                receivedValue=received_value,
                pulledValue=pulled_value,
                endingValue=ending_value,
                sku_pending=bool(inv_item.get("sku_pending")),
                needs_attention=bool(inv_item.get("needs_attention")),
            )
        )
    return items


def _invoice_register_weeks(db_month: int, year: int) -> dict | None:
    """Aggregate the invoice register per week for the period.

    NOTE: invoices.month is 1-INDEXED (July=7) unlike monthly_inventory /
    monthly_snapshots / inventory_transactions which are 0-indexed (July=6).
    Returns week → {goods_subtotal, vizient_discount, fuel_surcharge, tax,
    net_total, invoice_count, line_item_count}, or None when the register has
    no rows.
    """
    try:
        res = (
            supabase_service.table("invoices")
            .select(
                "id,week_number,subtotal,vizient_discount,fuel_surcharge,tax,net_total"
            )
            .eq("month", db_month + 1)
            .eq("year", year)
            .execute()
        )
    except Exception:
        logger.exception("Could not load invoice register for reconciliation")
        return None

    weeks: dict[str, dict] = {}
    invoice_week: dict[str, str] = {}
    for row in res.data or []:
        week = int(_to_float(row.get("week_number")))
        if week <= 0:
            continue
        if row.get("id"):
            invoice_week[row["id"]] = str(week)
        agg = weeks.setdefault(
            str(week),
            {
                "goods_subtotal": 0.0,
                "vizient_discount": 0.0,
                "fuel_surcharge": 0.0,
                "tax": 0.0,
                "net_total": 0.0,
                "invoice_count": 0,
                "line_item_count": 0,
            },
        )
        agg["goods_subtotal"] = round(
            agg["goods_subtotal"] + _to_float(row.get("subtotal")), 2
        )
        agg["vizient_discount"] = round(
            agg["vizient_discount"] + _to_float(row.get("vizient_discount")), 2
        )
        agg["fuel_surcharge"] = round(
            agg["fuel_surcharge"] + _to_float(row.get("fuel_surcharge")), 2
        )
        agg["tax"] = round(agg["tax"] + _to_float(row.get("tax")), 2)
        agg["net_total"] = round(agg["net_total"] + _to_float(row.get("net_total")), 2)
        agg["invoice_count"] += 1

    # Line-item counts: one batched query for the whole period (no N+1),
    # range-lifted past the default row cap so counts cannot truncate.
    if invoice_week:
        try:
            items_res = (
                supabase_service.table("invoice_items")
                .select("invoice_id")
                .in_("invoice_id", list(invoice_week))
                .range(0, 49999)
                .execute()
            )
            for row in items_res.data or []:
                wk = invoice_week.get(row.get("invoice_id") or "")
                if wk and wk in weeks:
                    weeks[wk]["line_item_count"] += 1
        except Exception:
            # Counts are display metadata — never fail reconciliation for them.
            logger.exception("Could not load invoice line-item counts")
    return weeks or None


def _weekly_received_values_from_ledger(db_month: int, year: int) -> dict | None:
    try:
        txns = (
            supabase_service.table("inventory_transactions")
            .select("week_number,quantity,unit_price,txn_type")
            .eq("month", db_month)
            .eq("year", year)
            .in_("txn_type", ["received", "adjustment_increase"])
            .execute()
        )
    except Exception:
        logger.exception("Could not load weekly received values from ledger")
        return None

    weeks: dict[str, float] = {}
    for row in txns.data or []:
        week = int(_to_float(row.get("week_number")))
        if week <= 0:
            continue
        value = _to_float(row.get("quantity")) * _to_float(row.get("unit_price"))
        if value <= 0:
            continue
        key = str(week)
        weeks[key] = round(weeks.get(key, 0) + value, 2)

    if not weeks:
        return None
    return {
        "source": "inventory_transactions",
        "weeks": weeks,
        "total": round(sum(weeks.values()), 2),
        "notes": {},
    }


def _serialize_dt(dt) -> str:
    if dt is None:
        return ""
    if hasattr(dt, "isoformat"):
        return dt.isoformat()
    return str(dt)


_JOIN_SELECT = (
    "id, item_id, month, year, opening_oh, status, "
    "w1_received, w2_received, w3_received, "
    "w1_pulled, w2_pulled, w3_pulled, "
    "unit_price, opening_unit_cost, opening_value, received_value, pulled_value, ending_value, created_at, "
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

        items = [
            item for item in _flatten_rows(result.data) if not item.needs_attention
        ]
        period_id = f"{year}-{month:02d}"
        created_at = _serialize_dt(result.data[0].get("created_at"))

        over_pulled_count = sum(
            1
            for item in items
            if (item.onHand or 0) + (item.totalReceived or 0) < (item.totalPulled or 0)
        )
        total_received = sum(item.totalReceived or 0 for item in items)
        total_pulled = sum(item.totalPulled or 0 for item in items)
        opening_value = sum(item.openingValue or 0 for item in items)
        received_value = sum(item.receivedValue or 0 for item in items)
        pulled_value = sum(item.pulledValue or 0 for item in items)
        closing_value = sum(item.value or 0 for item in items)
        category_totals: dict[str, float] = {}
        for item in items:
            category = item.category or "Uncategorized"
            category_totals[category] = round(
                category_totals.get(category, 0) + (item.value or 0),
                2,
            )
        weekly_invoice_totals = None
        try:
            snap = (
                supabase_service.table("monthly_snapshots")
                .select("wk1_total,wk2_total,wk3_total,wk4_total,wk5_total,data")
                .eq("month", db_month)
                .eq("year", year)
                .limit(1)
                .execute()
            )
            snap_row = (snap.data or [None])[0]
            if snap_row:
                snap_data = snap_row.get("data") or {}
                weekly_invoice_totals = (
                    snap_data.get("weekly_invoice_totals")
                    if isinstance(snap_data, dict)
                    else None
                )
                if not weekly_invoice_totals:
                    weeks = {
                        str(idx): _to_float(snap_row.get(f"wk{idx}_total"))
                        for idx in range(1, 6)
                        if snap_row.get(f"wk{idx}_total") is not None
                    }
                    if weeks:
                        weekly_invoice_totals = {
                            "source": "monthly_snapshots",
                            "weeks": weeks,
                            "total": round(sum(weeks.values()), 2),
                            "notes": {},
                        }
        except Exception:
            weekly_invoice_totals = None
        if not weekly_invoice_totals:
            weekly_invoice_totals = _weekly_received_values_from_ledger(db_month, year)

        # Reconcile the headline weekly totals against the invoice register so
        # the UI can explain (goods vs payable) instead of silently showing two
        # different numbers — the 2026-07-18 audit's "$101.09 variance".
        invoice_register = _invoice_register_weeks(db_month, year)
        weekly_reconciliation = None
        if invoice_register:
            headline_weeks = (
                weekly_invoice_totals.get("weeks", {}) if weekly_invoice_totals else {}
            )
            weekly_reconciliation = fi.reconcile_weekly_invoices(
                headline_weeks, invoice_register
            )

        return InventoryResponse(
            id=period_id,
            items=items,
            metadata={
                "month": month,
                "year": year,
                "period": period_id,
                "weeks_in_period": weeks_in_month(month, year),
                "item_count": len(items),
                "reorder_count": sum(
                    1
                    for item in items
                    if (item.closingQty or 0) < (item.par or 0) and (item.par or 0) > 0
                ),
                "over_pulled_count": over_pulled_count,
                "total_received": total_received,
                "total_pulled": total_pulled,
                "opening_value": opening_value,
                "received_value": received_value,
                "pulled_value": pulled_value,
                "closing_value": closing_value,
                "category_totals": category_totals,
                "weekly_invoice_totals": weekly_invoice_totals,
                "invoice_register": invoice_register,
                "weekly_reconciliation": weekly_reconciliation,
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
        # suggested_category_id is a plain column (no FK) so it never makes the
        # inventory_categories embed ambiguous. Resolve its display name via a
        # small id->name map instead of a second PostgREST embed.
        q = supabase_service.table("inventory_items").select(
            "id, sku, description, category_id, unit_price, par_level, unit, active, sku_pending, needs_attention, "
            "suggested_category_id, "
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
        cat_rows = (
            supabase_service.table("inventory_categories").select("id, name").execute()
        )
        cat_name_by_id = {c["id"]: c.get("name") or "" for c in (cat_rows.data or [])}
        items = []
        for row in result.data or []:
            cat_join = row.get("inventory_categories") or {}
            if isinstance(cat_join, list):
                cat_join = cat_join[0] if cat_join else {}
            sug_id = row.get("suggested_category_id")
            items.append(
                {
                    "id": row["id"],
                    "sku": row["sku"],
                    "description": row["description"],
                    "category_id": row.get("category_id"),
                    "category": cat_join.get("name") or "",
                    "suggested_category_id": sug_id,
                    "suggested_category": cat_name_by_id.get(sug_id, "")
                    if sug_id
                    else "",
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
            if item.onHand is not None:
                monthly_fields["opening_oh"] = item.onHand
            if item.price is not None:
                monthly_fields["unit_price"] = item.price
            if item.status:
                monthly_fields["status"] = item.status
            for attr, col in [
                ("openingUnitCost", "opening_unit_cost"),
                ("openingValue", "opening_value"),
                ("receivedValue", "received_value"),
                ("pulledValue", "pulled_value"),
                ("endingValue", "ending_value"),
            ]:
                val = getattr(item, attr)
                if val is not None:
                    monthly_fields[col] = val
            for src, col in [
                ("w1r", "w1_received"),
                ("w2r", "w2_received"),
                ("w3r", "w3_received"),
                ("w1p", "w1_pulled"),
                ("w2p", "w2_pulled"),
                ("w3p", "w3_pulled"),
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
            opening_value = sum(item.openingValue or 0 for item in items)
            received_value = sum(item.receivedValue or 0 for item in items)
            pulled_value = sum(item.pulledValue or 0 for item in items)
            closing_value = sum(item.value or 0 for item in items)
            category_totals: dict[str, float] = {}
            for item in items:
                category = item.category or "Uncategorized"
                category_totals[category] = round(
                    category_totals.get(category, 0) + (item.value or 0),
                    2,
                )

            snapshots.append(
                InventoryResponse(
                    id=period_id,
                    items=items,
                    metadata={
                        "month": m,
                        "year": y,
                        "period": period_id,
                        "weeks_in_period": weeks_in_month(m, y),
                        "item_count": len(items),
                        "reorder_count": sum(
                            1
                            for item in items
                            if (item.closingQty or 0) < (item.par or 0)
                            and (item.par or 0) > 0
                        ),
                        "opening_value": opening_value,
                        "received_value": received_value,
                        "pulled_value": pulled_value,
                        "closing_value": closing_value,
                        "category_totals": category_totals,
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
    """Stage inventory item metadata edits through Source Control.

    This endpoint used to write directly to inventory_items. It now preserves the
    public API surface while routing all catalog edits through staging -> PR ->
    merge so item changes have review, commit history, and rollback context.
    """
    role = (auth_user.get("role") or "").lower()
    if role not in ("admin", "manager", "sudo"):
        raise HTTPException(status_code=403, detail="Manager access required.")

    item_r = (
        supabase_service.table("inventory_items")
        .select("id,sku,description,unit_price,par_level,unit,active")
        .eq("sku", sku)
        .limit(1)
        .execute()
    )
    item = (item_r.data or [None])[0]
    if not item:
        raise HTTPException(status_code=404, detail=f"Item not found: {sku}")

    payload: dict = {"sku": sku}
    changed: list[str] = []
    if body.par is not None:
        payload["par"] = body.par
        changed.append("par")
    if body.unit:
        payload["unit"] = body.unit
        changed.append("unit")
    if body.desc is not None:
        payload["desc"] = body.desc
        changed.append("description")
    if body.price is not None:
        payload["price"] = body.price
        changed.append("price")
    if body.active is not None:
        payload["active"] = body.active
        changed.append("active")

    new_sku = (body.new_sku or "").strip()
    if new_sku and new_sku != sku:
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
        payload["new_sku"] = new_sku
        changed.append("sku")

    if body.category:
        cat_r = (
            supabase_service.table("inventory_categories")
            .select("id,name")
            .eq("name", body.category)
            .limit(1)
            .execute()
        )
        cat_row = (cat_r.data or [None])[0]
        if not cat_row:
            valid_r = (
                supabase_service.table("inventory_categories")
                .select("name")
                .order("sort_order")
                .execute()
            )
            raise HTTPException(
                status_code=422,
                detail={
                    "message": f"Unknown category: {body.category}",
                    "valid_categories": [
                        r.get("name") for r in (valid_r.data or []) if r.get("name")
                    ],
                },
            )
        payload["category"] = body.category
        changed.append("category")

    if not changed:
        raise HTTPException(status_code=422, detail="No item fields supplied.")

    now = datetime.now(timezone.utc).isoformat()
    summary = f"Item update for {sku}: {', '.join(changed)}"
    row = {
        "entity_type": "inventory",
        "entity_id": sku,
        "field_name": "item_update",
        "old_value_text": item.get("description") or sku,
        "new_value_text": summary,
        "change_type": "item_update",
        "metadata": {
            "summary": summary,
            "source_endpoint": "PATCH /api/inventory/items/{sku}",
            "changed_fields": changed,
        },
        "status": "pending",
        "submitted_by": auth_user["id"],
        "source": "inventory_api",
        "operation": "item_update",
        "full_payload": payload,
        "created_at": now,
    }
    staged_r = supabase_service.table("staging_entries").insert(row).execute()
    staged = (staged_r.data or [None])[0]
    if not staged:
        raise HTTPException(status_code=500, detail="Failed to stage item update.")

    pr = ensure_pr_for_entries(
        [staged["entry_id"]],
        auth_user["id"],
        title=f"Item update - {sku}",
        description=summary,
        entity_scope="inventory",
    )

    return {
        "staged": True,
        "sku": new_sku or sku,
        "updated": changed,
        "entry_id": staged["entry_id"],
        "pr_id": pr.get("pr_id") if pr else None,
        "pr_number": pr.get("pr_number") if pr else None,
        "warning": None
        if pr
        else "Item update staged, but pull request auto-wrap failed.",
    }


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


def _next_period(db_month: int, year: int) -> tuple[int, int]:
    if db_month >= 11:
        return 0, year + 1
    return db_month + 1, year


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
    now = business_now()
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
    nm, ny = _next_period(lm, ly)

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
    next_month, next_year = _next_period(from_month, from_year)

    source_status_r = (
        supabase_service.table("month_status")
        .select("status")
        .eq("month", from_month)
        .eq("year", from_year)
        .limit(1)
        .execute()
    )
    source_status = (source_status_r.data or [{}])[0].get("status", "open")
    if source_status == "published":
        raise HTTPException(
            status_code=409,
            detail=f"{_label(from_month, from_year)} is already published and cannot be rolled again.",
        )

    target_status_r = (
        supabase_service.table("month_status")
        .select("status")
        .eq("month", next_month)
        .eq("year", next_year)
        .limit(1)
        .execute()
    )
    if target_status_r.data:
        raise HTTPException(
            status_code=409,
            detail=f"{_label(next_month, next_year)} is already initialized; rollover would overwrite an existing period.",
        )

    target_rows_r = (
        supabase_service.table("monthly_inventory")
        .select("id")
        .eq("month", next_month)
        .eq("year", next_year)
        .limit(1)
        .execute()
    )
    if target_rows_r.data:
        raise HTTPException(
            status_code=409,
            detail=f"{_label(next_month, next_year)} already has inventory rows; rollover refused.",
        )

    now = business_now()
    # next_month is 0-indexed (Jan=0); datetime.month is 1-indexed (Jan=1).
    # Compare in the same 0-indexed space so we block rolling INTO a month that
    # hasn't started yet (e.g. rolling May->June while it is still May), while
    # allowing the roll once the real-world clock has reached the next month.
    # business_now() uses the cafeteria's local (Eastern) day, not UTC's --
    # UTC crosses into the next day/month hours before Eastern does.
    current_month_0 = now.month - 1
    if (next_year, next_month) > (now.year, current_month_0):
        raise HTTPException(
            status_code=409,
            detail=f"Cannot roll into future period {_label(next_month, next_year)} yet.",
        )

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
        logger.info(
            "[INVENTORY] rollover %s -> %s by user=%s result=%s",
            _label(from_month, from_year),
            _label(next_month, next_year),
            auth_user.get("id"),
            result.data,
        )
        return {"ok": True, "result": result.data}
    except Exception as e:
        logger.exception("Error in rollover_period")
        raise HTTPException(status_code=500, detail=f"Rollover failed: {str(e)}")


# ── Week-status endpoints ──────────────────────────────────────────────────────


class WeekStatusRequest(BaseModel):
    month: int  # 1-indexed
    year: int
    week: int  # 1-3
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


@router.get("/audit")
async def get_audit_findings(
    month: int = Query(...),
    year: int = Query(...),
    auth_user: dict = Depends(_get_auth_user),
):
    """Read the post-session inventory audit findings for a period (in-app log).

    Findings are written by audit_inventory_period (run after each data-entry
    session / commit). month is 1-indexed (API), stored 0-indexed (DB).
    """
    db_month = month - 1
    try:
        r = (
            supabase_service.table("inventory_audit_log")
            .select("id,check_type,severity,sku,message,details,resolved,created_at")
            .eq("month", db_month)
            .eq("year", year)
            .eq("resolved", False)
            .order("created_at", desc=True)
            .execute()
        )
        rows = r.data or []
        counts = {"error": 0, "warning": 0, "info": 0}
        for x in rows:
            sev = x.get("severity", "info")
            counts[sev] = counts.get(sev, 0) + 1
        return {
            "month": month,
            "year": year,
            "total": len(rows),
            "counts": counts,
            "findings": rows,
        }
    except Exception as e:
        logger.exception("Error in get_audit_findings")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/audit")
async def run_audit(
    month: int = Query(...),
    year: int = Query(...),
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Run the deterministic post-session inventory audit for a period (manager+).

    Re-checks negative/over-pulled endings, ledger reconciliation drift, missing
    prices, orphan items, suspicious quantities, and duplicate weekly entries.
    Idempotent — clears the period's prior unresolved findings first.
    """
    db_month = month - 1
    try:
        r = supabase_service.rpc(
            "audit_inventory_period", {"p_month": db_month, "p_year": year}
        ).execute()
        return {"month": month, "year": year, "findings": r.data}
    except Exception as e:
        logger.exception("Error in run_audit")
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
    if body.week not in (1, 2, 3):
        raise HTTPException(status_code=422, detail="week must be 1-3.")
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
