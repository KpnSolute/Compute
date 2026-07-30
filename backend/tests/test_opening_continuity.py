"""A period must open with exactly what the prior period closed with.

Nothing enforced or detected this. A full-month workbook upload writes
`opening_oh` straight from the sheet's Opening column, and rollover is skipped
for those rows, so a sheet that disagrees with the prior period's computed
ending silently wins and the difference disappears from inventory.

Live 2026-07 (the case these tests are built from): June closed SKU 4785416
(BGAS 9X9) and 2961001 (CUP PET 9Z) at 2 each; the July sheet opened both at 0.
$281.12 vanished at the month boundary, and June closing $9,505.58 became July
opening $9,224.46 — exactly that much lower.

The knock-on matters as much as the loss: with 2 fewer cases of opening stock,
July's recorded pulls exceeded what those rows could hold, so both showed an
impossible over-pull of exactly 2, which the display clamp then added back into
Closing value. One broken invariant produced the missing money, the phantom
over-pull, and the summary cards that would not reconcile.
"""

from backend import inventory_formulas as fi


def _row(item_id, opening=0, w1r=0, w2r=0, w3r=0, w1p=0, w2p=0, w3p=0, price=0.0):
    return {
        "item_id": item_id,
        "opening_oh": opening,
        "w1_received": w1r,
        "w2_received": w2r,
        "w3_received": w3r,
        "w1_pulled": w1p,
        "w2_pulled": w2p,
        "w3_pulled": w3p,
        "unit_price": price,
    }


# June 2026, verbatim from production.
JUNE = [
    _row("bgas", opening=0, w2r=2, price=71.80),  # ends at 2
    _row("cup", opening=0, w1r=3, w3r=1, w1p=1, w2p=1, price=68.76),  # ends at 2
]
# July 2026, verbatim: both opened at 0 and were then pulled harder than they
# could support.
JULY = [
    _row("bgas", opening=0, w1r=2, w1p=2, w2p=1, w3p=1, price=71.80),
    _row("cup", opening=0, w1r=3, w2r=2, w1p=3, w2p=2, w3p=2, price=68.76),
]


def test_detects_the_live_july_discontinuity():
    result = fi.opening_continuity(JUNE, JULY)

    assert result["reconciled"] is False
    assert result["drift_rows"] == 2
    assert result["qty_drift"] == -4
    # June closed $9,505.58; July opened $9,224.46 — exactly this much lower.
    assert result["value_drift"] == -281.12

    worst = result["items"][0]
    assert worst["item_id"] == "bgas"
    assert worst["expected_opening_qty"] == 2
    assert worst["actual_opening_qty"] == 0
    assert worst["value_drift"] == -143.60


def test_the_phantom_over_pull_disappears_once_opening_is_correct():
    """With the carried stock restored, neither row is over-pulled."""
    fixed = [dict(r, opening_oh=2) for r in JULY]
    assert fi.opening_continuity(JUNE, fixed)["reconciled"] is True

    for row in fixed:
        ending = fi.ending_oh(
            row["opening_oh"],
            fi.total_received(
                row["w1_received"], row["w2_received"], row["w3_received"]
            ),
            fi.total_pulled(row["w1_pulled"], row["w2_pulled"], row["w3_pulled"]),
        )
        assert ending == 0, "should land exactly at zero, not below"
        assert not fi.is_negative_ending(
            row["opening_oh"],
            fi.total_received(
                row["w1_received"], row["w2_received"], row["w3_received"]
            ),
            fi.total_pulled(row["w1_pulled"], row["w2_pulled"], row["w3_pulled"]),
        )


def test_a_clean_rollover_reconciles():
    prior = [_row("a", opening=4, w1r=2, w1p=1, price=10.0)]  # ends at 5
    current = [_row("a", opening=5, price=10.0)]
    result = fi.opening_continuity(prior, current)
    assert result["reconciled"] is True
    assert result["drift_rows"] == 0
    assert result["value_drift"] == 0


def test_an_item_that_lost_its_whole_row_is_the_worst_case():
    """Closing with stock and having no row at all next period drops the lot."""
    prior = [_row("gone", opening=3, price=25.0)]  # ends at 3
    result = fi.opening_continuity(prior, [])
    assert result["drift_rows"] == 1
    assert result["items"][0]["missing_row"] is True
    assert result["items"][0]["value_drift"] == -75.0


def test_an_item_new_this_period_is_not_drift():
    """No prior row and opening 0 is a normal new item, not a discontinuity."""
    result = fi.opening_continuity([], [_row("new", opening=0, w1r=5, price=10.0)])
    assert result["reconciled"] is True


def test_opening_over_prior_ending_is_also_flagged():
    """Drift is signed — opening with MORE than was closed is equally wrong."""
    prior = [_row("a", opening=1, price=10.0)]  # ends at 1
    result = fi.opening_continuity(prior, [_row("a", opening=6, price=10.0)])
    assert result["reconciled"] is False
    assert result["qty_drift"] == 5
    assert result["value_drift"] == 50.0


def test_legitimate_zero_current_price_is_not_replaced_by_prior_price():
    """A real zero price must not inherit the prior period's price."""
    prior = [_row("a", opening=1, price=10.0)]
    current = [_row("a", opening=2, price=0.0)]
    result = fi.opening_continuity(prior, current)
    assert result["qty_drift"] == 1
    assert result["value_drift"] == 0.0


def test_overpull_audit_is_backend_owned_and_uses_row_pull_value():
    result = fi.overpull_audit(
        [
            _row("over", opening=0, w1p=3, price=10.0),
            _row("ok", opening=3, w1r=1, w1p=4, price=10.0),
        ]
    )

    assert result == {
        "count": 1,
        "quantity": 3.0,
        "value": 30.0,
        "triggered": True,
        "basis": "physical_quantity_equation",
    }


def test_value_reconciliation_audit_reports_physical_clamp_adjustment():
    result = fi.value_reconciliation_audit(
        [_row("empty", opening=0, w1r=1, w1p=2, price=10.0)]
    )
    assert result["raw_balance"] == -10.0
    assert result["displayed_ending"] == 0.0
    assert result["clamp_adjustment"] == 10.0
    assert result["adjusted_rows"] == 1
    assert result["reconciled"] is False
