"""Verify that central KpnAuth workforce tokens cannot authorize Compute tenants.

The central workforce auth path (``KpnAuthJWTValidator``, ``KPN_AUTH_MODE``,
and ``kpn_staff_identity_links``) has been removed. These tests guard against
any regression that re-introduces it as a fallback. Unsigned ``pin_*`` tokens
are rejected before any lookup; arbitrary bearer tokens must not grant tenant
staff access.
"""

from __future__ import annotations

import jwt as pyjwt
import pytest
from fastapi import HTTPException

from backend import routes
from backend.routes import _deps

_TOKEN_ALG = "HS256"
_TOKEN_SECRET = "test-secret-not-a-real-key"
_USER_ID = "00000000-0000-0000-0000-000000000099"
_TENANT_ID = "00000000-0000-0000-0000-000000000077"


def _central_workforce_token(*, tenant_id: str = _TENANT_ID) -> str:
    """Build a plausible central KpnAuth workforce token signed with a fake key.

    This token looks exactly like a real one (``iss``, ``aud``, ``token_use``,
    ``tenant_id``, ``installation_id`` claims are all present) but is signed
    with a key that Compute does not trust. If any code path still tries to
    verify it, the signature check must fail.
    """
    return pyjwt.encode(
        {
            "sub": _USER_ID,
            "iss": "https://auth.kpnsolute.com",
            "aud": "kpnsolute:compute:workforce",
            "token_use": "workforce",
            "tenant_id": tenant_id,
            "installation_id": "inst-1",
            "exp": 9999999999,
            "iat": 1700000000,
            "jti": "fake-jti-central",
        },
        _TOKEN_SECRET,
        algorithm=_TOKEN_ALG,
    )


# ---------------------------------------------------------------------------
# _profile_for_token rejects central workforce tokens
# ---------------------------------------------------------------------------


class TestCentralWorkforceTokenRejected:
    """Central KpnAuth bearer tokens must never grant tenant staff access."""

    def test_arbitrary_bearer_token_rejected(self, monkeypatch: pytest.MonkeyPatch):
        """An arbitrary JWT-bearing bearer token must not pass as staff."""
        token = _central_workforce_token()
        # Staff session verification must return None (token is not a staff session).
        monkeypatch.setattr(_deps, "verify_staff_session", lambda _t: None)
        # Supabase JWT verification must also reject this token (signed with unknown key).
        monkeypatch.setattr(routes.jwt_validator, "verify_token", lambda _t: None)
        with pytest.raises(HTTPException, match="Invalid or expired token"):
            _deps._profile_for_token(f"Bearer {token}")

    def test_kpn_auth_validator_no_longer_exists(self):
        """The central workforce validator object must not exist in routes."""
        assert not hasattr(routes, "kpn_auth_validator"), (
            "kpn_auth_validator still exists in routes module"
        )

    def test_kpn_auth_mode_removed_from_routes(self):
        """KPN_AUTH_MODE must not be importable from routes."""
        assert not hasattr(routes, "KPN_AUTH_MODE"), (
            "KPN_AUTH_MODE still exists in routes module"
        )

    def test_kpn_auth_mode_removed_from_config_flags(self):
        """KPN_AUTH_MODE must not be importable from config_flags."""
        from backend import config_flags

        assert not hasattr(config_flags, "kpn_auth_mode"), (
            "kpn_auth_mode still exists in config_flags"
        )

    def test_identity_links_table_no_longer_in_tenant_tables(self):
        """kpn_staff_identity_links must not appear in TENANT_TABLES."""
        from backend.tenancy import TENANT_TABLES

        assert "kpn_staff_identity_links" not in TENANT_TABLES, (
            "kpn_staff_identity_links still in TENANT_TABLES"
        )
