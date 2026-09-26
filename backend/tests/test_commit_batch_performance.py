"""Large saves must use bounded DB round trips without dropping sparse fields."""

import asyncio
import threading
from contextvars import ContextVar
from types import SimpleNamespace
from unittest.mock import patch

from backend.ai import diff
from backend.inventory_identity import (
    load_items_for_batch,
    resolve_and_write_item,
    flush_item_updates,
)
from backend.staging.dispatch import (
    _enforce_value_invariants,
    _validate_monthly_rows_no_overpull,
)


class Query:
    def __init__(self, client, name):
        self.client, self.name = client, name
        self.filters = []
        self.values = None
        self.operation = "select"

    def select(self, *_args):
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: row.get(key) == value)
        return self

    def in_(self, key, values):
        self.filters.append(lambda row: row.get(key) in values)
        return self

    def update(self, values):
        self.operation, self.values = "update", values
        return self

    def upsert(self, values, **_kwargs):
        self.operation, self.values = "upsert", values
        return self

    def execute(self):
        self.client.calls.append((self.name, self.operation))
        rows = self.client.rows[self.name]
        matches = [row for row in rows if all(f(row) for f in self.filters)]
        if self.operation == "update":
            for row in matches:
                row.update(self.values)
        elif self.operation == "upsert":
            for values in self.values:
                next(row for row in rows if row["id"] == values["id"]).update(values)
        return SimpleNamespace(data=matches)


class Client:
    def __init__(self, count=300):
        self.calls = []
        self.rows = {
            "inventory_items": [
                {
                    "id": str(i),
                    "sku": f"SKU-{i}",
                    "description": "Item",
                    "unit_price": 2,
                    "par_level": 3,
                    "unit": "CS",
                    "category_id": "manager-category",
                    "inventory_categories": {"name": "Dry"},
                }
                for i in range(count)
            ],
            "monthly_inventory": [
                {
                    "item_id": str(i),
                    "month": 8,
                    "year": 2026,
                    "opening_oh": 10,
                    "unit_price": 2,
                    "opening_unit_cost": 0,
                    "opening_value": 20,
                    "received_value": 0,
                    "pulled_value": 0,
                    "ending_value": 20,
                    "inventory_items": {"unit_price": 2},
                }
                for i in range(count)
            ],
        }

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, params):
        client = self

        class Request:
            def execute(self):
                client.calls.append((name, "rpc"))
                assert name == "settle_inventory_values_batch"
                for values in params["p_updates"]:
                    row = next(
                        r
                        for r in client.rows["monthly_inventory"]
                        if r["item_id"] == values["item_id"]
                    )
                    row.update(values)
                return SimpleNamespace(data=None)

        return Request()


def test_300_item_diff_uses_six_queries_and_resets_snapshot():
    client = Client()
    entries = [
        {
            "entry_id": str(i),
            "operation": "inventory_save",
            "full_payload": {
                "month": 9,
                "year": 2026,
                "items": [
                    {
                        "sku": f"SKU-{i}",
                        "desc": "Item",
                        "price": 2,
                        "par": 3,
                        "onHand": 10,
                        "category": "Dry",
                    }
                ],
            },
        }
        for i in range(300)
    ]
    with patch.object(diff, "supabase_service", client):
        result = diff.diff_batch(entries)
    assert len(client.calls) == 6
    assert len(result) == 300
    assert all(r["rows"][0]["status"] == "unchanged" for r in result)
    assert diff._batch_inventory.get() is None


def test_identity_batches_changed_rows_and_preserves_omitted_fields():
    client = Client()
    items = [{"sku": f"SKU-{i}"} for i in range(300)]
    existing = load_items_for_batch(client, items)
    pending = {}
    for item in items:
        resolve_and_write_item(
            client,
            sku=item["sku"],
            desc="Renamed",
            category_id="wrong",
            fallback_category_id="new",
            existing_items=existing,
            pending_updates=pending,
        )
    flush_item_updates(client, pending)
    assert len(client.calls) == 6
    assert all(
        row["description"] == "Renamed"
        and row["category_id"] == "manager-category"
        and row["unit_price"] == 2
        and row["unit"] == "CS"
        for row in client.rows["inventory_items"]
    )


def test_overpull_validation_batches_reads_and_still_rejects_invalid_row():
    client = Client()
    rows = [
        {"item_id": str(i), "month": 8, "year": 2026, "w1_pulled": 5}
        for i in range(300)
    ]
    assert _validate_monthly_rows_no_overpull(client, rows) is None
    assert len(client.calls) == 3
    rows[-1]["w1_pulled"] = 11
    assert "exceeds available stock" in _validate_monthly_rows_no_overpull(client, rows)


def test_same_value_corrections_are_batched():
    client = Client()
    assert (
        _enforce_value_invariants(client, 8, 2026, [str(i) for i in range(300)]) == 300
    )
    assert len(client.calls) == 6
    assert all(
        row["opening_unit_cost"] == 2 for row in client.rows["monthly_inventory"]
    )


def test_commit_keeps_event_loop_responsive_and_copies_tenant_context():
    from backend.routes import sourcectrl

    context = ContextVar("test_tenant")
    started, release = threading.Event(), threading.Event()

    def commit(_body, _user):
        started.set()
        assert release.wait(2)
        return context.get()

    async def scenario():
        context.set("tenant-one")
        task = asyncio.create_task(sourcectrl.approve_commit(None, {}))
        try:
            for _ in range(100):
                if started.is_set():
                    break
                await asyncio.sleep(0.01)
            assert started.is_set()
            assert not task.done()
        finally:
            release.set()
        assert await task == "tenant-one"

    with patch.object(sourcectrl, "_approve_commit_sync", commit):
        asyncio.run(scenario())
