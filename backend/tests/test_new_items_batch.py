"""Canonical catalog creation batches writes without changing item semantics."""

from copy import deepcopy
from types import SimpleNamespace

import pytest

from backend.inventory_identity import (
    flush_item_updates,
    prepare_items_for_batch,
    resolve_and_write_item,
)


class Client:
    def __init__(self, rows=()):
        self.rows = {row["sku"]: deepcopy(row) for row in rows}
        self.calls = []
        self.fail_insert = False
        self.omit_response = False

    def table(self, name):
        assert name == "inventory_items"
        return Query(self)


class Query:
    def __init__(self, client):
        self.client = client
        self.op = "select"
        self.payload = None
        self.filters = []

    def select(self, *args):
        return self

    def in_(self, key, values):
        self.filters.append(lambda row: row.get(key) in values)
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: row.get(key) == value)
        return self

    def ilike(self, key, value):
        self.filters.append(lambda row: str(row.get(key, "")).lower() == value.lower())
        return self

    def limit(self, *args):
        return self

    def insert(self, payload):
        self.op, self.payload = "insert", payload
        return self

    def update(self, payload):
        self.op, self.payload = "update", payload
        return self

    def upsert(self, payload, **kwargs):
        self.op, self.payload = "upsert", payload
        return self

    def execute(self):
        c = self.client
        c.calls.append((self.op, deepcopy(self.payload)))
        if self.op == "select":
            return SimpleNamespace(
                data=[
                    deepcopy(row)
                    for row in c.rows.values()
                    if all(f(row) for f in self.filters)
                ]
            )
        if self.op == "insert":
            if c.fail_insert:
                raise RuntimeError("insert failed")
            rows = self.payload if isinstance(self.payload, list) else [self.payload]
            assert len({tuple(sorted(row)) for row in rows}) == 1
            inserted = []
            for row in rows:
                assert "_batch_created" not in row
                assert row["sku"] not in c.rows
                stored = {
                    "unit_price": 0,
                    "par_level": 0,
                    **row,
                    "id": f"id-{row['sku']}",
                }
                c.rows[row["sku"]] = stored
                inserted.append(deepcopy(stored))
            return SimpleNamespace(data=[] if c.omit_response else inserted)
        if self.op == "update":
            for row in c.rows.values():
                if all(f(row) for f in self.filters):
                    row.update(self.payload)
        else:
            for update in self.payload:
                assert "_batch_created" not in update
                next(
                    row for row in c.rows.values() if row["id"] == update["id"]
                ).update(update)
        return SimpleNamespace(data=[])


def resolve(client, item, cache, updates, *, direction=None, review=False):
    return resolve_and_write_item(
        client,
        sku=item.get("sku"),
        desc=item.get("desc"),
        category_id={"Produce": "produce", "Other": "other"}.get(item.get("category")),
        fallback_category_id="review",
        force_review_category=review,
        price=item.get("price") if direction != "issued" else None,
        par=item.get("par") if direction is None else None,
        unit=item.get("unit") or None,
        existing_items=cache,
        pending_updates=updates,
    )


def test_300_new_items_need_three_reads_and_three_inserts():
    client = Client()
    items = [
        {"sku": f" sku-{i:03} ", "desc": f"Item {i}", "price": 2, "par": 3}
        for i in range(300)
    ]
    original = deepcopy(items)
    cache = prepare_items_for_batch(
        client, items, {}, "review", force_review_category=True
    )
    updates = {}
    for item in items:
        item_id, sku, created = resolve(client, item, cache, updates, review=True)
        assert item_id == f"id-{sku}"
        assert created is True
    flush_item_updates(client, updates)
    assert updates == {}
    assert [op for op, _ in client.calls] == ["select"] * 3 + ["insert"] * 3
    assert items == original
    assert all("_batch_created" not in row for row in cache.values())


@pytest.mark.parametrize("direction", [None, "received", "issued"])
def test_sparse_defaults_and_review_suggestions_match_sequential_resolver(direction):
    items = [
        {
            "sku": "001-A",
            "desc": " Apple ",
            "category": "Produce",
            "price": 0,
            "par": 0,
        },
        {"sku": "002-A", "category": "Unknown"},
        {"sku": "003-A", "desc": "Box", "unit": "EA", "price": 2.5, "par": 8},
    ]
    batch, sequential = Client(), Client()
    cache = prepare_items_for_batch(
        batch,
        items,
        {"Produce": "produce"},
        "review",
        force_review_category=True,
        direction=direction,
    )
    for item in items:
        assert (
            resolve(batch, item, cache, {}, direction=direction, review=True)[2] is True
        )
        resolve(sequential, item, None, None, direction=direction, review=True)
    for sku, row in batch.rows.items():
        expected = sequential.rows[sku]
        assert {
            k: v for k, v in row.items() if k not in ("created_at", "updated_at")
        } == {
            k: v for k, v in expected.items() if k not in ("created_at", "updated_at")
        }
    assert batch.rows["001-A"]["suggested_category_id"] == "produce"
    assert batch.rows["001-A"]["category_id"] == "review"
    assert batch.rows["002-A"]["unit"] is None


def test_existing_rows_and_duplicate_sku_keep_categories_and_created_flag():
    client = Client(
        [
            {
                "id": "old",
                "sku": "OLD",
                "description": "Old",
                "category_id": "manager",
                "unit": "EA",
            }
        ]
    )
    items = [
        {"sku": " new ", "desc": "First", "category": "Produce"},
        {"sku": "NEW", "desc": "Second", "category": "Other", "price": 9},
        {"sku": "OLD", "desc": "Updated", "category": "Other"},
    ]
    cache = prepare_items_for_batch(
        client, items, {"Produce": "produce", "Other": "other"}, "review"
    )
    updates = {}
    assert [resolve(client, item, cache, updates)[2] for item in items] == [
        True,
        False,
        False,
    ]
    flush_item_updates(client, updates)
    assert client.rows["NEW"]["category_id"] == "produce"
    assert client.rows["NEW"]["description"] == "Second"
    assert client.rows["NEW"]["unit_price"] == 9
    assert client.rows["OLD"]["category_id"] == "manager"
    assert client.rows["OLD"]["unit"] == "EA"
    assert len([c for c in client.calls if c[0] == "insert"]) == 1
    assert all("category_id" not in row for row in updates.values())


def test_blank_and_placeholder_keep_existing_description_path():
    client = Client([{"id": "found", "sku": "MJC-FOUND", "description": "Apples"}])
    items = [{"sku": "TEMP_000", "desc": "apples"}, {"sku": "", "desc": "New blank"}]
    cache = prepare_items_for_batch(client, items, {}, "review")
    assert cache == {}
    assert client.calls == []
    assert resolve(client, items[0], cache, {}) == ("found", "MJC-FOUND", False)
    item_id, sku, created = resolve(client, items[1], cache, {})
    assert created is True
    assert sku.startswith("MJC-")
    assert item_id


def test_failure_propagates_without_single_row_fallback():
    client = Client()
    client.fail_insert = True
    with pytest.raises(RuntimeError, match="insert failed"):
        prepare_items_for_batch(client, [{"sku": "NEW"}], {}, "review")
    assert [op for op, _ in client.calls] == ["select", "insert"]


def test_no_returned_id_fails_explicitly():
    client = Client()
    client.omit_response = True
    with pytest.raises(RuntimeError, match="returned no item id"):
        prepare_items_for_batch(client, [{"sku": "NEW"}], {}, "review")


def test_supplied_cache_avoids_reads_and_invalid_direction_never_writes():
    client = Client()
    cache = {}
    assert (
        prepare_items_for_batch(
            client, [{"sku": "NEW"}], {}, "review", existing_items=cache
        )
        is cache
    )
    assert [op for op, _ in client.calls] == ["insert"]
    with pytest.raises(ValueError, match="direction"):
        prepare_items_for_batch(
            client, [{"sku": "OTHER"}], {}, "review", direction="both"
        )
    assert [op for op, _ in client.calls] == ["insert"]
