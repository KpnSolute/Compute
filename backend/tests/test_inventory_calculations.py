"""Inventory API calculation contract tests."""

import importlib


def _import_inventory(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "secret")
    return importlib.import_module("backend.routes.inventory")


def test_flatten_rows_uses_three_week_pulled_schema(monkeypatch):
    inv = _import_inventory(monkeypatch)
    rows = [
        {
            "item_id": "item-1",
            "opening_oh": 10,
            "w1_received": 5,
            "w2_received": 0,
            "w3_received": 0,
            "w1_pulled": 1,
            "w2_pulled": 0,
            "w3_pulled": 4,
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

    item = inv._flatten_rows(rows)[0]

    assert item.totalReceived == 5
    assert item.totalPulled == 5
    assert item.closingQty == 10
    assert item.running_total == 10
    assert item.value == 25.0


def test_flatten_rows_prefers_audited_value_controls(monkeypatch):
    inv = _import_inventory(monkeypatch)
    rows = [
        {
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
    ]

    item = inv._flatten_rows(rows)[0]

    assert item.totalReceived == 6
    assert item.totalPulled == 3
    assert item.closingQty == 5
    assert item.openingValue == 12
    assert item.receivedValue == 75
    assert item.pulledValue == 25
    assert item.endingValue == 62
    assert item.value == 62
