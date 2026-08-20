"""Tests for hashed staff PIN verification and signed session secrets.

These cover the two defects fixed in the tenant-local staff login path: the
plaintext PIN comparison and the unsigned, non-expiring `pin_<uuid>` token.
"""

import pytest

from backend.staff_credentials import (
    hash_staff_pin,
    verify_staff_pin,
    verify_staff_pin_hash,
    weak_staff_pin,
)
from backend.staff_sessions import staff_session_secret


def test_hash_is_self_describing_and_never_contains_the_pin():
    encoded = hash_staff_pin("482913")
    assert encoded.startswith("kpn-scrypt$1$")
    assert "482913" not in encoded
    assert len(encoded.split("$")) == 7


def test_same_pin_hashes_differently_each_time():
    assert hash_staff_pin("482913") != hash_staff_pin("482913")


def test_hash_verifies_only_the_correct_pin():
    encoded = hash_staff_pin("482913")
    assert verify_staff_pin_hash("482913", encoded) is True
    assert verify_staff_pin_hash("482914", encoded) is False
    assert verify_staff_pin_hash("", encoded) is False
    assert verify_staff_pin_hash("482913", "") is False


def test_malformed_hashes_are_rejected_rather_than_raising():
    for bad in [
        "not-a-hash",
        "kpn-scrypt$1$short",
        "kpn-scrypt$2$1$1$1$aa$bb",
        "$$$$$$",
    ]:
        assert verify_staff_pin_hash("482913", bad) is False


def test_hashed_profile_verifies_without_requesting_an_upgrade():
    profile = {"pin_hash": hash_staff_pin("482913"), "pin": "wrong-and-ignored"}
    ok, upgrade = verify_staff_pin("482913", profile)
    assert ok is True
    # The plaintext column must not be consulted once a hash exists.
    assert upgrade is None


def test_hashed_profile_rejects_the_legacy_plaintext_value():
    profile = {"pin_hash": hash_staff_pin("482913"), "pin": "111111"}
    ok, upgrade = verify_staff_pin("111111", profile)
    assert ok is False
    assert upgrade is None


def test_legacy_plaintext_verifies_once_and_returns_an_upgrade_hash():
    profile = {"pin": "482913"}
    ok, upgrade = verify_staff_pin("482913", profile)
    assert ok is True
    assert upgrade is not None
    # The returned hash must verify the same PIN, so the row can be migrated.
    assert verify_staff_pin_hash("482913", upgrade) is True


def test_legacy_plaintext_rejects_a_wrong_pin():
    ok, upgrade = verify_staff_pin("000000", {"pin": "482913"})
    assert ok is False
    assert upgrade is None


def test_profile_with_no_credential_at_all_is_denied():
    ok, upgrade = verify_staff_pin("482913", {})
    assert ok is False
    assert upgrade is None
    ok, _ = verify_staff_pin("", {"pin": ""})
    assert ok is False


def test_empty_supplied_pin_never_matches_an_empty_stored_pin():
    # Guards against an "" == "" match granting access to a credential-less row.
    ok, _ = verify_staff_pin("", {"pin": ""})
    assert ok is False


def test_session_secret_uses_the_explicit_staff_secret(monkeypatch):
    monkeypatch.setenv(
        "KPNCOMPUTE_STAFF_SESSION_SECRET", "my-own-secret-at-least-32-chars-long"
    )
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    assert staff_session_secret() == "my-own-secret-at-least-32-chars-long"


def test_session_secret_ignores_jwt_and_service_keys(monkeypatch):
    monkeypatch.delenv("KPNCOMPUTE_STAFF_SESSION_SECRET", raising=False)
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "explicit-secret")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "deployed-service-key")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "service-role")
    # Neither SUPABASE_JWT_SECRET nor SUPABASE_SERVICE_KEY are used — only the
    # explicit staff secret.
    assert staff_session_secret() is None


def test_session_secret_is_none_when_not_configured(monkeypatch):
    monkeypatch.delenv("KPNCOMPUTE_STAFF_SESSION_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_JWT_SECRET", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    # Callers must fail closed rather than mint an unsigned token.
    assert staff_session_secret() is None


def test_session_secret_rejects_short_keys(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_STAFF_SESSION_SECRET", "short")
    assert staff_session_secret() is None


@pytest.mark.parametrize("pin", ["2222", "1234", "0000", "111111", "123456", "12345"])
def test_known_weak_pins_are_flagged_for_rotation(pin):
    assert weak_staff_pin(pin) is True


@pytest.mark.parametrize("pin", ["482913", "907341", "630582"])
def test_reasonable_pins_are_not_flagged(pin):
    assert weak_staff_pin(pin) is False
