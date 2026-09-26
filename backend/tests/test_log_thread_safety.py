import asyncio
import logging
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from threading import Event, get_ident
from types import SimpleNamespace

import pytest

from backend import api_logs
from backend.routes import api_logs as routes


@pytest.fixture(autouse=True)
def isolated_buffers(monkeypatch):
    monkeypatch.setattr(api_logs, "_events", deque(maxlen=api_logs.MAX_EVENTS))
    monkeypatch.setattr(api_logs, "_subscribers", {})


def test_worker_logging_wakes_waiting_subscriber():
    async def scenario():
        loop = asyncio.get_running_loop()
        loop.set_debug(True)  # Wrong-thread Future wakeups must fail loudly.
        queue = asyncio.Queue()
        api_logs.subscribe(queue)
        pending = asyncio.create_task(queue.get())
        await asyncio.sleep(0)
        record = logging.LogRecord(
            "worker", logging.INFO, "", 0, "hello %s", ("async",), None
        )
        await asyncio.to_thread(api_logs.InMemoryLogHandler().emit, record)
        event = await asyncio.wait_for(pending, 1)
        assert event["message"] == "hello async"
        assert event["type"] == "log"
        assert api_logs.get_events() == [event]
        api_logs.unsubscribe(queue)

    asyncio.run(scenario())


def test_concurrent_writers_and_readers_preserve_ring_and_delivery_order():
    async def scenario():
        queue = asyncio.Queue()
        api_logs.subscribe(queue)

        def write(worker):
            for index in range(400):
                api_logs._append_event({"id": (worker, index)})
                snapshot = api_logs.get_events()
                assert len(snapshot) <= api_logs.MAX_EVENTS
                assert len({event["id"] for event in snapshot}) == len(snapshot)

        def run_workers():
            with ThreadPoolExecutor(max_workers=4) as pool:
                list(pool.map(write, range(4)))

        await asyncio.to_thread(run_workers)
        received = [await asyncio.wait_for(queue.get(), 1) for _ in range(1600)]
        assert api_logs.get_events() == received[-api_logs.MAX_EVENTS :]
        for worker in range(4):
            assert [e["id"][1] for e in received if e["id"][0] == worker] == list(
                range(400)
            )
        api_logs.unsubscribe(queue)

    asyncio.run(scenario())


def test_closed_loop_is_removed_without_losing_buffered_event():
    loop = asyncio.new_event_loop()
    queue = asyncio.Queue()

    async def register():
        api_logs.subscribe(queue)

    loop.run_until_complete(register())
    loop.close()
    with ThreadPoolExecutor(max_workers=1) as pool:
        pool.submit(api_logs._append_event, {"id": "after-close"}).result(timeout=1)
    assert queue not in api_logs._subscribers
    assert queue.empty()
    assert api_logs.get_events() == [{"id": "after-close"}]


def test_subscribers_on_different_loops_receive_on_their_owner():
    ready = Event()

    def other_loop():
        async def listen():
            asyncio.get_running_loop().set_debug(True)
            queue = asyncio.Queue()
            api_logs.subscribe(queue)
            ready.set()
            try:
                return await asyncio.wait_for(queue.get(), 3)
            finally:
                api_logs.unsubscribe(queue)

        return asyncio.run(listen())

    async def scenario():
        asyncio.get_running_loop().set_debug(True)
        queue = asyncio.Queue()
        api_logs.subscribe(queue)
        with ThreadPoolExecutor(max_workers=1) as pool:
            other = pool.submit(other_loop)
            assert await asyncio.to_thread(ready.wait, 2)
            await asyncio.to_thread(api_logs._append_event, {"id": "both-loops"})
            assert await asyncio.wait_for(queue.get(), 1) == {"id": "both-loops"}
            assert await asyncio.wrap_future(other) == {"id": "both-loops"}
        api_logs.unsubscribe(queue)
        assert not api_logs._subscribers

    asyncio.run(scenario())


def test_unsubscribe_ignores_already_scheduled_delivery():
    async def scenario():
        queue = asyncio.Queue()
        api_logs.subscribe(queue)
        api_logs._append_event({"id": 1})
        api_logs.unsubscribe(queue)
        api_logs.unsubscribe(queue)
        await asyncio.sleep(0)
        assert queue.empty()
        assert api_logs.get_events() == [{"id": 1}]

    asyncio.run(scenario())


def test_full_subscriber_is_removed_on_owning_loop():
    async def scenario():
        queue = asyncio.Queue(maxsize=1)
        api_logs.subscribe(queue)
        await asyncio.to_thread(
            lambda: [api_logs._append_event({"id": i}) for i in range(3)]
        )
        await asyncio.sleep(0)
        assert queue not in api_logs._subscribers
        assert queue.get_nowait() == {"id": 0}
        assert queue.empty()
        assert api_logs.get_events() == [{"id": i} for i in range(3)]

    asyncio.run(scenario())


def test_routes_reexport_shared_capture_functions():
    for name in (
        "record_log",
        "record_request",
        "install_log_capture",
        "InMemoryLogHandler",
        "_append_event",
    ):
        assert getattr(routes, name) is getattr(api_logs, name)


def test_stream_auth_runs_in_worker_and_shared_capture_reaches_stream(monkeypatch):
    async def scenario():
        owner = get_ident()

        def authenticate(token):
            assert get_ident() != owner
            assert token == "test-token"
            return {"tenant": {"id": "workspace-a"}}

        monkeypatch.setattr(routes, "_user_from_token", authenticate)
        api_logs._append_event({"id": "hidden", "tenant_id": "workspace-b"})
        api_logs._append_event({"id": "history", "tenant_id": "workspace-a"})
        response = await routes.stream_api_logs(token="test-token")
        stream = response.body_iterator
        try:
            assert "history" in await anext(stream)
            assert "event: ready" in await anext(stream)
            pending = asyncio.create_task(anext(stream))
            await asyncio.sleep(0)
            await asyncio.to_thread(
                routes.record_request,
                method="GET",
                path="/worker",
                status_code=200,
                duration_ms=1,
                tenant_id="workspace-a",
            )
            event = await asyncio.wait_for(pending, 1)
            assert "event: log" in event
            assert "/worker" in event
        finally:
            await stream.aclose()
        assert not api_logs._subscribers

    asyncio.run(scenario())


def test_log_endpoint_uses_shared_snapshot_and_keeps_newest_first(monkeypatch):
    monkeypatch.setattr(routes, "current_tenant", lambda: None)
    api_logs._append_event({"id": "older", "type": "log", "level": "info"})
    api_logs._append_event({"id": "newer", "type": "log", "level": "info"})
    response = routes.get_api_logs(
        limit=10, kind="all", level="all", include_durable=False, auth_user={}
    )
    import json

    body = json.loads(response.body)
    assert [entry["id"] for entry in body["entries"]] == ["newer", "older"]
    assert body["buffered"] == 2
    assert [entry["id"] for entry in api_logs.get_events()] == ["older", "newer"]


def test_portal_login_reads_json_on_loop_and_runs_auth_workflow_in_worker(monkeypatch):
    async def scenario():
        owner = get_ident()
        called = []

        async def read_json():
            assert get_ident() == owner
            return {"username": "test-manager", "password": "synthetic-password"}

        def sign_in(credentials):
            assert get_ident() != owner
            assert credentials["email"] == "test-manager@mjc-cafeteria.com"
            called.append("sign-in")
            return SimpleNamespace(
                session=SimpleNamespace(access_token="synthetic-token")
            )

        def authenticate(token):
            assert get_ident() != owner
            assert token == "synthetic-token"
            called.append("profile")
            return {"username": "test-manager", "role": "manager"}

        monkeypatch.setattr(routes.supabase.auth, "sign_in_with_password", sign_in)
        monkeypatch.setattr(routes, "_user_from_token", authenticate)
        response = await routes.portal_logs_login(SimpleNamespace(json=read_json))
        assert response.status_code == 200
        assert called == ["sign-in", "profile"]
        assert (
            api_logs.get_events()[-1]["message"]
            == "Portal log login succeeded for test-manager."
        )

    asyncio.run(scenario())


def test_portal_login_invalid_json_preserves_validation_error():
    async def scenario():
        async def read_json():
            raise ValueError("invalid JSON")

        with pytest.raises(routes.HTTPException) as error:
            await routes.portal_logs_login(SimpleNamespace(json=read_json))
        assert error.value.status_code == 400

    asyncio.run(scenario())


@pytest.mark.parametrize("status", [401, 403])
def test_stream_auth_preserves_http_errors(monkeypatch, status):
    def reject(token):
        raise routes.HTTPException(status_code=status, detail="rejected")

    monkeypatch.setattr(routes, "_user_from_token", reject)

    async def scenario():
        with pytest.raises(routes.HTTPException) as error:
            await routes.stream_api_logs(token="synthetic-token")
        assert error.value.status_code == status
        assert not api_logs._subscribers

    asyncio.run(scenario())


def test_portal_login_auth_failure_preserves_401_and_safe_log(monkeypatch):
    def reject(credentials):
        raise ValueError("provider failure")

    monkeypatch.setattr(routes.supabase.auth, "sign_in_with_password", reject)

    async def scenario():
        async def read_json():
            return {"username": "test-manager", "password": "synthetic-password"}

        with pytest.raises(routes.HTTPException) as error:
            await routes.portal_logs_login(SimpleNamespace(json=read_json))
        assert error.value.status_code == 401
        assert (
            api_logs.get_events()[-1]["message"]
            == "Portal log login failed for test-manager."
        )

    asyncio.run(scenario())
