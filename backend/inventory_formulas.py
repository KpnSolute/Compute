"""Canonical Monthly Inventory Template formulas — single source of truth.

Every layer computes the template's derived columns through these helpers so the
spreadsheet logic lives in exactly one place: file parsing (data entry),
staging/dispatch (storage), and the read API (UI output) all call here instead of
re-deriving the arithmetic inline.

Grid formulas (per item), matching the standardized workbook cells:
    Total Received = SUM(Received Wk1..Wk3)                      (cell =SUM(E,G,I))
    Total Pulled   = SUM(Pulled Wk1..Wk3)                        (cell =SUM(F,H,J))
    Ending OH      = Opening OH + Total Received - Total Pulled   (cell =D+K-L)

Review controls (period aggregates) mirror the Review tab's verified totals:
    Inventory Items      = COUNTA(SKU)
    Invoice SKUs         = COUNT(non-TEMP SKUs)
    Opening/Temp Items   = COUNT(TEMP_ SKUs)
    Opening OH           = SUM(Opening OH)
    Total Received       = SUM(Total Received)
    Total Pulled         = SUM(Total Pulled)
    Ending OH            = SUM(Ending OH)
    Negative Ending Rows = COUNT(Ending OH < 0)
"""

from collections.abc import Iterable


def num(v) -> float:
    """Coerce any cell/field value to a float; blanks and junk become 0."""
    try:
        return float(v) if v not in (None, "") else 0.0
    except (TypeError, ValueError):
        return 0.0


# ── per-item quantity formulas (the grid) ────────────────────────────────────


def total_received(w1r, w2r, w3r) -> float:
    return num(w1r) + num(w2r) + num(w3r)


def total_pulled(w1p, w2p, w3p) -> float:
    return num(w1p) + num(w2p) + num(w3p)


def ending_oh(opening, received, pulled) -> float:
    """Ending OH = Opening + Total Received - Total Pulled.

    May be negative — a negative ending is the workbook's over-pull audit signal
    (the Review tab's "Negative Ending Rows" control). Use ending_qty() for stock
    that should never display below zero.
    """
    return num(opening) + num(received) - num(pulled)


def ending_qty(opening, received, pulled) -> float:
    return max(0.0, ending_oh(opening, received, pulled))


def is_negative_ending(opening, received, pulled) -> bool:
    return ending_oh(opening, received, pulled) < 0


def is_below_par(ending, par) -> bool:
    return num(par) > 0 and num(ending) < num(par)


def is_temp_sku(sku) -> bool:
    return str(sku or "").strip().upper().startswith("TEMP")


# ── per-item dollar-value formulas ───────────────────────────────────────────


def received_value(received, unit_price) -> float:
    return round(max(0.0, num(received)) * max(0.0, num(unit_price)), 2)


def pulled_value(pulled, unit_price) -> float:
    return round(max(0.0, num(pulled)) * max(0.0, num(unit_price)), 2)


def opening_value(opening, opening_unit_cost) -> float:
    return round(max(0.0, num(opening)) * max(0.0, num(opening_unit_cost)), 2)


def raw_ending_value(opening_val, received_val, pulled_val) -> float:
    """Unclamped value residual — an AUDIT signal, never a displayed stock value.

    Goes negative whenever the period's outflow was valued higher than its
    inflow. That happens routinely and legitimately: received value is priced
    from the invoice actually paid, pulled value from the catalog `unit_price`,
    so a period that receives and pulls the same quantity still leaves a small
    residual (the live 2026-07 Disposables FORK row: received 268.36 for 7 cases
    at an invoice-derived price, pulled 7 x 38.50 catalog = 269.50, residual
    -1.14). Surface it as drift to review; never show it as inventory worth.
    """
    return num(opening_val) + num(received_val) - num(pulled_val)


def ending_value(opening_val, received_val, pulled_val, ending_quantity=None) -> float:
    """Ending Value = max(0, Opening Value + Received Value - Pulled Value).

    When `ending_quantity` is supplied it GOVERNS: zero physical stock holds
    zero dollars, whatever the value columns residually say. Quantity is the
    counted fact; the value columns are priced derivations of it, and letting
    them disagree is what put stale money on rows that hold nothing.

    Callers that have the period's quantities must always pass
    `ending_quantity` — omitting it falls back to the value-only clamp, which
    stops negatives but cannot catch a positive stale balance on an empty row.
    """
    if ending_quantity is not None and num(ending_quantity) <= 0:
        return 0.0
    return round(max(0.0, raw_ending_value(opening_val, received_val, pulled_val)), 2)


def row_value(quantity, unit_price) -> float:
    """Value a quantity with the approved unit price for its month."""
    return round(max(0.0, num(quantity)) * max(0.0, num(unit_price)), 2)


def resolve_row_financials(row: dict, unit_price=None) -> dict:
    """Canonical read-path resolver for one `monthly_inventory` row.

    Every consumer (inventory API, cost API, dashboard, AI tools, reports) runs
    a row through here so they cannot drift apart. Stored financial columns are
    audit inputs only; every displayed value is recomputed from quantities and
    the period's monthly unit price.

    Returns opening/received/pulled/ending values, the quantities they belong
    to, and two audit fields: `ending_value_raw` (the legacy stored-column
    residual) and `ending_value_adjustment` (the difference from the standard
    monthly-price value; nonzero means the legacy row needs review).
    """
    opening_qty = max(0.0, num(row.get("opening_oh")))
    recv_qty = total_received(
        row.get("w1_received"), row.get("w2_received"), row.get("w3_received")
    )
    pull_qty = total_pulled(
        row.get("w1_pulled"), row.get("w2_pulled"), row.get("w3_pulled")
    )
    end_qty = ending_qty(opening_qty, recv_qty, pull_qty)

    price = num(row.get("unit_price") if unit_price is None else unit_price)
    ouc = price
    raw_open = row.get("opening_value")
    raw_recv = row.get("received_value")
    raw_pull = row.get("pulled_value")
    open_val = opening_value(opening_qty, price)
    recv_val = received_value(recv_qty, price)
    pull_val = pulled_value(pull_qty, price)

    raw = raw_ending_value(
        num(raw_open) if raw_open is not None else open_val,
        num(raw_recv) if raw_recv is not None else recv_val,
        num(raw_pull) if raw_pull is not None else pull_val,
    )
    end_val = ending_value(open_val, recv_val, pull_val, ending_quantity=end_qty)
    return {
        "opening_qty": opening_qty,
        "received_qty": recv_qty,
        "pulled_qty": pull_qty,
        "ending_qty": end_qty,
        "unit_price": price,
        "opening_unit_cost": ouc,
        "opening_value": open_val,
        "received_value": recv_val,
        "pulled_value": pull_val,
        "ending_value": end_val,
        "ending_value_raw": raw,
        "ending_value_adjustment": round(end_val - raw, 6),
    }


def value_invariant_updates(row: dict) -> dict:
    """Columns that must change for a stored row to satisfy the value contract.

    The contract, applied at every write so no read path has to compensate:

      * A stored value column is authoritative only while ITS OWN quantity is
        nonzero. Zero quantity means zero dollars — this is what a sparse
        upsert cannot express on its own, because omitting a column preserves
        whatever was there before (the zeroed-category bug: `opening_oh` goes
        to 0, `opening_value` silently keeps last month's money).
      * `ending_value` is never stored as anything but the derived, clamped,
        quantity-governed figure.

    Returns `{}` when the row is already conformant, so callers can skip the
    write entirely.
    """
    opening_qty = num(row.get("opening_oh"))
    recv_qty = total_received(
        row.get("w1_received"), row.get("w2_received"), row.get("w3_received")
    )
    pull_qty = total_pulled(
        row.get("w1_pulled"), row.get("w2_pulled"), row.get("w3_pulled")
    )

    price = num(row.get("unit_price"))
    open_val = opening_value(opening_qty, price)
    recv_val = received_value(recv_qty, price)
    pull_val = pulled_value(pull_qty, price)
    if opening_qty <= 0:
        open_val = 0.0
    if recv_qty <= 0:
        recv_val = 0.0
    if pull_qty <= 0:
        pull_val = 0.0
    end_val = ending_value(
        open_val,
        recv_val,
        pull_val,
        ending_quantity=ending_qty(opening_qty, recv_qty, pull_qty),
    )

    updates: dict = {}
    for column, wanted in (
        ("opening_value", open_val),
        ("received_value", recv_val),
        ("pulled_value", pull_val),
        ("ending_value", end_val),
    ):
        current = row.get(column)
        if current is None or abs(num(current) - wanted) > 1e-6:
            updates[column] = round(wanted, 6)
    # An opening unit cost with no opening quantity is a stale price tag on an
    # empty row; it would resurrect a value the moment a quantity is entered.
    if (
        row.get("opening_unit_cost") is None
        or abs(num(row.get("opening_unit_cost")) - price) > 1e-6
    ):
        updates["opening_unit_cost"] = round(price, 6)
    return updates


def overpull_audit(rows: Iterable[dict]) -> dict:
    """Return a backend-owned audit for quantities issued beyond available stock.

    This is a finding only when a row's physical equation is negative:
    ``opening + received - pulled < 0``.  The value uses the same pulled-value
    basis as the row resolver, so the UI cannot invent a warning or price it
    with a different unit cost.
    """
    count = 0
    quantity = 0.0
    value = 0.0
    for row in rows:
        opening = max(0.0, num(row.get("opening_oh")))
        received = total_received(
            row.get("w1_received"), row.get("w2_received"), row.get("w3_received")
        )
        pulled = total_pulled(
            row.get("w1_pulled"), row.get("w2_pulled"), row.get("w3_pulled")
        )
        excess = max(0.0, pulled - opening - received)
        if excess <= 0:
            continue
        count += 1
        quantity += excess
        financials = resolve_row_financials(row)
        pull_unit = (
            financials["pulled_value"] / pulled
            if pulled > 0
            else financials["unit_price"]
        )
        value += excess * max(0.0, pull_unit)
    return {
        "count": count,
        "quantity": round(quantity, 6),
        "value": round(value, 2),
        "triggered": count > 0,
        "basis": "physical_quantity_equation",
    }


def value_reconciliation_audit(rows: Iterable[dict]) -> dict:
    """Reconcile component money with displayed, quantity-clamped ending money."""
    raw_total = 0.0
    displayed_total = 0.0
    adjusted_rows = 0
    for row in rows:
        financials = resolve_row_financials(row)
        raw_total += financials["ending_value_raw"]
        displayed_total += financials["ending_value"]
        if abs(financials["ending_value_adjustment"]) > 0.005:
            adjusted_rows += 1
    adjustment = displayed_total - raw_total
    return {
        "raw_balance": round(raw_total, 2),
        "displayed_ending": round(displayed_total, 2),
        "clamp_adjustment": round(adjustment, 2),
        "adjusted_rows": adjusted_rows,
        "reconciled": abs(adjustment) <= 0.005,
        "basis": "row_component_values_with_physical_clamp",
    }


def opening_continuity(
    prior_rows: Iterable[dict], current_rows: Iterable[dict]
) -> dict:
    """Check that this period opened with exactly what last period closed with.

    THE INVARIANT: opening qty of month N == ending qty of month N-1, per item.

    Nothing enforced this, and nothing detected when it broke. A full-month
    workbook upload writes `opening_oh` straight from the sheet's Opening
    column and `_rollover_opening_balances` is skipped for those rows (they are
    "explicit"), so a sheet that disagrees with the prior period's computed
    ending silently wins and the difference simply vanishes from inventory.

    Live 2026-07: the July sheet opened SKU 4785416 (BGAS 9X9) and 2961001 (CUP
    PET 9Z) at 0 when June closed each at 2. $281.12 disappeared at the month
    boundary — and because those two items then had less opening stock than was
    pulled from them, July also showed an impossible over-pull of exactly 2 on
    each, which the display clamp added back into Closing value. One broken
    invariant, three visible symptoms.

    Rows are dicts of monthly_inventory columns; `item_id` joins them.
    Returns the per-item drift plus totals, worst first. `drift_value` is
    signed: negative means the period opened with LESS than it should have.
    """
    prior_end: dict = {}
    for row in prior_rows:
        item_id = row.get("item_id")
        if not item_id:
            continue
        prior_end[item_id] = {
            "qty": ending_qty(
                row.get("opening_oh"),
                total_received(
                    row.get("w1_received"),
                    row.get("w2_received"),
                    row.get("w3_received"),
                ),
                total_pulled(
                    row.get("w1_pulled"), row.get("w2_pulled"), row.get("w3_pulled")
                ),
            ),
            "price": num(row.get("unit_price")),
        }

    drifted: list[dict] = []
    seen: set = set()
    for row in current_rows:
        item_id = row.get("item_id")
        if not item_id:
            continue
        seen.add(item_id)
        expected = prior_end.get(
            item_id, {"qty": 0.0, "price": num(row.get("unit_price"))}
        )
        opened = num(row.get("opening_oh"))
        if abs(opened - expected["qty"]) < 1e-9:
            continue
        raw_price = row.get("unit_price")
        price = expected["price"] if raw_price is None else num(raw_price)
        drifted.append(
            {
                "item_id": item_id,
                "expected_opening_qty": expected["qty"],
                "actual_opening_qty": opened,
                "qty_drift": round(opened - expected["qty"], 6),
                "value_drift": round((opened - expected["qty"]) * price, 2),
            }
        )
    # An item that closed with stock but has no row at all this period has
    # silently dropped its whole balance — the most severe form of the defect.
    for item_id, expected in prior_end.items():
        if item_id in seen or expected["qty"] <= 0:
            continue
        drifted.append(
            {
                "item_id": item_id,
                "expected_opening_qty": expected["qty"],
                "actual_opening_qty": 0.0,
                "qty_drift": round(-expected["qty"], 6),
                "value_drift": round(-expected["qty"] * expected["price"], 2),
                "missing_row": True,
            }
        )

    drifted.sort(key=lambda d: abs(d["value_drift"]), reverse=True)
    return {
        "reconciled": not drifted,
        "drift_rows": len(drifted),
        "qty_drift": round(sum(d["qty_drift"] for d in drifted), 6),
        "value_drift": round(sum(d["value_drift"] for d in drifted), 2),
        "items": drifted,
    }


# ── weekly invoice-register reconciliation ───────────────────────────────────


def reconcile_weekly_invoices(headline_weeks: dict, register_weeks: dict) -> dict:
    """Reconcile the weekly received headline against the invoice register.

    The two totals measure DIFFERENT things by design and must never be compared
    raw (the 2026-07-18 audit's "$101.09 unexplained variance" was exactly this):

      headline (weekly_invoice_totals) — GOODS value received, pure item totals.
        Tax, fuel surcharge, and Vizient/GPO discounts are never in item
        valuation (standing project rule).
      register (invoices table)        — PAYABLE amounts. Each invoice's
        net_total = goods subtotal − vizient + fuel + tax.

    Per week this returns both measures plus the explained bridge between them,
    and two actionable residuals:
      residual      = headline − register goods subtotal. Nonzero means the
                      ledger and the invoice register genuinely disagree about
                      goods received — real drift needing review.
      net_residual  = register net_total − (goods − vizient + fuel + tax).
                      Nonzero means an invoice row's own financial fields do not
                      satisfy the net-total identity — a bad invoice record.

    `headline_weeks` maps week → goods value (e.g. {"2": 9445.32}).
    `register_weeks` maps week → {goods_subtotal, vizient_discount,
    fuel_surcharge, tax, net_total, invoice_count}.
    Only weeks present in either input appear in the output.
    """
    weeks: dict[str, dict] = {}
    for wk in sorted(set(headline_weeks) | set(register_weeks), key=str):
        headline = round(num(headline_weeks.get(wk)), 2)
        reg = register_weeks.get(wk) or {}
        goods = round(num(reg.get("goods_subtotal")), 2)
        vizient = round(num(reg.get("vizient_discount")), 2)
        fuel = round(num(reg.get("fuel_surcharge")), 2)
        tax = round(num(reg.get("tax")), 2)
        net = round(num(reg.get("net_total")), 2)
        has_register = bool(reg)
        residual = round(headline - goods, 2) if has_register else None
        net_residual = (
            round(net - round(goods - vizient + fuel + tax, 2), 2)
            if has_register
            else None
        )
        weeks[str(wk)] = {
            "headline_goods": headline,
            "register_goods": goods if has_register else None,
            "register_net": net if has_register else None,
            "vizient_discount": vizient if has_register else None,
            "fuel_surcharge": fuel if has_register else None,
            "tax": tax if has_register else None,
            "invoice_count": int(num(reg.get("invoice_count"))) if has_register else 0,
            "line_item_count": (
                int(num(reg.get("line_item_count"))) if has_register else 0
            ),
            "residual": residual,
            "net_residual": net_residual,
            "reconciled": (
                has_register
                and abs(residual or 0) < 0.01
                and abs(net_residual or 0) < 0.01
            ),
        }
    return weeks


# ── period aggregates (the Review control block) ─────────────────────────────


def review_controls(items: Iterable[dict]) -> dict:
    """Aggregate item dicts into the Review tab's Quantity Control totals.

    Each item dict supplies opening / received / pulled (already per-item totals)
    and sku. Returns the same metrics the standardized Review tab computes, so the
    parser and API report identical control numbers to the workbook.
    """
    item_count = invoice_skus = temp_items = negative_rows = 0
    opening = received = pulled = 0.0
    for it in items:
        item_count += 1
        sku = it.get("sku")
        if is_temp_sku(sku):
            temp_items += 1
        elif sku:
            invoice_skus += 1
        o, r, p = num(it.get("opening")), num(it.get("received")), num(it.get("pulled"))
        opening += o
        received += r
        pulled += p
        if ending_oh(o, r, p) < 0:
            negative_rows += 1
    return {
        "item_count": item_count,
        "invoice_skus": invoice_skus,
        "temp_items": temp_items,
        "opening": opening,
        "received": received,
        "pulled": pulled,
        "ending": opening + received - pulled,
        "negative_ending_rows": negative_rows,
    }
