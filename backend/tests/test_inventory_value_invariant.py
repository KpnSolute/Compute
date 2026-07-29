"""Regression tests for the canonical inventory value contract (Phase 2/3).

The 2026-07 production readiness audit found 43 rows in period month=6/2026
holding zero physical stock but a nonzero stored `ending_value`, 20 of them
negative — the reported Disposables "FORK, MW BLK PLST REFL" row displayed
-$1.14. These tests pin the contract that closes that class of defect:

    Total Received = w1r + w2r + w3r
    Total Pulled   = w1p + w2p + w3p
    Ending Qty     = max(0, Opening + Received - Pulled)
    Ending Value   = 0                                        when Ending Qty = 0
                   = max(0, OpenVal + RecvVal - PullVal)      otherwise

and that a stored value column is authoritative only while its own quantity is
nonzero.
"""

import importlib

from backend import inventory_formulas as fi


def _import_inventory(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "secret")
    return importlib.import_module("backend.routes.inventory")


# The live production row behind the reported -$1.14, verbatim.
FORK_ROW = {
    "item_id": "fork",
    "opening_oh": 0,
    "w1_received": 4,
    "w2_received": 3,
    "w3_received": 0,
    "w1_pulled": 2,
    "w2_pulled": 2,
    "w3_pulled": 3,
    "unit_price": 38.50,
    "opening_unit_cost": None,
    "opening_value": 0.00,
    "received_value": 268.36,  # invoice-derived
    "pulled_value": 269.50,  # catalog-price derived (7 x 38.50)
    "ending_value": -1.14,  # what production actually stored
}


# ── the three-week quantity grid ─────────────────────────────────────────────


def test_normal_three_week_quantity_calculation():
    assert fi.total_received(4, 3, 0) == 7
    assert fi.total_pulled(2, 2, 3) == 7
    assert fi.ending_oh(10, 7, 5) == 12
    assert fi.ending_qty(10, 7, 5) == 12


def test_over_pull_stays_visible_as_audit_signal_but_never_as_stock():
    # Physical stock floors at zero; the over-pull remains detectable.
    assert fi.ending_oh(0, 5, 7) == -2
    assert fi.ending_qty(0, 5, 7) == 0
    assert fi.is_negative_ending(0, 5, 7) is True


# ── the value rule ───────────────────────────────────────────────────────────


def test_zero_ending_quantity_forces_zero_ending_value():
    # Quantity governs: an empty row holds no dollars, positive residual or not.
    assert fi.ending_value(0, 268.36, 269.50, ending_quantity=0) == 0.0
    assert fi.ending_value(0, 700.42, 8.64, ending_quantity=0) == 0.0


def test_negative_value_residual_is_never_returned_as_stock_value():
    assert fi.ending_value(0, 268.36, 269.50) == 0.0
    # ...but it is still derivable as an audit figure.
    assert round(fi.raw_ending_value(0, 268.36, 269.50), 2) == -1.14


def test_ending_value_normal_case_is_untouched():
    assert fi.ending_value(12, 75, 25, ending_quantity=5) == 62.0


def test_resolve_row_financials_suppresses_the_live_fork_row():
    fin = fi.resolve_row_financials(FORK_ROW)
    assert fin["ending_qty"] == 0
    assert fin["ending_value"] == 0.0
    # The suppressed residual is reported, not silently dropped.
    assert round(fin["ending_value_raw"], 2) == -1.14
    assert round(fin["ending_value_adjustment"], 2) == 1.14


def test_resolve_row_financials_suppresses_stale_positive_balance():
    # Live Meats row 8470437: catch-weight price mismatch left $1,752.11 on a
    # row that ended the period with nothing in it.
    row = {
        "opening_oh": 0,
        "w1_received": 1,
        "w2_received": 1,
        "w3_received": 0,
        "w1_pulled": 1,
        "w2_pulled": 0,
        "w3_pulled": 1,
        "unit_price": 11.11,
        "opening_value": 0,
        "received_value": 1774.33,
        "pulled_value": 22.22,
        "ending_value": 1752.11,
    }
    fin = fi.resolve_row_financials(row)
    assert fin["ending_qty"] == 0
    assert fin["ending_value"] == 0.0


def test_resolve_row_financials_derives_values_when_columns_absent():
    row = {
        "opening_oh": 10,
        "w1_received": 5,
        "w2_received": 0,
        "w3_received": 0,
        "w1_pulled": 1,
        "w2_pulled": 0,
        "w3_pulled": 4,
        "unit_price": 2.5,
    }
    fin = fi.resolve_row_financials(row)
    assert fin["ending_qty"] == 10
    assert fin["opening_value"] == 25.0
    assert fin["received_value"] == 12.5
    assert fin["pulled_value"] == 12.5
    assert fin["ending_value"] == 25.0
    assert fin["ending_value_adjustment"] == 0


# ── the write-side invariant ─────────────────────────────────────────────────


def test_value_invariant_updates_clears_a_zeroed_category_row():
    # The zeroing bug: opening_oh set to 0 by a sparse upsert, financial
    # columns left holding last period's money.
    row = {
        "opening_oh": 0,
        "w1_received": 0,
        "w2_received": 0,
        "w3_received": 0,
        "w1_pulled": 0,
        "w2_pulled": 0,
        "w3_pulled": 0,
        "opening_unit_cost": 38.5,
        "opening_value": 154.0,
        "received_value": 0,
        "pulled_value": 0,
        "ending_value": 154.0,
    }
    updates = fi.value_invariant_updates(row)
    assert updates["opening_value"] == 0
    assert updates["ending_value"] == 0
    assert updates["opening_unit_cost"] is None


def test_value_invariant_updates_settles_the_live_fork_row():
    updates = fi.value_invariant_updates(FORK_ROW)
    assert updates["ending_value"] == 0


def test_value_invariant_updates_is_a_noop_on_a_conformant_row():
    row = {
        "opening_oh": 2,
        "w1_received": 1,
        "w2_received": 0,
        "w3_received": 0,
        "w1_pulled": 0,
        "w2_pulled": 0,
        "w3_pulled": 0,
        "opening_unit_cost": 6.0,
        "opening_value": 12.0,
        "received_value": 10.0,
        "pulled_value": 0.0,
        "ending_value": 22.0,
    }
    assert fi.value_invariant_updates(row) == {}


def test_value_invariant_drops_value_on_a_direction_with_no_quantity():
    row = {
        "opening_oh": 5,
        "w1_received": 0,
        "w2_received": 0,
        "w3_received": 0,
        "w1_pulled": 0,
        "w2_pulled": 0,
        "w3_pulled": 0,
        "opening_unit_cost": 4.0,
        "opening_value": 20.0,
        "received_value": 99.0,  # stale: nothing was received
        "pulled_value": 33.0,  # stale: nothing was pulled
        "ending_value": 86.0,
    }
    updates = fi.value_invariant_updates(row)
    assert updates["received_value"] == 0
    assert updates["pulled_value"] == 0
    assert updates["ending_value"] == 20.0


# ── the read path ────────────────────────────────────────────────────────────


def test_api_never_emits_a_negative_ending_value(monkeypatch):
    inv = _import_inventory(monkeypatch)
    row = dict(
        FORK_ROW,
        inventory_items={
            "id": "fork",
            "sku": "3383435",
            "description": "FORK, MW BLK PLST REFL",
            "par_level": 0,
            "unit": "case",
            "inventory_categories": {"name": "Disposables"},
        },
    )
    item = inv._flatten_rows([row])[0]
    assert item.closingQty == 0
    assert item.endingValue == 0
    assert item.value == 0


def test_api_still_honours_audited_values_on_a_row_holding_stock(monkeypatch):
    inv = _import_inventory(monkeypatch)
    row = {
        "item_id": "item-2",
        "opening_oh": 2,
        "w1_received": 1,
        "w2_received": 2,
        "w3_received": 3,
        "w1_pulled": 1,
        "w2_pulled": 1,
        "w3_pulled": 1,
        "unit_price": 10,
        "opening_unit_cost": 6,
        "opening_value": 12,
        "received_value": 75,
        "pulled_value": 25,
        "ending_value": 62,
        "inventory_items": {
            "id": "item-2",
            "sku": "DAI-001",
            "description": "Butter",
            "par_level": 0,
            "unit": "each",
            "inventory_categories": {"name": "Dairy"},
        },
    }
    item = inv._flatten_rows([row])[0]
    assert item.closingQty == 5
    assert item.endingValue == 62


def test_category_totals_match_item_totals(monkeypatch):
    """Release gate: category rollups and item rows must agree on ending value.

    Both sides now run the same resolver, so a stale row is suppressed
    identically in each — the failure mode this guards is one side adopting a
    different rule and the two silently diverging.
    """
    inv = _import_inventory(monkeypatch)
    rows = [
        dict(
            FORK_ROW,
            item_id="fork",
            inventory_items={
                "id": "fork",
                "sku": "3383435",
                "description": "Fork",
                "par_level": 0,
                "unit": "case",
                "inventory_categories": {"id": "c1", "name": "Disposables"},
            },
        ),
        {
            "item_id": "napkin",
            "opening_oh": 0,
            "w1_received": 3,
            "w2_received": 2,
            "w3_received": 0,
            "w1_pulled": 2,
            "w2_pulled": 2,
            "w3_pulled": 0,
            "unit_price": 49.46,
            "opening_value": 0,
            "received_value": 242.76,
            "pulled_value": 197.84,
            "ending_value": 44.92,
            "inventory_items": {
                "id": "napkin",
                "sku": "8869828",
                "description": "Napkin",
                "par_level": 0,
                "unit": "case",
                "inventory_categories": {"id": "c1", "name": "Disposables"},
            },
        },
    ]
    items = inv._flatten_rows(rows)
    item_total = sum(i.endingValue or 0 for i in items)
    category_total = sum(fi.resolve_row_financials(r)["ending_value"] for r in rows)
    assert round(item_total, 2) == round(category_total, 2)
    assert item_total >= 0


# ── rollover ─────────────────────────────────────────────────────────────────


def test_rollover_never_carries_a_negative_balance_forward():
    """A stale prior ending_value must not become next month's opening_value."""
    carried = fi.resolve_row_financials(FORK_ROW)["ending_value"]
    assert carried == 0.0


def test_rollover_carries_a_real_balance_forward():
    row = {
        "opening_oh": 4,
        "w1_received": 2,
        "w2_received": 0,
        "w3_received": 0,
        "w1_pulled": 1,
        "w2_pulled": 0,
        "w3_pulled": 0,
        "unit_price": 10.0,
        "opening_unit_cost": 10.0,
        "opening_value": 40.0,
        "received_value": 20.0,
        "pulled_value": 10.0,
        "ending_value": 50.0,
    }
    fin = fi.resolve_row_financials(row)
    assert fin["ending_qty"] == 5
    assert fin["ending_value"] == 50.0
    # Opening unit cost for the next period stays sane.
    assert round(fin["ending_value"] / fin["ending_qty"], 2) == 10.0
