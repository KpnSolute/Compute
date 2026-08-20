"""Signed tenant-local staff sessions for KpnCompute.

MJCC staff sign in with a username and PIN at their own tenant route. That stays
a tenant-local capability: the credential never leaves KpnCompute and is never
copied into central KpnAuth. What this module owns is the *session* minted after
a PIN verifies.

Three defects are closed here:

* The session used to be signed with ``SUPABASE_JWT_SECRET``, or, when that was
  absent, with a key derived from ``SUPABASE_SERVICE_KEY``. Deriving an
  authentication signing key from a database credential couples two unrelated
  blast radii: rotating the service key silently invalidates every staff
  session, and a leaked service key becomes a session-forgery key. The signing
  key is now its own explicit variable and nothing else.
* The token carried only ``sub``/``role``/``iat``/``exp``. It had no issuer, no
  audience, no token type, and no tenant. A token minted for one purpose could
  be presented for another, and a token minted for tenant A carried nothing that
  said so.
* Verification went through the *Supabase* validator, so whether a staff session
  verified at all depended on whether the staff secret happened to equal the
  Supabase JWT secret. Mint and verify now use the same explicit key, and staff
  tokens are verified by this module alone.

``credential_version`` binds the session to the PIN that created it. Rotating or
resetting a PIN increments that version, so every session minted from the old
credential stops verifying at the next request --- revocation without a session
table.
"""

from __future__ import annotations

import datetime
import os
import uuid

import jwt as pyjwt

# The audience and token type are constants, not configuration: a deployment
# must not be able to widen what a staff token is accepted for.
STAFF_SESSION_AUDIENCE = "kpncompute:staff"
STAFF_SESSION_TOKEN_USE = "compute_staff"
STAFF_SESSION_ALGORITHM = "HS256"
DEFAULT_STAFF_SESSION_ISSUER = "https://compute.kpnsolute.com"
DEFAULT_STAFF_SESSION_TTL_SECONDS = 12 * 60 * 60
MINIMUM_SECRET_LENGTH = 32

_REQUIRED_CLAIMS = ("sub", "exp", "iat", "iss", "aud", "token_use", "tenant_id")


class StaffSessionConfigurationError(RuntimeError):
    """Raised when a staff session is requested without a signing key."""


def staff_session_secret() -> str | None:
    """The explicit staff signing key, or None when it is not configured.

    Deliberately reads exactly one variable. There is no fallback to
    ``SUPABASE_JWT_SECRET`` and no derivation from ``SUPABASE_SERVICE_KEY``:
    callers fail closed with an explicit setup error instead of silently signing
    with a database credential.
    """
    secret = (os.getenv("KPNCOMPUTE_STAFF_SESSION_SECRET") or "").strip()
    if len(secret) < MINIMUM_SECRET_LENGTH:
        return None
    return secret


def staff_session_issuer() -> str:
    value = (os.getenv("KPNCOMPUTE_STAFF_SESSION_ISSUER") or "").strip()
    return (value or DEFAULT_STAFF_SESSION_ISSUER).rstrip("/")


def staff_session_ttl_seconds() -> int:
    raw = (os.getenv("KPNCOMPUTE_STAFF_SESSION_TTL_SECONDS") or "").strip()
    if not raw:
        return DEFAULT_STAFF_SESSION_TTL_SECONDS
    try:
        ttl = int(raw)
    except ValueError:
        return DEFAULT_STAFF_SESSION_TTL_SECONDS
    # Bounded on both ends: a zero/negative TTL would mint a dead token, and an
    # unbounded one would make revocation-by-expiry meaningless.
    return max(60, min(ttl, 24 * 60 * 60))


def mint_staff_session(
    *,
    user_id: str,
    tenant_id: str,
    tenant_slug: str,
    role: str,
    credential_version: int,
    now: datetime.datetime | None = None,
    ttl_seconds: int | None = None,
) -> tuple[str, dict]:
    """Sign a staff session bound to one tenant and one PIN generation.

    Raises :class:`StaffSessionConfigurationError` when no signing key is set.
    A tenant id is mandatory: a staff session that cannot name its tenant cannot
    be checked against the tenant it is later presented to.
    """
    secret = staff_session_secret()
    if not secret:
        raise StaffSessionConfigurationError(
            "KPNCOMPUTE_STAFF_SESSION_SECRET is not configured."
        )
    immutable_tenant = (tenant_id or "").strip()
    if not immutable_tenant:
        raise StaffSessionConfigurationError(
            "A staff session requires an immutable tenant id."
        )
    if not (user_id or "").strip():
        raise StaffSessionConfigurationError("A staff session requires a subject.")

    issued_at = now or datetime.datetime.now(datetime.timezone.utc)
    expires_at = issued_at + datetime.timedelta(
        seconds=ttl_seconds or staff_session_ttl_seconds()
    )
    claims = {
        "iss": staff_session_issuer(),
        "aud": STAFF_SESSION_AUDIENCE,
        "sub": str(user_id),
        "token_use": STAFF_SESSION_TOKEN_USE,
        "tenant_id": immutable_tenant,
        "tenant_slug": (tenant_slug or "").strip().lower(),
        "role": role,
        "credential_version": int(credential_version),
        "jti": str(uuid.uuid4()),
        "iat": int(issued_at.timestamp()),
        "nbf": int(issued_at.timestamp()),
        "exp": int(expires_at.timestamp()),
    }
    return pyjwt.encode(claims, secret, algorithm=STAFF_SESSION_ALGORITHM), claims


def verify_staff_session(token: str) -> dict | None:
    """Verify a staff session token. Returns claims, or None on any failure.

    Every one of issuer, audience, expiry, token type, and tenant id is
    required. A token missing any of them is rejected rather than accepted with
    a default, so a token minted for another purpose can never satisfy this
    check by omission.
    """
    if not token:
        return None
    secret = staff_session_secret()
    if not secret:
        # Fail closed. Without the key there is nothing to verify against, and
        # accepting the token unverified is the defect this module removes.
        return None
    try:
        claims = pyjwt.decode(
            token,
            secret,
            algorithms=[STAFF_SESSION_ALGORITHM],
            audience=STAFF_SESSION_AUDIENCE,
            issuer=staff_session_issuer(),
            options={"require": list(_REQUIRED_CLAIMS), "verify_exp": True},
        )
    except Exception:
        return None
    if claims.get("token_use") != STAFF_SESSION_TOKEN_USE:
        return None
    if not str(claims.get("tenant_id") or "").strip():
        return None
    if not str(claims.get("sub") or "").strip():
        return None
    return claims


def staff_session_credential_version(claims: dict) -> int:
    """The PIN generation a session was minted from; 0 when a token predates it."""
    try:
        return int(claims.get("credential_version") or 0)
    except (TypeError, ValueError):
        return 0
