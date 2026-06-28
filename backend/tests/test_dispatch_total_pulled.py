"""
Unit tests for total_pulled_raw → inventory_transactions (week_number=0).

Verifies that dispatch_inventory_save:
  - writes a week_number=0 issued transaction when an item carries total_pulled_raw
  - clears prior week0 rows for the same staging_entry_id on retry (idempotent)
  - does NOT erase unrelated staging entries' transaction rows
  - writes no transaction rows when total_pulled_raw is absent

Also verifies that _granular_commit_changes in sourcectrl assigns action='pull'
and week_number=0 for the total_pulled_raw field.

Uses in-memory fake Supabase client — zero network/DB required.
"""
import os
import sys
from unittest.mock import MagicMock, patch

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

_HAS_SUPABASE = bool(os.getenv("SUPABASE_URL"))

ITEM_ID = "item-abc"
STAGING_ID = "stage-001"
NEW_ITEMS_CAT_ID = "cat-new-items"
DRY_CAT_ID = "cat-dry"


# ── minimal fake Supabase client ─────────────────────────────────────────────

class _Result:
    def __init__(self, data):
        self.data = data


class _FakeQuery:
    def __init__(self, table):
        self._t = table
        self._filters: dict = {}
        self._op = "select"
        self._payload = None

    def select(self, *_a, **_k):
        self._op = "select"
        return self

    def eq(self, col, val):
        self._filters[col] = val
        return self

    def in_(self, col, vals):
        self._filters[f"__in_{col}"] = list(vals)
        return self

    def ilike(self, col, val):
        return self

    def limit(self, *_a, **_k):
        return self

    def update(self, p):
        self._op = "update"
        self._payload = p
        return self

    def insert(self, p):
        self._op = "insert"
        self._payload = p
        return self

    def delete(self):
        self._op = "delete"
        return self

    def upsert(self, p, **kw):
        self._op = "upsert"
        self._payload = p
        return self

    def execute(self):
        rows = self._t._rows
        plain_filters = {k: v for k, v in self._filters.items() if not k.startswith("__in_")}

        if self._op == "select":
            matched = [r for r in rows if all(r.get(k) == v for k, v in plain_filters.items())]
            return _Result(matched)

        if self._op == "update":
            for r in rows:
                if all(r.get(k) == v for k, v in plain_filters.items()):
                    r.update(self._payload)
            return _Result([])

        if self._op == "insert":
            payload = self._payload if isinstance(self._payload, list) else [self._payload]
            inserted = []
            for item in payload:
                new = dict(item)
                new.setdefault("id", f"id-{len(rows) + 1}")
                rows.append(new)
                inserted.append({"id": new["id"]})
            return _Result(inserted)

        if self._op == "upsert":
            payload = self._payload if isinstance(self._payload, list) else [self._payload]
            for item in payload:
                rows.append(dict(item))
            return _Result([])

        if self._op == "delete":
            keep = [r for r in rows if not all(r.get(k) == v for k, v in plain_filters.items())]
            self._t._rows[:] = keep
            return _Result([])

        return _Result([])


class _FakeTable:
    def __init__(self, rows=None):
        self._rows = list(rows or [])

    def select(self, *a, **k):
        return _FakeQuery(self).select(*a, **k)

    def update(self, p):
        return _FakeQuery(self).update(p)

    def insert(self, p):
        return _FakeQuery(self).insert(p)

    def delete(self):
        return _FakeQuery(self).delete()

    def upsert(self, p, **kw):
        return _FakeQuery(self).upsert(p, **kw)


class _FakeRpc:
    def execute(self):
        return _Result([])


class FakeSup:
    def __init__(self, items=None, categories=None, txns=None):
        cats = categories or [
            {"id": DRY_CAT_ID, "name": "Dry Goods"},
            {"id": NEW_ITEMS_CAT_ID, "name": "New Items"},
        ]
        self._tables = {
            "inventory_items": _FakeTable(items or [
                {"id": ITEM_ID, "sku": "DRY-001", "description": "Rice", "category_id": DRY_CAT_ID},
            ]),
            "inventory_categories": _FakeTable(cats),
            "monthly_inventory": _FakeTable([]),
            "inventory_transactions": _FakeTable(txns or []),
            "month_status": _FakeTable([]),  # empty = not published
        }

    def table(self, name):
        if name not in self._tables:
            self._tables[name] = _FakeTable([])
        return self._tables[name]

    def rpc(self, *a, **k):
        return _FakeRpc()

    @property
    def txns(self):
        return self._tables["inventory_transactions"]._rows


# ── dispatch tests ────────────────────────────────────────────────────────────

def test_total_pulled_raw_writes_week0_transaction():
    """An item with total_pulled_raw gets a week_number=0 issued transaction."""
    from backend.staging.dispatch import dispatch_inventory_save

    sup = FakeSup()
    payload = {
        "month": 5,
        "year": 2026,
        "_staging_entry_id": STAGING_ID,
        "items": [{
            "sku": "DRY-001",
            "desc": "Rice",
            "category": "Dry Goods",
            "onHand": 100,
            "price": 1.5,
            "total_pulled_raw": 40.0,
        }],
    }
    with patch("backend.staging.dispatch._client", return_value=sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1, result
    txns = sup.txns
    assert len(txns) == 1, f"Expected 1 transaction, got {txns}"
    txn = txns[0]
    assert txn["week_number"] == 0
    assert txn["txn_type"] == "issued"
    assert txn["quantity"] == 40.0
    assert txn["staging_entry_id"] == STAGING_ID
    assert txn["item_id"] == ITEM_ID
    assert txn["unit_price"] == 1.5


def test_total_pulled_raw_retry_is_idempotent():
    """Replaying the same staging entry replaces the prior week0 row."""
    from backend.staging.dispatch import dispatch_inventory_save

    existing = [{
        "id": "txn-old",
        "item_id": ITEM_ID,
        "staging_entry_id": STAGING_ID,
        "week_number": 0,
        "txn_type": "issued",
        "quantity": 30.0,
    }]
    sup = FakeSup(txns=existing)
    payload = {
        "month": 5,
        "year": 2026,
        "_staging_entry_id": STAGING_ID,
        "items": [{
            "sku": "DRY-001",
            "desc": "Rice",
            "category": "Dry Goods",
            "onHand": 100,
            "price": 1.5,
            "total_pulled_raw": 40.0,
        }],
    }
    with patch("backend.staging.dispatch._client", return_value=sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1
    txns = sup.txns
    assert len(txns) == 1, f"Expected 1 transaction after idempotent retry, got {txns}"
    assert txns[0]["quantity"] == 40.0
    assert txns[0]["staging_entry_id"] == STAGING_ID


def test_other_staging_entry_txns_preserved():
    """The week0 clear for staging_entry_id STAGING_ID does not erase other entries."""
    from backend.staging.dispatch import dispatch_inventory_save

    other_txn = {
        "id": "txn-other",
        "item_id": ITEM_ID,
        "staging_entry_id": "stage-other",
        "week_number": 1,
        "txn_type": "issued",
        "quantity": 20.0,
    }
    sup = FakeSup(txns=[other_txn])
    payload = {
        "month": 5,
        "year": 2026,
        "_staging_entry_id": STAGING_ID,
        "items": [{
            "sku": "DRY-001",
            "desc": "Rice",
            "category": "Dry Goods",
            "onHand": 100,
            "total_pulled_raw": 40.0,
        }],
    }
    with patch("backend.staging.dispatch._client", return_value=sup):
        dispatch_inventory_save(payload)

    txns = sup.txns
    assert len(txns) == 2, f"Expected 2 transactions (other preserved + new), got {txns}"
    assert any(t["staging_entry_id"] == "stage-other" for t in txns)
    assert any(t["week_number"] == 0 and t["staging_entry_id"] == STAGING_ID for t in txns)


def test_no_total_pulled_raw_no_transaction():
    """Items without total_pulled_raw write no transaction rows."""
    from backend.staging.dispatch import dispatch_inventory_save

    sup = FakeSup()
    payload = {
        "month": 5,
        "year": 2026,
        "items": [{"sku": "DRY-001", "desc": "Rice", "category": "Dry Goods", "onHand": 100}],
    }
    with patch("backend.staging.dispatch._client", return_value=sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1
    assert len(sup.txns) == 0


def test_zero_total_pulled_raw_no_transaction():
    """A total_pulled_raw of 0 writes no transaction row (no meaningful pull)."""
    from backend.staging.dispatch import dispatch_inventory_save

    sup = FakeSup()
    payload = {
        "month": 5,
        "year": 2026,
        "items": [{"sku": "DRY-001", "desc": "Rice", "category": "Dry Goods", "onHand": 100, "total_pulled_raw": 0}],
    }
    with patch("backend.staging.dispatch._client", return_value=sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1
    assert len(sup.txns) == 0


# ── commit_changes diff tests ─────────────────────────────────────────────────

@pytest.mark.skipif(not _HAS_SUPABASE, reason="SUPABASE_URL not set — routes.__init__ requires it")
def test_granular_commit_changes_total_pulled_raw():
    """total_pulled_raw diff row gets action='pull' and week_number=0."""
    from backend.routes.sourcectrl import _granular_commit_changes

    diffs = [{
        "operation": "inventory_save",
        "month": 5,
        "year": 2026,
        "rows": [{
            "sku": "DRY-001",
            "status": "update",
            "before": {},
            "after": {"total_pulled_raw": 40.0},
            "changes": ["total_pulled_raw"],
        }],
    }]

    mock_sup = MagicMock()
    mock_sup.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
        {"sku": "DRY-001", "id": ITEM_ID}
    ]

    with patch("backend.routes.sourcectrl._client", return_value=mock_sup):
        changes = _granular_commit_changes("commit-1", diffs)

    assert len(changes) == 1, f"Expected 1 change row, got {changes}"
    c = changes[0]
    assert c["action"] == "pull"
    assert c["week_number"] == 0
    assert c["field_name"] == "total_pulled_raw"
    assert c["new_value"] == 40.0
    assert c["item_id"] == ITEM_ID
    assert c["entity_type"] == "inventory"


def _run_standalone():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  PASS {fn.__name__}")
    print(f"\n{passed}/{len(fns)} dispatch/diff tests passed")


if __name__ == "__main__":
    _run_standalone()
