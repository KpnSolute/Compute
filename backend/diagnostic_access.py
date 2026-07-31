"""Read-only service identity for CLI diagnostics.

The diagnostic principal is deliberately not a human Supabase account.  Its
secret is supplied only through the server environment and grants access to
diagnostic log reads, never business data or mutations.
"""

from __future__ import annotations

import hmac
import os

from fastapi import Header, HTTPException

DIAGNOSTIC_PRINCIPAL = "codex-diagnostics"


def _configured_key() -> str:
    return os.getenv("MJCC_DIAGNOSTIC_LOG_KEY", "").strip()


def _extract_key(authorization: str, diagnostic_key: str) -> str:
    header_key = (diagnostic_key or "").strip()
    if header_key:
        return header_key
    value = (authorization or "").strip()
    if value.lower().startswith("diagnostic "):
        return value[11:].strip()
    return ""


def diagnostic_principal(
    authorization: str = Header(""),
    x_diagnostic_key: str = Header(""),
) -> dict:
    """Return the CLI principal when the server-only key matches exactly."""
    configured = _configured_key()
    presented = _extract_key(authorization, x_diagnostic_key)
    if (
        not configured
        or not presented
        or not hmac.compare_digest(presented, configured)
    ):
        raise HTTPException(status_code=401, detail="Diagnostic credentials required")
    return {
        "id": DIAGNOSTIC_PRINCIPAL,
        "username": DIAGNOSTIC_PRINCIPAL,
        "display_name": DIAGNOSTIC_PRINCIPAL,
        "role": "diagnostic",
        "scopes": ["logs:read"],
    }
