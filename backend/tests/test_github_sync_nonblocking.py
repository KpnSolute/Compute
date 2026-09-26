"""Queue drains yield during database work and retain request tenant scope."""

import asyncio
import inspect
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from starlette.concurrency import run_in_threadpool

from backend.routes import github_sync as sync
from backend.tenancy import TenantContext, current_tenant


class Query:
    def __init__(self, client, table):
        self.client, self.table = client, table
        self.values = None
        self.filters = []

    def select(self, *_args):
        return self

    def is_(self, key, _value):
        self.filters.append(lambda row: row.get(key) is None)
        return self

    def lt(self, key, value):
        self.filters.append(lambda row: row[key] < value)
        return self

    def eq(self, key, value):
        self.filters.append(lambda row: row.get(key) == value)
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, value):
        self.count = value
        return self

    def update(self, values):
        self.values = values
        return self

    def execute(self):
        self.client.calls.append(
            (self.table, self.values, current_tenant(), threading.get_ident())
        )
        if self.client.block and self.values is None:
            self.client.entered.set()
            if not self.client.release.wait(3):
                raise RuntimeError("blocked query timed out")
        if self.client.fail_query:
            raise RuntimeError("database unavailable")
        if self.values is not None and self.client.fail_write:
            self.client.fail_write = False
            raise RuntimeError("write unavailable")
        rows = self.client.rows[self.table]
        matches = [row for row in rows if all(test(row) for test in self.filters)]
        if self.values is not None:
            for row in matches:
                row.update(self.values)
        return SimpleNamespace(
            data=[dict(row) for row in matches][: getattr(self, "count", len(matches))]
        )


class Client:
    def __init__(self):
        self.rows = {
            "github_sync_queue": [
                {"id": "q1", "commit_id": "c1", "payload": {}, "attempts": 0}
            ],
            "commits": [{"commit_id": "c1"}],
        }
        self.calls = []
        self.block = self.fail_query = self.fail_write = False
        self.entered, self.release = threading.Event(), threading.Event()

    def table(self, name):
        return Query(self, name)


@pytest.fixture
def client(monkeypatch):
    client = Client()
    monkeypatch.setattr(sync, "supabase_service", client)
    monkeypatch.setattr(sync, "_push_to_github", AsyncMock(return_value="sha"))
    return client


def test_blocked_query_keeps_loop_responsive_and_serializes_drains(client):
    async def scenario():
        client.block = True
        first = asyncio.create_task(sync._drain_queue())
        second = None
        try:
            for _ in range(100):
                if client.entered.is_set():
                    break
                await asyncio.sleep(0.005)
            assert client.entered.is_set()
            assert not first.done()
            second = asyncio.create_task(sync._drain_queue())
            await asyncio.sleep(0.03)
            assert not second.done()
            assert len(client.calls) == 1
        finally:
            client.release.set()
            results = await asyncio.gather(first, *([second] if second else []))
        assert results == [
            {"processed": 1, "failed": 0, "skipped": 0},
            {"processed": 0, "failed": 0, "skipped": 0},
        ]
        sync._push_to_github.assert_awaited_once()

    asyncio.run(scenario())


def test_tenant_context_reaches_every_worker_and_async_upload(client):
    context = TenantContext(id="tenant-a", slug="a", name="A")
    main_thread = threading.get_ident()

    async def upload(*_args):
        assert current_tenant() == context
        assert threading.get_ident() == main_thread
        return "tenant-sha"

    sync._push_to_github.side_effect = upload
    asyncio.run(sync._drain_queue_for_tenant(context))
    assert len(client.calls) == 3
    assert all(call[2] == context and call[3] != main_thread for call in client.calls)
    assert current_tenant() is None
    assert client.rows["commits"][0]["github_sha"] == "tenant-sha"


def test_upload_failures_retry_to_limit_with_tenant_context(client):
    context = TenantContext(id="tenant-b", slug="b", name="B")
    sync._push_to_github.side_effect = RuntimeError("x" * 600)
    for attempt in range(1, sync.MAX_ATTEMPTS + 1):
        result = asyncio.run(sync._drain_queue_for_tenant(context))
        assert result["failed"] == 1
        assert client.rows["github_sync_queue"][0]["attempts"] == attempt
    assert len(client.rows["github_sync_queue"][0]["last_error"]) == 500
    assert asyncio.run(sync._drain_queue_for_tenant(context))["failed"] == 0
    assert sync._push_to_github.await_count == sync.MAX_ATTEMPTS
    assert all(call[2] == context for call in client.calls)
    assert "github_sha" not in client.rows["commits"][0]


def test_database_write_failure_is_recorded_and_retry_succeeds(client):
    client.fail_write = True
    assert asyncio.run(sync._drain_queue())["failed"] == 1
    row = client.rows["github_sync_queue"][0]
    assert row["attempts"] == 1
    assert row["last_error"] == "write unavailable"
    assert asyncio.run(sync._drain_queue())["processed"] == 1
    assert row["last_error"] is None
    assert row["synced_at"]


def test_query_failure_releases_lock(client):
    client.fail_query = True
    with pytest.raises(RuntimeError, match="database unavailable"):
        asyncio.run(sync._drain_queue())
    assert not sync._drain_lock.locked()
    client.fail_query = False
    assert asyncio.run(sync._drain_queue())["processed"] == 1


def test_cancelled_waiter_does_not_release_owner_lock(client):
    async def scenario():
        assert sync._drain_lock.acquire(blocking=False)
        try:
            waiter = asyncio.create_task(sync._drain_queue())
            await asyncio.sleep(0.02)
            waiter.cancel()
            with pytest.raises(asyncio.CancelledError):
                await waiter
            assert sync._drain_lock.locked()
            assert client.calls == []
        finally:
            sync._drain_lock.release()
        assert (await sync._drain_queue())["processed"] == 1

    asyncio.run(scenario())


def test_status_is_sync_and_preserves_counts_and_errors(client):
    assert not inspect.iscoroutinefunction(sync.sync_status)
    client.rows["github_sync_queue"].extend(
        [
            {"id": "q2", "attempts": 3},
            {"id": "q3", "attempts": 0, "synced_at": "now"},
        ]
    )
    result = asyncio.run(run_in_threadpool(sync.sync_status, {}))
    assert {key: result[key] for key in ("total", "pending", "failed", "synced")} == {
        "total": 3,
        "pending": 1,
        "failed": 1,
        "synced": 1,
    }
    client.fail_query = True
    with pytest.raises(sync.HTTPException) as error:
        sync.sync_status({})
    assert error.value.status_code == 500
