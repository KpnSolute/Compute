"""Regression test: business_now() must report the cafeteria's local
(Eastern) day, not the server's UTC day.

UTC crosses into the next day/month 4-5 hours before Eastern does (4h
during EDT, 5h during EST), which previously made period-status/rollover
logic think a new month had started while it was still the last evening
of the old one in Miami.
"""

import os
import sys
from datetime import datetime, timedelta, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def test_business_now_is_behind_utc_by_4_or_5_hours():
    from backend.periods import business_now

    utc_now = datetime.now(timezone.utc)
    eastern_now = business_now()

    # Eastern is always UTC-4 (EDT) or UTC-5 (EST) -- never same offset as UTC.
    offset = eastern_now.utcoffset()
    assert offset in (timedelta(hours=-4), timedelta(hours=-5)), (
        f"expected EDT (-4h) or EST (-5h) offset, got {offset}"
    )
    # Same instant, just relabeled -- must not drift.
    assert abs((eastern_now.astimezone(timezone.utc) - utc_now).total_seconds()) < 5


def test_late_evening_utc_month_rollover_stays_in_prior_month_locally():
    """The exact bug scenario: UTC has already flipped to day 1 of next month
    while it's still the evening of the last day of the month in Miami."""
    from backend.periods import BUSINESS_TZ

    # 2026-07-01 00:30 UTC = 2026-06-30 20:30 EDT (UTC-4 in July).
    utc_instant = datetime(2026, 7, 1, 0, 30, tzinfo=timezone.utc)
    local_instant = utc_instant.astimezone(BUSINESS_TZ)

    assert utc_instant.month == 7, "sanity check: UTC has crossed into July"
    assert local_instant.month == 6, (
        f"expected local time to still be June, got {local_instant}"
    )


def _run_standalone():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  PASS {fn.__name__}")
    print(f"\n{passed}/{len(fns)} periods/business_now tests passed")


if __name__ == "__main__":
    _run_standalone()
