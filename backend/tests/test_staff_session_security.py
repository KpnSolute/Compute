"""Security proofs for tenant-local staff sessions.

A mutation review of this roster found that four controls could be deleted
outright with the whole suite staying green:

  * JWT signature / expiry / audience / issuer verification
  * credential-version revocation (``_deps.py``)
  * cross-tenant session replay rejection (``_deps.py``)
  * the throttle re-lock decision

The first three were untestable because ``conftest`` replaced the real, installed
pyjwt with a ``MagicMock``, so every "signed token" assertion compared mocks.
That stub is now scoped to the case where pyjwt is genuinely missing, and these
tests exercise the real signer and verifier.

Each test here is written so that removing the control it covers makes it fail.
"""

from __future__ import annotations

import datetime

import jwt as pyjwt
import pytest
from fastapi import Depends, FastAPI
from fastapi.testclient import TestClient

from backend.routes import _deps
from backend.staff_sessions import (
    STAFF_SESSION_AUDIENCE,
    mint_staff_session,
    staff_session_credential_version,
    verify_staff_session,
)

_SECRET = "staff-session-secret-of-sufficient-length!!"
_OTHER_SECRET = "a-completely-different-secret-of-length!!!!"


@pytest.fixture(autouse=True)
def _configured(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_STAFF_SESSION_SECRET", _SECRET)


def _mint(**overrides):
    params = {
        "user_id": "u1",
        "tenant_id": "tenant-a",
        "tenant_slug": "mjcc",
        "role": "staff",
        "credential_version": 2,
    }
    params.update(overrides)
    return mint_staff_session(**params)


class TestRealSignatureVerification:
    """The token must actually be signed, and verification must actually check."""

    def test_round_trip_returns_claims(self):
        token, claims = _mint()
        verified = verify_staff_session(token)
        assert verified is not None
        assert verified["sub"] == "u1"
        assert verified["tenant_id"] == "tenant-a"
        assert verified["credential_version"] == 2
        # Proves a real JWT was produced, not a mock.
        assert token.count(".") == 2

    def test_token_signed_with_another_secret_is_rejected(self):
        forged = pyjwt.encode(
            {
                "iss": "https://compute.kpnsolute.com",
                "aud": STAFF_SESSION_AUDIENCE,
                "sub": "u1",
                "token_use": "compute_staff",
                "tenant_id": "tenant-a",
                "credential_version": 2,
                "iat": int(datetime.datetime.now(datetime.timezone.utc).timestamp()),
                "exp": int(
                    (
                        datetime.datetime.now(datetime.timezone.utc)
                        + datetime.timedelta(hours=1)
                    ).timestamp()
                ),
            },
            _OTHER_SECRET,
            algorithm="HS256",
        )
        assert verify_staff_session(forged) is None

    def test_tampered_payload_is_rejected(self):
        token, _ = _mint()
        header, payload, signature = token.split(".")
        # Re-encode a different tenant into the payload, keep the signature.
        forged_payload = pyjwt.encode(
            {**verify_staff_session(token), "tenant_id": "tenant-b"},
            _OTHER_SECRET,
            algorithm="HS256",
        ).split(".")[1]
        assert verify_staff_session(f"{header}.{forged_payload}.{signature}") is None

    def test_expired_token_is_rejected(self):
        past = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(
            hours=2
        )
        token, _ = _mint(now=past, ttl_seconds=60)
        assert verify_staff_session(token) is None

    def test_wrong_audience_is_rejected(self):
        token = pyjwt.encode(
            {
                "iss": "https://compute.kpnsolute.com",
                "aud": "some:other:audience",
                "sub": "u1",
                "token_use": "compute_staff",
                "tenant_id": "tenant-a",
                "credential_version": 2,
                "iat": int(datetime.datetime.now(datetime.timezone.utc).timestamp()),
                "exp": int(
                    (
                        datetime.datetime.now(datetime.timezone.utc)
                        + datetime.timedelta(hours=1)
                    ).timestamp()
                ),
            },
            _SECRET,
            algorithm="HS256",
        )
        assert verify_staff_session(token) is None

    def test_wrong_issuer_is_rejected(self, monkeypatch):
        token, _ = _mint()
        # A deployment that changes issuer must stop accepting the old tokens.
        monkeypatch.setenv(
            "KPNCOMPUTE_STAFF_SESSION_ISSUER", "https://impostor.example"
        )
        assert verify_staff_session(token) is None

    def test_token_without_tenant_is_rejected(self):
        token = pyjwt.encode(
            {
                "iss": "https://compute.kpnsolute.com",
                "aud": STAFF_SESSION_AUDIENCE,
                "sub": "u1",
                "token_use": "compute_staff",
                "iat": int(datetime.datetime.now(datetime.timezone.utc).timestamp()),
                "exp": int(
                    (
                        datetime.datetime.now(datetime.timezone.utc)
                        + datetime.timedelta(hours=1)
                    ).timestamp()
                ),
            },
            _SECRET,
            algorithm="HS256",
        )
        assert verify_staff_session(token) is None

    def test_token_for_another_purpose_is_rejected(self):
        """A workforce/consumer token must not satisfy a staff check."""
        token = pyjwt.encode(
            {
                "iss": "https://compute.kpnsolute.com",
                "aud": STAFF_SESSION_AUDIENCE,
                "sub": "u1",
                "token_use": "workforce",
                "tenant_id": "tenant-a",
                "iat": int(datetime.datetime.now(datetime.timezone.utc).timestamp()),
                "exp": int(
                    (
                        datetime.datetime.now(datetime.timezone.utc)
                        + datetime.timedelta(hours=1)
                    ).timestamp()
                ),
            },
            _SECRET,
            algorithm="HS256",
        )
        assert verify_staff_session(token) is None

    def test_verification_fails_closed_without_a_secret(self, monkeypatch):
        token, _ = _mint()
        monkeypatch.delenv("KPNCOMPUTE_STAFF_SESSION_SECRET", raising=False)
        assert verify_staff_session(token) is None


class TestCredentialVersionRevocation:
    """Rotating a PIN must invalidate sessions minted from the old one."""

    def test_version_travels_in_the_token(self):
        _token, claims = _mint(credential_version=7)
        assert staff_session_credential_version(claims) == 7

    def test_profile_lookup_rejects_a_superseded_version(self, monkeypatch):
        token, _ = _mint(credential_version=2)
        # The stored PIN generation has moved on; the session must not verify.
        monkeypatch.setattr(
            _deps,
            "supabase_admin",
            _profile_client(
                {"id": "u1", "active": True, "role": "staff", "pin_version": 3}
            ),
        )
        with pytest.raises(Exception) as excinfo:
            _deps._profile_for_token(f"Bearer {token}")
        assert "credential has changed" in str(excinfo.value)

    def test_matching_version_is_accepted(self, monkeypatch):
        token, _ = _mint(credential_version=3)
        monkeypatch.setattr(
            _deps,
            "supabase_admin",
            _profile_client(
                {"id": "u1", "active": True, "role": "staff", "pin_version": 3}
            ),
        )
        resolved = _deps._profile_for_token(f"Bearer {token}")
        assert resolved["_auth_method"] == "staff_session"
        assert resolved["_staff_tenant_id"] == "tenant-a"


class TestCrossTenantReplay:
    """A session minted for tenant A must not act inside tenant B."""

    def _app(self):
        app = FastAPI()

        @app.get("/probe")
        async def probe(auth_user: dict = Depends(_deps._get_auth_user)):
            return {"tenant": auth_user.get("tenant", {}).get("slug")}

        return app

    def _wire(self, monkeypatch, *, session_tenant: str, resolved_tenant: str):
        from backend.tenancy import TenantContext

        monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "shadow")
        monkeypatch.setattr(
            _deps,
            "_profile_for_token",
            lambda _auth: {
                "id": "u1",
                "role": "staff",
                "active": True,
                "_auth_method": "staff_session",
                "_staff_tenant_id": session_tenant,
            },
        )
        monkeypatch.setattr(
            _deps,
            "resolve_user_tenant",
            lambda _c, _u, _s: (
                TenantContext(
                    id=resolved_tenant,
                    slug="other",
                    name="Other",
                    user_id="u1",
                    role="staff",
                ),
                [],
            ),
        )

    def test_session_from_another_tenant_is_refused(self, monkeypatch):
        self._wire(monkeypatch, session_tenant="tenant-a", resolved_tenant="tenant-b")
        response = TestClient(self._app(), raise_server_exceptions=False).get(
            "/probe", headers={"Authorization": "Bearer x"}
        )
        assert response.status_code == 403, response.text
        assert "does not match" in response.json()["detail"]

    def test_session_in_its_own_tenant_is_allowed(self, monkeypatch):
        self._wire(monkeypatch, session_tenant="tenant-a", resolved_tenant="tenant-a")
        response = TestClient(self._app(), raise_server_exceptions=False).get(
            "/probe", headers={"Authorization": "Bearer x"}
        )
        assert response.status_code == 200, response.text


def _profile_client(profile: dict):
    """Minimal admin-client stub returning one user_profiles row."""

    class _Result:
        def __init__(self, data):
            self.data = data

    class _Query:
        def __init__(self, rows):
            self._rows = rows

        def select(self, *_a, **_k):
            return self

        def eq(self, *_a, **_k):
            return self

        def limit(self, *_a, **_k):
            return self

        def execute(self):
            return _Result(self._rows)

    class _Client:
        def table(self, _name):
            return _Query([profile])

    return _Client()
