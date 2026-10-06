"""
Price Review API — manager decisions on invoice prices that were not applied.

The observed-price protocol (backend/pricing.py, AGENTS.md §4A) applies
ordinary invoice price moves on commit and holds large ones here, the same way
unknown SKUs wait in the SKU review queue.

GET  /api/price-review                — queue rows (pending by default)
GET  /api/price-review/drift          — monthly prices that differ from the
                                        period's latest invoice price
POST /api/price-review/{id}/resolve   — apply or keep a held price
POST /api/price-review/drift/resolve  — apply or keep a drifted price that has
                                        no queue row (e.g. history before the
                                        protocol existed)

Months are 1-indexed in this API and 0-indexed in the database, like every
other inventory route.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from pydantic import BaseModel

from backend import pricing
from backend.audit_events import record_audit_event
from backend.concurrency import serialized_inventory_write
from backend.routes import supabase_service
from backend.routes._deps import _require_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/price-review", tags=["price-review"])

ACTIONS = ("apply", "keep")


class ResolveBody(BaseModel):
    action: str  # 'apply' | 'keep'
    price: Optional[float] = None  # apply only: override the observed price
    note: Optional[str] = None


class DriftResolveBody(ResolveBody):
    item_id: str
    month: int  # 1-indexed
    year: int


def _db_month(month: Optional[int]) -> Optional[int]:
    if month is None:
        return None
    if not 1 <= month <= 12:
        raise HTTPException(status_code=422, detail="month must be 1-12.")
    return month - 1


def _check_action(body: ResolveBody) -> None:
    if body.action not in ACTIONS:
        raise HTTPException(status_code=422, detail="action must be 'apply' or 'keep'.")
    if body.action == "apply" and body.price is not None and body.price <= 0:
        raise HTTPException(status_code=422, detail="price must be greater than 0.")


def _assert_period_open(db_month: int, year: int) -> None:
    row = (
        supabase_service.table("month_status")
        .select("status")
        .eq("month", db_month)
        .eq("year", year)
        .limit(1)
        .execute()
    ).data
    if row and row[0].get("status") == "published":
        raise HTTPException(
            status_code=403,
            detail=f"{db_month + 1}/{year} is published. Reopen the period to change its prices.",
        )


def _apply_price(item_id: str, db_month: int, year: int, price: float) -> None:
    """Set the period price and the catalog price to the accepted figure."""
    supabase_service.rpc(
        "apply_observed_prices",
        {
            "p_month": db_month,
            "p_year": year,
            "p_prices": [{"item_id": item_id, "unit_price": price}],
        },
    ).execute()
    supabase_service.table("inventory_items").update(
        {"unit_price": price, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", item_id).execute()


def open_price_issues(db_month: int, year: int) -> dict:
    """Pending reviews and unresolved drift for a period (the publish gate)."""
    pending = (
        supabase_service.table("price_review_queue")
        .select("id")
        .eq("month", db_month)
        .eq("year", year)
        .eq("status", "pending")
        .execute()
    ).data or []
    drift = (
        supabase_service.table("inventory_price_drift")
        .select("item_id")
        .eq("month", db_month)
        .eq("year", year)
        .eq("review_pending", False)
        .eq("difference_accepted", False)
        .execute()
    ).data or []
    return {"pending_reviews": len(pending), "unresolved_drift": len(drift)}


@router.get("")
def list_price_review(
    status: str = Query("pending"),
    month: Optional[int] = Query(None),
    year: Optional[int] = Query(None),
    limit: int = Query(200, ge=1, le=1000),
    _auth: dict = Depends(_require_manager),
):
    if status != "all" and status not in pricing.QUEUE_STATUSES:
        raise HTTPException(status_code=422, detail=f"Unknown status {status!r}.")
    q = supabase_service.table("price_review_queue").select("*")
    if status != "all":
        q = q.eq("status", status)
    if month is not None:
        q = q.eq("month", _db_month(month))
    if year is not None:
        q = q.eq("year", year)
    rows = q.order("created_at", desc=True).limit(limit).execute().data or []
    return [{**row, "month": row["month"] + 1} for row in rows]


@router.get("/drift")
def list_price_drift(
    month: int = Query(...),
    year: int = Query(...),
    _auth: dict = Depends(_require_manager),
):
    db_month = _db_month(month)
    rows = (
        supabase_service.table("inventory_price_drift")
        .select("*")
        .eq("month", db_month)
        .eq("year", year)
        .eq("difference_accepted", False)
        .order("sku")
        .execute()
    ).data or []
    return {
        "month": month,
        "year": year,
        "summary": open_price_issues(db_month, year),
        "rows": [{**row, "month": month} for row in rows],
    }


# Declared before "/{row_id}/resolve" so "drift" is never read as a row id.
@router.post("/drift/resolve")
@serialized_inventory_write
def resolve_drift(
    body: DriftResolveBody,
    auth_user: dict = Depends(_require_manager),
):
    _check_action(body)
    db_month = _db_month(body.month)
    drift = (
        supabase_service.table("inventory_price_drift")
        .select("*")
        .eq("item_id", body.item_id)
        .eq("month", db_month)
        .eq("year", body.year)
        .limit(1)
        .execute()
    ).data
    if not drift:
        raise HTTPException(
            status_code=404, detail="No price drift for this item and period."
        )
    drift = drift[0]
    if drift.get("review_pending"):
        raise HTTPException(
            status_code=409,
            detail="This item already has a pending price review; resolve that row instead.",
        )
    _assert_period_open(db_month, body.year)

    now = datetime.now(timezone.utc).isoformat()
    previous = pricing.as_price(drift.get("inventory_price"))
    observed = pricing.as_price(drift.get("observed_price"))
    price = float(body.price or observed)
    if body.action == "apply":
        _apply_price(body.item_id, db_month, body.year, price)
    # Record the decision as a queue row so every price change has one audit
    # trail, whether it came from a commit or from this screen.
    record = {
        "item_id": body.item_id,
        "sku": drift.get("sku"),
        "description": drift.get("description"),
        "month": db_month,
        "year": body.year,
        "week": drift.get("week_number"),
        "invoice_number": drift.get("invoice_number"),
        "previous_price": round(previous, 4) if previous > 0 else None,
        "observed_price": round(observed, 4),
        "applied_price": round(price, 4) if body.action == "apply" else None,
        "change_pct": drift.get("change_pct"),
        "status": "applied" if body.action == "apply" else "kept",
        "reason": (body.note or "").strip()[:500] or "Resolved from price drift.",
        "created_by": auth_user["id"],
        "resolved_by": auth_user["id"],
        "resolved_at": now,
    }
    saved = supabase_service.table("price_review_queue").insert(record).execute().data
    record_audit_event(
        action=f"price_drift.{body.action}",
        result="accepted",
        actor=auth_user,
        method="POST",
        path="/api/price-review/drift/resolve",
        target_type="inventory_item",
        target_id=body.item_id,
        sku=drift.get("sku"),
        period_month=db_month,
        period_year=body.year,
        status_code=200,
        detail=f"{previous} -> {price if body.action == 'apply' else previous}",
    )
    return {**(saved[0] if saved else record), "month": body.month}


@router.post("/{row_id}/resolve")
@serialized_inventory_write
def resolve_price(
    row_id: str,
    body: ResolveBody,
    auth_user: dict = Depends(_require_manager),
):
    _check_action(body)
    rows = (
        supabase_service.table("price_review_queue")
        .select("*")
        .eq("id", row_id)
        .limit(1)
        .execute()
    ).data
    if not rows:
        raise HTTPException(status_code=404, detail="Price review row not found.")
    row = rows[0]
    if row.get("status") != "pending":
        raise HTTPException(
            status_code=409, detail=f"Row is already {row.get('status')}."
        )
    _assert_period_open(row["month"], row["year"])

    now = datetime.now(timezone.utc).isoformat()
    update = {"resolved_by": auth_user["id"], "resolved_at": now}
    if body.note:
        update["reason"] = body.note.strip()[:500]
    if body.action == "apply":
        price = float(body.price or row["observed_price"])
        _apply_price(row["item_id"], row["month"], row["year"], price)
        update.update(status="applied", applied_price=price)
    else:
        update["status"] = "kept"
    supabase_service.table("price_review_queue").update(update).eq(
        "id", row_id
    ).execute()

    record_audit_event(
        action=f"price_review.{body.action}",
        result="accepted",
        actor=auth_user,
        method="POST",
        path=f"/api/price-review/{row_id}/resolve",
        target_type="inventory_item",
        target_id=row["item_id"],
        sku=row.get("sku"),
        period_month=row["month"],
        period_year=row["year"],
        status_code=200,
        detail=(
            f"{row.get('previous_price')} -> {update.get('applied_price')}"
            if body.action == "apply"
            else f"kept {row.get('previous_price')} (invoice {row.get('observed_price')})"
        ),
    )
    return {**row, **update, "month": row["month"] + 1}
