"""Weekly headline vs invoice-register reconciliation + register item counts.

Pins the 2026-07-18 production-audit findings:
  - The Week-2 "$101.09 variance" was two different, individually-correct
    measures (goods value vs payable net) shown side by side with no bridge.
    reconcile_weekly_invoices must explain it to the cent and only flag REAL
    drift (headline disagreeing with the register's own goods subtotal).
  - GET /api/invoices returned no item_count, so the register rendered
    "Items —".

Uses in-memory fake Supabase clients per house pattern — zero network/DB.
"""

import asyncio
import os
import sys
from unittest.mock import patch

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from backend.inventory_formulas import reconcile_weekly_invoices  # noqa: E402


# ── pure reconciliation math ─────────────────────────────────────────────────

# Real July 2026 W2 production numbers (audit evidence).
JULY_W2_REGISTER = {
    "2": {
        "goods_subtotal": 9445.32,
        "vizient_discount": 106.09,
        "fuel_surcharge": 5.00,
        "tax": 0.0,
        "net_total": 9344.23,
        "invoice_count": 2,
        "line_item_count": 92,
    }
}


def test_july_w2_variance_is_fully_explained_and_reconciled():
    out = reconcile_weekly_invoices({"2": 9445.32}, JULY_W2_REGISTER)
    w2 = out["2"]
    assert w2["headline_goods"] == 9445.32
    assert w2["register_goods"] == 9445.32
    assert w2["register_net"] == 9344.23
    # The audit's "$101.09 unexplained" = vizient − fuel, now explained:
    assert round(w2["vizient_discount"] - w2["fuel_surcharge"], 2) == 101.09
    assert w2["residual"] == 0.0
    assert w2["net_residual"] == 0.0
    assert w2["reconciled"] is True
    assert w2["invoice_count"] == 2
    assert w2["line_item_count"] == 92


def test_real_goods_drift_is_flagged_not_absorbed():
    # Headline says $100 more goods than the register documents — REAL drift
    # (e.g. an unregistered invoice or manual ledger edit). Must not reconcile.
    out = reconcile_weekly_invoices({"2": 9545.32}, JULY_W2_REGISTER)
    w2 = out["2"]
    assert w2["residual"] == 100.0
    assert w2["reconciled"] is False


def test_bad_invoice_net_identity_is_flagged():
    register = {
        "1": {
            "goods_subtotal": 1000.0,
            "vizient_discount": 0.0,
            "fuel_surcharge": 0.0,
            "tax": 0.0,
            "net_total": 990.0,  # violates net = goods − viz + fuel + tax
            "invoice_count": 1,
        }
    }
    out = reconcile_weekly_invoices({"1": 1000.0}, register)
    assert out["1"]["net_residual"] == -10.0
    assert out["1"]["reconciled"] is False


def test_week_with_headline_but_no_register_rows():
    out = reconcile_weekly_invoices({"1": 500.0}, {})
    w1 = out["1"]
    assert w1["headline_goods"] == 500.0
    assert w1["register_goods"] is None
    assert w1["residual"] is None
    assert w1["reconciled"] is False  # nothing to reconcile against


# ── fake Supabase harness ────────────────────────────────────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows, calls, table):
        self._rows = rows
        self._calls = calls
        self._table = table
        self._filters = {}

    def select(self, *_a, **_k):
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def in_(self, col, vals):
        self._filters[col] = list(vals)
        return self

    def order(self, *_a, **_k):
        return self

    def range(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        self._calls.append({"table": self._table, "filters": dict(self._filters)})
        return _Result(self._rows)


class _FakeSupabase:
    def __init__(self, tables):
        self._tables = tables
        self.calls = []

    def table(self, name):
        return _Query(self._tables.get(name, []), self.calls, name)


# ── _invoice_register_weeks: month indexing + aggregation ────────────────────


def test_invoice_register_weeks_uses_one_indexed_month_and_aggregates():
    from backend.routes import inventory as inv

    fake = _FakeSupabase(
        {
            "invoices": [
                {
                    "id": "inv-mf",
                    "week_number": 2,
                    "subtotal": "1652.70",
                    "vizient_discount": "0.00",
                    "fuel_surcharge": "5.00",
                    "tax": "0.00",
                    "net_total": "1657.70",
                },
                {
                    "id": "inv-usf",
                    "week_number": 2,
                    "subtotal": "7792.62",
                    "vizient_discount": "106.09",
                    "fuel_surcharge": "0.00",
                    "tax": "0.00",
                    "net_total": "7686.53",
                },
            ],
            "invoice_items": (
                [{"invoice_id": "inv-mf"}] * 10 + [{"invoice_id": "inv-usf"}] * 82
            ),
        }
    )
    with patch.object(inv, "supabase_service", fake):
        weeks = inv._invoice_register_weeks(6, 2026)  # db_month=6 → July

    # invoices.month is 1-indexed: the query must filter month=7, not 6.
    invoice_calls = [c for c in fake.calls if c["table"] == "invoices"]
    assert invoice_calls and invoice_calls[0]["filters"]["month"] == 7
    # Line-item counts arrive via ONE batched invoice_items query (no N+1).
    item_calls = [c for c in fake.calls if c["table"] == "invoice_items"]
    assert len(item_calls) == 1

    w2 = weeks["2"]
    assert w2["goods_subtotal"] == 9445.32
    assert w2["net_total"] == 9344.23
    assert w2["vizient_discount"] == 106.09
    assert w2["fuel_surcharge"] == 5.00
    assert w2["invoice_count"] == 2
    assert w2["line_item_count"] == 92  # 10 Multi-Flow + 82 US Foods lines


# ── GET /api/invoices item_count ─────────────────────────────────────────────


def test_get_invoices_attaches_item_counts():
    from backend.routes import data as data_routes

    fake = _FakeSupabase(
        {
            "invoices": [
                {"id": "inv-a", "vendor_id": "v1", "invoice_number": "898561"},
                {"id": "inv-b", "vendor_id": "v1", "invoice_number": "2140189"},
                {"id": "inv-c", "vendor_id": None, "invoice_number": "000001"},
            ],
            "vendors": [{"id": "v1", "name": "Multi-Flow Industries"}],
            "invoice_items": (
                [{"invoice_id": "inv-a"}] * 10 + [{"invoice_id": "inv-b"}] * 82
            ),
        }
    )
    with patch.object(data_routes, "supabase_service", fake):
        rows = asyncio.run(
            data_routes.get_invoices(month=7, year=2026, auth_user={"id": "u1"})
        )

    by_number = {r["invoice_number"]: r for r in rows}
    assert by_number["898561"]["item_count"] == 10
    assert by_number["2140189"]["item_count"] == 82
    # An invoice with no line rows shows 0, not a missing key.
    assert by_number["000001"]["item_count"] == 0
    assert by_number["898561"]["vendor_name"] == "Multi-Flow Industries"
