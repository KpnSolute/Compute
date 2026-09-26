import asyncio
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import BackgroundTasks

from backend import main
from backend.routes import github_sync as sync
from backend.tenancy import (
    TenantContext,
    TenantScopedClient,
    current_tenant,
    tenant_scope,
)


class Query:
    def __init__(self, store, table):
        self.store, self.table = store, table
        self.filters = []
        self.values = None
        self.columns = "*"
        self.start, self.end = 0, 999

    def select(self, columns):
        self.columns = columns
        return self

    def eq(self, key, value):
        self.filters.append((key, lambda row: row.get(key) == value))
        return self

    def is_(self, key, value):
        assert value == "null"
        self.filters.append((key, lambda row: row.get(key) is None))
        return self

    def lt(self, key, value):
        self.filters.append((key, lambda row: row[key] < value))
        return self

    def order(self, key):
        self.sort_key = key
        return self

    def range(self, start, end):
        self.start, self.end = start, end
        return self

    def limit(self, count):
        self.end = count - 1
        return self

    def update(self, values):
        self.values = values
        return self

    def execute(self):
        scope = current_tenant()
        self.store.calls.append((self.table, self.values, scope, threading.get_ident()))
        if self.table == "tenants":
            assert self.columns == "id,slug"
            assert self.values is None
        else:
            assert scope is not None
            assert any(key == "tenant_id" for key, _ in self.filters)
        if (
            self.store.fail_commit_write
            and self.table == "commits"
            and self.values is not None
        ):
            self.store.fail_commit_write = False
            raise RuntimeError("metadata unavailable")
        matches = [
            row
            for row in self.store.rows[self.table]
            if all(test(row) for _, test in self.filters)
        ]
        if self.values is not None:
            for row in matches:
                row.update(self.values)
        elif hasattr(self, "sort_key"):
            matches.sort(key=lambda row: row[self.sort_key])
        matches = matches[self.start : self.end + 1]
        if self.columns == "*":
            data = [dict(row) for row in matches]
        else:
            data = [
                {key: row[key] for key in self.columns.split(",")} for row in matches
            ]
        return SimpleNamespace(data=data)


class Store:
    def __init__(self):
        self.calls = []
        self.fail_commit_write = False
        self.rows = {
            "tenants": [
                {"id": "tenant-a", "slug": "a"},
                {"id": "tenant-b", "slug": "b"},
            ],
            "github_sync_queue": [],
            "commits": [],
        }

    def table(self, name):
        return Query(self, name)

    def enqueue(self, tenant, number=0):
        commit_id = f"{tenant}-commit-{number}"
        row = {
            "id": f"{tenant}-queue-{number}",
            "tenant_id": tenant,
            "commit_id": commit_id,
            "payload": {"message": "archive"},
            "attempts": 0,
            "synced_at": None,
            "created_at": number,
        }
        self.rows["github_sync_queue"].append(row)
        self.rows["commits"].append({"commit_id": commit_id, "tenant_id": tenant})
        return row


@pytest.fixture
def store(monkeypatch):
    store = Store()
    monkeypatch.setattr(sync, "supabase_admin", store)
    monkeypatch.setattr(sync, "supabase_service", TenantScopedClient(store))
    monkeypatch.setattr(sync, "GITHUB_TOKEN", "test-token")
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "enforced")
    monkeypatch.setattr(sync, "_push_to_github", AsyncMock(return_value="archive-sha"))
    return store


async def until(predicate):
    async def wait():
        while not predicate():
            await asyncio.sleep(0.001)

    await asyncio.wait_for(wait(), 2)


def test_poll_discovers_only_safe_fields_and_scopes_all_queue_io(store):
    for tenant in ("tenant-a", "tenant-b"):
        store.enqueue(tenant)
    main_thread = threading.get_ident()
    uploaded = []

    async def upload(commit_id, payload):
        scope = current_tenant()
        assert commit_id.startswith(scope.id)
        uploaded.append(scope.id)
        return "archive-sha"

    sync._push_to_github.side_effect = upload
    asyncio.run(sync._poll_archive_queues())
    assert uploaded == ["tenant-a", "tenant-b"]
    assert all(row["synced_at"] for row in store.rows["github_sync_queue"])
    assert all(row["github_sha"] == "archive-sha" for row in store.rows["commits"])
    assert all(thread != main_thread for _, _, _, thread in store.calls)
    assert current_tenant() is None


def test_poll_bounds_batches_and_paginates_tenants(store, monkeypatch):
    monkeypatch.setattr(sync, "TENANT_PAGE_SIZE", 1)
    for tenant in ("tenant-a", "tenant-b"):
        for number in range(12):
            store.enqueue(tenant, number)
    asyncio.run(sync._poll_archive_queues())
    assert sum(bool(row["synced_at"]) for row in store.rows["github_sync_queue"]) == 20
    assert sync._push_to_github.await_count == 20
    assert len([call for call in store.calls if call[0] == "tenants"]) == 3
    asyncio.run(sync._poll_archive_queues())
    assert all(row["synced_at"] for row in store.rows["github_sync_queue"])


def test_retry_limit_remains_durable_across_polls(store):
    row = store.enqueue("tenant-a")
    sync._push_to_github.side_effect = RuntimeError("upload unavailable")
    for expected in range(1, sync.MAX_ATTEMPTS + 1):
        asyncio.run(sync._poll_archive_queues())
        assert row["attempts"] == expected
    asyncio.run(sync._poll_archive_queues())
    assert sync._push_to_github.await_count == 3
    assert row["synced_at"] is None


def test_commit_metadata_failure_keeps_queue_eligible(store):
    row = store.enqueue("tenant-a")
    store.fail_commit_write = True
    asyncio.run(sync._poll_archive_queues())
    assert row["attempts"] == 1
    assert row["synced_at"] is None
    asyncio.run(sync._poll_archive_queues())
    assert row["synced_at"]
    assert row["last_error"] is None
    assert store.rows["commits"][0]["github_sha"] == "archive-sha"


def test_lifespan_restarts_pending_retries_and_stops_its_single_task(store):
    row = store.enqueue("tenant-a")

    async def scenario():
        sync._push_to_github.side_effect = RuntimeError("upload unavailable")
        async with main.app.router.lifespan_context(main.app):
            first = main.app.state.archive_queue_task
            await until(lambda: row["attempts"] == 1)
            assert not first.done()
        assert first.done()
        assert not sync._drain_lock.locked()
        sync._push_to_github.side_effect = None
        async with main.app.router.lifespan_context(main.app):
            second = main.app.state.archive_queue_task
            assert second is not first
            await until(lambda: bool(row["synced_at"]))
        assert second.done()
        assert sync._push_to_github.await_count == 2

    asyncio.run(scenario())


def test_later_commit_is_found_without_manual_endpoint(store, monkeypatch):
    monkeypatch.setattr(sync, "ARCHIVE_POLL_INTERVAL", 0.01)

    async def scenario():
        async with main.app.router.lifespan_context(main.app):
            await until(
                lambda: any(call[0] == "github_sync_queue" for call in store.calls)
            )
            row = store.enqueue("tenant-b")
            await until(lambda: bool(row["synced_at"]))
        assert sync._push_to_github.await_count == 1

    asyncio.run(scenario())


def test_poll_errors_are_sanitized_and_wait_before_retry(monkeypatch, caplog):
    calls = []

    async def broken(stop):
        calls.append(None)
        raise RuntimeError("sensitive-credential-and-payload")

    monkeypatch.setattr(sync, "_poll_archive_queues", broken)
    monkeypatch.setattr(sync, "GITHUB_TOKEN", "test-token")
    assert sync.ARCHIVE_POLL_INTERVAL == 30

    async def scenario():
        async with main.app.router.lifespan_context(main.app):
            await until(lambda: len(calls) == 1)
            await asyncio.sleep(0.03)
            assert len(calls) == 1
        assert main.app.state.archive_queue_task.done()

    asyncio.run(scenario())
    assert "Archive queue discovery failed (RuntimeError)" in caplog.text
    assert "sensitive-credential-and-payload" not in caplog.text


def test_one_tenant_failure_does_not_stop_other_tenants(store, monkeypatch, caplog):
    store.enqueue("tenant-b")
    drain = sync._drain_queue_for_tenant

    async def partly_broken(context):
        if context.id == "tenant-a":
            raise RuntimeError("sensitive-credential")
        return await drain(context)

    monkeypatch.setattr(sync, "_drain_queue_for_tenant", partly_broken)
    asyncio.run(sync._poll_archive_queues())
    assert store.rows["github_sync_queue"][0]["synced_at"]
    assert "Archive tenant poll failed (RuntimeError)" in caplog.text
    assert "sensitive-credential" not in caplog.text


def test_missing_token_skips_discovery_and_preserves_manual_503(store, monkeypatch):
    monkeypatch.setattr(sync, "GITHUB_TOKEN", "")
    asyncio.run(sync._poll_archive_queues())
    assert store.calls == []
    with pytest.raises(sync.HTTPException) as error:
        asyncio.run(sync.run_sync(BackgroundTasks(), {}))
    assert error.value.status_code == 503


def test_manual_endpoint_keeps_request_tenant_and_background_contract(store):
    context = TenantContext(id="tenant-b", slug="b", name="B")
    tasks = BackgroundTasks()
    with tenant_scope(context):
        result = asyncio.run(sync.run_sync(tasks, {}))
    assert result == {"ok": True, "message": "Sync queued in background."}
    assert len(tasks.tasks) == 1
    assert tasks.tasks[0].args == (context,)


def test_blocked_discovery_keeps_health_and_404_routes_responsive(store, monkeypatch):
    started, release = threading.Event(), threading.Event()

    def blocked(offset):
        started.set()
        if not release.wait(3):
            raise RuntimeError("discovery blocked the event loop")
        return []

    monkeypatch.setattr(sync, "_archive_tenants_page", blocked)
    for name in ("record_request", "record_audit_event", "record_error", "record_log"):
        monkeypatch.setattr(main, name, lambda *args, **kwargs: None)

    async def scenario():
        try:
            async with main.app.router.lifespan_context(main.app):
                await until(started.is_set)
                async with httpx.AsyncClient(
                    transport=httpx.ASGITransport(app=main.app), base_url="http://test"
                ) as client:
                    healthy = await asyncio.wait_for(client.get("/health"), 1)
                    missing = await asyncio.wait_for(client.get("/does-not-exist"), 1)
                assert healthy.status_code == 200
                assert missing.status_code == 404
                assert not release.is_set()
                release.set()
        finally:
            release.set()

    asyncio.run(scenario())
