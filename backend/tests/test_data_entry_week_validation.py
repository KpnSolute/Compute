"""Regression test: weekly upload validation must match the merge-path schema.

dispatch_inventory_week (backend/staging/dispatch.py), routes/inventory.py, and
ai/tools.py all only accept week 1-3 — the current operational template has no
W4 column. Upload validation previously allowed week=4 through, so a weekly W4
file would stage successfully and only fail later when the staged batch was
merged, leaving an unmergeable batch stuck in Source Control. Validate at the
upload boundary instead.
"""

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# backend.routes.__init__ requires real Supabase env vars at import time (same
# gate used by the routes.sourcectrl tests in test_dispatch_total_pulled.py).
_HAS_SUPABASE = bool(os.getenv("SUPABASE_URL"))
pytestmark = pytest.mark.skipif(
    not _HAS_SUPABASE, reason="SUPABASE_URL not set — routes.__init__ requires it"
)


def test_week_4_rejected_at_upload_validation():
    from backend.routes.data_entry import _validate_week
    from fastapi import HTTPException

    try:
        _validate_week(4, month=6, year=2026)
    except HTTPException as exc:
        assert exc.status_code == 422
        assert "W1-W3" in str(exc.detail)
        assert "W4" in str(exc.detail)
    else:
        raise AssertionError("week=4 should have raised HTTPException(422)")


def test_weeks_1_to_3_pass_validation():
    from backend.routes.data_entry import _validate_week

    for week in (1, 2, 3):
        _validate_week(week, month=6, year=2026)  # must not raise


def test_week_0_full_month_upload_passes_validation():
    from backend.routes.data_entry import _validate_week

    _validate_week(0, month=6, year=2026)  # full-month upload, no weekly scope


def _run_standalone():
    fns = [v for k, v in sorted(globals().items()) if k.startswith("test_")]
    passed = 0
    for fn in fns:
        fn()
        passed += 1
        print(f"  PASS {fn.__name__}")
    print(f"\n{passed}/{len(fns)} data-entry week validation tests passed")


if __name__ == "__main__":
    _run_standalone()
