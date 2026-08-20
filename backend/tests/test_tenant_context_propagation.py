"""Regression: tenant context must survive FastAPI's dependency machinery.

Production incident 2026-08-19: `_get_auth_user` was a *sync* generator
dependency that set a ContextVar via `tenant_scope`. FastAPI enters sync
context-manager dependencies through `contextmanager_in_threadpool`, so the
ContextVar was set in a worker thread's context and was invisible to the route
handler. Every tenant-scoped endpoint raised

    TenantContextError: Tenant context required before accessing <table>

and teardown then raised

    ValueError: <Token ...> was created in a different Context

Because FastAPI omits CORS headers on unhandled exceptions, the browser
reported this as a CORS failure, which sent the first investigation the wrong
way. These tests assert the binding is visible where the endpoint actually
runs, for both sync and async endpoints.
"""

import pytest
from fastapi import Depends, FastAPI, Request
from fastapi.testclient import TestClient

from backend.routes import _deps
from backend.tenancy import TenantContext, current_tenant


@pytest.fixture
def shadow_mode(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "shadow")


@pytest.fixture
def stub_identity(monkeypatch):
    """Stub the blocking Supabase lookups with the shape production returns."""
    context = TenantContext(
        id="6a40b9fd-73fa-4d80-9110-fed6c3d5468e",
        slug="mjcc",
        name="Miami Job Corps Center",
        user_id="d3d7cf98-4f34-4a71-9ded-e343701c026b",
        role="sudo",
    )
    monkeypatch.setattr(
        _deps,
        "_profile_for_token",
        lambda _auth: {"id": context.user_id, "role": "sudo", "active": True},
    )
    monkeypatch.setattr(
        _deps,
        "resolve_user_tenant",
        lambda _client, _uid, _slug: (context, [{"slug": "mjcc", "is_default": True}]),
    )
    return context


def _client(endpoint_is_async: bool) -> TestClient:
    app = FastAPI()

    if endpoint_is_async:

        @app.get("/probe")
        async def probe(
            request: Request, auth_user: dict = Depends(_deps._get_auth_user)
        ):
            bound = current_tenant()
            return {
                "tenant": None if bound is None else bound.slug,
                "tenant_id": getattr(request.state, "tenant_id", None),
            }

    else:

        @app.get("/probe")
        def probe(request: Request, auth_user: dict = Depends(_deps._get_auth_user)):
            bound = current_tenant()
            return {
                "tenant": None if bound is None else bound.slug,
                "tenant_id": getattr(request.state, "tenant_id", None),
            }

    return TestClient(app)


@pytest.mark.parametrize("is_async", [True, False])
def test_tenant_context_is_visible_inside_the_endpoint(
    shadow_mode, stub_identity, is_async
):
    response = _client(is_async).get("/probe", headers={"Authorization": "Bearer x"})
    assert response.status_code == 200, response.text
    # The regression produced a 500 here, not a missing value.
    assert response.json()["tenant"] == "mjcc"
    assert response.json()["tenant_id"] == stub_identity.id


def test_repeated_requests_do_not_leak_or_fail_teardown(shadow_mode, stub_identity):
    client = _client(True)
    for _ in range(5):
        response = client.get("/probe", headers={"Authorization": "Bearer x"})
        assert response.status_code == 200, response.text
        assert response.json()["tenant"] == "mjcc"
    # After teardown the binding must be cleared, not left dangling.
    assert current_tenant() is None


def test_context_is_cleared_after_the_request(shadow_mode, stub_identity):
    client = _client(False)
    assert (
        client.get("/probe", headers={"Authorization": "Bearer x"}).status_code == 200
    )
    assert current_tenant() is None


def test_immutable_tenant_header_must_match_resolved_membership(
    shadow_mode, stub_identity
):
    response = _client(True).get(
        "/probe",
        headers={
            "Authorization": "Bearer x",
            "X-Kpn-Workspace": "mjcc",
            "X-Kpn-Tenant-Id": "tenant-other",
        },
    )
    assert response.status_code == 403
    assert response.json()["detail"] == "Immutable tenant context mismatch"
    assert current_tenant() is None


def test_legacy_mode_binds_no_tenant(monkeypatch, stub_identity):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "legacy")
    response = _client(True).get("/probe", headers={"Authorization": "Bearer x"})
    assert response.status_code == 200, response.text
    assert response.json()["tenant"] is None


def test_dependencies_are_async_generators():
    """Guard the fix itself: reverting these to sync reintroduces the incident."""
    import inspect

    assert inspect.isasyncgenfunction(_deps._get_auth_user)
    assert inspect.isasyncgenfunction(_deps._get_public_tenant)
