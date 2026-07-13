"""
Unit tests for total_pulled_raw → inventory_transactions (week_number=3) + w3_pulled.

Verifies that dispatch_inventory_save:
  - writes a week_number=3 issued transaction AND sets the w3_pulled column when an
    item carries total_pulled_raw (verified monthly pull, no weekly split)
  - clears prior rows for the same staging_entry_id on retry (idempotent)
  - does NOT erase unrelated staging entries' transaction rows
  - writes no transaction rows when total_pulled_raw is absent

Also verifies that _granular_commit_changes in sourcectrl assigns action='pull'
and week_number=3 for the total_pulled_raw field.

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
        plain_filters = {
            k: v for k, v in self._filters.items() if not k.startswith("__in_")
        }
        in_filters = {
            k.removeprefix("__in_"): v
            for k, v in self._filters.items()
            if k.startswith("__in_")
        }

        def _matches(row):
            return all(row.get(k) == v for k, v in plain_filters.items()) and all(
                row.get(k) in vals for k, vals in in_filters.items()
            )

        if self._op == "select":
            matched = [r for r in rows if _matches(r)]
            return _Result(matched)

        if self._op == "update":
            for r in rows:
                if _matches(r):
                    r.update(self._payload)
            return _Result([])

        if self._op == "insert":
            payload = (
                self._payload if isinstance(self._payload, list) else [self._payload]
            )
            inserted = []
            for item in payload:
                new = dict(item)
                new.setdefault("id", f"id-{len(rows) + 1}")
                rows.append(new)
                inserted.append({"id": new["id"]})
            return _Result(inserted)

        if self._op == "upsert":
            payload = (
                self._payload if isinstance(self._payload, list) else [self._payload]
            )
            for item in payload:
                rows.append(dict(item))
            return _Result([])

        if self._op == "delete":
            keep = [r for r in rows if not _matches(r)]
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
            "inventory_items": _FakeTable(
                items
                or [
                    {
                        "id": ITEM_ID,
                        "sku": "DRY-001",
                        "description": "Rice",
                        "category_id": DRY_CAT_ID,
                    },
                ]
            ),
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


def test_total_pulled_raw_writes_week3_transaction_and_column():
    """An item with total_pulled_raw gets a week_number=3 issued transaction AND
    its verified monthly pull is written into the w3_pulled column so the stored
    ending (opening + received - pulled) is correct."""
    from backend.staging.dispatch import dispatch_inventory_save

    sup = FakeSup()
    payload = {
        "month": 5,
        "year": 2026,
        "_staging_entry_id": STAGING_ID,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "onHand": 100,
                "price": 1.5,
                "total_pulled_raw": 40.0,
            }
        ],
    }
    with patch("backend.staging.dispatch.supabase_service", sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1, result
    txns = sup.txns
    assert len(txns) == 1, f"Expected 1 transaction, got {txns}"
    txn = txns[0]
    assert txn["week_number"] == 3
    assert txn["txn_type"] == "issued"
    assert txn["quantity"] == 40.0
    assert txn["staging_entry_id"] == STAGING_ID
    assert txn["item_id"] == ITEM_ID
    assert txn["unit_price"] == 1.5
    # w3_pulled column must carry the verified monthly total
    mi = sup.table("monthly_inventory")._rows
    assert mi and mi[0].get("w3_pulled") == 40.0, f"w3_pulled not set; got {mi}"


def test_resave_with_different_staging_id_replaces_not_accumulates_ledger():
    """A re-save of the SAME item/week/cell with a FRESH staging_entry_id (e.g. a
    manual correction pass) must REPLACE the prior ledger row, not pile up a
    duplicate next to it. dispatch_inventory_save always overwrites
    monthly_inventory's weekly columns, so its ledger mirror must match — this
    is the live bug found in the June ledger (4x duplicate rows from repeated
    correction passes, each using a different staging_entry_id).
    """
    from backend.staging.dispatch import dispatch_inventory_save

    sup = FakeSup()
    base_payload = {
        "month": 5,
        "year": 2026,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "price": 1.5,
                "w1r": 2,
                "w1p": 1,
                "w2p": 1,
            }
        ],
    }

    with patch("backend.staging.dispatch.supabase_service", sup):
        dispatch_inventory_save({**base_payload, "_staging_entry_id": "pass-1"})
        dispatch_inventory_save({**base_payload, "_staging_entry_id": "pass-2"})
        dispatch_inventory_save({**base_payload, "_staging_entry_id": "pass-3"})

    txns = sorted((t["week_number"], t["txn_type"], t["quantity"]) for t in sup.txns)
    assert txns == [
        (1, "issued", 1),
        (1, "received", 2),
        (2, "issued", 1),
    ], f"expected exactly one row per (week, type) after 3 re-saves, got {sup.txns}"


def test_total_pulled_raw_retry_is_idempotent():
    """Replaying the same staging entry replaces the prior week0 row."""
    from backend.staging.dispatch import dispatch_inventory_save

    existing = [
        {
            "id": "txn-old",
            "item_id": ITEM_ID,
            "staging_entry_id": STAGING_ID,
            "week_number": 0,
            "txn_type": "issued",
            "quantity": 30.0,
        }
    ]
    sup = FakeSup(txns=existing)
    payload = {
        "month": 5,
        "year": 2026,
        "_staging_entry_id": STAGING_ID,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "onHand": 100,
                "price": 1.5,
                "total_pulled_raw": 40.0,
            }
        ],
    }
    with patch("backend.staging.dispatch.supabase_service", sup):
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
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "onHand": 100,
                "total_pulled_raw": 40.0,
            }
        ],
    }
    with patch("backend.staging.dispatch.supabase_service", sup):
        dispatch_inventory_save(payload)

    txns = sup.txns
    assert len(txns) == 2, (
        f"Expected 2 transactions (other preserved + new), got {txns}"
    )
    assert any(t["staging_entry_id"] == "stage-other" for t in txns)
    assert any(
        t["week_number"] == 3 and t["staging_entry_id"] == STAGING_ID for t in txns
    )


def test_no_total_pulled_raw_no_transaction():
    """Items without total_pulled_raw write no transaction rows."""
    from backend.staging.dispatch import dispatch_inventory_save

    sup = FakeSup()
    payload = {
        "month": 5,
        "year": 2026,
        "items": [
            {"sku": "DRY-001", "desc": "Rice", "category": "Dry Goods", "onHand": 100}
        ],
    }
    with patch("backend.staging.dispatch.supabase_service", sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1
    assert len(sup.txns) == 0


def test_full_month_upload_does_not_auto_rollover_missing_prior_skus():
    """A full-month published workbook upload is authoritative for its month.

    Prior-month SKUs absent from the workbook must not be reinserted by dispatch's
    convenience rollover pass, including a clean first upload after the period was
    wiped and therefore does not require overwrite confirmation.
    """
    from backend.staging.dispatch import dispatch_inventory_save

    stale_item_id = "item-stale"
    sup = FakeSup(
        items=[
            {
                "id": ITEM_ID,
                "sku": "DRY-001",
                "description": "Rice",
                "category_id": DRY_CAT_ID,
            },
            {
                "id": stale_item_id,
                "sku": "OLD-001",
                "description": "Old carried item",
                "category_id": DRY_CAT_ID,
            },
        ]
    )
    sup.table("monthly_inventory")._rows.extend(
        [
            {
                "item_id": stale_item_id,
                "month": 4,
                "year": 2026,
                "opening_oh": 2,
                "w1_received": 0,
                "w2_received": 0,
                "w3_received": 0,
                "w1_pulled": 0,
                "w2_pulled": 0,
                "w3_pulled": 0,
                "unit_price": 55.70,
                "opening_value": 111.40,
                "received_value": 0,
                "pulled_value": 0,
                "ending_value": 111.40,
            }
        ]
    )
    payload = {
        "month": 6,
        "year": 2026,
        "overwrite": False,
        "overwrite_scope": {"kind": "month", "month": 6, "year": 2026},
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "onHand": 0,
                "price": 1.5,
            }
        ],
    }

    with patch("backend.staging.dispatch.supabase_service", sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1, result
    june_rows = [
        row
        for row in sup.table("monthly_inventory")._rows
        if row.get("month") == 5 and row.get("year") == 2026
    ]
    assert {row["item_id"] for row in june_rows} == {ITEM_ID}
    assert "rolled_over" not in result


def test_dashboard_save_does_not_reinsert_missing_prior_skus_when_month_exists():
    """Dashboard saves must not resurrect prior-month SKUs omitted from the month.

    This guards the June cranberry SKU case: May had an old SKU with ending stock,
    while June intentionally used a different SKU. A later dashboard save should
    not run convenience rollover as if June were still an empty month.
    """
    from backend.staging.dispatch import dispatch_inventory_save

    stale_item_id = "item-stale"
    sup = FakeSup(
        items=[
            {
                "id": ITEM_ID,
                "sku": "DRY-001",
                "description": "Rice",
                "category_id": DRY_CAT_ID,
            },
            {
                "id": stale_item_id,
                "sku": "OLD-001",
                "description": "Old carried item",
                "category_id": DRY_CAT_ID,
            },
        ]
    )
    sup.table("monthly_inventory")._rows.extend(
        [
            {
                "item_id": stale_item_id,
                "month": 4,
                "year": 2026,
                "opening_oh": 2,
                "w1_received": 0,
                "w2_received": 0,
                "w3_received": 0,
                "w1_pulled": 0,
                "w2_pulled": 0,
                "w3_pulled": 0,
                "unit_price": 55.70,
                "opening_value": 111.40,
                "received_value": 0,
                "pulled_value": 0,
                "ending_value": 111.40,
            },
            {
                "item_id": ITEM_ID,
                "month": 5,
                "year": 2026,
                "opening_oh": 0,
                "w1_received": 1,
                "w2_received": 0,
                "w3_received": 0,
                "w1_pulled": 0,
                "w2_pulled": 0,
                "w3_pulled": 0,
                "unit_price": 1.5,
            },
        ]
    )
    payload = {
        "month": 6,
        "year": 2026,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "onHand": 0,
                "price": 1.5,
                "w1r": 1,
            }
        ],
    }

    with patch("backend.staging.dispatch.supabase_service", sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1, result
    june_rows = [
        row
        for row in sup.table("monthly_inventory")._rows
        if row.get("month") == 5 and row.get("year") == 2026
    ]
    assert {row["item_id"] for row in june_rows} == {ITEM_ID}
    assert "rolled_over" not in result


def test_established_month_save_does_not_overwrite_other_items_zero_opening():
    """Once a target month has ANY rows, convenience rollover must not run at
    all — not even for a different item with a real prior-month closing
    balance. An unrelated save (here, for DRY-001) must not silently restore
    DRY-002's opening_oh from last month's closing.
    """
    from backend.staging.dispatch import dispatch_inventory_save

    other_item_id = "item-other"
    sup = FakeSup(
        items=[
            {
                "id": ITEM_ID,
                "sku": "DRY-001",
                "description": "Rice",
                "category_id": DRY_CAT_ID,
            },
            {
                "id": other_item_id,
                "sku": "DRY-002",
                "description": "Beans",
                "category_id": DRY_CAT_ID,
            },
        ]
    )
    sup.table("monthly_inventory")._rows.extend(
        [
            # Prior month: DRY-002 has a real closing balance.
            {
                "item_id": other_item_id,
                "month": 4,
                "year": 2026,
                "opening_oh": 10,
                "w1_received": 0,
                "w2_received": 0,
                "w3_received": 0,
                "w1_pulled": 0,
                "w2_pulled": 0,
                "w3_pulled": 0,
                "unit_price": 2.0,
            },
            # Target month already established; a manager corrected DRY-002's
            # opening to 0 there.
            {
                "item_id": other_item_id,
                "month": 5,
                "year": 2026,
                "opening_oh": 0,
                "w1_received": 0,
                "w2_received": 0,
                "w3_received": 0,
                "w1_pulled": 0,
                "w2_pulled": 0,
                "w3_pulled": 0,
                "unit_price": 2.0,
            },
        ]
    )
    payload = {
        "month": 6,
        "year": 2026,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "onHand": 50,
                "price": 1.5,
            }
        ],
    }

    with patch("backend.staging.dispatch.supabase_service", sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1, result
    assert "rolled_over" not in result
    other_rows = [
        row
        for row in sup.table("monthly_inventory")._rows
        if row["item_id"] == other_item_id and row["month"] == 5
    ]
    assert len(other_rows) == 1, other_rows
    assert other_rows[0]["opening_oh"] == 0, other_rows


def test_inventory_save_unresolved_sku_blocks_whole_batch_before_write():
    """A batch with one valid SKU and one unresolved SKU must write ZERO
    monthly_inventory rows — not write the resolvable rows and only then
    report an error (which left live data ahead of an aborted commit).
    """
    from backend.staging import dispatch as dispatch_mod

    sup = FakeSup()
    payload = {
        "month": 5,
        "year": 2026,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "onHand": 10,
                "price": 1.5,
            },
            {
                "sku": "UNRESOLVED-001",
                "desc": "Mystery Item",
                "category": "Dry Goods",
                "onHand": 5,
                "price": 2.0,
            },
        ],
    }

    real_resolve = dispatch_mod.resolve_and_write_item

    def _fake_resolve(sup_arg, *, sku, **kwargs):
        if sku == "UNRESOLVED-001":
            return None, sku, False
        return real_resolve(sup_arg, sku=sku, **kwargs)

    with (
        patch("backend.staging.dispatch.supabase_service", sup),
        patch(
            "backend.staging.dispatch.resolve_and_write_item",
            side_effect=_fake_resolve,
        ),
    ):
        result = dispatch_mod.dispatch_inventory_save(payload)

    assert result["applied"] == 0, result
    assert result.get("dropped") == 1, result
    assert "error" in result
    assert sup.table("monthly_inventory")._rows == [], (
        "no monthly_inventory rows should be written when any SKU is unresolved"
    )
    assert sup.txns == []


def test_weekly_cells_write_week_1_to_3_ledger_rows():
    """Full-month weekly cells create matching week 1-3 ledger rows."""
    from backend.staging.dispatch import dispatch_inventory_save

    sup = FakeSup()
    payload = {
        "month": 5,
        "year": 2026,
        "_staging_entry_id": STAGING_ID,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "price": 1.5,
                "w1r": 2,
                "w2r": 3,
                "w3p": 4,
            }
        ],
    }
    with patch("backend.staging.dispatch.supabase_service", sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1
    assert [
        (t["week_number"], t["txn_type"], t["quantity"])
        for t in sorted(sup.txns, key=lambda row: (row["week_number"], row["txn_type"]))
    ] == [
        (1, "received", 2),
        (2, "received", 3),
        (3, "issued", 4),
    ]
    assert all(t["staging_entry_id"] == STAGING_ID for t in sup.txns)


def test_inventory_save_retry_replaces_weekly_and_week0_rows_for_same_staging_id():
    """Retrying a full-month save clears all prior rows for that staging entry."""
    from backend.staging.dispatch import dispatch_inventory_save

    existing = [
        {
            "id": "txn-old-week",
            "item_id": ITEM_ID,
            "staging_entry_id": STAGING_ID,
            "week_number": 1,
            "txn_type": "received",
            "quantity": 99,
        },
        {
            "id": "txn-old-week0",
            "item_id": ITEM_ID,
            "staging_entry_id": STAGING_ID,
            "week_number": 0,
            "txn_type": "issued",
            "quantity": 88,
        },
    ]
    sup = FakeSup(txns=existing)
    payload = {
        "month": 5,
        "year": 2026,
        "_staging_entry_id": STAGING_ID,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "w1r": 2,
                "total_pulled_raw": 4,
            }
        ],
    }
    with patch("backend.staging.dispatch.supabase_service", sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1
    assert sorted(
        (t["week_number"], t["txn_type"], t["quantity"]) for t in sup.txns
    ) == [
        (1, "received", 2),
        (3, "issued", 4),
    ]


def test_zero_total_pulled_raw_no_transaction():
    """A total_pulled_raw of 0 writes no transaction row (no meaningful pull)."""
    from backend.staging.dispatch import dispatch_inventory_save

    sup = FakeSup()
    payload = {
        "month": 5,
        "year": 2026,
        "items": [
            {
                "sku": "DRY-001",
                "desc": "Rice",
                "category": "Dry Goods",
                "onHand": 100,
                "total_pulled_raw": 0,
            }
        ],
    }
    with patch("backend.staging.dispatch.supabase_service", sup):
        result = dispatch_inventory_save(payload)

    assert result["applied"] == 1
    assert len(sup.txns) == 0


# ── commit_changes diff tests ─────────────────────────────────────────────────


@pytest.mark.skipif(
    not _HAS_SUPABASE, reason="SUPABASE_URL not set — routes.__init__ requires it"
)
def test_granular_commit_changes_total_pulled_raw():
    """total_pulled_raw diff row gets action='pull' and week_number=0."""
    from backend.routes.sourcectrl import _granular_commit_changes

    diffs = [
        {
            "operation": "inventory_save",
            "month": 5,
            "year": 2026,
            "rows": [
                {
                    "sku": "DRY-001",
                    "status": "update",
                    "before": {},
                    "after": {"total_pulled_raw": 40.0},
                    "changes": ["total_pulled_raw"],
                }
            ],
        }
    ]

    mock_sup = MagicMock()
    mock_sup.table.return_value.select.return_value.in_.return_value.execute.return_value.data = [
        {"sku": "DRY-001", "id": ITEM_ID}
    ]

    with patch("backend.routes.sourcectrl.supabase_service", mock_sup):
        changes = _granular_commit_changes("commit-1", diffs)

    assert len(changes) == 1, f"Expected 1 change row, got {changes}"
    c = changes[0]
    assert c["action"] == "pull"
    assert c["week_number"] == 3
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
