"""Staff credential hashing for KpnCompute.

MJCC staff sign in with a username and PIN at their own tenant route. That is an
intentional tenant capability and is not being removed. What is being removed is
the way it was stored and verified:

* PINs were compared in plaintext with ``!=``, which is neither hashed nor
  constant time.
* When ``SUPABASE_JWT_SECRET`` was absent the API minted ``pin_<uuid>`` — an
  unsigned, non-expiring bearer token that was literally the user's row id.

Both are fixed without changing the staff experience. Verification accepts an
existing plaintext PIN once, then reports a hash so the caller can upgrade the
row in place; after that the plaintext column is no longer consulted.

Session signing lives in :mod:`backend.staff_sessions`, not here. This module
used to derive a signing key from ``SUPABASE_SERVICE_KEY`` when no JWT secret
was configured, which made a database credential double as an authentication
signing key. The signing key is now its own explicit variable and this module
owns credential material only.
"""

from __future__ import annotations

import hashlib
import hmac
import os

_SCRYPT_N = 16384
_SCRYPT_R = 8
_SCRYPT_P = 1
_KEY_LENGTH = 32
_SALT_BYTES = 16
_FORMAT = "kpn-scrypt"
_VERSION = "1"


def hash_staff_pin(pin: str, salt: bytes | None = None) -> str:
    """Return a self-describing scrypt hash. The raw PIN is never persisted."""
    if not pin:
        raise ValueError("A staff PIN is required.")
    salt = salt or os.urandom(_SALT_BYTES)
    digest = hashlib.scrypt(
        pin.encode("utf-8"),
        salt=salt,
        n=_SCRYPT_N,
        r=_SCRYPT_R,
        p=_SCRYPT_P,
        dklen=_KEY_LENGTH,
        maxmem=64 * 1024 * 1024,
    )
    return "$".join(
        [
            _FORMAT,
            _VERSION,
            str(_SCRYPT_N),
            str(_SCRYPT_R),
            str(_SCRYPT_P),
            salt.hex(),
            digest.hex(),
        ]
    )


def verify_staff_pin_hash(pin: str, encoded: str) -> bool:
    """Constant-time verification against a stored scrypt hash."""
    if not pin or not encoded:
        return False
    parts = encoded.split("$")
    if len(parts) != 7:
        return False
    fmt, version, n, r, p, salt_hex, digest_hex = parts
    if fmt != _FORMAT or version != _VERSION:
        return False
    try:
        salt = bytes.fromhex(salt_hex)
        expected = bytes.fromhex(digest_hex)
        candidate = hashlib.scrypt(
            pin.encode("utf-8"),
            salt=salt,
            n=int(n),
            r=int(r),
            p=int(p),
            dklen=len(expected),
            maxmem=64 * 1024 * 1024,
        )
    except (ValueError, MemoryError):
        return False
    return hmac.compare_digest(candidate, expected)


def verify_staff_pin(pin: str, profile: dict) -> tuple[bool, str | None]:
    """Verify a supplied PIN against a ``user_profiles`` row.

    Returns ``(ok, upgrade_hash)``. ``upgrade_hash`` is non-None only when a
    legacy plaintext PIN verified and the row should be rewritten with that hash.

    A wrong PIN, a missing PIN, and an unknown user all perform the same scrypt
    work so response time does not disclose which case occurred.
    """
    supplied = pin or ""
    stored_hash = (profile.get("pin_hash") or "").strip()

    if stored_hash:
        return verify_staff_pin_hash(supplied, stored_hash), None

    legacy = profile.get("pin") or ""
    if legacy and supplied and hmac.compare_digest(supplied, legacy):
        # Verified once against the legacy column; hand back a hash so the caller
        # can migrate this row and stop consulting the plaintext value.
        return True, hash_staff_pin(supplied)

    # Burn equivalent work on every failure path.
    hash_staff_pin(supplied or "not-a-valid-staff-pin")
    return False, None


def weak_staff_pin(pin: str, minimum_length: int = 6) -> bool:
    """Flag PINs that must be rotated after the central migration imports them."""
    if not pin or len(pin) < minimum_length:
        return True
    if pin in {
        "0000",
        "1111",
        "1234",
        "2222",
        "4321",
        "9999",
        "000000",
        "111111",
        "123456",
        "654321",
    }:
        return True
    if len(set(pin)) == 1:
        return True
    ascending = "01234567890123456789"
    descending = "98765432109876543210"
    return pin in ascending or pin in descending
