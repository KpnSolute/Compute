"""Observed-price protocol: the rules for keeping inventory prices current.

Every received invoice line is a price *observation*. Inventory carries the
latest observed invoice price for each item and month (AGENTS.md §4A), the same
way SKU upkeep keeps item identity current: routine changes apply on commit,
and anything suspicious waits in a manager review queue instead of silently
rewriting the valuation.

This module is pure — no database access — so the decision is testable on its
own and identical wherever it is applied.
"""

from __future__ import annotations

# A price move larger than this fraction of the current period price is held
# for review rather than applied. 25% catches mis-mapped products and pack-size
# changes (the September lettuce row sat at $74.41 against invoices of $36.66
# and $47.20) while letting ordinary weekly movement through untouched.
PRICE_REVIEW_THRESHOLD = 0.25

# Prices closer than half a cent are the same price.
PRICE_TOLERANCE = 0.005

APPLY = "apply"
HOLD = "hold"
SAME = "same"
SKIP = "skip"

QUEUE_STATUSES = ("auto_applied", "pending", "applied", "kept", "dismissed")


def as_price(value) -> float:
    """A price as a float; anything unparseable or missing is 0."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def decide_price(
    previous, observed, threshold: float = PRICE_REVIEW_THRESHOLD
) -> tuple[str, float | None]:
    """Decide what a new invoice price does to the period price.

    Returns ``(decision, change_fraction)``:

    - ``skip``  — the invoice carries no usable price; nothing changes.
    - ``apply`` — no current price, or a move within ``threshold``.
    - ``same``  — the observation matches the current price.
    - ``hold``  — a move larger than ``threshold``; a manager decides.

    ``change_fraction`` is ``(observed - previous) / previous`` when a current
    price exists, else ``None``.
    """
    obs = as_price(observed)
    if obs <= 0:
        return SKIP, None
    prev = as_price(previous)
    if prev <= 0:
        return APPLY, None
    if abs(obs - prev) < PRICE_TOLERANCE:
        return SAME, 0.0
    change = (obs - prev) / prev
    if abs(change) > threshold:
        return HOLD, change
    return APPLY, change
