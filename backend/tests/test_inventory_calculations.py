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
    assert item.openingValue == 20
    assert item.receivedValue == 60
    assert item.pulledValue == 30
    assert item.endingValue == 50
    assert item.value == 50


def test_weekly_received_values_use_monthly_prices(monkeypatch):
    inv = _import_inventory(monkeypatch)

    class FakeQuery:
        def __init__(self, data):
            self.data = data

        def select(self, *_args, **_kwargs):
            return self

        def eq(self, *_args, **_kwargs):
            return self

        def in_(self, *_args, **_kwargs):
            return self

        def execute(self):
            return SimpleNamespace(data=self.data)

    class FakeSupabase:
        def table(self, name):
            if name == "inventory_transactions":
                return FakeQuery(
                    [
                        {
                            "item_id": "item-1",
                            "week_number": 1,
                            "quantity": 2,
                            "txn_type": "received",
                        },
                        {
                            "item_id": "item-1",
                            "week_number": 1,
                            "quantity": 1,
                            "txn_type": "received",
                        },
                        {
                            "item_id": "item-1",
                            "week_number": 2,
                            "quantity": 3,
                            "txn_type": "adjustment_increase",
                        },
                    ]
                )
            assert name == "monthly_inventory"
            return FakeQuery([{"item_id": "item-1", "unit_price": 10}])

    monkeypatch.setattr(inv, "supabase_service", FakeSupabase())

    totals = inv._weekly_received_values_from_ledger(6, 2026)

    assert totals == {
        "source": "inventory_transactions",
        "weeks": {"1": 30.0, "2": 30.0},
        "total": 60.0,
        "notes": {},
    }


def test_weekly_invoice_totals_are_numeric_and_additive():
    from backend.inventory_formulas import num

    weeks = {"1": "17989.79", "2": "7437.67", "3": "134.68"}
    assert round(sum(num(value) for value in weeks.values()), 2) == 25562.14
