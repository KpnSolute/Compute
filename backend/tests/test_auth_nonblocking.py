import asyncio
import threading
from contextvars import ContextVar
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from backend.routes import auth


def _assert_responsive(call, entered, release, context):
    async def exercise():
        context.set("request-context")
        task = asyncio.create_task(call())
        try:
            async with asyncio.timeout(1):
                while not entered.is_set():
                    await asyncio.sleep(0.005)
            # The dependency is still blocked while this request loop progresses.
            await asyncio.sleep(0)
            assert not task.done()
        finally:
            release.set()
            result = await task
        return result

    return asyncio.run(exercise())


@pytest.mark.parametrize("stage", ["jwt", "profile", "workspace"])
def test_jwt_login_dependency_io_allows_loop_progress(monkeypatch, stage):
    entered, release = threading.Event(), threading.Event()
    context = ContextVar("auth-test-request", default=None)
    loop_thread = threading.get_ident()
    user = {"id": "user-1", "username": "manager", "role": "manager", "active": True}
    claims = {"sub": user["id"], "email": "manager@example.test"}

    def block(result):
        assert threading.get_ident() != loop_thread
        assert context.get() == "request-context"
        entered.set()
        assert release.wait(2), (
            "The request event loop could not release the dependency"
        )
        return result

    monkeypatch.setattr(
        auth.jwt_validator,
        "verify_token",
        lambda token: block(claims) if stage == "jwt" else claims,
    )
    client = MagicMock()
    client.table.return_value.select.return_value.eq.return_value.single.return_value.execute.side_effect = (
        lambda: (
            block(SimpleNamespace(data=user))
            if stage == "profile"
            else SimpleNamespace(data=user)
        )
    )
    monkeypatch.setattr(auth, "supabase_admin", client)
    monkeypatch.setattr(
        auth,
        "_with_workspace",
        lambda profile, slug: block(profile) if stage == "workspace" else profile,
    )

    result = _assert_responsive(
        lambda: auth.login(auth.LoginRequest(access_token="test-token"), "", ""),
        entered,
        release,
        context,
    )
    assert result.access_token == "test-token"
    assert result.user["id"] == user["id"]


@pytest.mark.parametrize(
    "stage",
    [
        "tenant",
        "throttle",
        "lookup",
        "bcrypt",
        "upgrade",
        "mint",
        "success",
        "workspace",
    ],
)
def test_pin_login_workflow_allows_loop_progress(monkeypatch, stage):
    entered, release = threading.Event(), threading.Event()
    context = ContextVar("auth-test-request", default=None)
    loop_thread = threading.get_ident()
    user = {
        "id": "staff-1",
        "username": "staff",
        "role": "staff",
        "active": True,
        "pin_version": 1,
    }
    identity = {**user, "tenant": {"id": "tenant-1"}}

    def dependency(name, result):
        def invoke(*args, **kwargs):
            assert threading.get_ident() != loop_thread
            assert context.get() == "request-context"
            if name == stage:
                entered.set()
                assert release.wait(2), (
                    "The request event loop could not release the dependency"
                )
            return result

        return invoke

    query = MagicMock()
    query.select.return_value = query
    query.eq.return_value = query
    query.limit.return_value = query
    query.execute.side_effect = dependency(
        "tenant", SimpleNamespace(data=[{"id": "tenant-1", "slug": "mjcc"}])
    )
    monkeypatch.setattr(
        auth, "supabase_admin", SimpleNamespace(table=lambda name: query)
    )
    monkeypatch.setattr(
        auth, "current_state", dependency("throttle", {"locked": False})
    )

    # Keep the existing async patch interface used by the SSO and login tests.
    async def lookup(username, tenant_id):
        assert (username, tenant_id) == ("staff", "tenant-1")
        return dependency("lookup", user)()

    monkeypatch.setattr(auth, "_get_user_by_username", lookup)
    monkeypatch.setattr(
        auth, "verify_staff_pin", dependency("bcrypt", (True, "upgrade"))
    )
    monkeypatch.setattr(
        auth, "set_staff_pin", dependency("upgrade", {"pin_version": 2})
    )
    monkeypatch.setattr(
        auth, "mint_staff_session", dependency("mint", ("staff-token", {}))
    )
    monkeypatch.setattr(auth, "register_success", dependency("success", None))
    monkeypatch.setattr(auth, "_with_workspace", dependency("workspace", identity))

    result = _assert_responsive(
        lambda: auth.login(
            auth.LoginRequest(username=" Staff ", pin="1234"), "mjcc", "tenant-1"
        ),
        entered,
        release,
        context,
    )
    assert result.access_token == "staff-token"
    assert result.user["tenant"]["id"] == "tenant-1"


@pytest.mark.parametrize(
    "target",
    [
        "lunchvoice-start",
        "lunchvoice-exchange",
        "app-start",
        "app-exchange",
        "session-event",
    ],
)
def test_sso_and_session_io_allows_loop_progress(monkeypatch, target):
    entered, release = threading.Event(), threading.Event()
    context = ContextVar("auth-test-request", default=None)
    loop_thread = threading.get_ident()

    def blocked(*args, **kwargs):
        assert threading.get_ident() != loop_thread
        assert context.get() == "request-context"
        entered.set()
        assert release.wait(2), (
            "The request event loop could not release the dependency"
        )
        return SimpleNamespace(data=[])

    client = MagicMock()
    for method in (
        "table",
        "delete",
        "lt",
        "insert",
        "update",
        "eq",
        "is_",
        "gt",
        "select",
    ):
        getattr(client, method).return_value = client
    client.execute.side_effect = blocked
    monkeypatch.setattr(auth, "supabase_service", client)
    monkeypatch.setattr(auth, "_handoff_client", lambda: client)
    monkeypatch.setattr(auth, "_has_lioncafe_scope", lambda *args: True)
    monkeypatch.setattr(auth, "_has_app_scope", lambda *args: True)
    monkeypatch.setattr(auth, "_sso_secret", lambda: "test-secret")
    monkeypatch.setattr(auth, "_generic_sso_secret", lambda config: "test-secret")
    monkeypatch.setattr(auth, "_sso_callback", lambda: "https://example.test/sso")
    monkeypatch.setattr(
        auth, "_generic_sso_callback", lambda config: "https://example.test/sso"
    )
    monkeypatch.setattr(auth, "record_audit_event", blocked)
    response = SimpleNamespace(headers={})
    user = {"id": "user-1", "role": "manager"}
    calls = {
        "lunchvoice-start": lambda: auth.start_lunchvoice_sso(response, user),
        "lunchvoice-exchange": lambda: auth.exchange_lunchvoice_sso(
            auth.LunchvoiceSsoExchangeRequest(code="c" * 48), response, "test-secret"
        ),
        "app-start": lambda: auth.start_sso("marquee", response, user),
        "app-exchange": lambda: auth.exchange_sso(
            "marquee", auth.SsoExchangeRequest(code="c" * 48), response, "test-secret"
        ),
        "session-event": lambda: auth.session_event(
            auth.SessionEventBody(reason="logout"), "", ""
        ),
    }
    if target.endswith("exchange"):
        with pytest.raises(auth.HTTPException) as exc:
            _assert_responsive(calls[target], entered, release, context)
        assert exc.value.status_code == 401
    else:
        _assert_responsive(calls[target], entered, release, context)
    if target != "session-event":
        assert response.headers["Cache-Control"] == "no-store"
