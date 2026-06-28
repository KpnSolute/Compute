"""Inventory API calculation contract tests."""

import importlib


def _import_inventory(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "secret")
    return importlib.import_module("backend.routes.inventory")


def test_flatten_rows_counts_week0_aggregate_pulls(monkeypatch):
    inv = _import_inventory(monkeypatch)
    rows = [
        {
            "item_id": "item-1",
            "on_hand": 10,
            "w1_received": 5,
            "w2_received": 0,
            "w3_received": 0,
            "w4_received": 0,
            "w1_issued": 1,
            "w2_issued": 0,
            "w3_issued": 0,
            "w4_issued": 0,
            "unit_price": 2.5,
            "inventory_items": {
                "id": "item-1",
                "sku": "DRY-001",
                "description": "Rice",
                "par_level": 3,
                "unit": "case",
                "inventory_categories": {"name": "Dry Goods"},
            },
        }
    ]

    item = inv._flatten_rows(rows, {"item-1": 4})[0]

    assert item.totalReceived == 5
    assert item.aggregateIssued == 4
    assert item.totalIssued == 5
    assert item.closingQty == 10
    assert item.running_total == 10
    assert item.value == 25.0


def test_flatten_rows_falls_back_to_weekly_columns(monkeypatch):
    inv = _import_inventory(monkeypatch)
    rows = [
        {
            "item_id": "item-2",
            "on_hand": 2,
            "w1_received": 1,
            "w2_received": 2,
            "w3_received": 3,
            "w4_received": 4,
            "w1_issued": 1,
            "w2_issued": 1,
            "w3_issued": 1,
            "w4_issued": 1,
            "unit_price": 10,
            "inventory_items": {
                "id": "item-2",
                "sku": "DAI-001",
                "description": "Butter",
                "par_level": 0,
                "unit": "each",
                "inventory_categories": {"name": "Dairy"},
            },
        }
    ]

    item = inv._flatten_rows(rows)[0]

    assert item.totalReceived == 10
    assert item.aggregateIssued == 0
    assert item.totalIssued == 4
    assert item.closingQty == 8
    assert item.value == 80
