"""Inventory API calculation contract tests."""

import importlib
from types import SimpleNamespace


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


def test_flatten_rows_uses_imported_invoice_values_for_all_values(monkeypatch):
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


def test_weekly_received_values_come_from_ledger_prices(monkeypatch):
    inv = _import_inventory(monkeypatch)

    class FakeQuery:
        def select(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def in_(self, *_args, **_kwargs):
            return self

        def execute(self):
            return SimpleNamespace(
                data=[
                    {
                        "week_number": 1,
                        "quantity": 2,
                        "unit_price": 50.25,
                        "txn_type": "received",
                    },
                    {
                        "week_number": 1,
                        "quantity": 1,
                        "unit_price": 5,
                        "txn_type": "received",
                    },
                    {
                        "week_number": 2,
                        "quantity": 3,
                        "unit_price": 10,
                        "txn_type": "adjustment_increase",
                    },
                ]
            )

    class FakeSupabase:
        def table(self, name):
            assert name == "inventory_transactions"
            return FakeQuery()

    monkeypatch.setattr(inv, "supabase_service", FakeSupabase())

    totals = inv._weekly_received_values_from_ledger(6, 2026)

    assert totals == {
        "source": "inventory_transactions",
        "weeks": {"1": 105.5, "2": 30.0},
        "total": 135.5,
        "notes": {},
    }


def test_received_value_headline_matches_visible_week_cards():
    from backend.inventory_formulas import received_value_reconciliation

    result = received_value_reconciliation(
        30087.95,
        {"weeks": {"1": 17989.79, "2": 7437.67, "3": 134.68}},
    )

    assert result == {
        "headline": 25562.14,
        "row_total": 30087.95,
        "weekly_total": 25562.14,
        "gap": 4525.81,
        "reconciled": False,
        "source": "weekly_invoice_totals",
    }
