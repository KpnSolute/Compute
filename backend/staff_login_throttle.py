"""Database-backed throttling and lockout for tenant-local staff PIN sign-in.

A PIN is a short numeric secret. Without a rate limit, a four-digit PIN is ten
thousand guesses --- minutes of scripted traffic. KpnCompute runs more than one
web instance behind Render, so an in-process counter would let an attacker
spread guesses across instances and never reach the threshold on any of them.

State therefore lives in one table and every transition runs inside one database
function, which makes the counter correct regardless of how many instances are
serving. The state is keyed by ``(tenant_id, subject_key)``: a lockout in one
tenant never locks the same username in another, and a username that does not
exist is still counted, so probing for valid usernames costs the same as
probing for valid PINs.

The state is deliberately readable for audit --- failed count, first and last
failure, and the lockout window --- and contains no credential material.
"""

from __future__ import annotations

import datetime
import os
from typing import Any

STATE_RPC = "staff_login_throttle_state"
FAIL_RPC = "staff_login_throttle_fail"
RESET_RPC = "staff_login_throttle_reset"

# Bounded on both ends. A threshold of 1 locks staff out on a mistyped digit; an
# unbounded one is not a threshold. A lockout under a minute is not a delay, and
# one over an hour turns a wrong PIN into a shift-long outage for a cook.
MIN_FAILED_ATTEMPTS = 3
MAX_FAILED_ATTEMPTS = 10
DEFAULT_FAILED_ATTEMPTS = 5
MIN_LOCKOUT_SECONDS = 60
MAX_LOCKOUT_SECONDS = 60 * 60
DEFAULT_LOCKOUT_SECONDS = 15 * 60


class ThrottleBackendError(RuntimeError):
    """The throttle store was unreachable. Callers must fail closed, not open."""


def max_failed_attempts() -> int:
    return _bounded_int(
        "KPNCOMPUTE_STAFF_MAX_FAILED_ATTEMPTS",
        DEFAULT_FAILED_ATTEMPTS,
        MIN_FAILED_ATTEMPTS,
        MAX_FAILED_ATTEMPTS,
    )


def lockout_seconds() -> int:
    return _bounded_int(
        "KPNCOMPUTE_STAFF_LOCKOUT_SECONDS",
        DEFAULT_LOCKOUT_SECONDS,
        MIN_LOCKOUT_SECONDS,
        MAX_LOCKOUT_SECONDS,
    )


def _bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = (os.getenv(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        return default
    return max(minimum, min(value, maximum))


def subject_key(username: str | None) -> str:
    """The throttle key for a username. Case-insensitive, never the credential."""
    return (username or "").strip().lower()[:120]


def _retry_after_seconds(locked_until: str | None, now: datetime.datetime) -> int:
    if not locked_until:
        return 0
    try:
        parsed = datetime.datetime.fromisoformat(
            str(locked_until).replace("Z", "+00:00")
        )
    except ValueError:
        return 0
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=datetime.timezone.utc)
    remaining = int((parsed - now).total_seconds())
    return max(0, remaining)


def _state_from_row(row: dict | None, now: datetime.datetime) -> dict:
    row = row or {}
    retry_after = _retry_after_seconds(row.get("locked_until"), now)
    return {
        "locked": retry_after > 0,
        "retry_after_seconds": retry_after,
        "failed_count": int(row.get("failed_count") or 0),
        "locked_until": row.get("locked_until"),
        "first_failed_at": row.get("first_failed_at"),
        "last_failed_at": row.get("last_failed_at"),
    }


def _rpc(admin_client: Any, name: str, params: dict) -> dict | None:
    try:
        response = admin_client.rpc(name, params).execute()
    except Exception as exc:  # noqa: BLE001 - surfaced as a fail-closed backend error
        raise ThrottleBackendError(
            "The staff sign-in throttle store is unavailable."
        ) from exc
    data = getattr(response, "data", None)
    if isinstance(data, dict):
        return data
    if isinstance(data, list):
        return data[0] if data else None
    return None


def current_state(
    admin_client: Any,
    *,
    tenant_id: str | None,
    username: str | None,
    now: datetime.datetime | None = None,
) -> dict:
    """The lockout state for one tenant/username pair, before a PIN is checked."""
    moment = now or datetime.datetime.now(datetime.timezone.utc)
    row = _rpc(
        admin_client,
        STATE_RPC,
        {"p_tenant_id": (tenant_id or None), "p_subject_key": subject_key(username)},
    )
    return _state_from_row(row, moment)


def register_failure(
    admin_client: Any,
    *,
    tenant_id: str | None,
    username: str | None,
    now: datetime.datetime | None = None,
) -> dict:
    """Count one failed attempt and return the resulting state.

    Called for an unknown username as well as a wrong PIN, so the cost of
    probing for account existence is the same as the cost of guessing.
    """
    moment = now or datetime.datetime.now(datetime.timezone.utc)
    row = _rpc(
        admin_client,
        FAIL_RPC,
        {
            "p_tenant_id": (tenant_id or None),
            "p_subject_key": subject_key(username),
            "p_max_attempts": max_failed_attempts(),
            "p_lockout_seconds": lockout_seconds(),
        },
    )
    return _state_from_row(row, moment)


def register_success(
    admin_client: Any,
    *,
    tenant_id: str | None,
    username: str | None,
) -> None:
    """Clear the counter after a normal successful sign-in."""
    _rpc(
        admin_client,
        RESET_RPC,
        {"p_tenant_id": (tenant_id or None), "p_subject_key": subject_key(username)},
    )
