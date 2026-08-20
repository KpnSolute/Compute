"""Closed-enum runtime flags for KpnCompute.

``KPNCOMPUTE_TENANCY_MODE`` decides whether tenant scoping is enforced on
privileged data access.

This used to be read with a silent fallback: an unreadable value simply became
``legacy``. That is fail-open in the shape that matters most --- a typo
in ``requred`` or ``enfroced`` silently reopened the very boundary the operator
was trying to close, and nothing anywhere reported it.

These readers are closed enums. An unset variable takes the documented default;
anything else raises, and the process refuses to start.
"""

from __future__ import annotations

import os
from typing import Mapping

KPNCOMPUTE_TENANCY_MODES: tuple[str, ...] = ("legacy", "shadow", "enforced")

DEFAULT_KPNCOMPUTE_TENANCY_MODE = "legacy"


class ConfigurationError(RuntimeError):
    """Raised when a closed-enum flag holds a value that is not in its set."""


def _closed_enum(
    name: str,
    allowed: tuple[str, ...],
    default: str,
    env: Mapping[str, str] | None = None,
) -> str:
    """Return the configured value, or raise. Never silently substitutes."""
    source = os.environ if env is None else env
    raw = source.get(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if not value:
        # An explicitly empty value is the same statement as "unset". Treating it
        # as a typo would break deployments that clear a variable to reset it.
        return default
    if value not in allowed:
        raise ConfigurationError(
            f"{name}={raw!r} is not a recognised value. "
            f"Use one of: {', '.join(allowed)}. "
            "Refusing to start with an unreadable security flag rather than "
            "falling back to a weaker mode."
        )
    return value


def kpncompute_tenancy_mode(env: Mapping[str, str] | None = None) -> str:
    return _closed_enum(
        "KPNCOMPUTE_TENANCY_MODE",
        KPNCOMPUTE_TENANCY_MODES,
        DEFAULT_KPNCOMPUTE_TENANCY_MODE,
        env,
    )


def validate_runtime_flags(env: Mapping[str, str] | None = None) -> dict[str, str]:
    """Validate every closed-enum flag at once. Called during startup.

    Returns the resolved values so a caller can log them. Raises
    :class:`ConfigurationError` naming the first bad variable.
    """
    return {
        "KPNCOMPUTE_TENANCY_MODE": kpncompute_tenancy_mode(env),
    }
