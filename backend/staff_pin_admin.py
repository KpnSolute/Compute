"""The one place a KpnCompute staff PIN is created, changed, reset, or cleared.

Before this module, four separate code paths wrote a PIN --- ``POST /api/users``,
``PUT /api/users/{id}``, ``PUT /api/users/me/pin``, and the staging dispatch
``user_create``/``user_update`` operations. Each wrote the plaintext ``pin``
column directly. That meant three things were true at once:

* a new or rotated PIN was stored in plaintext, so the hashed column only ever
  described PINs that happened to have been used to sign in;
* nothing revoked sessions minted from the previous PIN, so resetting a
  compromised credential did not end the session that used it;
* the staging path could set a PIN without going through any validation at all.

Every write now goes through :func:`set_staff_pin` or :func:`clear_staff_pin`,
which call a single database function that replaces ``pin_hash``, clears the
legacy plaintext column, and increments ``pin_version`` in one statement.
``pin_version`` is carried in the signed staff session, so incrementing it
revokes every session minted from the old credential.

Nothing in this module returns, logs, or echoes credential material.
"""

from __future__ import annotations

import os
from typing import Any

from backend.staff_credentials import hash_staff_pin, weak_staff_pin

PIN_ABSOLUTE_MIN_LENGTH = 4
PIN_ABSOLUTE_MAX_LENGTH = 12
DEFAULT_PIN_MIN_LENGTH = 4

SET_PIN_RPC = "set_staff_pin_credential"
CLEAR_PIN_RPC = "clear_staff_pin_credential"


class StaffPinError(ValueError):
    """A rejected PIN. The message is safe to show a manager; it never echoes the PIN."""


class StaffPinBackendError(RuntimeError):
    """The credential store could not complete the change. Callers must fail closed."""


def pin_minimum_length() -> int:
    raw = (os.getenv("KPNCOMPUTE_STAFF_PIN_MIN_LENGTH") or "").strip()
    if not raw:
        return DEFAULT_PIN_MIN_LENGTH
    try:
        configured = int(raw)
    except ValueError:
        return DEFAULT_PIN_MIN_LENGTH
    return max(PIN_ABSOLUTE_MIN_LENGTH, min(configured, PIN_ABSOLUTE_MAX_LENGTH))


def normalize_pin(value: str | None) -> str:
    return (value or "").strip()


def validate_pin(value: str | None) -> str:
    """Return the normalized PIN, or raise :class:`StaffPinError`.

    The error text describes the rule, never the supplied value, so a PIN cannot
    reach a log line or an HTTP response through an error message.
    """
    pin = normalize_pin(value)
    if not pin:
        raise StaffPinError("A PIN is required.")
    if not pin.isdigit():
        raise StaffPinError("PIN must contain digits only.")
    minimum = pin_minimum_length()
    if len(pin) < minimum:
        raise StaffPinError(f"PIN must be at least {minimum} digits.")
    if len(pin) > PIN_ABSOLUTE_MAX_LENGTH:
        raise StaffPinError(f"PIN must be at most {PIN_ABSOLUTE_MAX_LENGTH} digits.")
    return pin


def _rpc(admin_client: Any, name: str, params: dict) -> list[dict]:
    try:
        response = admin_client.rpc(name, params).execute()
    except Exception as exc:  # noqa: BLE001 - surfaced as a fail-closed backend error
        raise StaffPinBackendError(
            "The staff credential store rejected the change."
        ) from exc
    data = getattr(response, "data", None)
    if data is None:
        raise StaffPinBackendError("The staff credential store returned no result.")
    if isinstance(data, dict):
        return [data]
    return list(data)


def set_staff_pin(
    admin_client: Any,
    *,
    user_id: str,
    tenant_id: str | None,
    pin: str,
    actor_id: str | None = None,
) -> dict:
    """Atomically replace a staff PIN and revoke sessions minted from the old one.

    ``tenant_id`` is the resolved tenant of the caller, not a client-supplied
    value. The database function refuses when the target user has no active
    membership in that tenant, so a manager in one workspace can never rotate a
    credential belonging to another.

    Returns credential *metadata* only: the new version and when it changed.
    """
    validated = validate_pin(pin)
    subject = (user_id or "").strip()
    if not subject:
        raise StaffPinError("A user id is required.")
    immutable_tenant = (tenant_id or "").strip()
    if not immutable_tenant:
        raise StaffPinError("A tenant id is required for staff credential changes.")

    rows = _rpc(
        admin_client,
        SET_PIN_RPC,
        {
            "p_user_id": subject,
            "p_tenant_id": immutable_tenant,
            "p_pin_hash": hash_staff_pin(validated),
            "p_must_rotate": weak_staff_pin(validated, pin_minimum_length()),
            "p_actor_id": (actor_id or None),
        },
    )
    if not rows:
        raise StaffPinBackendError(
            "The staff credential was not updated. The user may not be a member "
            "of this workspace."
        )
    row = rows[0]
    return {
        "user_id": subject,
        "pin_version": int(row.get("pin_version") or 0),
        "pin_updated_at": row.get("pin_updated_at"),
        "must_rotate": bool(row.get("must_rotate")),
        "sessions_revoked": True,
    }


def clear_staff_pin(
    admin_client: Any,
    *,
    user_id: str,
    tenant_id: str | None,
    actor_id: str | None = None,
) -> dict:
    """Remove a staff PIN entirely, revoking sessions minted from it."""
    subject = (user_id or "").strip()
    if not subject:
        raise StaffPinError("A user id is required.")
    immutable_tenant = (tenant_id or "").strip()
    if not immutable_tenant:
        raise StaffPinError("A tenant id is required for staff credential changes.")
    rows = _rpc(
        admin_client,
        CLEAR_PIN_RPC,
        {
            "p_user_id": subject,
            "p_tenant_id": immutable_tenant,
            "p_actor_id": (actor_id or None),
        },
    )
    if not rows:
        raise StaffPinBackendError(
            "The staff credential was not cleared. The user may not be a member "
            "of this workspace."
        )
    row = rows[0]
    return {
        "user_id": subject,
        "pin_version": int(row.get("pin_version") or 0),
        "pin_updated_at": row.get("pin_updated_at"),
        "must_rotate": False,
        "sessions_revoked": True,
    }


def credential_state(profile: dict) -> dict:
    """Non-secret credential metadata for a profile row.

    Never includes ``pin`` or ``pin_hash``. ``pin_set`` reports only that a
    credential exists, which is what a manager needs to know.
    """
    return {
        "pin_set": bool((profile.get("pin_hash") or "").strip()),
        "pin_version": int(profile.get("pin_version") or 0),
        "pin_updated_at": profile.get("pin_updated_at"),
        "must_rotate_pin": bool(profile.get("pin_must_rotate")),
    }
