import asyncio
import io
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import httpx
import pytest
from fastapi import HTTPException, UploadFile
from starlette.datastructures import Headers

from backend.routes import users


PROFILE = {
    "id": "target",
    "username": "target",
    "display_name": "Target",
    "role": "staff",
    "active": True,
}
ACTOR = {"id": "actor", "role": "sudo"}


def avatar(data=b"image", content_type="image/png"):
    return UploadFile(io.BytesIO(data), headers=Headers({"content-type": content_type}))


def database(monkeypatch, data):
    client = MagicMock()
    query = client.table.return_value
    for method in ("select", "eq", "single", "limit", "neq", "update", "insert"):
        getattr(query, method).return_value = query
    query.execute.return_value = SimpleNamespace(data=data)
    monkeypatch.setattr(users, "supabase_service", client)
    return query


@pytest.mark.parametrize("operation", ["profile", "membership", "avatar"])
def test_blocked_io_leaves_event_loop_responsive(monkeypatch, operation):
    started = threading.Event()
    release = threading.Event()
    query = database(monkeypatch, PROFILE if operation == "profile" else [PROFILE])
    monkeypatch.setattr(users, "_require_workspace_member", lambda _: None)

    def blocked(*args, **kwargs):
        started.set()
        if not release.wait(2):
            raise RuntimeError("event loop did not release the blocked call")
        if operation == "avatar":
            return SimpleNamespace(status_code=200)
        if operation == "membership":
            return None
        return SimpleNamespace(data=PROFILE)

    if operation == "profile":
        query.execute.side_effect = blocked
    elif operation == "membership":
        monkeypatch.setattr(users, "_require_workspace_member", blocked)
        monkeypatch.setattr(users, "_get_user_by_id", AsyncMock(return_value=PROFILE))
    else:
        monkeypatch.setattr(httpx, "put", blocked)

    async def scenario():
        call = (
            users.upload_my_avatar(avatar(), PROFILE)
            if operation == "avatar"
            else users.get_user("target", ACTOR)
        )
        task = asyncio.create_task(call)
        try:

            async def wait_started():
                while not started.is_set():
                    await asyncio.sleep(0.001)

            await asyncio.wait_for(wait_started(), 1)
            await asyncio.sleep(0)
            assert not task.done(), "blocking I/O prevented concurrent progress"
            release.set()
            result = await asyncio.wait_for(task, 1)
            assert result.id == "target"
        finally:
            release.set()
            await asyncio.gather(task, return_exceptions=True)

    asyncio.run(scenario())


@pytest.mark.parametrize(
    "helper,args,expected",
    [
        ("_get_user_by_id", ("missing",), None),
        ("_user_exists", ("missing",), False),
    ],
)
def test_lookup_errors_keep_existing_fallbacks(monkeypatch, helper, args, expected):
    query = database(monkeypatch, None)
    query.execute.side_effect = RuntimeError("offline")
    assert asyncio.run(getattr(users, helper)(*args)) is expected


@pytest.mark.parametrize(
    "endpoint", ["get_user", "update_user", "get_user_credentials", "disable_user"]
)
def test_missing_user_remains_404_with_async_mock(monkeypatch, endpoint):
    monkeypatch.setattr(users, "_require_workspace_member", lambda _: None)
    lookup = AsyncMock(return_value=None)
    monkeypatch.setattr(users, "_get_user_by_id", lookup)
    args = (
        ("missing", users.UserUpdateRequest(), ACTOR)
        if endpoint == "update_user"
        else ("missing", ACTOR)
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(getattr(users, endpoint)(*args))
    assert (exc.value.status_code, exc.value.detail) == (404, "User not found")
    lookup.assert_awaited_once_with("missing")


def test_duplicate_create_keeps_async_lookup_and_error(monkeypatch):
    lookup = AsyncMock(return_value=True)
    monkeypatch.setattr(users, "_user_exists", lookup)
    req = users.UserCreateRequest(
        username="manager",
        email="manager@example.com",
        display_name="Manager",
        role="manager",
    )
    with pytest.raises(HTTPException) as exc:
        asyncio.run(users.create_user(req, ACTOR))
    assert (exc.value.status_code, exc.value.detail) == (400, "Username already exists")
    lookup.assert_awaited_once_with("manager")


def test_disable_self_still_rejected(monkeypatch):
    monkeypatch.setattr(users, "_require_workspace_member", lambda _: None)
    monkeypatch.setattr(users, "_get_user_by_id", AsyncMock(return_value=PROFILE))
    with pytest.raises(HTTPException) as exc:
        asyncio.run(users.disable_user("target", PROFILE))
    assert (exc.value.status_code, exc.value.detail) == (
        400,
        "Cannot disable your own account",
    )


@pytest.mark.parametrize(
    "data,mime,status,detail",
    [
        (b"image", "text/plain", 400, "Avatar must be a JPEG, PNG, WebP, or GIF image"),
        (b"", "image/png", 400, "Avatar file is empty"),
        (
            b"x" * (users.AVATAR_MAX_BYTES + 1),
            "image/png",
            413,
            "Avatar must be 2 MB or smaller",
        ),
    ],
    ids=["unsupported", "empty", "oversized"],
)
def test_avatar_validation_errors_unchanged(data, mime, status, detail):
    with pytest.raises(HTTPException) as exc:
        asyncio.run(users.upload_my_avatar(avatar(data, mime), PROFILE))
    assert (exc.value.status_code, exc.value.detail) == (status, detail)


@pytest.mark.parametrize(
    "storage_result,rows,status,detail",
    [
        (
            SimpleNamespace(status_code=403, text="denied"),
            [PROFILE],
            502,
            "Avatar upload failed: denied",
        ),
        (SimpleNamespace(status_code=200), [], 500, "Failed to update avatar"),
        (RuntimeError("offline"), [PROFILE], 502, "Avatar service error: offline"),
    ],
)
def test_avatar_service_errors_unchanged(
    monkeypatch, storage_result, rows, status, detail
):
    database(monkeypatch, rows)
    put = MagicMock()
    if isinstance(storage_result, Exception):
        put.side_effect = storage_result
    else:
        put.return_value = storage_result
    monkeypatch.setattr(httpx, "put", put)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(users.upload_my_avatar(avatar(), PROFILE))
    assert (exc.value.status_code, exc.value.detail) == (status, detail)
