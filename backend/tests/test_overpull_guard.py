"""Regression tests for the DB-level over-pull guard's decision logic.

Mirrors migration ``..._prevent_new_inventory_overpulls.sql``'s trigger,
`prevent_inventory_overpull`, in pure Python so the policy is testable without
a live Postgres. The policy: reject a write that creates a new over-pull or
makes an existing one worse; allow a write on a row that was already
over-pulled as long as it doesn't push the shortfall further negative.

That carve-out matters because CHANGELOG v0.1.28 documents five real 2026-07
`monthly_inventory` rows deliberately left over-pulled (8 units / $288.57
total) rather than silently rewritten. A naive "reject if pulled > available"
trigger would relock those rows against any future touch, including an
unrelated correction or a monthly rollover — this guard must not do that.
"""

from backend.inventory_formulas import overpull_excess, write_increases_overpull


def _row(
    opening_oh=0,
    w1_received=0,
    w2_received=0,
    w3_received=0,
    w1_pulled=0,
    w2_pulled=0,
    w3_pulled=0,
):
    return {
        "opening_oh": opening_oh,
        "w1_received": w1_received,
        "w2_received": w2_received,
        "w3_received": w3_received,
        "w1_pulled": w1_pulled,
        "w2_pulled": w2_pulled,
        "w3_pulled": w3_pulled,
    }


def test_overpull_excess_zero_when_within_available():
    assert overpull_excess(opening_oh=10, received=5, pulled=12) == 0.0


def test_overpull_excess_positive_when_pulled_exceeds_available():
    assert overpull_excess(opening_oh=10, received=5, pulled=20) == 5.0


def test_insert_within_available_is_allowed():
    new = _row(opening_oh=10, w1_pulled=6)
    assert write_increases_overpull(None, new) is False


def test_insert_that_overpulls_is_rejected():
    new = _row(opening_oh=10, w1_pulled=15)
    assert write_increases_overpull(None, new) is True


def test_existing_overpull_row_untouched_by_unrelated_edit_stays_allowed():
    # Representative of the shape of the five preserved 2026-07 over-pull rows:
    # already 3 units short before this write, and this write doesn't touch
    # the quantity columns' net effect (same excess before and after).
    old = _row(opening_oh=5, w1_received=2, w1_pulled=10)
    new = _row(opening_oh=5, w1_received=2, w1_pulled=10)
    assert overpull_excess(5, 2, 10) == 3.0
    assert write_increases_overpull(old, new) is False


def test_existing_overpull_row_cannot_be_made_worse():
    old = _row(opening_oh=5, w1_received=2, w1_pulled=10)  # excess 3
    new = _row(opening_oh=5, w1_received=2, w1_pulled=14)  # excess 7
    assert write_increases_overpull(old, new) is True


def test_existing_overpull_row_can_be_corrected():
    old = _row(opening_oh=5, w1_received=2, w1_pulled=10)  # excess 3
    new = _row(opening_oh=8, w1_received=2, w1_pulled=10)  # excess 0, corrected
    assert write_increases_overpull(old, new) is False
