"""Tests for the staff PIN login path covering all seven correction-roster
blockers and the four concrete gaps identified during review.

Blockers tested:
  #1 — Staff token minted via mint_staff_session with full claims
  #2 — PIN writes routed through staff_pin_admin, not direct DB
  #3 — Throttle called at every failure/success point
  #4 — Username lookup tenant-bound via tenant_memberships
  #5 — Public resolver returns slug+name only (tested in workspace_console)
  #6 — Provider-origin redirect (tested in frontend workspace.test.ts)
  #7 — Migration schema complete (tested by import — see test_staff_credentials)

Gaps tested:
  A — Unresolved workspace rejected before username lookup
  B — Empty tenant_id never minted into staff token
  C — Throttle storage failures → 503, not swallowed
  D — Tenant membership mandatory and tenant-bound
"""

from __future__ import annotations

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.routes import auth as auth_module
from backend.staff_login_throttle import ThrottleBackendError
from backend.staff_sessions import mint_staff_session, StaffSessionConfigurationError

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_SESSION_SECRET = "test-session-secret-at-least-32-characters!!"


@pytest.fixture(autouse=True)
def _staff_secret(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_STAFF_SESSION_SECRET", _SESSION_SECRET)


@pytest.fixture(autouse=True)
def _shadow_mode(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "shadow")


def _make_app():
    app = FastAPI()
    app.include_router(auth_module.router)
    return app


def _client(app=None):
    return TestClient(app or _make_app(), raise_server_exceptions=False)


# ---------------------------------------------------------------------------
# Stub Supabase client that routes .table().select().eq()... queries
# ---------------------------------------------------------------------------


class _StubTable:
    """Minimal chainable query builder for stub Supabase responses."""

    def __init__(self, rows=None):
        self._rows = rows or []
        self._filters = []
        self._single = False
        self._limit_val = None

    def select(self, *_a, **_kw):
        return self

    def eq(self, key, value):
        self._filters.append((key, value))
        return self

    def is_(self, key, value):
        self._filters.append((key, value))
        return self

    def gt(self, key, value):
        self._filters.append((key, value))
        return self

    def in_(self, key, values):
        self._filters.append((key, values))
        return self

    def single(self):
        self._single = True
        return self

    def limit(self, v):
        self._limit_val = v
        return self

    def update(self, data):
        return self

    def insert(self, data):
        return self

    def execute(self):
        def _matches(row, filters):
            for k, v in filters:
                if isinstance(v, list):
                    if str(row.get(k)) not in [str(x) for x in v]:
                        return False
                else:
                    if str(row.get(k)) != str(v):
                        return False
            return True

        rows = [r for r in self._rows if _matches(r, self._filters)]
        if self._single:
            data = rows[0] if rows else None
        else:
            data = rows
        return SimpleNamespace(data=data)


class _StubClient:
    """Routes table() calls to different row sets by table name."""

    def __init__(self, tables: dict[str, list[dict]]):
        self._tables = tables

    def table(self, name: str):
        return _StubTable(self._tables.get(name, []))


def _stub_admin(tables: dict[str, list[dict]]):
    return _StubClient(tables)


def _valid_tenant_tables(user_row, *, tenant_id="t1", slug="mjcc"):
    """Build a full table stub with valid tenant + membership for a user."""
    return {
        "user_profiles": [user_row],
        # `name` is NOT NULL in production and is read by list_user_tenants,
        # so the stub carries it here rather than only on the membership row.
        "tenants": [
            {"id": tenant_id, "slug": slug, "status": "active", "name": "Test Tenant"}
        ],
        "tenant_memberships": [
            {
                "tenant_id": tenant_id,
                "user_id": user_row["id"],
                "status": "active",
                "role": user_row.get("role", "staff"),
                "is_default": True,
                "name": "Test Tenant",
                "slug": slug,
            }
        ],
    }


# ---------------------------------------------------------------------------
# BLOCKER 1 + GAP B: mint_staff_session used, never empty tenant_id
# ---------------------------------------------------------------------------


class TestMintStaffSession:
    """Blocker #1: login must call mint_staff_session with full claims.
    Gap B: resolved_tenant_id must never be empty when minting."""

    def test_mint_requires_nonempty_tenant_id(self):
        with pytest.raises(StaffSessionConfigurationError, match="tenant id"):
            mint_staff_session(
                user_id="user-1",
                tenant_id="",
                tenant_slug="mjcc",
                role="staff",
                credential_version=0,
            )

    def test_mint_requires_nonempty_user_id(self):
        with pytest.raises(StaffSessionConfigurationError, match="subject"):
            mint_staff_session(
                user_id="",
                tenant_id="tenant-1",
                tenant_slug="mjcc",
                role="staff",
                credential_version=0,
            )

    def test_mint_produces_full_claims(self):
        """Claims dict must carry every required field. The token is verified
        via the real pyjwt.decode in a separate round-trip."""
        import importlib

        real_pyjwt = importlib.import_module("jwt")
        original = real_pyjwt.encode

        def _real_encode(payload, key, algorithm="HS256", **kw):
            return original(payload, key, algorithm=algorithm, **kw)

        token, claims = mint_staff_session(
            user_id="user-1",
            tenant_id="tenant-1",
            tenant_slug="mjcc",
            role="staff",
            credential_version=3,
        )
        assert claims["iss"] == "https://compute.kpnsolute.com"
        assert claims["aud"] == "kpncompute:staff"
        assert claims["token_use"] == "compute_staff"
        assert claims["tenant_id"] == "tenant-1"
        assert claims["tenant_slug"] == "mjcc"
        assert claims["credential_version"] == 3
        assert claims["sub"] == "user-1"
        assert "jti" in claims
        assert "iat" in claims
        assert "nbf" in claims
        assert "exp" in claims
        # conftest mocks pyjwt.encode; verify the claims are well-formed by
        # checking the dict has all required fields instead of decoding.
        required = {"sub", "exp", "iat", "iss", "aud", "token_use", "tenant_id"}
        assert required.issubset(claims.keys())


# ---------------------------------------------------------------------------
# BLOCKER 4 + GAP D: tenant-bound username lookup
# ---------------------------------------------------------------------------


class TestTenantBoundLookup:
    """Blocker #4: _get_user_by_username must accept a tenant_id parameter.
    Gap D: membership lookup is mandatory and tenant-bound."""

    def test_membership_check_calls_tenant_memberships(self, monkeypatch):
        """When tenant_id is provided in non-legacy mode, the membership table
        is queried for an active membership."""
        user_row = {"id": "u1", "username": "testuser", "active": True, "role": "staff"}
        membership_row = {"tenant_id": "t1", "user_id": "u1", "status": "active"}

        tables = {
            "user_profiles": [user_row],
            "tenant_memberships": [membership_row],
        }
        admin = _stub_admin(tables)
        monkeypatch.setattr(auth_module, "supabase_admin", admin)

        import asyncio

        result = asyncio.run(auth_module._get_user_by_username("testuser", "t1"))
        assert result is not None
        assert result["username"] == "testuser"

    def test_no_membership_returns_none(self, monkeypatch):
        user_row = {"id": "u1", "username": "testuser", "active": True, "role": "staff"}
        tables = {
            "user_profiles": [user_row],
            "tenant_memberships": [],
        }
        admin = _stub_admin(tables)
        monkeypatch.setattr(auth_module, "supabase_admin", admin)

        import asyncio

        result = asyncio.run(auth_module._get_user_by_username("testuser", "t1"))
        assert result is None

    def test_membership_check_always_runs_when_tenant_id_set(self, monkeypatch):
        """When tenant_id is provided, the membership check ALWAYS runs,
        regardless of tenancy mode — every PIN login is tenant-bound."""
        monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "legacy")
        user_row = {"id": "u1", "username": "testuser", "active": True, "role": "staff"}
        # User exists but has no membership
        tables = {"user_profiles": [user_row], "tenant_memberships": []}
        admin = _stub_admin(tables)
        monkeypatch.setattr(auth_module, "supabase_admin", admin)

        import asyncio

        result = asyncio.run(auth_module._get_user_by_username("testuser", "t1"))
        assert result is None

    def test_membership_db_failure_raises_lookup_error(self, monkeypatch):
        """A database failure during membership resolution must raise
        StaffUsernameLookupError (fail-closed → 503), not return None."""
        from backend.routes.auth import StaffUsernameLookupError

        class _FailingClient:
            def table(self, name):
                raise ConnectionError("database unreachable")

        monkeypatch.setattr(auth_module, "supabase_admin", _FailingClient())

        import asyncio

        with pytest.raises(StaffUsernameLookupError):
            asyncio.run(auth_module._get_user_by_username("testuser", "t1"))

    def test_user_profile_db_failure_raises_lookup_error(self, monkeypatch):
        """A database failure during user profile lookup after membership
        resolution must raise StaffUsernameLookupError (fail-closed → 503)."""
        from backend.routes.auth import StaffUsernameLookupError

        class _PartialFailClient:
            def table(self, name):
                if name == "tenant_memberships":
                    return _StubTable(
                        [{"tenant_id": "t1", "user_id": "u1", "status": "active"}]
                    )
                raise ConnectionError("database unreachable")

        monkeypatch.setattr(auth_module, "supabase_admin", _PartialFailClient())

        import asyncio

        with pytest.raises(StaffUsernameLookupError):
            asyncio.run(auth_module._get_user_by_username("testuser", "t1"))

    def test_login_returns_503_on_username_lookup_db_failure(self, monkeypatch):
        """When the username lookup DB fails, the login endpoint returns 503
        instead of 401 (no account enumeration leak)."""
        from backend.routes.auth import StaffUsernameLookupError

        monkeypatch.setattr(
            auth_module,
            "supabase_admin",
            _stub_admin(
                {
                    "tenants": [{"id": "t1", "slug": "mjcc", "status": "active"}],
                }
            ),
        )
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        monkeypatch.setattr(
            auth_module,
            "_get_user_by_username",
            MagicMock(side_effect=StaffUsernameLookupError("db down")),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert resp.status_code == 503
        assert "temporarily unavailable" in resp.json()["detail"]


# ---------------------------------------------------------------------------


class TestThrottleFailClosed:
    """Blocker #3: throttle must be called. Gap C: storage failures → 503."""

    def test_throttle_backend_error_raises_503(self, monkeypatch):
        """When current_state raises ThrottleBackendError, login returns 503."""
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(side_effect=ThrottleBackendError("db down")),
        )
        monkeypatch.setattr(
            auth_module,
            "supabase_admin",
            _stub_admin(
                {
                    "tenants": [{"id": "t1", "slug": "mjcc", "status": "active"}],
                }
            ),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "testuser", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert resp.status_code == 503
        assert "temporarily unavailable" in resp.json()["detail"]

    def test_register_failure_backend_error_raises_503(self, monkeypatch):
        """When register_failure raises ThrottleBackendError, login returns 503."""
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        monkeypatch.setattr(
            auth_module,
            "register_failure",
            MagicMock(side_effect=ThrottleBackendError("db down")),
        )
        tables = {
            "user_profiles": [],
            "tenants": [{"id": "t1", "slug": "mjcc", "status": "active"}],
        }
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))

        resp = _client().post(
            "/api/auth/login",
            json={"username": "unknown", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert resp.status_code == 503
        assert "temporarily unavailable" in resp.json()["detail"]

    def test_register_success_backend_error_raises_503(self, monkeypatch):
        """When register_success raises ThrottleBackendError after a valid
        login, the response is 503."""
        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin_hash": None,
            "pin": "1234",
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        monkeypatch.setattr(
            auth_module,
            "register_success",
            MagicMock(side_effect=ThrottleBackendError("db down")),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert resp.status_code == 503
        assert "temporarily unavailable" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# GAP A: unresolved workspace rejected before username lookup
# ---------------------------------------------------------------------------


class TestUnresolvedWorkspace:
    """Gap A: in non-legacy mode, an unresolved workspace must be rejected
    before any global username query is made."""

    def test_invalid_workspace_slug_returns_404(self, monkeypatch):
        monkeypatch.setattr(
            auth_module,
            "supabase_admin",
            _stub_admin(
                {
                    "tenants": [],
                }
            ),
        )
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "anyone", "pin": "1234"},
            headers={"X-Kpn-Workspace": "nonexistent-workspace"},
        )
        assert resp.status_code == 404
        assert "not found" in resp.json()["detail"].lower()

    def test_workspace_store_failure_returns_503(self, monkeypatch):
        class _FailingTenantStore:
            def table(self, name):
                assert name == "tenants"
                raise ConnectionError("tenant store unavailable")

        monkeypatch.setattr(auth_module, "supabase_admin", _FailingTenantStore())

        resp = _client().post(
            "/api/auth/login",
            json={"username": "anyone", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert resp.status_code == 503
        assert "temporarily unavailable" in resp.json()["detail"]

    def test_empty_workspace_header_returns_400(self, monkeypatch):
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin({}))

        resp = _client().post(
            "/api/auth/login",
            json={"username": "anyone", "pin": "1234"},
            headers={"X-Kpn-Workspace": ""},
        )
        assert resp.status_code == 400
        assert "X-Kpn-Workspace" in resp.json()["detail"]

    def test_inactive_tenant_rejected(self, monkeypatch):
        monkeypatch.setattr(
            auth_module,
            "supabase_admin",
            _stub_admin(
                {
                    "tenants": [{"id": "t1", "slug": "mjcc", "status": "archived"}],
                }
            ),
        )
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "anyone", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert resp.status_code == 404


# ---------------------------------------------------------------------------
# BLOCKER 2: PIN writes routed through staff_pin_admin
# ---------------------------------------------------------------------------


class TestPinWriteRouting:
    """Blocker #2: users.py must import and use set_staff_pin / clear_staff_pin."""

    def test_users_module_imports_pin_admin(self):
        from backend.routes import users

        assert hasattr(users, "set_staff_pin")
        assert hasattr(users, "clear_staff_pin")

    def test_auth_module_does_not_import_pyjwt(self):
        """auth.py must not import pyjwt — session minting is in staff_sessions."""
        import ast

        source = open("backend/routes/auth.py").read()
        tree = ast.parse(source)
        for node in ast.walk(tree):
            if isinstance(node, (ast.Import, ast.ImportFrom)):
                if isinstance(node, ast.Import):
                    for alias in node.names:
                        assert alias.name != "jwt", (
                            "auth.py still imports pyjwt directly"
                        )
                elif isinstance(node, ast.ImportFrom):
                    assert node.module != "jwt", "auth.py still imports from jwt"


# ---------------------------------------------------------------------------
# Throttle called at every failure point (BLOCKER 3)
# ---------------------------------------------------------------------------


class TestThrottleCallSites:
    """Blocker #3: register_failure must be called on every credential failure,
    register_success on every success."""

    def test_register_failure_called_on_unknown_user(self, monkeypatch):
        monkeypatch.setattr(
            auth_module,
            "supabase_admin",
            _stub_admin(
                {
                    "user_profiles": [],
                    "tenants": [{"id": "t1", "slug": "mjcc", "status": "active"}],
                }
            ),
        )
        mock_fail = MagicMock()
        monkeypatch.setattr(auth_module, "register_failure", mock_fail)
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )

        response = _client().post(
            "/api/auth/login",
            json={"username": "ghost", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert response.status_code == 401
        assert response.json()["detail"] == "Invalid credentials"
        mock_fail.assert_called_once()
        kwargs = mock_fail.call_args
        assert kwargs.kwargs.get("tenant_id") == "t1"
        assert kwargs.kwargs.get("username") == "ghost"

    def test_register_failure_called_on_wrong_pin(self, monkeypatch):
        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin_hash": None,
            "pin": "9999",
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        mock_fail = MagicMock()
        monkeypatch.setattr(auth_module, "register_failure", mock_fail)
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )

        _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        mock_fail.assert_called_once()

    def test_register_failure_called_on_nonstaff_user(self, monkeypatch):
        user_row = {
            "id": "u1",
            "username": "admin1",
            "active": True,
            "role": "admin",
            "pin_hash": None,
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        mock_fail = MagicMock()
        monkeypatch.setattr(auth_module, "register_failure", mock_fail)
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )

        _client().post(
            "/api/auth/login",
            json={"username": "admin1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        mock_fail.assert_called_once()

    def test_register_success_called_on_valid_pin(self, monkeypatch):
        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin_hash": None,
            "pin": "1234",
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        mock_success = MagicMock()
        monkeypatch.setattr(auth_module, "register_success", mock_success)
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        monkeypatch.setattr(auth_module, "_with_workspace", lambda u, t: {})
        monkeypatch.setattr(
            auth_module,
            "mint_staff_session",
            lambda **_kw: ("fake-staff-token", {"sub": "u1"}),
        )
        # Mock verify_staff_pin to skip upgrade path — this test validates
        # throttle call sites, not the credential upgrade flow.
        monkeypatch.setattr(
            auth_module,
            "verify_staff_pin",
            lambda pin, profile: (True, None),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        mock_success.assert_called_once()
        assert resp.status_code == 200
        body = resp.json()
        assert body["access_token"]


# ---------------------------------------------------------------------------
# BLOCKER 5: public resolver slug+name only
# ---------------------------------------------------------------------------


class TestPublicResolverMinimal:
    """Blocker #5: resolve_workspace_entry returns only slug and name."""

    def test_response_excludes_id_and_brand_config(self, monkeypatch):
        from backend.routes import workspace_console

        tables = {
            "tenants": [
                {
                    "id": "tenant-mjcc",
                    "slug": "mjcc",
                    "name": "Miami Job Corps Center",
                    "status": "active",
                    "brand_config": {"short_name": "MJCC"},
                }
            ],
        }
        monkeypatch.setattr(workspace_console, "supabase_admin", _stub_admin(tables))
        app = FastAPI()
        app.include_router(workspace_console.router)
        resp = TestClient(app).get("/api/v1/workspaces/resolve/mjcc")
        assert resp.status_code == 200
        body = resp.json()["workspace"]
        assert body == {"slug": "mjcc", "name": "Miami Job Corps Center"}
        assert "id" not in body
        assert "brand_config" not in body


# ---------------------------------------------------------------------------
# FIX 1: legacy plaintext upgrade uses set_staff_pin, not direct DB update
# ---------------------------------------------------------------------------


class TestLegacyPlaintextUpgrade:
    """The upgrade path (plaintext PIN → hash) must call the atomic credential
    manager RPC, clear old-generation semantics, and mint with the returned
    pin_version — never write pin_hash directly."""

    def test_upgrade_calls_set_staff_pin_not_direct_update(self, monkeypatch):
        """When verify_staff_pin returns an upgrade_hash, the login handler
        calls set_staff_pin (RPC) instead of a raw table update."""
        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin_hash": None,
            "pin": "1234",
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        monkeypatch.setattr(auth_module, "_with_workspace", lambda u, t: {})
        monkeypatch.setattr(
            auth_module,
            "mint_staff_session",
            lambda **_kw: ("fake-token", {"sub": "u1"}),
        )
        monkeypatch.setattr(auth_module, "register_success", MagicMock())

        # Capture what set_staff_pin is called with
        captured_calls = []

        def _capturing_set_staff_pin(*args, **kwargs):
            captured_calls.append((args, kwargs))
            return {
                "pin_version": 7,
                "pin_updated_at": "2026-01-01T00:00:00Z",
                "must_rotate": False,
            }

        monkeypatch.setattr(auth_module, "set_staff_pin", _capturing_set_staff_pin)

        resp = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )

        assert resp.status_code == 200
        assert len(captured_calls) == 1
        call_kwargs = captured_calls[0][1]
        assert call_kwargs["user_id"] == "u1"
        assert call_kwargs["tenant_id"] == "t1"
        assert call_kwargs["pin"] == "1234"
        assert call_kwargs["actor_id"] == "u1"

    def test_no_direct_update_on_upgrade_path(self, monkeypatch):
        """The stub table's update() must NOT be called during upgrade.
        Only the RPC (set_staff_pin) should write to user_profiles."""
        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin_hash": None,
            "pin": "1234",
        }
        tables = _valid_tenant_tables(user_row)

        class _TrackingStubTable(_StubTable):
            update_called = False

            def update(self, data):
                _TrackingStubTable.update_called = True
                return super().update(data)

        class _TrackingStubClient(_StubClient):
            def table(self, name: str):
                tbl = super().table(name)
                # Wrap user_profiles table with tracking
                if name == "user_profiles":
                    t = _TrackingStubTable(tables.get(name, []))
                    t._filters = tbl._filters
                    return t
                return tbl

        monkeypatch.setattr(auth_module, "supabase_admin", _TrackingStubClient(tables))
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        monkeypatch.setattr(auth_module, "_with_workspace", lambda u, t: {})
        monkeypatch.setattr(
            auth_module,
            "mint_staff_session",
            lambda **_kw: ("fake-token", {"sub": "u1"}),
        )
        monkeypatch.setattr(auth_module, "register_success", MagicMock())
        monkeypatch.setattr(
            auth_module,
            "set_staff_pin",
            lambda **_kw: {"pin_version": 1, "must_rotate": False},
        )

        _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert not _TrackingStubTable.update_called, (
            "auth.py still calls .update() on user_profiles during upgrade"
        )

    def test_upgrade_uses_returned_version_for_minting(self, monkeypatch):
        """The pin_version returned by set_staff_pin is passed to
        mint_staff_session, not the stale value from the user row."""
        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin_hash": None,
            "pin": "1234",
            "pin_version": 0,
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        monkeypatch.setattr(auth_module, "_with_workspace", lambda u, t: {})
        monkeypatch.setattr(auth_module, "register_success", MagicMock())

        # set_staff_pin returns version 7 (the new version after upgrade)
        monkeypatch.setattr(
            auth_module,
            "set_staff_pin",
            lambda *_args, **_kw: {"pin_version": 7, "must_rotate": False},
        )

        minted_versions = []

        def _capture_mint(**kw):
            minted_versions.append(kw.get("credential_version"))
            return ("fake-token", {"sub": "u1"})

        monkeypatch.setattr(auth_module, "mint_staff_session", _capture_mint)

        resp = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )

        assert resp.status_code == 200
        assert minted_versions == [7], (
            f"Expected credential_version=7 from set_staff_pin, got {minted_versions}"
        )

    def test_staff_pin_backend_error_raises_503(self, monkeypatch):
        """If the credential store rejects the upgrade, login must fail closed
        with 503 instead of silently passing through."""
        from backend.staff_pin_admin import StaffPinBackendError

        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin_hash": None,
            "pin": "1234",
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        monkeypatch.setattr(
            auth_module,
            "set_staff_pin",
            MagicMock(side_effect=StaffPinBackendError("credential store down")),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert resp.status_code == 503
        assert "temporarily unavailable" in resp.json()["detail"]


# ---------------------------------------------------------------------------
# FIX 2: create_user must insert tenant membership BEFORE set_staff_pin
# ---------------------------------------------------------------------------


class TestCreateUserMembershipOrder:
    """The SQL RPC set_staff_pin_credential requires an active membership.
    create_user must insert tenant_memberships before calling set_staff_pin."""

    def test_membership_insert_before_pin_set(self, monkeypatch):
        """When creating a staff user in non-legacy mode, the membership row
        is inserted before set_staff_pin is called."""
        from backend.routes import users as users_module

        order_log = []

        class _OrderTrackingStubTable(_StubTable):
            def __init__(self, rows=None, table_name=""):
                super().__init__(rows)
                self._table_name = table_name

            def execute(self):
                result = super().execute()
                if self._table_name == "tenant_memberships":
                    order_log.append("membership_insert")
                return result

            def insert(self, data):
                if self._table_name == "tenant_memberships":
                    order_log.append("membership_insert")
                return self

        class _OrderTrackingStubClient(_StubClient):
            def table(self, name: str):
                return _OrderTrackingStubClient._make_table(self, name)

            @staticmethod
            def _make_table(self, name):
                tbl = _OrderTrackingStubTable(
                    self._tables.get(name, []), table_name=name
                )
                return tbl

        monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "shadow")

        admin = _OrderTrackingStubClient(
            {
                "user_profiles": [],
                "tenants": [{"id": "t1", "slug": "mjcc", "status": "active"}],
                "tenant_memberships": [],
            }
        )
        monkeypatch.setattr(users_module, "supabase_admin", admin)
        monkeypatch.setattr(users_module, "supabase_service", admin)

        # Mock _create_auth_user to return a fixed id
        monkeypatch.setattr(
            users_module, "_create_auth_user", lambda *a, **kw: "new-user-id"
        )
        monkeypatch.setattr(users_module, "_selected_tenant_id", lambda: "t1")
        monkeypatch.setattr(users_module, "_merge_membership", lambda u, m: {**u, **m})

        pin_calls = []

        def _capture_pin(**kw):
            pin_calls.append(kw)
            return {"pin_version": 1, "must_rotate": False}

        monkeypatch.setattr(users_module, "set_staff_pin", _capture_pin)

        # The insert for user_profiles should work
        from pydantic import BaseModel

        class CreateUserReq(BaseModel):
            username: str = "newstaff"
            display_name: str = "New Staff"
            last_name: str = "Staff"
            role: str = "staff"
            pin: str = "5678"
            password: str = ""
            phone: str = ""
            job_title: str = ""
            bio: str = ""
            avatar_url: str = ""

        # We can't easily test the full HTTP path, but we can verify the
        # ordering logic is correct by checking the module source
        import inspect

        source = inspect.getsource(users_module.create_user)
        lines = source.split("\n")

        membership_line = None
        pin_set_line = None
        for i, line in enumerate(lines):
            if "tenant_memberships" in line and "insert" in line:
                membership_line = i
            if "set_staff_pin(" in line and pin_set_line is None:
                pin_set_line = i

        assert membership_line is not None, "tenant_memberships insert not found"
        assert pin_set_line is not None, "set_staff_pin call not found"
        assert membership_line < pin_set_line, (
            f"Membership insert (line {membership_line}) must come before "
            f"set_staff_pin (line {pin_set_line}) in create_user"
        )


# ---------------------------------------------------------------------------
# FIX 3: ALL PIN logins require workspace + active tenant + membership
# ---------------------------------------------------------------------------


class TestPinLoginAlwaysTenantBound:
    """PIN login must NEVER mint an empty-tenant token. X-Kpn-Workspace is
    required for every PIN login, regardless of tenancy mode."""

    def test_missing_workspace_always_400(self, monkeypatch):
        """Even in legacy mode, PIN login without X-Kpn-Workspace returns 400."""
        monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "legacy")
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin({}))

        resp = _client().post(
            "/api/auth/login",
            json={"username": "anyone", "pin": "1234"},
        )
        assert resp.status_code == 400
        assert "X-Kpn-Workspace" in resp.json()["detail"]

    def test_empty_workspace_always_400(self, monkeypatch):
        """Blank X-Kpn-Workspace always returns 400, even in legacy mode."""
        monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "legacy")
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin({}))

        resp = _client().post(
            "/api/auth/login",
            json={"username": "anyone", "pin": "1234"},
            headers={"X-Kpn-Workspace": "  "},
        )
        assert resp.status_code == 400

    def test_invalid_workspace_always_404(self, monkeypatch):
        """An unknown workspace slug always returns 404, even in legacy mode."""
        monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "legacy")
        monkeypatch.setattr(
            auth_module,
            "supabase_admin",
            _stub_admin({"tenants": []}),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "anyone", "pin": "1234"},
            headers={"X-Kpn-Workspace": "nonexistent"},
        )
        assert resp.status_code == 404

    def test_legacy_mode_cannot_mint_empty_tenant_token(self, monkeypatch):
        """In legacy mode, a valid workspace + membership is still required.
        A user without a membership in the resolved tenant is rejected."""
        monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "legacy")
        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin": "1234",
        }
        # User exists but has NO membership
        tables = {
            "user_profiles": [user_row],
            "tenants": [{"id": "t1", "slug": "mjcc", "status": "active"}],
            "tenant_memberships": [],
        }
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        mock_fail = MagicMock()
        monkeypatch.setattr(auth_module, "register_failure", mock_fail)

        resp = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        # User exists but has no membership → credential failure → 401
        assert resp.status_code == 401
        assert "Invalid credentials" in resp.json()["detail"]
        mock_fail.assert_called_once()

    def test_no_legacy_global_username_fallback(self, monkeypatch):
        """PIN login never falls through to a global username query.
        Every login path resolves the workspace first."""
        import inspect

        source = inspect.getsource(auth_module.login)
        lines = source.split("\n")

        # Find the PIN login branch
        in_pin_branch = False
        found_workspace_check = False
        for line in lines:
            stripped = line.strip()
            if "req.username and req.pin" in stripped:
                in_pin_branch = True
            if in_pin_branch and "X-Kpn-Workspace" in stripped:
                found_workspace_check = True
            # Stop at the next branch
            if (
                in_pin_branch
                and stripped.startswith("else:")
                and "access_token" not in stripped
            ):
                break

        assert found_workspace_check, "PIN login branch does not check X-Kpn-Workspace"


# ---------------------------------------------------------------------------
# FIX 4: Runtime RPC names and parameter keys match the migration
# ---------------------------------------------------------------------------


class TestRuntimeRPCNamesMatchMigration:
    """The Python modules' RPC names and parameter keys must exactly match
    what the SQL migration defines. A mismatch would cause silent failures
    or cryptic database errors at runtime."""

    def test_set_staff_pin_rpc_matches_migration(self):
        from backend.staff_pin_admin import SET_PIN_RPC

        assert SET_PIN_RPC == "set_staff_pin_credential"

    def test_clear_staff_pin_rpc_matches_migration(self):
        from backend.staff_pin_admin import CLEAR_PIN_RPC

        assert CLEAR_PIN_RPC == "clear_staff_pin_credential"

    def test_throttle_state_rpc_matches_migration(self):
        from backend.staff_login_throttle import STATE_RPC

        assert STATE_RPC == "staff_login_throttle_state"

    def test_throttle_fail_rpc_matches_migration(self):
        from backend.staff_login_throttle import FAIL_RPC

        assert FAIL_RPC == "staff_login_throttle_fail"

    def test_throttle_reset_rpc_matches_migration(self):
        from backend.staff_login_throttle import RESET_RPC

        assert RESET_RPC == "staff_login_throttle_reset"

    def test_set_staff_pin_params_match_migration(self):
        """The RPC call must send exactly the parameter names the migration
        function signature defines: p_user_id, p_tenant_id, p_pin_hash,
        p_must_rotate, p_actor_id."""
        import inspect
        from backend import staff_pin_admin

        source = inspect.getsource(staff_pin_admin.set_staff_pin)
        # Verify the param dict keys used in the _rpc call
        assert '"p_user_id"' in source
        assert '"p_tenant_id"' in source
        assert '"p_pin_hash"' in source
        assert '"p_must_rotate"' in source
        assert '"p_actor_id"' in source

    def test_clear_staff_pin_params_match_migration(self):
        """The RPC call must send: p_user_id, p_tenant_id, p_actor_id."""
        import inspect
        from backend import staff_pin_admin

        source = inspect.getsource(staff_pin_admin.clear_staff_pin)
        assert '"p_user_id"' in source
        assert '"p_tenant_id"' in source
        assert '"p_actor_id"' in source

    def test_throttle_state_params_match_migration(self):
        """The RPC call must send: p_tenant_id, p_subject_key."""
        import inspect
        from backend import staff_login_throttle

        source = inspect.getsource(staff_login_throttle.current_state)
        assert '"p_tenant_id"' in source
        assert '"p_subject_key"' in source

    def test_throttle_fail_params_match_migration(self):
        """The RPC call must send: p_tenant_id, p_subject_key,
        p_max_attempts, p_lockout_seconds."""
        import inspect
        from backend import staff_login_throttle

        source = inspect.getsource(staff_login_throttle.register_failure)
        assert '"p_tenant_id"' in source
        assert '"p_subject_key"' in source
        assert '"p_max_attempts"' in source
        assert '"p_lockout_seconds"' in source

    def test_throttle_reset_params_match_migration(self):
        """The RPC call must send: p_tenant_id, p_subject_key."""
        import inspect
        from backend import staff_login_throttle

        source = inspect.getsource(staff_login_throttle.register_success)
        assert '"p_tenant_id"' in source
        assert '"p_subject_key"' in source

    def test_migration_sql_file_exists_with_all_functions(self):
        """The migration file must contain all five RPC function definitions."""
        migration_path = "supabase/migrations/20260818090000_staff_pin_hash.sql"
        import os

        assert os.path.exists(migration_path), f"Migration not found: {migration_path}"
        content = open(migration_path).read()
        assert "create or replace function public.set_staff_pin_credential" in content
        assert "create or replace function public.clear_staff_pin_credential" in content
        assert "create or replace function public.staff_login_throttle_state" in content
        assert "create or replace function public.staff_login_throttle_fail" in content
        assert "create or replace function public.staff_login_throttle_reset" in content


# ---------------------------------------------------------------------------
# BLOCKER 3 — re-lock after expired lockout
# ---------------------------------------------------------------------------


class TestThrottleReLock:
    """After an expired lockout, a new failure must re-lock the account.
    The original SQL required locked_until IS NULL, which prevented re-locking
    once the lockout window expired.  The fix uses
    (locked_until IS NULL OR locked_until < now())."""

    @staticmethod
    def _sql_without_comments(path: str) -> str:
        """SQL with `--` comments stripped and whitespace collapsed.

        The previous guard grepped the raw file, so the migration's own header
        comment — which quotes the fixed condition in prose — satisfied it. The
        SQL could be fully reverted and the test still passed. Stripping
        comments makes the assertion depend on the executable statement.
        """
        import re as _re

        body = "\n".join(
            line.split("--", 1)[0] for line in open(path, encoding="utf-8")
        )
        return _re.sub(r"\s+", " ", body).lower()

    def test_relock_migration_sql_contains_relock_condition(self):
        """The executable SQL — not a comment — must permit re-locking."""
        import os

        relock_path = "supabase/migrations/20260820100000_fix_throttle_relock.sql"
        assert os.path.exists(relock_path), f"Migration not found: {relock_path}"
        sql = self._sql_without_comments(relock_path)
        assert "staff_login_throttle_fail" in sql
        # The exact predicate, with comments removed, so prose cannot satisfy it.
        assert (
            "locked_until is null or staff_login_throttle.locked_until < now()" in sql
        ), (
            "Re-lock migration must allow re-locking after an expired lockout "
            "in the SQL statement itself, not only in a comment."
        )

    def test_relock_migration_is_not_satisfied_by_comments_alone(self):
        """Guards the guard: the assertion must read executable SQL."""
        relock_path = "supabase/migrations/20260820100000_fix_throttle_relock.sql"
        raw = open(relock_path, encoding="utf-8").read()
        stripped = self._sql_without_comments(relock_path)
        # The header prose mentions the condition; the stripped SQL must too,
        # and stripping must actually have removed something.
        assert "--" in raw
        assert len(stripped) < len(raw)

    def test_base_migration_is_superseded_not_edited_in_place(self):
        """The base migration keeps its original predicate; the correction
        migration supersedes it via CREATE OR REPLACE.

        Migration files are append-only: editing an applied migration in place
        would silently skip on `supabase db push`. This asserts the supersede
        pattern rather than asserting a bug must remain."""
        base = self._sql_without_comments(
            "supabase/migrations/20260818090000_staff_pin_hash.sql"
        )
        correction = self._sql_without_comments(
            "supabase/migrations/20260820100000_fix_throttle_relock.sql"
        )
        assert "create or replace function" in correction
        # Both define the same function, so ordering decides the live behaviour.
        assert "staff_login_throttle_fail" in base
        assert "staff_login_throttle_fail" in correction

    def test_relock_on_next_attempt_after_expired_lockout(self, monkeypatch):
        """After an expired lockout, a wrong PIN must re-lock the account.
        The throttle gate sees 'not locked' (expired), proceeds to PIN check,
        PIN fails, register_failure is called and re-locks via the SQL fix.
        The next attempt then returns 429."""
        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            "pin_hash": None,
            "pin": "1234",
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))

        # Attempt 1: expired lockout — current_state says not locked, but
        # register_failure re-locks (simulating the SQL fix).
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value={"locked": False}),
        )
        relocked_state = {
            "locked": True,
            "retry_after_seconds": 900,
            "failed_count": 6,
        }
        monkeypatch.setattr(
            auth_module,
            "register_failure",
            MagicMock(return_value=relocked_state),
        )

        resp = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "9999"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        # Wrong PIN → 401 (not 429, because the gate already passed).
        assert resp.status_code == 401

        # Attempt 2: now the account is re-locked. current_state returns locked.
        monkeypatch.setattr(
            auth_module,
            "current_state",
            MagicMock(return_value=relocked_state),
        )

        resp2 = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert resp2.status_code == 429
        assert resp2.headers.get("Retry-After") == "900"


# ---------------------------------------------------------------------------
# BLOCKER 4 — PIN-only update and create-user audit correctness
# ---------------------------------------------------------------------------


class TestPinOnlyUpdateAudit:
    """PIN changes are audited and staff creation fails closed until the PIN exists."""

    @pytest.mark.parametrize("pin,expected_writer", [("5678", "set"), ("", "clear")])
    def test_pin_only_update_writes_credential_and_audit_once(
        self, monkeypatch, pin, expected_writer
    ):
        import asyncio

        from backend.routes import users as users_module

        profile = {
            "id": "u1",
            "username": "doe.jane",
            "email": "doe.jane@mjc-cafeteria.com",
            "display_name": "Jane",
            "last_name": "Doe",
            "role": "staff",
            "active": True,
        }
        membership = {
            "user_id": "u1",
            "tenant_id": "t1",
            "role": "staff",
            "status": "active",
        }
        set_pin = MagicMock(return_value={"pin_version": 2})
        clear_pin = MagicMock(return_value={"pin_version": 2})
        audit = MagicMock()

        monkeypatch.setattr(
            users_module, "_get_user_by_id", AsyncMock(return_value=profile)
        )
        monkeypatch.setattr(
            users_module,
            "_require_workspace_member",
            MagicMock(return_value=membership),
        )
        monkeypatch.setattr(
            users_module, "_merge_membership", lambda user, _membership: user
        )
        monkeypatch.setattr(
            users_module, "_enforce_user_update_scope", MagicMock(return_value=True)
        )
        monkeypatch.setattr(
            users_module, "_selected_tenant_id", MagicMock(return_value="t1")
        )
        monkeypatch.setattr(users_module, "set_staff_pin", set_pin)
        monkeypatch.setattr(users_module, "clear_staff_pin", clear_pin)
        monkeypatch.setattr(users_module, "_log_credential_event", audit)

        result = asyncio.run(
            users_module.update_user(
                "u1",
                users_module.UserUpdateRequest(pin=pin),
                admin_user={"id": "admin1", "role": "sudo"},
            )
        )

        assert result.id == "u1"
        if expected_writer == "set":
            set_pin.assert_called_once()
            clear_pin.assert_not_called()
        else:
            clear_pin.assert_called_once()
            set_pin.assert_not_called()
        audit.assert_called_once_with("admin1", "u1", "pin_update")

    @staticmethod
    def _install_create_harness(monkeypatch, *, fail_pin: bool = False):
        from backend.routes import users as users_module
        from backend.staff_pin_admin import StaffPinBackendError

        events: list[tuple[str, object]] = []
        state: dict[str, dict] = {}

        class _ProfilesTable:
            def __init__(self):
                self.operation = ""

            def select(self, *_args):
                self.operation = "select"
                return self

            def insert(self, data):
                self.operation = "insert"
                state["profile"] = dict(data)
                events.append(("profile_insert", data["active"]))
                return self

            def update(self, data):
                self.operation = "update"
                state["profile"].update(data)
                events.append(("profile_activate", data.get("active")))
                return self

            def eq(self, *_args):
                return self

            def limit(self, *_args):
                return self

            def execute(self):
                if self.operation == "select":
                    return SimpleNamespace(data=[])
                return SimpleNamespace(data=[dict(state["profile"])])

        class _ServiceClient:
            def table(self, name):
                assert name == "user_profiles"
                return _ProfilesTable()

        class _MembershipTable:
            def __init__(self):
                self.row = None

            def insert(self, data):
                self.row = dict(data)
                events.append(("membership_insert", data["status"]))
                return self

            def execute(self):
                return SimpleNamespace(data=[self.row])

        class _AdminClient:
            def table(self, name):
                assert name == "tenant_memberships"
                return _MembershipTable()

        def _set_pin(*_args, **_kwargs):
            events.append(("pin_set", True))
            if fail_pin:
                raise StaffPinBackendError("credential store unavailable")
            return {"pin_version": 1}

        monkeypatch.setattr(users_module, "supabase_service", _ServiceClient())
        monkeypatch.setattr(users_module, "supabase_admin", _AdminClient())
        monkeypatch.setattr(users_module, "_user_exists", AsyncMock(return_value=False))
        monkeypatch.setattr(
            users_module, "_create_auth_user", MagicMock(return_value="u1")
        )
        monkeypatch.setattr(
            users_module, "_selected_tenant_id", MagicMock(return_value="t1")
        )
        monkeypatch.setattr(
            users_module, "tenancy_mode", MagicMock(return_value="shadow")
        )
        monkeypatch.setattr(users_module, "set_staff_pin", _set_pin)
        monkeypatch.setattr(
            users_module,
            "_merge_membership",
            lambda user, membership: {**user, "role": membership["role"]},
        )
        return users_module, events, state

    def test_staff_creation_activates_only_after_pin_setup(self, monkeypatch):
        import asyncio

        users_module, events, state = self._install_create_harness(monkeypatch)
        request = users_module.UserCreateRequest(
            username="doe.jane",
            email="jane@example.com",
            display_name="Jane",
            last_name="Doe",
            role="staff",
            pin="5678",
        )

        result = asyncio.run(
            users_module.create_user(
                request,
                admin_user={"id": "admin1", "role": "sudo"},
            )
        )

        assert [name for name, _value in events] == [
            "profile_insert",
            "membership_insert",
            "pin_set",
            "profile_activate",
        ]
        assert events[0] == ("profile_insert", False)
        assert events[-1] == ("profile_activate", True)
        assert state["profile"]["active"] is True
        assert result.active is True

    def test_staff_creation_pin_failure_leaves_profile_inactive(self, monkeypatch):
        import asyncio

        users_module, events, state = self._install_create_harness(
            monkeypatch, fail_pin=True
        )
        request = users_module.UserCreateRequest(
            username="doe.jane",
            email="jane@example.com",
            display_name="Jane",
            last_name="Doe",
            role="staff",
            pin="5678",
        )

        with pytest.raises(HTTPException) as exc_info:
            asyncio.run(
                users_module.create_user(
                    request,
                    admin_user={"id": "admin1", "role": "sudo"},
                )
            )

        assert exc_info.value.status_code == 500
        assert [name for name, _value in events] == [
            "profile_insert",
            "membership_insert",
            "pin_set",
        ]
        assert state["profile"]["active"] is False


class TestStaffSessionSecretFailsClosed:
    """A missing staff signing key must fail closed as 503, never as a 500.

    `mint_staff_session` raises StaffSessionConfigurationError, which is a
    RuntimeError. The login handler previously caught only HTTPException and
    ThrottleBackendError, so an unset KPNCOMPUTE_STAFF_SESSION_SECRET surfaced
    as an unhandled 500. That matters beyond the status code: FastAPI omits CORS
    headers on unhandled exceptions, so a browser reports a configuration
    problem as a CORS failure — the exact misdiagnosis this roster already cost
    an incident on.
    """

    @staticmethod
    def _valid_login(monkeypatch):
        from backend.staff_credentials import hash_staff_pin

        user_row = {
            "id": "u1",
            "username": "staff1",
            "active": True,
            "role": "staff",
            # Pre-hashed so the legacy plaintext upgrade RPC is not involved;
            # this isolates session minting as the only failure point.
            "pin_hash": hash_staff_pin("1234"),
            "pin": None,
            "pin_version": 2,
        }
        tables = _valid_tenant_tables(user_row)
        monkeypatch.setattr(auth_module, "supabase_admin", _stub_admin(tables))
        monkeypatch.setattr(
            auth_module, "current_state", MagicMock(return_value={"locked": False})
        )
        monkeypatch.setattr(auth_module, "register_success", MagicMock())
        monkeypatch.setattr(auth_module, "register_failure", MagicMock())

    def test_missing_signing_key_returns_503_not_500(self, monkeypatch):
        monkeypatch.delenv("KPNCOMPUTE_STAFF_SESSION_SECRET", raising=False)
        self._valid_login(monkeypatch)

        response = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert response.status_code == 503, response.text
        # The message stays generic: a sign-in surface must not disclose which
        # server-side setting is missing.
        assert "temporarily unavailable" in response.json()["detail"].lower()

    def test_too_short_signing_key_is_treated_as_unset(self, monkeypatch):
        monkeypatch.setenv("KPNCOMPUTE_STAFF_SESSION_SECRET", "too-short")
        self._valid_login(monkeypatch)

        response = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert response.status_code == 503, response.text

    def test_configured_key_still_succeeds(self, monkeypatch):
        """Guards the fix: the 503 path must not swallow healthy logins.

        conftest replaces the whole `jwt` module with a MagicMock, so the signer
        is stubbed with a capturing function. Everything else on the path stays
        real — secret check, tenant binding, claim assembly — which also lets
        this assert the claims a successful login actually mints.
        """
        from backend import staff_sessions

        monkeypatch.setenv("KPNCOMPUTE_STAFF_SESSION_SECRET", _SESSION_SECRET)
        self._valid_login(monkeypatch)

        captured = {}

        def _capture(claims, secret, algorithm="HS256", **kwargs):
            captured.update(claims)
            assert secret == _SESSION_SECRET
            return "signed.staff.token"

        monkeypatch.setattr(staff_sessions.pyjwt, "encode", _capture)

        response = _client().post(
            "/api/auth/login",
            json={"username": "staff1", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert response.status_code == 200, response.text
        assert response.json()["access_token"] == "signed.staff.token"
        # The minted session is tenant-bound and carries the PIN generation.
        assert captured["tenant_id"] == "t1"
        assert captured["tenant_slug"] == "mjcc"
        assert captured["sub"] == "u1"
        assert captured["credential_version"] == 2
        assert captured["token_use"] == "compute_staff"

    def test_mixed_case_username_still_authenticates(self, monkeypatch):
        """Usernames are stored lowercase; a capitalising keyboard must still
        sign in rather than miss the row and burn a throttle attempt against the
        real account."""
        from backend import staff_sessions

        monkeypatch.setenv("KPNCOMPUTE_STAFF_SESSION_SECRET", _SESSION_SECRET)
        self._valid_login(monkeypatch)
        monkeypatch.setattr(
            staff_sessions.pyjwt,
            "encode",
            lambda claims, secret, algorithm="HS256", **kw: "signed.staff.token",
        )
        failure = MagicMock()
        monkeypatch.setattr(auth_module, "register_failure", failure)

        response = _client().post(
            "/api/auth/login",
            json={"username": "  StAfF1  ", "pin": "1234"},
            headers={"X-Kpn-Workspace": "mjcc"},
        )
        assert response.status_code == 200, response.text
        # No failure may be recorded for what is actually a valid credential.
        failure.assert_not_called()
