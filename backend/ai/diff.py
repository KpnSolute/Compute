"""
Row-level diff engine.
Given staged entries (batch), compute before/after per row against live DB.
"""

import json
import os
from supabase import create_client

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


# ── per-operation diff handlers ───────────────────────────────────────────────


def _diff_inventory_item(item: dict, month: int = None, year: int = None) -> dict:
    """Compare a single inventory item payload against live DB state.

    on_hand is read from monthly_inventory (the real source of truth), not the dead
    inventory_items.on_hand column. category is included in change detection (P1.3).
    """
    sku = item.get("sku", "")
    r = (
        _client()
        .table("inventory_items")
        .select(
            "id,sku,description,unit_price,par_level,unit,inventory_categories(name)"
        )
        .eq("sku", sku)
        .limit(1)
        .execute()
    )
    live = r.data[0] if r.data else None

    after = {
        "sku": sku,
        "description": item.get("desc", ""),
        "unit_price": item.get("price", 0.0),
        "par_level": item.get("par", 0),
        "on_hand": item.get("onHand", 0),
        "category": item.get("category", ""),
    }
    # May-style workbooks carry total_pulled_raw when weekly pull columns are blank.
    # Surface it in the diff so commit_changes records an auditable pull action.
    if item.get("total_pulled_raw") is not None:
        after["total_pulled_raw"] = item["total_pulled_raw"]

    if not live:
        return {
            "sku": sku,
            "description": after["description"],
            "status": "new",
            "before": None,
            "after": after,
            "changes": list(after.keys()),
        }

    live_category = ""
    cat_data = live.get("inventory_categories")
    if isinstance(cat_data, dict):
        live_category = cat_data.get("name") or ""

    # Fetch on_hand from monthly_inventory — inventory_items.on_hand is not maintained.
    live_on_hand = 0
    if month is not None and year is not None:
        db_month = month - 1  # convert 1-indexed API month → 0-indexed DB month
        mi_r = (
            _client()
            .table("monthly_inventory")
            .select("opening_oh")
            .eq("item_id", live["id"])
            .eq("month", db_month)
            .eq("year", year)
            .limit(1)
            .execute()
        )
        if mi_r.data:
            live_on_hand = int(mi_r.data[0].get("opening_oh") or 0)

    before = {
        "sku": live["sku"],
        "description": live.get("description", ""),
        "unit_price": float(live.get("unit_price") or 0),
        "par_level": int(live.get("par_level") or 0),
        "on_hand": live_on_hand,
        "category": live_category,
    }

    changed_fields = [
        k
        for k in ("description", "unit_price", "par_level", "on_hand", "category")
        if before.get(k) != after.get(k)
    ]
    # total_pulled_raw is always a new pull record — no before value in DB.
    if "total_pulled_raw" in after:
        changed_fields.append("total_pulled_raw")

    return {
        "sku": sku,
        "description": after["description"] or before["description"],
        "status": "update" if changed_fields else "unchanged",
        "before": before,
        "after": after,
        "changes": changed_fields,
    }


def _diff_inventory_save(payload: dict) -> dict:
    items = payload.get("items", [])
    month = payload.get("month")
    year = payload.get("year")
    rows = [_diff_inventory_item(it, month=month, year=year) for it in items]
    new_count = sum(1 for r in rows if r["status"] == "new")
    update_count = sum(1 for r in rows if r["status"] == "update")
    unchanged_count = sum(1 for r in rows if r["status"] == "unchanged")
    return {
        "table": "inventory_items + monthly_inventory",
        "operation": "inventory_save",
        "summary": f"{new_count} new, {update_count} updates, {unchanged_count} unchanged",
        "month": payload.get("month"),
        "year": payload.get("year"),
        "rows": rows,
    }


def _diff_inventory_week(payload: dict) -> dict:
    """Preview a weekly-invoice posting: each item's qty → w{week}_{direction}."""
    week = payload.get("week")
    direction = payload.get("direction", "received")
    col = f"w{week}_{direction}"
    month = payload.get("month")
    year = payload.get("year")
    db_month = (month - 1) if month else None
    items = payload.get("items", [])
    svc = _client()
    rows = []
    for it in items:
        sku = (it.get("sku") or "").strip()
        qty = it.get("qty")
        if qty is None:
            qty = it.get("onHand", 0)

        live_r = (
            svc.table("inventory_items").select("id").eq("sku", sku).limit(1).execute()
        )
        item_row = live_r.data[0] if live_r.data else None
        status = "update" if item_row else "new"

        # Fetch the current value of the target weekly column so reviewers see before → after
        current_val = None
        if item_row and db_month is not None and year is not None:
            try:
                mi_r = (
                    svc.table("monthly_inventory")
                    .select(col)
                    .eq("item_id", item_row["id"])
                    .eq("month", db_month)
                    .eq("year", year)
                    .limit(1)
                    .execute()
                )
                if mi_r.data:
                    current_val = mi_r.data[0].get(col)
            except Exception:
                pass

        rows.append(
            {
                "sku": sku,
                "description": it.get("desc", ""),
                "status": status,
                "before": {col: current_val} if item_row else None,
                "after": {col: qty},
                "changes": [col],
            }
        )
    return {
        "table": "monthly_inventory",
        "operation": "inventory_week_update",
        "summary": f"{len(items)} item(s) → Week {week} {direction}",
        "month": month,
        "year": year,
        "rows": rows,
    }


def _diff_item_update(payload: dict) -> dict:
    """Preview an edit/reassign of a single item identified by SKU."""
    sku = (payload.get("sku") or "").strip()
    r = (
        _client()
        .table("inventory_items")
        .select("sku,description,category_id,unit_price,par_level,unit,active")
        .eq("sku", sku)
        .limit(1)
        .execute()
    )
    live = r.data[0] if r.data else None
    after = {
        k: payload[k]
        for k in ("desc", "category", "price", "par", "unit", "active", "new_sku")
        if payload.get(k) is not None
    }
    status = "update" if live else "missing"
    return {
        "table": "inventory_items",
        "operation": "item_update",
        "summary": f"Edit {sku}" + ("" if live else " (SKU not found)"),
        "rows": [
            {
                "sku": sku,
                "status": status,
                "before": live,
                "after": after,
                "changes": list(after.keys()),
            }
        ],
    }


def _diff_item_delete(payload: dict) -> dict:
    sku = (payload.get("sku") or "").strip()
    hard = payload.get("hard") is True
    return {
        "table": "inventory_items",
        "operation": "item_delete",
        "summary": f"{'Hard-delete' if hard else 'Deactivate'} {sku}",
        "rows": [
            {
                "sku": sku,
                "status": "delete",
                "before": {"sku": sku},
                "after": None if hard else {"active": False},
                "changes": ["active"],
            }
        ],
    }


def _diff_event_create(payload: dict) -> dict:
    title = payload.get("title", "")
    date = payload.get("date", "")
    q = _client().table("events").select("id,title,date,cat,status")
    if title:
        q = q.eq("title", title)
    if date:
        q = q.eq("date", date)
    r = q.limit(1).execute()
    existing = r.data[0] if r.data else None

    after = {k: v for k, v in payload.items() if v is not None}
    if existing:
        before = {k: existing.get(k) for k in after}
        changed = [k for k in after if after[k] != before.get(k)]
        return {
            "table": "events",
            "operation": "event_create",
            "summary": "1 update (event already exists)",
            "rows": [
                {
                    "title": title,
                    "date": date,
                    "status": "update",
                    "before": before,
                    "after": after,
                    "changes": changed,
                }
            ],
        }

    return {
        "table": "events",
        "operation": "event_create",
        "summary": "1 new event",
        "rows": [
            {
                "title": title,
                "date": date,
                "status": "new",
                "before": None,
                "after": after,
                "changes": list(after.keys()),
            }
        ],
    }


def _diff_haccp_save(payload: dict) -> dict:
    return {
        "table": "haccp_logs",
        "operation": "haccp_save",
        "summary": "1 new HACCP log entry (insert-only)",
        "rows": [
            {
                "status": "new",
                "before": None,
                "after": payload,
                "changes": list(payload.keys()),
            }
        ],
    }


def _diff_daily_log_save(payload: dict) -> dict:
    return {
        "table": "daily_operations_logs",
        "operation": "daily_log_save",
        "summary": "1 new operations log entry (insert-only)",
        "rows": [
            {
                "status": "new",
                "before": None,
                "after": payload,
                "changes": list(payload.keys()),
            }
        ],
    }


def _diff_menu_save(payload: dict) -> dict:
    day = payload.get("day", "")
    data = payload.get("data", {})
    r = (
        _client()
        .table("menu_entries")
        .select("meal_type,items")
        .eq("day_of_week", day)
        .execute()
    )
    existing = {row["meal_type"]: row["items"] for row in (r.data or [])}
    rows = []
    for meal_type, items in data.items():
        raw_before = existing.get(meal_type)
        if raw_before is None:
            before_items = None
            status = "new"
        else:
            try:
                before_items = (
                    json.loads(raw_before)
                    if isinstance(raw_before, str)
                    else raw_before
                )
            except (ValueError, TypeError):
                before_items = raw_before
            status = "update"
        rows.append(
            {
                "day": day,
                "meal_type": meal_type,
                "status": status,
                "before": {"items": before_items},
                "after": {"items": items},
                "changes": ["items"] if before_items != items else [],
            }
        )
    return {
        "table": "menu_entries",
        "operation": "menu_save",
        "summary": f"{len(rows)} meal slots for {day}",
        "rows": rows,
    }


# ── public API ────────────────────────────────────────────────────────────────

_DIFF_HANDLERS = {
    "inventory_save": _diff_inventory_save,
    "inventory_week_update": _diff_inventory_week,
    "item_update": _diff_item_update,
    "item_delete": _diff_item_delete,
    "event_create": _diff_event_create,
    "haccp_save": _diff_haccp_save,
    "daily_log_save": _diff_daily_log_save,
    "menu_save": _diff_menu_save,
}


def diff_staging_entry(entry: dict) -> dict:
    """Compute row-level diff for a single staging entry."""
    op = entry.get("operation") or ""
    payload = entry.get("full_payload") or {}
    handler = _DIFF_HANDLERS.get(op)
    if not handler:
        return {
            "table": "unknown",
            "operation": op,
            "summary": "No diff handler for this operation",
            "rows": [],
        }
    result = handler(payload)
    result["entry_id"] = entry.get("entry_id")
    return result


def diff_batch(batch_entries: list[dict]) -> list[dict]:
    """Compute row-level diffs for all entries in a batch."""
    return [diff_staging_entry(e) for e in batch_entries]
