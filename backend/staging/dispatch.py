import json
import logging
import os
from datetime import datetime, timezone

from supabase import create_client

from backend.inventory_identity import (
    get_new_items_category_id,
    resolve_and_write_item,
)

log = logging.getLogger("mjcc.dispatch")

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
        r = (
            sup.table("month_status")
            .select("status")
            .eq("month", db_month)
            .eq("year", year)
            .limit(1)
            .execute()
        )
        row = (r.data or [None])[0]
        return bool(row and row.get("status") == "published")
    except Exception:
        return False


def _non_negative(value, field: str, sku: str | None = None):
    if value is None:
        return None
    try:
        number = float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be numeric for SKU {sku or 'unknown'}")
    if number < 0:
        raise ValueError(f"{field} cannot be negative for SKU {sku or 'unknown'}")
    return number


def _validate_inventory_item_numbers(
    items: list[dict], fields: tuple[str, ...]
) -> None:
    for item in items:
        sku = item.get("sku")
        for field in fields:
            if field in item and item.get(field) is not None:
                _non_negative(item.get(field), field, sku)


def _rollover_opening_balances(sup, db_month: int, year: int) -> int:
    """Carry the previous month's closing balance forward as opening on_hand for
    items that have on_hand == 0 in the current month. Only fires when previous
    month has data. Non-blocking — called after the main upsert."""
    prev_db_month = db_month - 1 if db_month > 0 else 11
    prev_year = year if db_month > 0 else year - 1

    prev_r = sup.table('monthly_inventory').select(
        'item_id,on_hand,w1_received,w2_received,w3_received,w4_received,'
        'w1_issued,w2_issued,w3_issued,w4_issued'
    ).eq('month', prev_db_month).eq('year', prev_year).execute()
    if not prev_r.data:
        return 0

    prev_ids = [r['item_id'] for r in prev_r.data]

    # Aggregate week-0 pulls from inventory_transactions (May-style total_pulled_raw)
    txn_r = sup.table('inventory_transactions').select('item_id,quantity').in_(
        'item_id', prev_ids
    ).eq('month', prev_db_month).eq('year', prev_year).eq('week_number', 0).eq(
        'txn_type', 'issued'
    ).execute()
    agg_pulls: dict[str, float] = {}
    for t in txn_r.data or []:
        agg_pulls[t['item_id']] = agg_pulls.get(t['item_id'], 0) + (t['quantity'] or 0)

    # Which items in the current month still have on_hand == 0?
    curr_r = sup.table('monthly_inventory').select('item_id,on_hand').in_(
        'item_id', prev_ids
    ).eq('month', db_month).eq('year', year).execute()
    curr_map = {r['item_id']: r.get('on_hand') or 0 for r in curr_r.data or []}

    updated = 0
    for prev in prev_r.data:
        iid = prev['item_id']
        if curr_map.get(iid, 0) != 0:
            continue  # explicit opening balance already set — don't override
        closing = max(0, int(
            (prev.get('on_hand') or 0)
            + (prev.get('w1_received') or 0)
            + (prev.get('w2_received') or 0)
            + (prev.get('w3_received') or 0)
            + (prev.get('w4_received') or 0)
            - (prev.get('w1_issued') or 0)
            - (prev.get('w2_issued') or 0)
            - (prev.get('w3_issued') or 0)
            - (prev.get('w4_issued') or 0)
            - agg_pulls.get(iid, 0)
        ))
        if closing > 0:
            sup.table('monthly_inventory').update({'on_hand': closing}).eq(
                'item_id', iid
            ).eq('month', db_month).eq('year', year).execute()
            updated += 1
    return updated


def dispatch_inventory_save(payload: dict) -> dict:
    month = payload.get("month") or datetime.now().month  # 1-indexed from staging
    year = payload.get("year") or datetime.now().year
    items = payload.get("items", [])
    notes = payload.get("notes", "")
    if not items:
        return {"applied": 0, "error": "No items in payload"}
    try:
        _validate_inventory_item_numbers(
            items,
            (
                "onHand",
                "price",
                "w1r",
                "w2r",
                "w3r",
                "w4r",
                "w1i",
                "w2i",
                "w3i",
                "w4i",
                "total_pulled_raw",
            ),
        )
    except ValueError as exc:
        return {"applied": 0, "error": str(exc)}

    db_month = max(0, month - 1)  # Convert 1→0 indexed for monthly_inventory
    sup = _client()
    # Published periods are read-only (also enforced by the DB guard trigger).
    if _is_month_published(sup, db_month, year):
        return {
            "applied": 0,
            "error": f"Period {month}/{year} is published and cannot be modified",
        }

    # Audit metadata threaded from the commit path (_apply_entries injects _staging_entry_id).
    # When _apply_entries batches many entries into one call, _batch_staging_ids carries all IDs.
    staging_entry_id = payload.get("_staging_entry_id")
    batch_staging_ids: list[str] = payload.get("_batch_staging_ids") or (
        [staging_entry_id] if staging_entry_id else []
    )
    source_file = payload.get("source_file")
    source_hash = payload.get("source_hash")
    batch_id = payload.get("import_batch_id")
    created_by = payload.get("_author_id") or payload.get("created_by")
    txn_date = payload.get("txn_date") or datetime.now(timezone.utc).date().isoformat()

    cat_r = sup.table("inventory_categories").select("id,name").execute()
    cat_map = {r["name"]: r["id"] for r in (cat_r.data or [])}
    new_items_cat_id = get_new_items_category_id(sup)
    # data-entry imports flag the whole batch so brand-new SKUs land in New Items.
    review_new = bool(payload.get("review_new"))

    count = 0
    dropped = 0
    rows: list[dict] = []
    txn_rows: list[dict] = []  # week 1-4 spreadsheet cells + week 0 aggregate pulls
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
            # Whole-month baseline carries par/reorder levels when the sheet has a
            # Par column. None when absent → resolve_and_write_item preserves the
            # item's existing par (never zeroes it).
            par=item.get("par"),
            unit=item.get("unit") or None,
            force_review_category=review_new,
        )
        if not item_id:
            log.warning(
                "[dispatch] inventory_save: could not resolve item_id for sku=%r "
                "desc=%r — item DROPPED from this import (month=%s year=%s)",
                item.get("sku"),
                item.get("desc"),
                month,
                year,
            )
            dropped += 1
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
            monthly_fields["on_hand"] = int(
                _non_negative(on_hand, "onHand", item.get("sku"))
            )
        if item.get("price") is not None:
            monthly_fields["unit_price"] = item["price"]
        # Only write weekly columns when explicitly present in the payload — omitting
        # them preserves existing W1-W4 data instead of zeroing it on every save.
        for src, col, week_number, txn_type in [
            ("w1r", "w1_received", 1, "received"),
            ("w2r", "w2_received", 2, "received"),
            ("w3r", "w3_received", 3, "received"),
            ("w4r", "w4_received", 4, "received"),
            ("w1i", "w1_issued", 1, "issued"),
            ("w2i", "w2_issued", 2, "issued"),
            ("w3i", "w3_issued", 3, "issued"),
            ("w4i", "w4_issued", 4, "issued"),
        ]:
            if src in item:
                qty = _non_negative(item[src], src, item.get("sku"))
                monthly_fields[col] = qty
                if qty:
                    item_sid = item.get("_staging_entry_id") or staging_entry_id
                    txn_rows.append(
                        {
                            "item_id": item_id,
                            "sku": _sku,
                            "month": db_month,
                            "year": year,
                            "week_number": week_number,
                            "txn_type": txn_type,
                            "quantity": qty,
                            "unit_price": _non_negative(
                                item.get("price"), "price", item.get("sku")
                            )
                            or 0,
                            "source_file": source_file,
                            "source_hash": source_hash,
                            "batch_id": batch_id,
                            "staging_entry_id": item_sid,
                            "txn_date": txn_date,
                            "created_by": created_by,
                        }
                    )
        rows.append(monthly_fields)
        count += 1

        # May-style workbooks: weekly pull columns blank but Total Pulled (col L) is
        # verified. Record as a week_number=0 aggregate issued transaction so
        # source-control history shows the pull without inventing per-week distribution.
        tpr = item.get("total_pulled_raw")
        if tpr is not None:
            pr_qty = _non_negative(tpr, "total_pulled_raw", item.get("sku"))
            if pr_qty:
                # Per-item staging_entry_id: set when _apply_entries batches multiple
                # entries into one call (each item carries its own entry's ID).
                item_sid = item.get("_staging_entry_id") or staging_entry_id
                txn_rows.append(
                    {
                        "item_id": item_id,
                        "sku": _sku,
                        "month": db_month,
                        "year": year,
                        "week_number": 0,
                        "txn_type": "issued",
                        "quantity": pr_qty,
                        "unit_price": _non_negative(
                            item.get("price"), "price", item.get("sku")
                        )
                        or 0,
                        "source_file": source_file,
                        "source_hash": source_hash,
                        "batch_id": batch_id,
                        "staging_entry_id": item_sid,
                        "txn_date": txn_date,
                        "created_by": created_by,
                    }
                )

    # Batched, atomic write. Rows are grouped by their exact column signature so a
    # batched upsert never introduces NULLs for columns a row omitted (which would
    # wipe existing weekly data). Each group is a single statement -> one snapshot
    # refresh per period (see statement-level trigger), instead of one per row.
    #
    # Dedup by (item_id, month, year) first: when multiple spreadsheet rows share
    # the same SKU (e.g. 20 no-SKU rows all resolve to the same item_id), a single
    # batch upsert with duplicate conflict keys raises PG error 21000. Last write wins,
    # matching the old sequential per-entry behavior.
    if rows:
        _seen: dict[tuple, dict] = {}
        for r in rows:
            _seen[(r["item_id"], r["month"], r["year"])] = r
        rows = list(_seen.values())
        groups: dict[tuple, list[dict]] = {}
        for r in rows:
            groups.setdefault(tuple(sorted(r.keys())), []).append(r)
        for batch in groups.values():
            sup.table("monthly_inventory").upsert(
                batch,
                on_conflict="item_id,month,year",
            ).execute()

    # Write ledger rows for spreadsheet weekly cells and week_number=0 aggregate
    # pulls. Idempotent: clear prior rows for ALL staging_entry_ids in this batch
    # before re-inserting. Use in_() so a 266-entry batch is one DELETE instead of
    # 266 separate deletes.
    if txn_rows:
        ids_to_clear = list(
            {r["staging_entry_id"] for r in txn_rows if r.get("staging_entry_id")}
        )
        if not ids_to_clear and batch_staging_ids:
            ids_to_clear = batch_staging_ids
        if ids_to_clear:
            sup.table("inventory_transactions").delete().in_(
                "staging_entry_id", ids_to_clear
            ).execute()
        sup.table("inventory_transactions").insert(txn_rows).execute()

    result = {
        "applied": count,
        "dropped": dropped,
        "month": month,
        "year": year,
        "notes": notes,
    }
    # Do not let a lossy save be recorded as a clean merge. If any item was
    # dropped (unresolvable SKU), surface it as an error so _apply_entries leaves
    # the staging entry pending for review instead of marking it merged.
    if dropped:
        result["error"] = (
            f"{dropped} item(s) dropped (unresolved SKU); {count} applied. Entry left pending for review."
        )
    # Auto-rollover: carry previous month closing balances forward as opening on_hand
    try:
        rolled = _rollover_opening_balances(sup, db_month, year)
        if rolled:
            result['rolled_over'] = rolled
    except Exception as exc:
        log.warning('[dispatch] rollover failed (non-blocking): %s', exc)
    return result


def dispatch_item_update(payload: dict) -> dict:
    """Edit ANY inventory item, identified by SKU. Supports category reassign
    (the manager moving an item OUT of "New Items"), description/price/par/unit
    edits, and (de)activation. Only the fields present in the payload are written.
    """
    sup = _client()
    sku = (payload.get("sku") or "").strip()
    if not sku:
        return {"applied": 0, "error": "Missing sku"}

    target = sup.table("inventory_items").select("id").eq("sku", sku).limit(1).execute()
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

    try:
        sup.table("inventory_items").update(fields).eq("id", row["id"]).execute()
    except Exception as exc:
        err_str = str(exc)
        if (
            new_sku
            and new_sku != sku
            and (
                "23505" in err_str
                or "unique" in err_str.lower()
                or "duplicate" in err_str.lower()
            )
        ):
            conflict_r = (
                sup.table("inventory_items")
                .select("id,sku,description")
                .eq("sku", new_sku)
                .limit(1)
                .execute()
            )
            conflict_row = (conflict_r.data or [None])[0] or {}
            return {
                "applied": 0,
                "error": "sku_conflict",
                "conflict_sku": new_sku,
                "conflict_item_id": conflict_row.get("id"),
                "conflict_desc": conflict_row.get("description"),
            }
        raise
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
    """Weekly invoice/pull posting — LEDGER MODEL (Phase 1).

    Each parsed quantity is appended to `inventory_transactions` as one movement
    (txn_type received|issued), then the derived `w{week}_{direction}` column on
    monthly_inventory is RECOMPUTED from the ledger via recompute_week_totals().
    Consequences vs the old direct-write:
      - A SECOND invoice/pull in the same week ACCUMULATES (the column = SUM of
        ledger rows) instead of overwriting the first.
      - The ledger is the source of truth; the column is a derived cache.
      - Replay is idempotent: prior ledger rows from the same staging entry are
        deleted before re-insert, so a retried commit never double-counts.
    on_hand (opening) and the other weeks are never touched. Unrecognized SKUs
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
    try:
        _validate_inventory_item_numbers(items, ("qty", "onHand", "price"))
    except ValueError as exc:
        return {"applied": 0, "error": str(exc)}

    db_month = max(0, month - 1)
    txn_type = direction  # 'received' | 'issued'
    sup = _client()
    if _is_month_published(sup, db_month, year):
        return {
            "applied": 0,
            "error": f"Period {month}/{year} is published and cannot be modified",
        }

    # Audit metadata threaded from the upload (data_entry) so every ledger row is
    # traceable back to its source file / batch.
    staging_entry_id = payload.get("_staging_entry_id")
    source_file = payload.get("source_file")
    source_hash = payload.get("source_hash")
    invoice_number = payload.get("invoice_number")
    batch_id = payload.get("import_batch_id")
    created_by = payload.get("_author_id") or payload.get("created_by")
    txn_date = payload.get("txn_date") or datetime.now(timezone.utc).date().isoformat()

    cat_r = sup.table("inventory_categories").select("id,name").execute()
    cat_map = {r["name"]: r["id"] for r in (cat_r.data or [])}
    new_items_cat_id = get_new_items_category_id(sup)
    review_new = bool(payload.get("review_new"))

    count = 0
    dropped = 0
    txn_rows: list[dict] = []
    affected_items: set[str] = set()
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
            log.warning(
                "[dispatch] inventory_week: could not resolve item_id for sku=%r "
                "desc=%r — item DROPPED from this import (month=%s year=%s week=%s)",
                item.get("sku"),
                item.get("desc"),
                month,
                year,
                week,
            )
            dropped += 1
            continue

        qty = item.get("qty")
        if qty is None:
            qty = item.get("onHand", 0)
        qty = _non_negative(qty, "qty", item.get("sku"))
        price = _non_negative(item.get("price"), "price", item.get("sku")) or 0
        txn_rows.append(
            {
                "item_id": item_id,
                "sku": _sku,
                "month": db_month,
                "year": year,
                "week_number": week,
                "txn_type": txn_type,
                "quantity": qty,
                "unit_price": price,
                "source_file": source_file,
                "source_hash": source_hash,
                "invoice_number": invoice_number,
                "batch_id": batch_id,
                "staging_entry_id": staging_entry_id,
                "txn_date": txn_date,
                "created_by": created_by,
            }
        )
        affected_items.add(item_id)
        count += 1

    # Idempotent append: clear any prior ledger rows from this exact staging entry
    # (a retried commit), then insert. The unique index on staging_entry_id is the
    # backstop. Then recompute the derived weekly columns from the full ledger so
    # repeat invoices in the same week ACCUMULATE.
    if staging_entry_id:
        sup.table("inventory_transactions").delete().eq(
            "staging_entry_id", staging_entry_id
        ).execute()
    if txn_rows:
        sup.table("inventory_transactions").insert(txn_rows).execute()
    for iid in affected_items:
        sup.rpc(
            "recompute_week_totals",
            {"p_item_id": iid, "p_month": db_month, "p_year": year},
        ).execute()

    result = {
        "applied": count,
        "dropped": dropped,
        "month": month,
        "year": year,
        "week": week,
        "direction": direction,
        "ledger": True,
    }
    if dropped:
        result["error"] = (
            f"{dropped} item(s) dropped (unresolved SKU); {count} applied. Entry left pending for review."
        )
    return result


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
                "sides": json.dumps(
                    []
                ),  # sides as TEXT JSON per §4 real schema (plan fix for fidelity)
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
    clean = {
        k: v for k, v in payload.items() if v is not None and not k.startswith("_")
    }
    if staging_id:
        existing = (
            sup.table("events")
            .select("id")
            .eq("staging_entry_id", staging_id)
            .limit(1)
            .execute()
        )
        if existing.data:
            return {"applied": 0, "skipped": True}
        clean["staging_entry_id"] = staging_id
    r = sup.table("events").insert(clean).execute()
    return {"applied": 1, "event": r.data[0] if r.data else None}


def dispatch_haccp_save(payload: dict) -> dict:
    sup = _client()
    staging_id = payload.get("_staging_entry_id")
    if staging_id:
        existing = (
            sup.table("haccp_logs")
            .select("id")
            .eq("staging_entry_id", staging_id)
            .limit(1)
            .execute()
        )
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
        existing = (
            sup.table("daily_operations_logs")
            .select("id")
            .eq("staging_entry_id", staging_id)
            .limit(1)
            .execute()
        )
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


_UNCATEGORIZED_ID_FALLBACK = "448c13cf-e5c0-404f-bf32-f299d411c944"


def _resolve_uncategorized_id(sup) -> str:
    """Dynamically look up the 'Uncategorized' category ID. Falls back to hardcoded UUID."""
    try:
        r = (
            sup.table("inventory_categories")
            .select("id")
            .ilike("name", "uncategorized")
            .limit(1)
            .execute()
        )
        if r.data:
            return r.data[0]["id"]
    except Exception:
        pass
    return _UNCATEGORIZED_ID_FALLBACK


def dispatch_item_create(payload: dict) -> dict:
    """Insert a new inventory_items row. Resolves category name → id; falls back to
    Uncategorized when absent. Returns {"applied":1,"item_id":<uuid>} on success or
    {"applied":0,"error":"sku_conflict",...} on a unique-constraint violation."""
    sup = _client()
    sku = (payload.get("sku") or "").strip()
    if not sku:
        return {"applied": 0, "error": "Missing sku"}

    desc = (payload.get("description") or sku).strip()
    cat_id = None
    if payload.get("category"):
        cat_r = (
            sup.table("inventory_categories")
            .select("id")
            .eq("name", payload["category"])
            .limit(1)
            .execute()
        )
        if cat_r.data:
            cat_id = cat_r.data[0]["id"]
    if cat_id is None:
        cat_id = _resolve_uncategorized_id(sup)

    try:
        ins = (
            sup.table("inventory_items")
            .insert(
                {
                    "sku": sku,
                    "description": desc,
                    "category_id": cat_id,
                    "unit_price": payload.get("unit_price") or 0,
                    "par_level": payload.get("par_level") or 0,
                    "unit": payload.get("unit") or "each",
                    "active": bool(payload.get("active", True)),
                }
            )
            .execute()
        )
        new_item = ins.data[0] if ins.data else {}
        return {"applied": 1, "item_id": new_item.get("id"), "sku": sku}
    except Exception as exc:
        err_str = str(exc)
        if (
            "23505" in err_str
            or "unique" in err_str.lower()
            or "duplicate" in err_str.lower()
        ):
            conflict_r = (
                sup.table("inventory_items")
                .select("id,sku,description")
                .eq("sku", sku)
                .limit(1)
                .execute()
            )
            conflict_row = (conflict_r.data or [None])[0] or {}
            return {
                "applied": 0,
                "error": "sku_conflict",
                "conflict_sku": sku,
                "conflict_item_id": conflict_row.get("id"),
                "conflict_desc": conflict_row.get("description"),
            }
        raise


REGISTRY = {
    "inventory_save": dispatch_inventory_save,
    "inventory_week_update": dispatch_inventory_week,
    "item_create": dispatch_item_create,
    "item_update": dispatch_item_update,
    "item_delete": dispatch_item_delete,
    "menu_save": dispatch_menu_save,
    "event_create": dispatch_event_create,
    "haccp_save": dispatch_haccp_save,
    "daily_log_save": dispatch_daily_log_save,
    "user_create": dispatch_user_create,
    "user_update": dispatch_user_update,
}


def validate_payload(operation: str, full_payload: dict) -> str | None:
    """Pure validation (NO writes) used by the commit path for atomicity.

    A commit replays many entries, and each dispatcher writes to the DB as it
    goes. If entry #50 fails validation, entries #1–49 have already been written
    — leaving orphaned partial data even though the commit "aborted". Running
    this for EVERY entry before ANY write makes the commit genuinely atomic:
    a single bad row rejects the whole batch with nothing written.

    Returns an error string if the payload would fail, else None.
    """
    try:
        if operation == "inventory_save":
            _validate_inventory_item_numbers(
                full_payload.get("items", []),
                (
                    "onHand",
                    "price",
                    "w1r",
                    "w2r",
                    "w3r",
                    "w4r",
                    "w1i",
                    "w2i",
                    "w3i",
                    "w4i",
                    "total_pulled_raw",
                ),
            )
        elif operation == "inventory_week_update":
            _validate_inventory_item_numbers(
                full_payload.get("items", []), ("qty", "onHand", "price")
            )
    except ValueError as exc:
        return str(exc)
    return None


def replay(operation: str, full_payload: dict) -> dict:
    handler = REGISTRY.get(operation)
    if not handler:
        return {"applied": 0, "error": f"Unknown operation: {operation}"}
    return handler(full_payload)
