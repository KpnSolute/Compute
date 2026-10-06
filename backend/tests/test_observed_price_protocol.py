"""Observed-price protocol: inventory carries the latest received invoice price.

Owner decision 2026-10-05 (AGENTS.md §4A). Before it, a period whose monthly
row already held a price never took its own invoices' prices: September 2026
valued stock at August-era prices.
"""

from collections import Counter

import pytest

from backend import pricing
from backend.staging import dispatch
from backend.tests.test_week_batch_performance import Client

# ── the pure rule ────────────────────────────────────────────────────────────


@pytest.mark.parametrize(
    "previous, observed, decision",
    [
        (50.0, None, pricing.SKIP),
        (50.0, 0, pricing.SKIP),
        (None, 12.5, pricing.APPLY),  # first observation for the item
        (0, 12.5, pricing.APPLY),
        (63.11, 63.11, pricing.SAME),
        (63.11, 63.114, pricing.SAME),  # inside half a cent
        (62.52, 63.11, pricing.APPLY),  # +0.9%
        (51.63, 48.59, pricing.APPLY),  # -5.9%
        (40.0, 50.0, pricing.APPLY),  # exactly +25% is not over the threshold
        (40.0, 50.01, pricing.HOLD),
        (74.41, 47.20, pricing.HOLD),  # -36.6%: the September lettuce row
        (36.66, 47.20, pricing.HOLD),  # +28.8%
    ],
)
def test_decide_price(previous, observed, decision):
    assert pricing.decide_price(previous, observed)[0] == decision


def test_change_fraction_is_relative_to_previous_price():
    assert pricing.decide_price(40.0, 50.0) == (pricing.APPLY, 0.25)
    assert pricing.decide_price(None, 50.0) == (pricing.APPLY, None)


# ── the commit path ──────────────────────────────────────────────────────────

# Inventory prices and invoice prices reported in the September audit.
SEPTEMBER = [
    ("6803811", "CUP, PAPR 10 Z HOT MDW", 62.52, 63.11, 2),
    ("2326411", "LETTUCE, ICBRG FRESH REF BOX", 74.41, 47.20, 2),
    ("6769541", "CHEESE, CHEDR MILD SHRD BAG", 51.63, 48.59, 1),
    ("7340979", "CREAM, WHPG HVY 36% BUTRFT UHT", 47.05, 45.88, 1),
]


def september_client():
    client = Client(len(SEPTEMBER))
    for i, (sku, desc, price, _invoice, _qty) in enumerate(SEPTEMBER):
        client.rows["inventory_items"][i].update(
            sku=sku, description=desc, unit_price=price
        )
        row = client.rows["monthly_inventory"][i]
        row.update(unit_price=price, opening_unit_cost=price)
    return client


def received(lines, *, week=3, invoice="1770890", prefix="stage"):
    return {
        "month": 9,
        "year": 2026,
        "week": week,
        "direction": "received",
        "invoice_number": invoice,
        "source_file": "Sepwk3.pdf",
        "_batch_staging_ids": [f"{prefix}-{i}" for i in range(len(lines))],
        "items": [
            {
                "sku": sku,
                "desc": desc,
                "qty": qty,
                "price": invoice_price,
                "category": "Dry",
                "_staging_entry_id": f"{prefix}-{i}",
            }
            for i, (sku, desc, _price, invoice_price, qty) in enumerate(lines)
        ],
    }


def by_sku(client, table):
    ids = {row["id"]: row["sku"] for row in client.rows["inventory_items"]}
    key = "id" if table == "inventory_items" else "item_id"
    return {ids[row[key]]: row for row in client.rows[table]}


@pytest.fixture
def september(monkeypatch):
    client = september_client()
    monkeypatch.setattr(dispatch, "supabase_service", client)
    return client


def test_september_invoice_applies_ordinary_moves_and_holds_the_outlier(september):
    result = dispatch.dispatch_inventory_week(received(SEPTEMBER))

    assert result["prices_applied"] == 3 and result["prices_held"] == 1
    monthly = by_sku(september, "monthly_inventory")
    catalog = by_sku(september, "inventory_items")
    # Ordinary moves now reach the period price and the catalog.
    for sku, expected in [("6803811", 63.11), ("6769541", 48.59), ("7340979", 45.88)]:
        assert monthly[sku]["unit_price"] == expected
        assert catalog[sku]["unit_price"] == expected
    # The lettuce move (-36.6%) waits for a manager and changes neither.
    assert monthly["2326411"]["unit_price"] == 74.41
    assert catalog["2326411"]["unit_price"] == 74.41

    queue = {row["sku"]: row for row in september.rows["price_review_queue"]}
    assert queue["2326411"]["status"] == "pending"
    assert queue["2326411"]["previous_price"] == 74.41
    assert queue["2326411"]["observed_price"] == 47.20
    assert queue["2326411"]["applied_price"] is None
    assert "review threshold" in queue["2326411"]["reason"]
    assert queue["6803811"]["status"] == "auto_applied"
    assert queue["6803811"]["applied_price"] == 63.11
    for row in queue.values():
        assert row["invoice_number"] == "1770890"
        assert row["month"] == 8 and row["year"] == 2026 and row["week"] == 3


def test_applied_price_revalues_the_period_movements(september):
    dispatch.dispatch_inventory_week(received(SEPTEMBER))
    cup = by_sku(september, "monthly_inventory")["6803811"]
    # Received stock is valued at the new invoice price; opening stock keeps
    # its own carried cost.
    assert cup["received_value"] == pytest.approx(2 * 63.11)
    assert cup["opening_value"] == pytest.approx(10 * 62.52)
    assert cup["ending_value"] == pytest.approx(10 * 62.52 + 2 * 63.11)


def test_one_apply_call_for_the_whole_invoice(september):
    dispatch.dispatch_inventory_week(received(SEPTEMBER))
    applies = [
        args for name, args in september.rpc_calls if name == "apply_observed_prices"
    ]
    assert len(applies) == 1
    assert {p["unit_price"] for p in applies[0]["p_prices"]} == {63.11, 48.59, 45.88}
    assert applies[0]["p_month"] == 8 and applies[0]["p_year"] == 2026


def test_unchanged_price_records_nothing(september):
    same = [(sku, desc, price, price, qty) for sku, desc, price, _i, qty in SEPTEMBER]
    result = dispatch.dispatch_inventory_week(received(same))
    assert result["prices_applied"] == 0 and result["prices_held"] == 0
    assert september.rows["price_review_queue"] == []
    assert not [
        name for name, _ in september.rpc_calls if name == "apply_observed_prices"
    ]


def test_replayed_commit_neither_duplicates_nor_reopens_a_decision(september):
    dispatch.dispatch_inventory_week(received(SEPTEMBER))
    lettuce = next(
        row for row in september.rows["price_review_queue"] if row["sku"] == "2326411"
    )
    lettuce["status"] = "kept"  # a manager kept the old price

    dispatch.dispatch_inventory_week(received(SEPTEMBER))

    assert len(september.rows["price_review_queue"]) == 4
    assert lettuce["status"] == "kept"
    assert by_sku(september, "monthly_inventory")["2326411"]["unit_price"] == 74.41


def test_later_invoice_price_wins_within_the_month(september):
    cup = [SEPTEMBER[0]]
    dispatch.dispatch_inventory_week(
        received([(*cup[0][:3], 63.11, 5)], week=1, prefix="wk1")
    )
    dispatch.dispatch_inventory_week(
        received([(*cup[0][:3], 64.00, 2)], week=3, prefix="wk3")
    )
    assert by_sku(september, "monthly_inventory")["6803811"]["unit_price"] == 64.00
    statuses = Counter(row["status"] for row in september.rows["price_review_queue"])
    assert statuses == {"auto_applied": 2}


def test_pull_sheets_never_touch_prices(monkeypatch):
    client = september_client()
    monkeypatch.setattr(dispatch, "supabase_service", client)
    pulls = received(SEPTEMBER)
    pulls["direction"] = "issued"
    result = dispatch.dispatch_inventory_week(pulls)
    assert "prices_applied" not in result
    assert client.rows["price_review_queue"] == []
    assert not [name for name, _ in client.rpc_calls if name == "apply_observed_prices"]
    for sku, _desc, price, _invoice, _qty in SEPTEMBER:
        assert by_sku(client, "monthly_inventory")[sku]["unit_price"] == price
