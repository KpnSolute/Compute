import asyncio
import threading
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI
from fastapi.concurrency import run_in_threadpool

from backend import concurrency
from backend.routes import inventory, sku_review
from backend.routes._deps import (
    _get_auth_user,
    _require_admin_or_manager,
    _require_manager,
)


class ObservedLock:
    """Signal a contender before it blocks on the real shared lock."""

    def __init__(self):
        self.lock = threading.RLock()
        self.contender = threading.Event()
        self.owner_entered = False

    def __enter__(self):
        if self.owner_entered:
            self.contender.set()
        self.lock.acquire()
        self.owner_entered = True
        return self

    def __exit__(self, *args):
        self.lock.release()

    def acquire(self, blocking=True):
        if self.owner_entered:
            self.contender.set()
        acquired = self.lock.acquire(blocking=blocking)
        if acquired:
            self.owner_entered = True
        return acquired

    def release(self):
        self.lock.release()


def _app():
    app = FastAPI()
    app.include_router(inventory.router)
    app.include_router(sku_review.router)
    for dependency in (_get_auth_user, _require_admin_or_manager, _require_manager):
        app.dependency_overrides[dependency] = lambda: {
            "id": "manager-1",
            "role": "admin",
        }

    @app.get("/unrelated")
    async def unrelated():
        return {"responsive": True}

    return app


async def _wait(event):
    async with asyncio.timeout(1):
        while not event.is_set():
            await asyncio.sleep(0.005)


class InventoryQuery:
    def __init__(self, state, table):
        self.state, self.table = state, table
        self.filters = {}

    def select(self, *args, **kwargs):
        return self

    def eq(self, name, value):
        self.filters[name] = value
        return self

    def order(self, *args, **kwargs):
        return self

    def limit(self, *args):
        return self

    def in_(self, *args):
        return self

    def execute(self):
        self.state["queries"].append(self.table)
        if self.table == "monthly_inventory":
            rows = [
                row
                for row in self.state["rows"]
                if all(row.get(k) == v for k, v in self.filters.items())
            ]
        elif self.table == "live_inventory":
            rows = [
                {
                    "sku": "SKU-1",
                    "description": "Item",
                    "category": "Dry",
                    "on_hand": 2,
                    "par_level": 5,
                }
                for row in self.state["rows"]
            ]
        else:
            rows = []
        return SimpleNamespace(data=rows)


@pytest.mark.parametrize(
    "path",
    [
        "/api/inventory",
        "/api/inventory?month=9&year=2026",
        "/api/inventory/history",
        "/api/inventory/reorders",
        "/api/inventory/period-status",
    ],
)
def test_reader_waits_for_clear_then_replay_without_blocking_loop(monkeypatch, path):
    # No cache is permitted for an unresolved tenant outside legacy mode.
    monkeypatch.setattr(concurrency, "tenancy_mode", lambda: "enforced")
    lock = ObservedLock()
    monkeypatch.setattr(concurrency, "inventory_write_lock", lock)
    cleared, release = threading.Event(), threading.Event()
    state = {"rows": [], "queries": []}
    row = {
        "item_id": "item-1",
        "month": 8,
        "year": 2026,
        "opening_oh": 2,
        "unit_price": 3,
        "inventory_items": {
            "id": "item-1",
            "sku": "SKU-1",
            "description": "Item",
            "par_level": 5,
            "inventory_categories": {"name": "Dry"},
        },
    }
    monkeypatch.setattr(
        inventory,
        "supabase_service",
        SimpleNamespace(table=lambda name: InventoryQuery(state, name)),
    )

    def replay():
        state["rows"].clear()
        cleared.set()
        assert release.wait(3), "The request loop could not release commit replay"
        state["rows"].append(row)

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_app()), base_url="https://test.invalid"
        ) as client:
            commit = asyncio.create_task(concurrency.run_commit(replay))
            reader = None
            try:
                await _wait(cleared)
                reader = asyncio.create_task(client.get(path))
                await _wait(lock.contender)
                assert state["rows"] == []
                assert state["queries"] == []
                assert not reader.done()
                async with asyncio.timeout(1):
                    ping = await client.get("/unrelated")
                assert ping.json() == {"responsive": True}
            finally:
                release.set()
                await commit
                response = await reader if reader is not None else None
            assert response.status_code == 200, response.text
            data = response.json()
            if path.endswith("/history"):
                assert data[0]["items"][0]["sku"] == "SKU-1"
            elif path.endswith("/reorders"):
                assert data[0]["short"] == 3
            elif path.endswith("/period-status"):
                assert data["latest_month"] == 8
            else:
                assert data["items"][0]["sku"] == "SKU-1"

    asyncio.run(exercise())


def test_inventory_and_sku_mutations_are_serialized_and_loop_stays_responsive(
    monkeypatch,
):
    lock = ObservedLock()
    monkeypatch.setattr(concurrency, "inventory_write_lock", lock)
    entered, release = threading.Event(), threading.Event()
    calls = []

    def execute_audit():
        calls.append("audit-start")
        entered.set()
        assert release.wait(3)
        calls.append("audit-end")
        return SimpleNamespace(data=[])

    monkeypatch.setattr(
        inventory,
        "supabase_service",
        SimpleNamespace(rpc=lambda *args: SimpleNamespace(execute=execute_audit)),
    )

    class QueueQuery:
        def select(self, *args):
            return self

        def eq(self, *args):
            return self

        def single(self):
            return self

        def execute(self):
            calls.append("sku-state-check")
            return SimpleNamespace(data={"status": "pending", "parsed_sku": "ALIAS-1"})

    def sku_rpc(name, params):
        calls.append(name)
        return SimpleNamespace(execute=lambda: SimpleNamespace(data={"ok": True}))

    monkeypatch.setattr(
        sku_review,
        "supabase_service",
        SimpleNamespace(table=lambda name: QueueQuery(), rpc=sku_rpc),
    )

    async def exercise():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=_app()), base_url="https://test.invalid"
        ) as client:
            first = asyncio.create_task(
                client.post("/api/inventory/audit?month=9&year=2026")
            )
            second = None
            try:
                await _wait(entered)
                second = asyncio.create_task(
                    client.post(
                        "/api/sku-review/queue-1/resolve",
                        json={
                            "resolution": "alias_existing",
                            "item_id": "item-1",
                        },
                    )
                )
                await _wait(lock.contender)
                assert calls == ["audit-start"]
                async with asyncio.timeout(1):
                    assert (await client.get("/unrelated")).status_code == 200
            finally:
                release.set()
                first_response = await first
                second_response = await second if second is not None else None
            assert first_response.status_code == second_response.status_code == 200
            assert calls == [
                "audit-start",
                "audit-end",
                "sku-state-check",
                "sku_add_alias",
                "sku_review_resolve",
            ]

    asyncio.run(exercise())


def test_inventory_lock_is_reentrant_for_nested_sku_commit():
    entered = []

    @concurrency.serialized_inventory_write
    def nested_commit():
        entered.append("nested")

    def invoke():
        with concurrency.inventory_write_lock:
            nested_commit()

    asyncio.run(run_in_threadpool(invoke))
    assert entered == ["nested"]
