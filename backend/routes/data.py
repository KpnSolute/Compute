"""
Data Access API Endpoints

Provides endpoints for checklist, servsafe, meal periods, incidents,
invoices, inventory categories, dashboard stats, and archives.
"""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel
from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user

router = APIRouter(prefix="/api", tags=["data"])


# _get_auth_user imported from backend.routes._deps (single source of truth).


@router.get("/opening-checklist")
async def get_opening_checklist(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase_service.table("opening_checklist_items")
            .select("*")
            .eq("is_active", True)
            .order("sort_order")
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── ServSafe ───────────────────────────────────────────────────────────────


@router.get("/servsafe")
async def get_servsafe(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase_service.table("servsafe_certifications")
            .select("*")
            .order("staff_name")
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Meal Periods ──────────────────────────────────────────────────────────


@router.get("/meal-periods")
async def get_meal_periods(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase_service.table("meal_periods")
            .select("*")
            .order("sort_order")
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Incidents ──────────────────────────────────────────────────────────────


class IncidentCreate(BaseModel):
    incident_type: str
    description: str
    reported_by: str
    notes: str = ""


@router.get("/incidents")
async def get_incidents(
    limit: int = Query(50, ge=1, le=500),
    incident_type: str = Query(None, alias="type"),
    auth_user: dict = Depends(_get_auth_user),
):
    try:
        query = supabase_service.table("incident_logs").select("*")
        if incident_type:
            query = query.eq("incident_type", incident_type)
        result = query.order("reported_at", desc=True).limit(limit).execute()
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/incidents", status_code=201)
async def create_incident(
    payload: IncidentCreate, auth_user: dict = Depends(_get_auth_user)
):
    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            supabase_service.table("incident_logs")
            .insert(
                {
                    "incident_type": payload.incident_type,
                    "description": payload.description,
                    "reported_by": payload.reported_by,
                    "notes": payload.notes,
                    "reported_at": now,
                    "created_at": now,
                }
            )
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=500, detail="Failed to create incident")
        return result.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Invoices ───────────────────────────────────────────────────────────────


@router.get("/invoices")
async def get_invoices(
    month: int = Query(None),
    year: int = Query(None),
    auth_user: dict = Depends(_get_auth_user),
):
    try:
        query = supabase_service.table("invoices").select("*")
        if month is not None:
            # invoices.month is 1-indexed in DB — no conversion needed
            query = query.eq("month", month)
        if year is not None:
            query = query.eq("year", year)
        result = query.order("created_at", desc=True).execute()
        invoices_data = result.data if result.data else []

        vendor_ids = list(
            {inv.get("vendor_id") for inv in invoices_data if inv.get("vendor_id")}
        )
        vendor_map = {}
        if vendor_ids:
            vendors_result = (
                supabase_service.table("vendors")
                .select("id,name")
                .in_("id", vendor_ids)
                .execute()
            )
            vendor_map = {v["id"]: v["name"] for v in (vendors_result.data or [])}

        return [
            {**inv, "vendor_name": vendor_map.get(inv.get("vendor_id"))}
            for inv in invoices_data
        ]
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/invoices/{id}/items")
async def get_invoice_items(id: str, auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase_service.table("invoice_items")
            .select("*")
            .eq("invoice_id", id)
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Inventory Categories ──────────────────────────────────────────────────


@router.get("/inventory-categories")
async def get_inventory_categories(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase_service.table("inventory_categories")
            .select("*")
            .order("sort_order")
            .execute()
        )
        return result.data if result.data else []
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _require_manager(auth_user: dict = Depends(_get_auth_user)) -> dict:
    role_levels = {"staff": 10, "assistant": 20, "manager": 30, "admin": 40, "sudo": 50}
    if role_levels.get(auth_user.get("role", ""), 0) < 30:
        raise HTTPException(status_code=403, detail="Manager or above required")
    return auth_user


class CategoryBody(BaseModel):
    name: str
    sort_order: int | None = None


@router.post("/inventory-categories", status_code=201)
async def create_category(
    body: CategoryBody, auth_user: dict = Depends(_require_manager)
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Category name is required")
    # auto-assign sort_order = max + 1 if not provided
    try:
        existing = (
            supabase_service.table("inventory_categories")
            .select("sort_order")
            .execute()
        )
        max_sort = max(
            (r.get("sort_order") or 0 for r in (existing.data or [])), default=0
        )
        sort_order = body.sort_order if body.sort_order is not None else max_sort + 1
        result = (
            supabase_service.table("inventory_categories")
            .insert({"name": name, "sort_order": sort_order})
            .execute()
        )
        return result.data[0] if result.data else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/inventory-categories/{cat_id}")
async def update_category(
    cat_id: str, body: CategoryBody, auth_user: dict = Depends(_require_manager)
):
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=422, detail="Category name is required")
    update: dict = {"name": name}
    if body.sort_order is not None:
        update["sort_order"] = body.sort_order
    try:
        result = (
            supabase_service.table("inventory_categories")
            .update(update)
            .eq("id", cat_id)
            .execute()
        )
        return result.data[0] if result.data else {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/inventory-categories/{cat_id}", status_code=204)
async def delete_category(cat_id: str, auth_user: dict = Depends(_require_manager)):
    # Block deletion if any inventory items are assigned to this category
    try:
        items = (
            supabase_service.table("inventory_items")
            .select("id")
            .eq("category_id", cat_id)
            .eq("active", True)
            .limit(1)
            .execute()
        )
        if items.data:
            raise HTTPException(
                status_code=409,
                detail="Cannot delete a category that has active inventory items",
            )
        supabase_service.table("inventory_categories").delete().eq(
            "id", cat_id
        ).execute()
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Dashboard Stats ────────────────────────────────────────────────────────


@router.get("/dashboard/stats")
async def get_dashboard_stats(auth_user: dict = Depends(_get_auth_user)):
    try:
        # total_value = current inventory value for the open period. The
        # live_inventory view prefers monthly_inventory.ending_value so dashboard
        # totals follow workbook Review controls instead of recomputing value
        # from quantity x current catalog price.
        total_value = 0.0
        try:
            tv = supabase_service.table("live_inventory").select("sub_total").execute()
            if tv.data:
                total_value = sum(float(r.get("sub_total", 0) or 0) for r in tv.data)
        except Exception:
            pass
        if not total_value:
            # Fallback: the latest filed period snapshot's grand_total (also an
            # ending-based figure). Never fall back to summing on_hand alone —
            # that ignores the month's receipts/issues and understates value.
            try:
                snap = (
                    supabase_service.table("monthly_snapshots")
                    .select("grand_total")
                    .order("year", desc=True)
                    .order("month", desc=True)
                    .limit(1)
                    .execute()
                )
                if snap.data:
                    total_value = float(snap.data[0].get("grand_total", 0) or 0)
            except Exception:
                pass

        # total_items: count active items from the canonical catalog
        # (the legacy `barcodes` store was retired in migration 008).
        total_items = 0
        try:
            ti = (
                supabase_service.table("inventory_items")
                .select("id")
                .eq("active", True)
                .execute()
            )
            total_items = len(ti.data) if ti.data else 0
        except Exception:
            pass

        # low_stock from live_inventory where on_hand < par_level
        low_stock = 0
        try:
            ls = (
                supabase_service.table("live_inventory")
                .select("on_hand,par_level")
                .execute()
            )
            if ls.data:
                low_stock = sum(
                    1
                    for r in ls.data
                    if float(r.get("on_hand", 0) or 0)
                    < float(r.get("par_level", 0) or 0)
                )
        except Exception:
            pass

        # pending_staging from staging_entries COUNT where status='pending'
        pending_staging = 0
        try:
            ps = (
                supabase_service.table("staging_entries")
                .select("entry_id")
                .eq("status", "pending")
                .execute()
            )
            pending_staging = len(ps.data) if ps.data else 0
        except Exception:
            pass

        # recent_activity from commits (last 5), enriched with user_profiles
        recent_activity = []
        try:
            cr = (
                supabase_service.table("commits")
                .select("commit_id,message,author_id,created_at")
                .order("created_at", desc=True)
                .limit(5)
                .execute()
            )
            if cr.data:
                author_ids = list(
                    {c["author_id"] for c in cr.data if c.get("author_id")}
                )
                pm = {}
                if author_ids:
                    pr = (
                        supabase_service.table("user_profiles")
                        .select("id,display_name,username,role")
                        .in_("id", author_ids)
                        .execute()
                    )
                    pm = {p["id"]: p for p in (pr.data or [])}
                for c in cr.data:
                    p = pm.get(c.get("author_id"), {})
                    recent_activity.append(
                        {
                            "who": p.get("display_name")
                            or p.get("username")
                            or c.get("author_id"),
                            "role": p.get("role", "staff"),
                            "what": "committed",
                            "detail": c.get("message", ""),
                            "when": c.get("created_at"),
                        }
                    )
        except Exception:
            pass

        return {
            "total_value": round(total_value, 2),
            "total_items": total_items,
            "low_stock": low_stock,
            "pending_staging": pending_staging,
            "recent_activity": recent_activity,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── Archives ───────────────────────────────────────────────────────────────


@router.get("/archives")
async def get_archives(auth_user: dict = Depends(_get_auth_user)):
    try:
        result = (
            supabase_service.table("monthly_snapshots")
            .select("month,year,grand_total,item_count")
            .order("year", desc=True)
            .order("month", desc=True)
            .execute()
        )
        rows = result.data or []
        # DB stores 0-indexed month; API returns 1-indexed
        for r in rows:
            r["month"] = r["month"] + 1
        return rows
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/archives/{year}/{month}")
async def get_archive_detail(
    year: int, month: int, auth_user: dict = Depends(_get_auth_user)
):
    try:
        # month param is 1-indexed from API; DB uses 0-indexed
        db_month = month - 1
        result = (
            supabase_service.table("monthly_snapshots")
            .select("*")
            .eq("year", year)
            .eq("month", db_month)
            .single()
            .execute()
        )
        if not result.data:
            raise HTTPException(status_code=404, detail="Archive not found")
        data = dict(result.data)
        data["month"] = data["month"] + 1  # 0→1 indexed
        return data
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
