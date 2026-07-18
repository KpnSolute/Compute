"""
Unit tests for backend.inventory_identity.resolve_and_write_item — the single
SKU-based item resolver introduced in the 2026-06-09 SKU-identity refactor
(CHANGELOG v1.9.0).

Uses an in-memory fake of the supabase client's fluent table API so the logic
is exercised with zero network/DB. Runnable two ways:
    pytest tests/test_inventory_identity.py
    python tests/test_inventory_identity.py     (no pytest required)
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from backend.inventory_identity import resolve_and_write_item  # noqa: E402

NEW_ITEMS_ID = "cat-new-items"
DRY_ID = "cat-dry"


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, table):
        self._t = table
        self._filters = {}
        self._op = "select"
        self._payload = None

    # chain no-ops we don't need to inspect
    def select(self, *_a, **_k):
        self._op = "select"
        return self

    def eq(self, col, val):
        self._filters[col] = val
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
        rows = self._t._rows
        if self._op == "select":
            matched = [
                r for r in rows if all(r.get(k) == v for k, v in self._filters.items())
            ]
            return _Result([{"id": r["id"]} for r in matched])
        if self._op == "update":
            for r in rows:
                if all(r.get(k) == v for k, v in self._filters.items()):
                    r.update(self._payload)
            return _Result([])
        if self._op == "insert":
            new = dict(self._payload)
            new.setdefault("id", f"id-{len(rows) + 1}")
            rows.append(new)
            return _Result([{"id": new["id"]}])
        return _Result([])


class _Table:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *a, **k):
        return _Query(self).select(*a, **k)

    def update(self, p):
        return _Query(self).update(p)

    def insert(self, p):
        return _Query(self).insert(p)


class FakeSup:
    def __init__(self, rows=None):
        self._tables = {"inventory_items": _Table(rows or [])}

    def table(self, name):
        return self._tables[name]

    @property
    def rows(self):
        return self._tables["inventory_items"]._rows


def test_known_sku_updates_not_inserts():
    sup = FakeSup(
        [{"id": "abc", "sku": "COKE-12", "description": "Old", "category_id": DRY_ID}]
    )
    item_id, sku, created = resolve_and_write_item(
        sup,
        sku="COKE-12",
        desc="Coca-Cola 12oz",
        category_id=DRY_ID,
        fallback_category_id=NEW_ITEMS_ID,
        price=1.5,
        par=10,
    )
    assert created is False
    assert item_id == "abc"
    assert sku == "COKE-12"
    assert len(sup.rows) == 1  # no new row
    row = sup.rows[0]
    assert row["description"] == "Coca-Cola 12oz"
    assert row["category_id"] == DRY_ID  # unchanged on update path


def test_known_sku_update_preserves_category():
    # Manager previously reassigned this item to DRY; a later weekly save carries
    # a different category — it must NOT clobber the reassignment.
    sup = FakeSup([{"id": "abc", "sku": "X1", "category_id": DRY_ID}])
    resolve_and_write_item(
        sup,
        sku="X1",
        desc="thing",
        category_id="cat-other",
        fallback_category_id=NEW_ITEMS_ID,
    )
    assert sup.rows[0]["category_id"] == DRY_ID  # untouched


def test_unknown_sku_with_known_category_uses_it():
    sup = FakeSup([])
    item_id, sku, created = resolve_and_write_item(
        sup,
        sku="NEW-1",
        desc="New thing",
        category_id=DRY_ID,
        fallback_category_id=NEW_ITEMS_ID,
    )
    assert created is True
    assert len(sup.rows) == 1
    assert sup.rows[0]["category_id"] == DRY_ID
    assert sup.rows[0]["sku"] == "NEW-1"
    assert sup.rows[0]["active"] is True


def test_unknown_sku_no_category_falls_back_to_new_items():
    sup = FakeSup([])
    resolve_and_write_item(
        sup,
        sku="NEW-2",
        desc="Mystery",
        category_id=None,
        fallback_category_id=NEW_ITEMS_ID,
    )
    assert sup.rows[0]["category_id"] == NEW_ITEMS_ID


def test_force_review_routes_new_item_to_new_items_even_with_category():
    # data-entry path: a guessed category must still land in New Items.
    sup = FakeSup([])
    resolve_and_write_item(
        sup,
        sku="NEW-3",
        desc="Parsed",
        category_id=DRY_ID,
        fallback_category_id=NEW_ITEMS_ID,
        force_review_category=True,
    )
    assert sup.rows[0]["category_id"] == NEW_ITEMS_ID


def test_blank_sku_is_generated():
    sup = FakeSup([])
    item_id, sku, created = resolve_and_write_item(
        sup,
        sku="  ",
        desc="No sku item",
        category_id=DRY_ID,
        fallback_category_id=NEW_ITEMS_ID,
    )
    assert created is True
    assert sku.startswith("MJC-")
    assert len(sku) == 14  # "MJC-" + 10 hex
    assert sup.rows[0]["sku"] == sku


def test_missing_par_and_price_not_written():
    sup = FakeSup([{"id": "abc", "sku": "P1", "par_level": 5, "unit_price": 2.0}])
    resolve_and_write_item(
        sup,
        sku="P1",
        desc="keep par",
        category_id=DRY_ID,
        fallback_category_id=NEW_ITEMS_ID,  # price/par omitted
    )
    row = sup.rows[0]
    assert row["par_level"] == 5  # preserved, not zeroed
    assert row["unit_price"] == 2.0


def _run_standalone():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  PASS {fn.__name__}")
    print(f"\n{passed}/{len(fns)} resolver tests passed")


if __name__ == "__main__":
    _run_standalone()
