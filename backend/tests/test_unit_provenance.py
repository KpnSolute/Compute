"""Unit-of-measure provenance — never fabricate a unit the source didn't state.

2026-07-18 audit follow-up (MF Cranberry Fusion showed unit "each" with no
source evidence). The chain had three different fabricated defaults: the
deterministic parser hardcoded EA for Multi-Flow/receipt/generic lines, the
vision normalizer defaulted CS, dispatch_item_create defaulted "each", and the
inventory_items column default is 'CS'. Policy now:

  - a source format WITHOUT a unit column yields unit "" (unknown);
  - US Foods lines keep their real, printed sales-unit column;
  - weekly inventory ops carry NO unit at all (unit is catalog data);
  - creating a catalog item without a source-proven unit stores NULL
    explicitly (visible as unconfirmed in review) — never a fabricated value.
"""

import os
import sys

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from backend.ai import parser  # noqa: E402
from backend.ai.invoice_parser import (  # noqa: E402
    _normalize_vision_items,
    invoice_items_to_ops,
)
from backend.inventory_identity import resolve_and_write_item  # noqa: E402
from backend.staging import dispatch  # noqa: E402
from backend.tests.test_pasted_text_invoice import MULTIFLOW_TEXT  # noqa: E402


def test_multiflow_lines_have_unknown_unit_not_fabricated_ea():
    _, data = parser.detect_and_parse(
        "pasted-invoice.txt", MULTIFLOW_TEXT.encode("utf-8")
    )
    items = data["items"]
    assert len(items) == 10
    assert all(item.get("unit") == "" for item in items), (
        "Multi-Flow text has no unit column — parsed unit must stay unknown"
    )


def test_usfoods_line_keeps_real_unit_column():
    page = """INVOICE
ACCOUNT NUMBER INVOICE NUMBER INVOICE DATE CUSTOMER NUMBER PURCHASE ORDER # SALES LOCATION SALES REP DATE ORDERED
41736679 1736605 07/01/2026 1273721 4520 3135 492 06/28/2026
INVOICE LINE DETAILS
 4 4 0 CS 1327889 CHICKEN BREAST FIL 2/5LB $52.05 $208.20
"""
    from backend.ai.invoice_parser import parse_invoice_text_pages

    parsed = parse_invoice_text_pages([page], "usfoods.txt")
    items = parsed["items"]
    assert len(items) == 1
    assert items[0]["unit"] == "CS"  # real printed sales-unit column


def test_vision_normalizer_does_not_fabricate_cs():
    out = _normalize_vision_items(
        [{"sku": "X1", "description": "Thing", "qty_shipped": 2, "unit_price": 3.5}]
    )
    assert out[0]["unit"] == ""


def test_weekly_ops_carry_no_unit_field():
    items = [
        {
            "sku": "F00480038",
            "description": "MF Cranberry Fusion 13%",
            "unit": "",
            "qty_shipped": 4,
            "unit_price": 55.70,
            "ext_price": 222.80,
            "category": "BEVERAGES",
        }
    ]
    ops = invoice_items_to_ops(items, {}, 7, 2026, 2, "received", {})
    assert len(ops) == 1
    op_item = ops[0]["payload"]["items"][0]
    assert "unit" not in op_item, (
        "weekly updates must never mutate catalog unit-of-measure"
    )


# ── minimal fake supabase for resolve_and_write_item ─────────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, store, table):
        self._store = store
        self._table = table
        self._op = "select"
        self._payload = None

    def select(self, *_a, **_k):
        self._op = "select"
        return self

    def eq(self, *_a, **_k):
        return self

    def ilike(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def update(self, payload):
        self._op = "update"
        self._payload = payload
        return self

    def insert(self, payload):
        self._op = "insert"
        self._payload = payload
        return self

    def execute(self):
        if self._op == "select":
            return _Result([])  # no existing item → create path
        if self._op == "insert":
            self._store["inserted"] = self._payload
            return _Result([{**self._payload, "id": "new-item-1"}])
        self._store["updated"] = self._payload
        return _Result([self._payload])


class _FakeSup:
    def __init__(self):
        self.store = {}

    def table(self, name):
        return _Query(self.store, name)


def test_resolve_and_write_item_stores_null_unit_when_unproven():
    sup = _FakeSup()
    item_id, sku, created = resolve_and_write_item(
        sup,
        sku="F00480038",
        desc="MF Cranberry Fusion 13%",
        category_id=None,
        fallback_category_id="cat-new-items",
        price=55.70,
        unit=None,
    )
    assert created is True
    inserted = sup.store["inserted"]
    # Explicit NULL beats the column's 'CS' default — unit shows unconfirmed.
    assert "unit" in inserted and inserted["unit"] is None


def test_resolve_and_write_item_keeps_source_proven_unit():
    sup = _FakeSup()
    resolve_and_write_item(
        sup,
        sku="1327889",
        desc="CHICKEN BREAST FIL",
        category_id=None,
        fallback_category_id="cat-new-items",
        unit="CS",
    )
    assert sup.store["inserted"]["unit"] == "CS"


def test_dispatch_item_create_defaults_unit_to_null(monkeypatch):
    fake = _FakeSup()
    monkeypatch.setattr(dispatch, "supabase_service", fake)
    # category lookup select returns [] → falls back; then insert captured.
    monkeypatch.setattr(dispatch, "_resolve_uncategorized_id", lambda _sup: "cat-unc")
    result = dispatch.dispatch_item_create(
        {"sku": "NEW-1", "description": "New thing", "unit_price": 1.0}
    )
    assert result["applied"] == 1
    assert fake.store["inserted"]["unit"] is None
