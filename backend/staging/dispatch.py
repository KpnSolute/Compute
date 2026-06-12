import json
import os
from datetime import datetime, timezone

from supabase import create_client

from backend.inventory_identity import (
    get_new_items_category_id,
    resolve_and_write_item,
)

_svc = None


def _client():
    global _svc
    if _svc is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        _svc = create_client(url, key)
    return _svc


def _is_month_published(sup, db_month: int, year: int) -> bool:
    """Return True if this period is published/closed — writes should be rejected."""
    try:
        r = sup.table('month_status').select('status').eq('month', db_month).eq('year', year).limit(1).execute()
        row = (r.data or [None])[0]
        return bool(row and row.get('status') == 'published')
    except Exception:
        return False


def dispatch_inventory_save(payload: dict) -> dict:
    month = payload.get("month") or datetime.now().month  # 1-indexed from staging
    year = payload.get("year") or datetime.now().year
    items = payload.get("items", [])
    notes = payload.get("notes", "")
    if not items:
        return {"applied": 0, "error": "No items in payload"}

    db_month = max(0, month - 1)  # Convert 1→0 indexed for monthly_inventory
    sup = _client()
    if _is_month_published(sup, db_month, year):
        return {'applied': 0, 'error': f'Period {month}/{year} is published and cannot be modified'}

    cat_r = sup.table("inventory_categories").select("id,name").execute()
    cat_map = {r["name"]: r["id"] for r in (cat_r.data or [])}
    new_items_cat_id = get_new_items_category_id(sup)
    # data-entry imports flag the whole batch so brand-new SKUs land in New Items.
    review_new = bool(payload.get("review_new"))

    count = 0
    for item in items:
        # Identity is resolved by SKU only; an unknown category resolves to None
        # so a brand-new item lands in "New Items" for manager review.
        cat_id = cat_map.get(item.get("category", ""))

        item_id, _sku, _created = resolve_and_write_item(
            sup,
            sku=item.get("sku"),
            desc=item.get("desc"),
            category_id=cat_id,
            fallback_category_id=new_items_cat_id,
            price=item.get("price"),
            par=None,  # par is item-level; use dispatch_item_update for par changes
            unit=item.get("unit") or None,
            force_review_category=review_new,
        )
        if not item_id:
            continue

        monthly_fields: dict = {
            "item_id": item_id,
            "month": db_month,
            "year": year,
        }
        # Only write on_hand when explicitly in the payload — a missing key must
        # not zero an existing balance. Default 0 only for new rows (DB default).
        on_hand = item.get("onHand")
        if on_hand is not None:
            monthly_fields["on_hand"] = max(0, int(on_hand))
        if item.get("price") is not None:
            monthly_fields["unit_price"] = item["price"]
        # Only write weekly columns when explicitly present in the payload — omitting
        # them preserves existing W1-W4 data instead of zeroing it on every save.
        for src, col in [
            ("w1r", "w1_received"), ("w2r", "w2_received"),
            ("w3r", "w3_received"), ("w4r", "w4_received"),
            ("w1i", "w1_issued"),   ("w2i", "w2_issued"),
            ("w3i", "w3_issued"),   ("w4i", "w4_issued"),
        ]:
            if src in item:
                monthly_fields[col] = item[src]
        sup.table("monthly_inventory").upsert(
            monthly_fields,
            on_conflict="item_id,month,year",
        ).execute()
        count += 1
    return {"applied": count, "month": month, "year": year, "notes": notes}


def dispatch_item_update(payload: dict) -> dict:
    """Edit ANY inventory item, identified by SKU. Supports category reassign
    (the manager moving an item OUT of "New Items"), description/price/par/unit
    edits, and (de)activation. Only the fields present in the payload are written.
    """
    sup = _client()
    sku = (payload.get("sku") or "").strip()
    if not sku:
        return {"applied": 0, "error": "Missing sku"}

    target = (
        sup.table("inventory_items").select("id").eq("sku", sku).limit(1).execute()
    )
    row = (target.data or [None])[0]
    if not row:
        return {"applied": 0, "error": f"Unknown sku: {sku}"}

    fields: dict = {"updated_at": datetime.now(timezone.utc).isoformat()}
    if payload.get("desc") is not None:
        fields["description"] = payload["desc"]
    if payload.get("category"):
        cat_r = (
            sup.table("inventory_categories")
            .select("id")
            .eq("name", payload["category"])
            .limit(1)
            .execute()
        )
        cat_row = (cat_r.data or [None])[0]
        if cat_row:
            fields["category_id"] = cat_row["id"]
    if payload.get("price") is not None:
        fields["unit_price"] = payload["price"]
    if payload.get("par") is not None:
        fields["par_level"] = payload["par"]
    if payload.get("unit"):
        fields["unit"] = payload["unit"]
    if payload.get("active") is not None:
        fields["active"] = bool(payload["active"])
    # Optional SKU rename (kept distinct from identity to avoid silent merges).
    new_sku = (payload.get("new_sku") or "").strip()
    if new_sku and new_sku != sku:
        fields["sku"] = new_sku

    sup.table("inventory_items").update(fields).eq("id", row["id"]).execute()
    return {"applied": 1, "sku": new_sku or sku, "fields": list(fields.keys())}


def dispatch_item_delete(payload: dict) -> dict:
    """Delete an inventory item by SKU. Soft by default (active=false) to
    preserve monthly_inventory / source-control history; hard delete only when
    the payload explicitly sets `hard: true`.
    """
    sup = _client()
    sku = (payload.get("sku") or "").strip()
    if not sku:
        return {"applied": 0, "error": "Missing sku"}

    if payload.get("hard") is True:
        sup.table("inventory_items").delete().eq("sku", sku).execute()
        return {"applied": 1, "sku": sku, "mode": "hard"}

    sup.table("inventory_items").update(
        {"active": False, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("sku", sku).execute()
    return {"applied": 1, "sku": sku, "mode": "soft"}


def dispatch_inventory_week(payload: dict) -> dict:
    """Weekly invoice posting: write a parsed quantity into ONE target column —
    `w{week}_{received|issued}` — for the given month, WITHOUT touching on_hand or
    the other weeks. Used by the Data Entry weekly-invoice upload (admin picks
    Month / Week / Imports(received)|Exports(issued)).

    The partial upsert on (item_id,month,year) updates only the provided column on
    conflict, so opening balance and other weeks are preserved. Unrecognized SKUs
    resolve into "New Items" for manager review (force_review).
    """
    month = payload.get("month") or datetime.now().month  # 1-indexed
    year = payload.get("year") or datetime.now().year
    week = int(payload.get("week") or 0)
    direction = (payload.get("direction") or "received").lower()
    items = payload.get("items", [])
    if week not in (1, 2, 3, 4):
        return {"applied": 0, "error": f"Invalid week {week} (expected 1-4)"}
    if direction not in ("received", "issued"):
        return {"applied": 0, "error": f"Invalid direction {direction}"}
    if not items:
        return {"applied": 0, "error": "No items in payload"}

    db_month = max(0, month - 1)
    col = f"w{week}_{direction}"
    sup = _client()
    if _is_month_published(sup, db_month, year):
        return {'applied': 0, 'error': f'Period {month}/{year} is published and cannot be modified'}

    cat_r = sup.table("inventory_categories").select("id,name").execute()
    cat_map = {r["name"]: r["id"] for r in (cat_r.data or [])}
    new_items_cat_id = get_new_items_category_id(sup)
    review_new = bool(payload.get("review_new"))

    count = 0
    for item in items:
        cat_id = cat_map.get(item.get("category", ""))
        item_id, _sku, _created = resolve_and_write_item(
            sup,
            sku=item.get("sku"),
            desc=item.get("desc"),
            category_id=cat_id,
            fallback_category_id=new_items_cat_id,
            price=item.get("price"),
            par=None,  # par is item-level; use dispatch_item_update for par changes
            unit=item.get("unit") or None,
            force_review_category=review_new,
        )
        if not item_id:
            continue

        qty = item.get("qty")
        if qty is None:
            qty = item.get("onHand", 0)
        monthly_fields = {
            "item_id": item_id,
            "month": db_month,
            "year": year,
            col: qty,
        }
        if item.get("price") is not None:
            monthly_fields["unit_price"] = item.get("price")
        # Partial upsert: only `col` (+ unit_price) is written on conflict, so
        # on_hand and the other weekly columns are left intact.
        sup.table("monthly_inventory").upsert(
            monthly_fields, on_conflict="item_id,month,year"
        ).execute()
        count += 1
    return {
        "applied": count,
        "month": month,
        "year": year,
        "week": week,
        "direction": direction,
    }


def dispatch_menu_save(payload: dict) -> dict:
    day = payload.get("day")
    data = payload.get("data", {})
    if not day or not data:
        return {"applied": 0, "error": "Missing day or data"}

    sup = _client()
    cycle_r = (
        sup.table("menu_cycles").select("id").eq("active", True).limit(1).execute()
    )
    if not cycle_r.data:
        return {"applied": 0, "error": "No active cycle found"}
    cycle_id = cycle_r.data[0]["id"]

    sup.table("menu_entries").delete().eq("day_of_week", day).eq(
        "cycle_id", cycle_id
    ).execute()

    inserts = []
    sort_order = 0
    for meal_type, items in data.items():
        # menu_entries.items is a text column — serialize lists as JSON strings.
        items_list = items if isinstance(items, list) else []
        inserts.append(
            {
                "cycle_id": cycle_id,
                "week_number": 1,
                "day_of_week": day,
                "meal_type": meal_type,
                "items": json.dumps(items_list),
                "sides": json.dumps([]),  # sides as TEXT JSON per §4 real schema (plan fix for fidelity)
                "sort_order": sort_order,
                "created_at": datetime.now(timezone.utc).isoformat(),
                "updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        sort_order += 1

    if inserts:
        sup.table("menu_entries").insert(inserts).execute()
    return {"applied": len(inserts), "day": day, "cycle_id": cycle_id}


def dispatch_event_create(payload: dict) -> dict:
    sup = _client()
    staging_id = payload.get("_staging_entry_id")
    clean = {k: v for k, v in payload.items() if v is not None and not k.startswith("_")}
    if staging_id:
        existing = sup.table("events").select("id").eq("staging_entry_id", staging_id).limit(1).execute()
        if existing.data:
            return {"applied": 0, "skipped": True}
        clean["staging_entry_id"] = staging_id
    r = sup.table("events").insert(clean).execute()
    return {"applied": 1, "event": r.data[0] if r.data else None}


def dispatch_haccp_save(payload: dict) -> dict:
    sup = _client()
    staging_id = payload.get("_staging_entry_id")
    if staging_id:
        existing = sup.table("haccp_logs").select("id").eq("staging_entry_id", staging_id).limit(1).execute()
        if existing.data:
            return {"applied": 0, "skipped": True}
    row = {
        "location": payload.get("location", ""),
        "temperature": payload.get("temperature", 0),
        "unit": payload.get("unit", "F"),
        "timestamp": payload.get("timestamp", datetime.now(timezone.utc).isoformat()),
        "checked_by": payload.get("checked_by", ""),
        "notes": payload.get("notes", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if staging_id:
        row["staging_entry_id"] = staging_id
    r = sup.table("haccp_logs").insert(row).execute()
    return {"applied": 1, "log": r.data[0] if r.data else None}


def dispatch_daily_log_save(payload: dict) -> dict:
    sup = _client()
    staging_id = payload.get("_staging_entry_id")
    if staging_id:
        existing = sup.table("daily_operations_logs").select("id").eq("staging_entry_id", staging_id).limit(1).execute()
        if existing.data:
            return {"applied": 0, "skipped": True}
    row = {
        "entry_type": payload.get("entry_type", ""),
        "title": payload.get("title", ""),
        "description": payload.get("description", ""),
        "severity": payload.get("severity", "info"),
        "data": payload.get("data", ""),
        "created_by": payload.get("created_by", ""),
        "created_at": datetime.now(timezone.utc).isoformat(),
    }
    if staging_id:
        row["staging_entry_id"] = staging_id
    r = sup.table("daily_operations_logs").insert(row).execute()
    return {"applied": 1, "log": r.data[0] if r.data else None}


def dispatch_user_create(payload: dict) -> dict:
    sup = _client()
    # NOTE: user_profiles has NO password column. Auth is Supabase Auth (JWT) for
    # admin/manager, PIN for staff. Never write password to user_profiles.
    row = {
        "username": payload.get("username", ""),
        "display_name": payload.get("display_name", ""),
        "last_name": payload.get("last_name", ""),
        "role": payload.get("role", "staff"),
        "pin": payload.get("pin"),
        "active": payload.get("active", True),
        "email": payload.get("email", ""),
    }
    r = sup.table("user_profiles").insert(row).execute()
    return {"applied": 1, "user": r.data[0] if r.data else None}


def dispatch_user_update(payload: dict) -> dict:
    sup = _client()
    user_id = payload.get("user_id")
    if not user_id:
        return {"applied": 0, "error": "Missing user_id"}
    # Exclude user_id (routing key) and password (column does not exist in user_profiles).
    _EXCLUDED = {"user_id", "password"}
    fields = {k: v for k, v in payload.items() if k not in _EXCLUDED and v is not None}
    r = sup.table("user_profiles").update(fields).eq("id", user_id).execute()
    return {"applied": 1, "user": r.data[0] if r.data else None}


REGISTRY = {
    "inventory_save": dispatch_inventory_save,
    "inventory_week_update": dispatch_inventory_week,
    "item_update": dispatch_item_update,
    "item_delete": dispatch_item_delete,
    "menu_save": dispatch_menu_save,
    "event_create": dispatch_event_create,
    "haccp_save": dispatch_haccp_save,
    "daily_log_save": dispatch_daily_log_save,
    "user_create": dispatch_user_create,
    "user_update": dispatch_user_update,
}


def replay(operation: str, full_payload: dict) -> dict:
    handler = REGISTRY.get(operation)
    if not handler:
        return {"applied": 0, "error": f"Unknown operation: {operation}"}
    return handler(full_payload)
