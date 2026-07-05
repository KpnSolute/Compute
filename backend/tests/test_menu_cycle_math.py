"""Regression test for the 28-day menu cycle-day math in backend.routes.menu."""

import os
import sys
from datetime import date, timedelta

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_anchor_date_is_cycle_day_1():
    from backend.routes.menu import _cycle_day_for_date

    anchor = date(2026, 6, 28)
    assert _cycle_day_for_date(anchor, anchor) == 1


def test_anchor_plus_27_is_cycle_day_28():
    from backend.routes.menu import _cycle_day_for_date

    anchor = date(2026, 6, 28)
    assert _cycle_day_for_date(anchor + timedelta(days=27), anchor) == 28


def test_anchor_plus_28_wraps_to_cycle_day_1():
    from backend.routes.menu import _cycle_day_for_date

    anchor = date(2026, 6, 28)
    assert _cycle_day_for_date(anchor + timedelta(days=28), anchor) == 1


def test_date_before_anchor_works():
    from backend.routes.menu import _cycle_day_for_date

    anchor = date(2026, 6, 28)
    # One day before anchor wraps to the last day of the cycle.
    assert _cycle_day_for_date(anchor - timedelta(days=1), anchor) == 28
    # 28 days before anchor lands back on cycle day 1.
    assert _cycle_day_for_date(anchor - timedelta(days=28), anchor) == 1


def _run_standalone():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  PASS {fn.__name__}")
    print(f"\n{passed}/{len(fns)} menu cycle math tests passed")


if __name__ == "__main__":
    _run_standalone()
