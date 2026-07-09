"""
Snack Bar Shop API Endpoints

A minimal point-of-sale layer: a product catalog with stock, per-transaction
buyer ("entity": student or staff) tracking, and per-entity-type tax/discount
rates. Revenue from these transactions feeds Cost Manager's
snack_bar_revenue auto_source (backend/routes/cost.py::_snack_bar_revenue,
which sums snack_bar_sales — see dispatch note below) so it can be reported
as a revenue source there.

Endpoints:
- GET/POST/PATCH/DELETE /api/snackbar/products - Product catalog (manager+ writes)
- GET/PUT /api/snackbar/rates - Per-entity-type tax/discount rates (manager+ writes)
- GET/POST /api/snackbar/transactions - Record and list sales (any staff may record)
"""

import logging
from datetime import date, datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel, Field

from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user, _require_admin_or_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/snackbar", tags=["snack_bar"])


# ── products ──────────────────────────────────────────────────────────────


class SnackBarProductIn(BaseModel):
    name: str = Field(..., min_length=1)
    price: float = Field(..., ge=0)
    stock_qty: int = Field(0, ge=0)


class SnackBarProductResponse(BaseModel):
    id: str
    name: str
    price: float
    stock_qty: int
    active: bool
    created_at: str
    updated_at: str


@router.get("/products", response_model=list[SnackBarProductResponse])
async def list_products(
    include_inactive: bool = Query(False),
    auth_user: dict = Depends(_get_auth_user),
):
    try:
        q = supabase_service.table("snack_bar_products").select("*")
        if not include_inactive:
            q = q.eq("active", True)
        result = q.order("name").execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.post("/products", response_model=SnackBarProductResponse, status_code=201)
async def create_product(
    body: SnackBarProductIn,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    record = {"name": body.name, "price": body.price, "stock_qty": body.stock_qty}
    try:
        result = supabase_service.table("snack_bar_products").insert(record).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=500, detail="Failed to create product")
    return row


@router.patch("/products/{product_id}", response_model=SnackBarProductResponse)
async def update_product(
    product_id: str,
    body: SnackBarProductIn,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    record = {"name": body.name, "price": body.price, "stock_qty": body.stock_qty}
    try:
        result = (
            supabase_service.table("snack_bar_products")
            .update(record)
            .eq("id", product_id)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=404, detail="Product not found")
    return row


@router.delete("/products/{product_id}", status_code=204)
async def deactivate_product(
    product_id: str,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Deactivates rather than hard-deletes — past transactions keep their own
    snapshotted product_name/unit_price regardless, but the catalog itself
    should stay a record of everything ever sold."""
    try:
        supabase_service.table("snack_bar_products").update({"active": False}).eq(
            "id", product_id
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ── entity tax/discount rates ────────────────────────────────────────────


class EntityRateIn(BaseModel):
    tax_pct: float = Field(..., ge=0, le=100)
    discount_pct: float = Field(..., ge=0, le=100)


class EntityRateResponse(BaseModel):
    entity_type: str
    tax_pct: float
    discount_pct: float
    updated_by: Optional[str] = None
    updated_at: str


@router.get("/rates", response_model=list[EntityRateResponse])
async def list_rates(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = supabase_service.table("snack_bar_entity_rates").select("*").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    return result.data or []


@router.put("/rates/{entity_type}", response_model=EntityRateResponse)
async def update_rate(
    entity_type: str,
    body: EntityRateIn,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    if entity_type not in ("student", "staff"):
        raise HTTPException(
            status_code=400, detail="entity_type must be 'student' or 'staff'"
        )
    record = {
        "tax_pct": body.tax_pct,
        "discount_pct": body.discount_pct,
        "updated_by": auth_user["id"],
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    try:
        result = (
            supabase_service.table("snack_bar_entity_rates")
            .update(record)
            .eq("entity_type", entity_type)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=404, detail="Entity type not found")
    return row


# ── transactions ──────────────────────────────────────────────────────────


class TransactionItemIn(BaseModel):
    product_id: str
    qty: int = Field(..., gt=0)


class TransactionIn(BaseModel):
    entity_type: str = Field(..., pattern="^(student|staff)$")
    entity_name: str = Field(..., min_length=1)
    business_date: Optional[str] = None
    items: list[TransactionItemIn] = Field(..., min_length=1)


class TransactionItemResponse(BaseModel):
    id: str
    product_id: Optional[str] = None
    product_name: str
    unit_price: float
    qty: int
    line_total: float


class TransactionResponse(BaseModel):
    id: str
    entity_type: str
    entity_name: str
    subtotal: float
    discount_amount: float
    tax_amount: float
    total_amount: float
    business_date: str
    recorded_by: Optional[str] = None
    created_at: str
    items: list[TransactionItemResponse] = []


@router.post("/transactions", response_model=TransactionResponse, status_code=201)
async def create_transaction(
    body: TransactionIn,
    auth_user: dict = Depends(_get_auth_user),
):
    """Record a sale. Any authenticated staff may record — this is meant to be
    a fast 'jot who bought what' entry, not a gated approval flow."""
    product_ids = [item.product_id for item in body.items]
    try:
        products_r = (
            supabase_service.table("snack_bar_products")
            .select("id, name, price, stock_qty")
            .in_("id", product_ids)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    product_map = {p["id"]: p for p in (products_r.data or [])}
    missing = [pid for pid in product_ids if pid not in product_map]
    if missing:
        raise HTTPException(
            status_code=400, detail=f"Unknown product id(s): {', '.join(missing)}"
        )

    try:
        rate_r = (
            supabase_service.table("snack_bar_entity_rates")
            .select("tax_pct, discount_pct")
            .eq("entity_type", body.entity_type)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    rate_row = rate_r.data[0] if rate_r.data else {"tax_pct": 0, "discount_pct": 0}
    tax_pct = float(rate_row.get("tax_pct") or 0)
    discount_pct = float(rate_row.get("discount_pct") or 0)

    line_items = []
    subtotal = 0.0
    for item in body.items:
        product = product_map[item.product_id]
        unit_price = float(product["price"])
        line_total = round(unit_price * item.qty, 2)
        subtotal += line_total
        line_items.append(
            {
                "product_id": product["id"],
                "product_name": product["name"],
                "unit_price": unit_price,
                "qty": item.qty,
                "line_total": line_total,
            }
        )
    subtotal = round(subtotal, 2)
    discount_amount = round(subtotal * discount_pct / 100, 2)
    taxable = subtotal - discount_amount
    tax_amount = round(taxable * tax_pct / 100, 2)
    total_amount = round(taxable + tax_amount, 2)

    business_date = body.business_date or date.today().isoformat()
    txn_record = {
        "entity_type": body.entity_type,
        "entity_name": body.entity_name.strip(),
        "subtotal": subtotal,
        "discount_amount": discount_amount,
        "tax_amount": tax_amount,
        "total_amount": total_amount,
        "business_date": business_date,
        "recorded_by": auth_user["id"],
    }
    try:
        txn_r = (
            supabase_service.table("snack_bar_transactions")
            .insert(txn_record)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    txn_row = txn_r.data[0] if txn_r.data else None
    if not txn_row:
        raise HTTPException(status_code=500, detail="Failed to create transaction")

    for li in line_items:
        li["transaction_id"] = txn_row["id"]
    try:
        items_r = (
            supabase_service.table("snack_bar_transaction_items")
            .insert(line_items)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    # Best-effort stock decrement — not blocking the sale if this fails.
    for item in body.items:
        product = product_map[item.product_id]
        try:
            supabase_service.table("snack_bar_products").update(
                {"stock_qty": int(product["stock_qty"]) - item.qty}
            ).eq("id", product["id"]).execute()
        except Exception:
            logger.exception("Failed to decrement stock for product %s", product["id"])

    return {**txn_row, "items": items_r.data or []}


@router.get("/transactions", response_model=list[TransactionResponse])
async def list_transactions(
    start: str = Query(None),
    end: str = Query(None),
    limit: int = Query(50, ge=1, le=200),
    auth_user: dict = Depends(_get_auth_user),
):
    try:
        q = supabase_service.table("snack_bar_transactions").select("*")
        if start:
            q = q.gte("business_date", start)
        if end:
            q = q.lte("business_date", end)
        txns_r = q.order("created_at", desc=True).limit(limit).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    txns = txns_r.data or []
    if not txns:
        return []

    txn_ids = [t["id"] for t in txns]
    try:
        items_r = (
            supabase_service.table("snack_bar_transaction_items")
            .select("*")
            .in_("transaction_id", txn_ids)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
    items_by_txn: dict[str, list[dict]] = {}
    for item in items_r.data or []:
        items_by_txn.setdefault(item["transaction_id"], []).append(item)

    return [{**t, "items": items_by_txn.get(t["id"], [])} for t in txns]
