import logging
from datetime import datetime, timezone

from backend.routes import supabase_service
from backend.inventory_identity import (
    get_new_items_category_id,
    resolve_and_write_item,
)
from backend import inventory_formulas as fi

log = logging.getLogger("mjcc.dispatch")


def _load_category_context(sup) -> tuple[dict, str | None]:
    """Category name->id map + the 'New Items' category id — shared setup
    used by every dispatcher that resolves items against a category."""
    cat_r = sup.table("inventory_categories").select("id,name").execute()
    cat_map = {r["name"]: r["id"] for r in (cat_r.data or [])}
    new_items_cat_id = get_new_items_category_id(sup)
    return cat_map, new_items_cat_id


def _unresolved_items_rejected(dropped: int, **scope) -> dict:
    """Standard 'batch rejected, nothing written' result for unresolved SKUs.

    Both inventory dispatchers reject the WHOLE batch before any write if any
    item can't be resolved — a merged commit batches many staging entries
    into one call (see sourcectrl._apply_entries), so writing the resolvable
    rows here while reporting an error would leave live data ahead of the
    aborted commit/staging state — partial writes with no matching audit
    record."""
    return {
        "applied": 0,
        "dropped": dropped,
        **scope,
        "error": (
            f"{dropped} item(s) unresolved (unknown SKU); batch rejected before "
            "any write. Nothing was applied."
        ),
    }


_VALUE_INVARIANT_SELECT = (
    "item_id,opening_oh,w1_received,w2_received,w3_received,"
    "w1_pulled,w2_pulled,w3_pulled,unit_price,opening_unit_cost,"
    "opening_value,received_value,pulled_value,ending_value,"
    "inventory_items!inner(unit_price)"
)


def _enforce_value_invariants(sup, db_month: int, year: int, item_ids) -> int:
    """Re-settle the financial columns of rows this dispatch just touched.

    Both inventory dispatchers write SPARSELY: monthly_inventory upserts carry
    only the columns present in the payload, and `recompute_week_totals`
    rewrites quantities plus received/pulled value but leaves opening_value
    alone. Omitted columns keep their previous contents, so zeroing a
    category's quantities leaves last period's dollars sitting on rows that now
    hold nothing — the stale `-$1.14` and `$1,752.11` rows found in the
    2026-07 production audit.

    Reading the rows back after the write and settling them against
    `fi.value_invariant_updates` is the one place that sees the FULL post-write
    row (payload columns plus untouched ones), which is exactly what the
    invariant needs. Returns the number of rows corrected.
    """
    ids = [i for i in dict.fromkeys(item_ids) if i]
    if not ids:
        return 0
    corrected = 0
    # Chunked so a whole-month save (300+ items) stays inside URL length limits.
    for start in range(0, len(ids), 100):
        chunk = ids[start : start + 100]
        try:
            res = (
                sup.table("monthly_inventory")
                .select(_VALUE_INVARIANT_SELECT)
                .eq("month", db_month)
                .eq("year", year)
                .in_("item_id", chunk)
                .execute()
            )
        except Exception as exc:
            log.warning("[dispatch] value-invariant read failed: %s", exc)
            continue
        for row in res.data or []:
            item_meta = row.get("inventory_items") or {}
            if (
                row.get("unit_price") is None
                and item_meta.get("unit_price") is not None
            ):
                row = {**row, "unit_price": item_meta["unit_price"]}
            updates = fi.value_invariant_updates(row)
            if not updates:
                continue
            try:
                sup.table("monthly_inventory").update(updates).eq(
                    "item_id", row["item_id"]
                ).eq("month", db_month).eq("year", year).execute()
                corrected += 1
                log.info(
                    "[dispatch] value invariant settled | item_id=%s month=%s year=%s %s",
                    row["item_id"],
                    db_month,
                    year,
                    updates,
                )
            except Exception as exc:
                log.warning(
                    "[dispatch] value-invariant write failed for item_id=%s: %s",
                    row.get("item_id"),
                    exc,
                )
    return corrected


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


def _numeric(value, field: str, sku: str | None = None):
    if value is None:
        return None
    try:
        return float(str(value).replace(",", ""))
    except (TypeError, ValueError):
        raise ValueError(f"{field} must be numeric for SKU {sku or 'unknown'}")


def _validate_inventory_item_numbers(
    items: list[dict], fields: tuple[str, ...]
) -> None:
    for item in items:
        sku = item.get("sku")
        for field in fields:
            if field in item and item.get(field) is not None:
                if field == "pulled_value":
                    _numeric(item.get(field), field, sku)
                else:
                    _non_negative(item.get(field), field, sku)


def _weekly_invoice_amount(raw: dict, week: int):
    for key in (
        str(week),
        f"week_{week}",
        f"week{week}",
        f"w{week}",
        f"wk{week}",
        f"wk{week}_total",
    ):
        if key in raw:
            return _non_negative(raw.get(key), f"week_{week}_invoice_total")
    return None


def _normalize_weekly_invoice_totals(raw: dict | None) -> dict | None:
    if not isinstance(raw, dict):
        return None
    source_weeks = raw.get("weeks") if isinstance(raw.get("weeks"), dict) else raw
    weeks: dict[str, float] = {}
    for week in range(1, 6):
        amount = _weekly_invoice_amount(source_weeks, week)
        if amount is not None:
            weeks[str(week)] = round(float(amount), 2)
    if not weeks:
        return None

    raw_notes = raw.get("notes") if isinstance(raw.get("notes"), dict) else {}
    notes = {
        str(k): str(v).strip() for k, v in raw_notes.items() if str(v or "").strip()
    }
    return {
        "source": raw.get("source") or "manager_entered",
        "weeks": weeks,
        "total": round(sum(weeks.values()), 2),
        "notes": notes,
    }


def _save_weekly_invoice_totals(
    sup,
    db_month: int,
    year: int,
    raw_totals: dict | None,
    *,
    source_file: str | None = None,
    source_hash: str | None = None,
    updated_by: str | None = None,
) -> dict | None:
    totals = _normalize_weekly_invoice_totals(raw_totals)
    if not totals:
        return None

    existing = (
        sup.table("monthly_snapshots")
        .select("data")
        .eq("month", db_month)
        .eq("year", year)
        .limit(1)
        .execute()
    )
    existing_data = ((existing.data or [{}])[0] or {}).get("data") or {}
    if not isinstance(existing_data, dict):
        existing_data = {}

    totals = {
        **totals,
        "source_file": source_file,
        "source_hash": source_hash,
        "updated_by": updated_by,
        "updated_at": datetime.now(timezone.utc).isoformat(),
    }
    data = {**existing_data, "weekly_invoice_totals": totals}
    fields = {
        "month": db_month,
        "year": year,
        "data": data,
        "wk1_total": totals["weeks"].get("1"),
        "wk2_total": totals["weeks"].get("2"),
        "wk3_total": totals["weeks"].get("3"),
        "wk4_total": totals["weeks"].get("4"),
        "wk5_total": totals["weeks"].get("5"),
        "saved_at": datetime.now(timezone.utc).isoformat(),
    }
    sup.table("monthly_snapshots").upsert(
        fields,
        on_conflict="month,year",
    ).execute()
    return totals


def _rollover_opening_balances(
    sup, db_month: int, year: int, explicit_on_hand_item_ids: set[str] | None = None
) -> int:
    """Carry previous-month closing balances into a genuinely empty next month.

    Convenience rollover only fires for month CREATION. Once the target period
    has any monthly_inventory rows at all, it returns immediately — it must
    never overwrite an established month's opening balances (e.g. a manager
    correction setting opening_oh=0), even for rows it didn't touch yet.
    """
    explicit_on_hand_item_ids = explicit_on_hand_item_ids or set()
    prev_db_month = db_month - 1 if db_month > 0 else 11
    prev_year = year if db_month > 0 else year - 1

    any_current_rows = bool(
        (
            sup.table("monthly_inventory")
            .select("item_id")
            .eq("month", db_month)
            .eq("year", year)
            .limit(1)
            .execute()
        ).data
    )
    if any_current_rows:
        return 0

    prev_r = (
        sup.table("monthly_inventory")
        .select(
            "item_id,opening_oh,w1_received,w2_received,w3_received,"
            "w1_pulled,w2_pulled,w3_pulled,unit_price,"
            "opening_unit_cost,opening_value,received_value,pulled_value,ending_value"
        )
        .eq("month", prev_db_month)
        .eq("year", prev_year)
        .execute()
    )
    if not prev_r.data:
        return 0

    updated = 0
    for prev in prev_r.data:
        iid = prev["item_id"]
        if iid in explicit_on_hand_item_ids:
            continue
        # Ending = opening + received - pulled, via the canonical template formula
        # (total_pulled_raw now lands in w3_pulled, so no week-0 ledger lookup).
        prev_received = fi.total_received(
            prev.get("w1_received"), prev.get("w2_received"), prev.get("w3_received")
        )
        prev_pulled = fi.total_pulled(
            prev.get("w1_pulled"), prev.get("w2_pulled"), prev.get("w3_pulled")
        )
        closing = fi.ending_qty(prev.get("opening_oh"), prev_received, prev_pulled)
        if closing > 0:
            # Re-derive through the canonical resolver rather than trusting the
            # stored ending_value: a stale or negative prior balance would
            # otherwise become next month's opening_value AND opening_unit_cost,
            # propagating one bad row forward indefinitely.
            ending_value = fi.resolve_row_financials(prev)["ending_value"]
            opening_unit_cost = (ending_value / closing) if closing else None
            sup.table("monthly_inventory").upsert(
                {
                    "item_id": iid,
                    "month": db_month,
                    "year": year,
                    "opening_oh": closing,
                    "unit_price": prev.get("unit_price") or 0,
                    "opening_unit_cost": opening_unit_cost,
                    "opening_value": ending_value,
                    "received_value": 0,
                    "pulled_value": 0,
                    "ending_value": ending_value,
                },
                on_conflict="item_id,month,year",
            ).execute()
            updated += 1
    return updated


def dispatch_inventory_save(payload: dict) -> dict:
    # 1-indexed month from staging. Use explicit None checks, NOT `or`, so a
    # provided value is never silently swapped for the current month (BUG #4).
    month = payload.get("month")
    if month is None:
        month = datetime.now().month
    year = payload.get("year")
    if year is None:
        year = datetime.now().year
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
                "w1p",
                "w2p",
                "w3p",
                "total_pulled_raw",
                "opening_unit_cost",
                "opening_value",
                "received_value",
                "pulled_value",
                "ending_value",
            ),
        )
    except ValueError as exc:
        return {"applied": 0, "error": str(exc)}

    db_month = max(0, month - 1)  # Convert 1→0 indexed for monthly_inventory
    sup = supabase_service
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

    cat_map, new_items_cat_id = _load_category_context(sup)
    # data-entry imports flag the whole batch so brand-new SKUs land in New Items.
    review_new = bool(payload.get("review_new"))

    count = 0
    dropped = 0
    rows: list[dict] = []
    txn_rows: list[dict] = []  # week 1-3 spreadsheet cells + aggregate pulls
    explicit_on_hand_item_ids: set[str] = set()
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
        if item.get("onHand") is not None:
            explicit_on_hand_item_ids.add(item_id)

        monthly_fields: dict = {
            "item_id": item_id,
            "month": db_month,
            "year": year,
        }
        on_hand = item.get("onHand")
        if on_hand is not None:
            monthly_fields["opening_oh"] = int(
                _non_negative(on_hand, "onHand", item.get("sku"))
            )
        if item.get("price") is not None:
            monthly_fields["unit_price"] = item["price"]
        if item.get("status") is not None:
            monthly_fields["status"] = item["status"]
        for payload_key, column in (
            ("opening_unit_cost", "opening_unit_cost"),
            ("opening_value", "opening_value"),
            ("received_value", "received_value"),
            ("pulled_value", "pulled_value"),
            ("ending_value", "ending_value"),
        ):
            if item.get(payload_key) is not None:
                parser = _numeric if payload_key == "pulled_value" else _non_negative
                monthly_fields[column] = parser(
                    item.get(payload_key),
                    payload_key,
                    item.get("sku"),
                )
        if "ending_value" not in monthly_fields and (
            "opening_value" in monthly_fields or "received_value" in monthly_fields
        ):
            monthly_fields["pulled_value"] = monthly_fields.get("pulled_value", 0)
            monthly_fields["ending_value"] = fi.ending_value(
                monthly_fields.get("opening_value"),
                monthly_fields.get("received_value"),
                monthly_fields.get("pulled_value"),
            )
        for src, col, week_number, txn_type in [
            ("w1r", "w1_received", 1, "received"),
            ("w2r", "w2_received", 2, "received"),
            ("w3r", "w3_received", 3, "received"),
            ("w1p", "w1_pulled", 1, "issued"),
            ("w2p", "w2_pulled", 2, "issued"),
            ("w3p", "w3_pulled", 3, "issued"),
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
        # verified. The 3-week schema has no month-aggregate column, so attribute
        # the verified monthly total to week 3 (the last week) — both the
        # w3_pulled column AND a matching week-3 ledger row, so the stored ending
        # (opening + received - pulled) and the audit ledger reconcile. Only used
        # when per-week pulls are absent (parser guarantees mutual exclusivity).
        tpr = item.get("total_pulled_raw")
        if tpr is not None:
            pr_qty = _non_negative(tpr, "total_pulled_raw", item.get("sku"))
            if pr_qty:
                monthly_fields["w3_pulled"] = (
                    monthly_fields.get("w3_pulled", 0) + pr_qty
                )
                # Per-item staging_entry_id: set when _apply_entries batches multiple
                # entries into one call (each item carries its own entry's ID).
                item_sid = item.get("_staging_entry_id") or staging_entry_id
                txn_rows.append(
                    {
                        "item_id": item_id,
                        "sku": _sku,
                        "month": db_month,
                        "year": year,
                        "week_number": 3,
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

    if dropped:
        return _unresolved_items_rejected(dropped, month=month, year=year, notes=notes)

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
    # pulls. Idempotent two ways:
    #  1. Clear prior rows for ALL staging_entry_ids in this batch (handles a
    #     retried commit replaying the SAME staging entry — in_() so a 266-entry
    #     batch is one DELETE instead of 266 separate deletes).
    #  2. ALSO clear by (item_id, week_number, txn_type) for the exact cells this
    #     save is about to write, regardless of staging_entry_id. dispatch_inventory_save
    #     always OVERWRITES monthly_inventory's weekly columns (never sums), so its
    #     ledger mirror must replace, not accumulate, on every save — a manual
    #     re-save with a fresh staging_entry_id (e.g. a one-off correction) would
    #     otherwise leave the prior pass's rows behind instead of replacing them.
    #     (Live June ledger had accumulated 4x duplicate rows this way before this
    #     fix — see CHANGELOG v4.26.23.) This is safe for partial saves because it
    #     only clears the specific (week, type) keys present in THIS payload, never
    #     a whole item/month — weeks this save doesn't touch are left alone.
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
        cell_groups: dict[tuple, set[str]] = {}
        for r in txn_rows:
            cell_groups.setdefault((r["week_number"], r["txn_type"]), set()).add(
                r["item_id"]
            )
        for (wk, ttype), item_ids in cell_groups.items():
            sup.table("inventory_transactions").delete().eq("month", db_month).eq(
                "year", year
            ).eq("week_number", wk).eq("txn_type", ttype).in_(
                "item_id", list(item_ids)
            ).execute()
        sup.table("inventory_transactions").insert(txn_rows).execute()

    # Settle financial columns against the post-write row state (see
    # _enforce_value_invariants) so a sparse upsert can't strand stale dollars.
    settled = _enforce_value_invariants(
        sup, db_month, year, [r["item_id"] for r in rows]
    )

    result = {
        "applied": count,
        "dropped": dropped,
        "month": month,
        "year": year,
        "notes": notes,
    }
    if settled:
        result["value_rows_settled"] = settled
    # Auto-rollover: carry previous month closing balances forward as opening on_hand
    try:
        overwrite_scope = payload.get("overwrite_scope") or {}
        full_month_upload = overwrite_scope.get("kind") == "month"
        if not full_month_upload:
            rolled = _rollover_opening_balances(
                sup, db_month, year, explicit_on_hand_item_ids
            )
            if rolled:
                result["rolled_over"] = rolled
    except Exception as exc:
        log.warning("[dispatch] rollover failed (non-blocking): %s", exc)
    try:
        saved_invoice_totals = _save_weekly_invoice_totals(
            sup,
            db_month,
            year,
            payload.get("weekly_invoice_totals"),
            source_file=source_file,
            source_hash=source_hash,
            updated_by=created_by,
        )
        if saved_invoice_totals:
            result["weekly_invoice_totals"] = saved_invoice_totals
    except Exception as exc:
        result["error"] = f"Weekly invoice totals could not be saved: {exc}"
    return result


def dispatch_monthly_invoice_totals_update(payload: dict) -> dict:
    month = payload.get("month")
    year = payload.get("year")
    if month is None or year is None:
        return {"applied": 0, "error": "month and year are required"}
    db_month = max(0, int(month) - 1)
    sup = supabase_service
    if _is_month_published(sup, db_month, int(year)):
        return {
            "applied": 0,
            "error": f"Period {month}/{year} is published and cannot be modified",
        }
    try:
        saved = _save_weekly_invoice_totals(
            sup,
            db_month,
            int(year),
            payload.get("weekly_invoice_totals") or payload,
            source_file=payload.get("source_file"),
            source_hash=payload.get("source_hash"),
            updated_by=payload.get("_author_id") or payload.get("updated_by"),
        )
    except ValueError as exc:
        return {"applied": 0, "error": str(exc)}
    if not saved:
        return {"applied": 0, "error": "No weekly invoice totals supplied"}
    return {
        "applied": 1,
        "month": int(month),
        "year": int(year),
        "weekly_invoice_totals": saved,
    }


def dispatch_item_update(payload: dict) -> dict:
    """Edit ANY inventory item, identified by SKU. Supports category reassign
    (the manager moving an item OUT of "New Items"), description/price/par/unit
    edits, and (de)activation. Only the fields present in the payload are written.
    """
    sup = supabase_service
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
            # The manager has resolved the category — the parser's advisory guess
            # is no longer pending, so clear it (keeps the review list accurate).
            fields["suggested_category_id"] = None
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
    sup = supabase_service
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
    opening_oh and the other weeks are never touched. Unrecognized SKUs
    resolve into "New Items" for manager review (force_review).
    """
    # 1-indexed month; explicit None checks so a real value is never replaced (BUG #4).
    month = payload.get("month")
    if month is None:
        month = datetime.now().month
    year = payload.get("year")
    if year is None:
        year = datetime.now().year
    week = int(payload.get("week") or 0)
    direction = (payload.get("direction") or "received").lower()
    items = payload.get("items", [])
    if week not in (1, 2, 3):
        return {
            "applied": 0,
            "error": f"Invalid week {week} (expected 1-3 for the current template schema)",
        }
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
    sup = supabase_service
    if _is_month_published(sup, db_month, year):
        return {
            "applied": 0,
            "error": f"Period {month}/{year} is published and cannot be modified",
        }

    # Audit metadata threaded from the upload (data_entry) so every ledger row is
    # traceable back to its source file / batch.
    staging_entry_id = payload.get("_staging_entry_id")
    batch_staging_ids = payload.get("_batch_staging_ids") or []
    source_file = payload.get("source_file")
    source_hash = payload.get("source_hash")
    invoice_number = payload.get("invoice_number")
    batch_id = payload.get("import_batch_id")
    created_by = payload.get("_author_id") or payload.get("created_by")
    txn_date = payload.get("txn_date") or datetime.now(timezone.utc).date().isoformat()

    cat_map, new_items_cat_id = _load_category_context(sup)
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
                "staging_entry_id": item.get("_staging_entry_id") or staging_entry_id,
                "txn_date": txn_date,
                "created_by": created_by,
            }
        )
        affected_items.add(item_id)
        count += 1

    if dropped:
        return _unresolved_items_rejected(
            dropped, month=month, year=year, week=week, direction=direction
        )

    # Idempotent append: clear any prior ledger rows from this exact staging entry
    # (a retried commit), then insert. The unique index on staging_entry_id is the
    # backstop. Then recompute the derived weekly columns from the full ledger so
    # repeat invoices in the same week ACCUMULATE.
    staging_ids = {
        row.get("staging_entry_id") for row in txn_rows if row.get("staging_entry_id")
    }
    staging_ids.update(sid for sid in batch_staging_ids if sid)
    if staging_ids:
        sup.table("inventory_transactions").delete().in_(
            "staging_entry_id", sorted(staging_ids)
        ).execute()
    if txn_rows:
        sup.table("inventory_transactions").insert(txn_rows).execute()
    for iid in affected_items:
        sup.rpc(
            "recompute_week_totals",
            {"p_item_id": iid, "p_month": db_month, "p_year": year},
        ).execute()
    # recompute_week_totals derives ending_value WITHOUT a zero-clamp and
    # without the quantity rule, so it is the writer that produced the negative
    # stored balances in the audit. Settle every row it just touched.
    settled = _enforce_value_invariants(sup, db_month, year, affected_items)

    result = {
        "applied": count,
        "dropped": dropped,
        "month": month,
        "year": year,
        "week": week,
        "direction": direction,
        "ledger": True,
    }
    if settled:
        result["value_rows_settled"] = settled
    try:
        rolled = _rollover_opening_balances(sup, db_month, year)
        if rolled:
            result["rolled_over"] = rolled
    except Exception as exc:
        log.warning("[dispatch] rollover failed (non-blocking): %s", exc)
    return result


def dispatch_menu_save(payload: dict) -> dict:
    """Apply a day-level AI menu save onto menu_cycle_slots (positional update).

    For each meal period: assign items to existing slots in order, create CUSTOM
    slots for extras, deactivate leftover slots beyond the new list."""
    from uuid import uuid4

    from backend.routes.menu import (
        GROUP_FOR_PERIOD,
        LEGACY_DAY_INDEX,
        _resolve_item,
        legacy_target_cycle_day,
    )

    day = payload.get("day")
    data = payload.get("data", {})
    if not day or not data:
        return {"applied": 0, "error": "Missing day or data"}
    if day not in LEGACY_DAY_INDEX:
        return {"applied": 0, "error": f"Invalid day {day}"}

    cycle_day = legacy_target_cycle_day(day)
    sup = supabase_service
    now = datetime.now(timezone.utc).isoformat()
    applied = 0

    for meal_period, items in data.items():
        names = []
        for it in items if isinstance(items, list) else []:
            name = it.get("item") if isinstance(it, dict) else it
            if isinstance(name, str) and name.strip():
                names.append(name.strip())

        slots_r = (
            sup.table("menu_cycle_slots")
            .select("record_id,slot_order")
            .eq("cycle_day", cycle_day)
            .eq("meal_period", meal_period)
            .order("service_order")
            .order("slot_order")
            .execute()
        )
        slots = slots_r.data or []

        for i, name in enumerate(names):
            item_id = _resolve_item(None, name)
            if i < len(slots):
                sup.table("menu_cycle_slots").update(
                    {
                        "item_id": item_id,
                        "active": True,
                        "updated_by": "ai-data-entry",
                        "updated_at": now,
                    }
                ).eq("record_id", slots[i]["record_id"]).execute()
            else:
                next_order = (
                    (slots[-1]["slot_order"] if slots else 0) + (i - len(slots)) + 1
                )
                sup.table("menu_cycle_slots").insert(
                    {
                        "record_id": f"MJCC28-D{cycle_day:02d}-CUSTOM-{uuid4().hex[:6].upper()}",
                        "cycle_day": cycle_day,
                        "meal_group": GROUP_FOR_PERIOD.get(meal_period, meal_period),
                        "meal_period": meal_period,
                        "service_order": 0,
                        "slot_order": next_order,
                        "slot_name": f"Item {i + 1}",
                        "item_id": item_id,
                        "active": True,
                        "updated_by": "ai-data-entry",
                        "updated_at": now,
                    }
                ).execute()
            applied += 1

        for extra in slots[len(names) :]:
            sup.table("menu_cycle_slots").update(
                {"active": False, "updated_by": "ai-data-entry", "updated_at": now}
            ).eq("record_id", extra["record_id"]).execute()

    return {"applied": applied, "day": day, "cycle_day": cycle_day}


def dispatch_event_create(payload: dict) -> dict:
    sup = supabase_service
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
    sup = supabase_service
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


def dispatch_budget_save(payload: dict) -> dict:
    sup = supabase_service
    month = payload.get("month")
    year = payload.get("year")
    gov_allotment = payload.get("gov_allotment")
    if not month or year is None or gov_allotment is None:
        return {
            "applied": 0,
            "error": "budget_save requires month, year, gov_allotment",
        }
    record = {
        "month": max(0, int(month) - 1),  # 1-indexed payload -> 0-indexed DB
        "year": int(year),
        "gov_allotment": gov_allotment,
        "w1_planned_pull": payload.get("w1_planned_pull"),
        "w2_planned_pull": payload.get("w2_planned_pull"),
        "w3_planned_pull": payload.get("w3_planned_pull"),
        "w1_planned_renewable": payload.get("w1_planned_renewable"),
        "w2_planned_renewable": payload.get("w2_planned_renewable"),
        "w3_planned_renewable": payload.get("w3_planned_renewable"),
        "notes": payload.get("notes"),
    }
    r = sup.table("cost_budgets").upsert(record, on_conflict="month,year").execute()
    return {"applied": 1, "budget": r.data[0] if r.data else None}


def dispatch_daily_log_save(payload: dict) -> dict:
    sup = supabase_service
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
    sup = supabase_service
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
    sup = supabase_service
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
    sup = supabase_service
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
                    # NULL (not a fabricated "each") when the caller has no
                    # source-proven unit — the manager confirms it in review.
                    "unit": payload.get("unit") or None,
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
    "monthly_invoice_totals_update": dispatch_monthly_invoice_totals_update,
    "item_create": dispatch_item_create,
    "item_update": dispatch_item_update,
    "item_delete": dispatch_item_delete,
    "menu_save": dispatch_menu_save,
    "event_create": dispatch_event_create,
    "haccp_save": dispatch_haccp_save,
    "daily_log_save": dispatch_daily_log_save,
    "budget_save": dispatch_budget_save,
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
                    "w1p",
                    "w2p",
                    "w3p",
                    "total_pulled_raw",
                    "opening_unit_cost",
                    "opening_value",
                    "received_value",
                    "pulled_value",
                    "ending_value",
                ),
            )
        elif operation == "inventory_week_update":
            _validate_inventory_item_numbers(
                full_payload.get("items", []), ("qty", "onHand", "price")
            )
        elif operation == "monthly_invoice_totals_update":
            if not _normalize_weekly_invoice_totals(
                full_payload.get("weekly_invoice_totals") or full_payload
            ):
                return "No weekly invoice totals supplied"
        elif operation == "budget_save":
            if (
                not full_payload.get("month")
                or full_payload.get("gov_allotment") is None
            ):
                return "Budget entries require month and gov_allotment"
    except ValueError as exc:
        return str(exc)
    return None


def replay(operation: str, full_payload: dict) -> dict:
    handler = REGISTRY.get(operation)
    if not handler:
        return {"applied": 0, "error": f"Unknown operation: {operation}"}
    return handler(full_payload)
