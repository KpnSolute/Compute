"""HTTP acceptance regressions for commit isolation and ordered mutations."""

import asyncio
import threading
from unittest.mock import patch

import httpx
from fastapi import FastAPI

from backend.routes import sourcectrl
from backend.routes._deps import _require_assistant
from backend.concurrency import run_commit, serialized_inventory_write


def test_http_read_remains_available_during_commit():
    app = FastAPI()
    app.include_router(sourcectrl.router)
    app.dependency_overrides[_require_assistant] = lambda: {
        "id": "admin",
        "role": "admin",
    }
    started, release = threading.Event(), threading.Event()

    @app.get("/probe")
    def probe():
        return {"ok": True}

    def slow_commit(*_):
        started.set()
        assert release.wait(3)
        return {"commit_id": "test"}

    async def scenario():
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app), base_url="http://test"
        ) as client:
            commit = asyncio.create_task(
                client.post(
                    "/api/commits",
                    json={
                        "staging_ids": ["test"],
                        "message": "test",
                        "author_id": "admin",
                    },
                )
            )
            try:
                async with asyncio.timeout(1):
                    while not started.is_set():
                        await asyncio.sleep(0.005)
                    response = await client.get("/probe")
                assert response.status_code == 200
                assert not commit.done()
            finally:
                release.set()
                response = await commit
            assert response.status_code == 201

    with patch.object(sourcectrl, "_approve_commit_sync", slow_commit):
        asyncio.run(scenario())


def test_commit_queue_keeps_worker_capacity_and_orders_writes():
    entered, release = threading.Event(), threading.Event()
    order = []

    def first():
        order.append("first-start")
        entered.set()
        assert release.wait(3)
        order.append("first-end")

    @serialized_inventory_write
    def mutation():
        order.append("mutation")

    async def scenario():
        one = asyncio.create_task(run_commit(first))
        try:
            async with asyncio.timeout(1):
                while not entered.is_set():
                    await asyncio.sleep(0.005)
            two = asyncio.create_task(run_commit(lambda: order.append("second")))
            writer = asyncio.create_task(asyncio.to_thread(mutation))
            await asyncio.sleep(0.01)
            assert order == ["first-start"]
        finally:
            release.set()
            await one
        await asyncio.gather(two, writer)
        assert order.index("first-end") < order.index("second")
        assert order.index("first-end") < order.index("mutation")

    asyncio.run(scenario())
