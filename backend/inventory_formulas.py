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
    return num(received) * num(unit_price)


def pulled_value(pulled, unit_price) -> float:
    return num(pulled) * num(unit_price)


def opening_value(opening, opening_unit_cost) -> float:
    return num(opening) * num(opening_unit_cost)


def ending_value(opening_val, received_val, pulled_val) -> float:
    return max(0.0, num(opening_val) + num(received_val) - num(pulled_val))


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
