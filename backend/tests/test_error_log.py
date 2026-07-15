"""Durable error persistence is best-effort, capped, and never raises.

record_error() feeds the error_logs table from the exception handlers. It must
never add a failure of its own — a logging error must not mask the real one — and
it must bound field sizes so a huge traceback can't bloat a row.
"""

from backend import error_log


def _capture_rows(monkeypatch):
    rows = []
    monkeypatch.setattr(error_log, "_blocking_insert", lambda row: rows.append(row))
    # Run submitted work inline so the test can assert on it deterministically.
    monkeypatch.setattr(error_log._executor, "submit", lambda fn, row: fn(row) or rows)
    return rows


def test_record_error_builds_expected_row(monkeypatch):
    rows = _capture_rows(monkeypatch)
    error_log.record_error(
        method="POST",
        path="/api/data-entry/upload",
        status_code=422,
        error_type="HTTPException",
        detail="invoice_quantity_reconciliation_failed",
        user_hint="othniel@mjc-cafeteria.com",
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["method"] == "POST"
    assert row["status_code"] == 422
    assert row["detail"] == "invoice_quantity_reconciliation_failed"
    assert row["user_hint"] == "othniel@mjc-cafeteria.com"
    assert row["traceback"] is None


def test_record_error_caps_long_fields(monkeypatch):
    rows = _capture_rows(monkeypatch)
    error_log.record_error(
        method="GET",
        path="/x",
        status_code=500,
        error_type="ValueError",
        detail="D" * 9000,
        traceback_str="T" * 20000,
    )
    row = rows[0]
    assert len(row["detail"]) == 4000
    assert len(row["traceback"]) == 8000


def test_record_error_never_raises_on_bad_input(monkeypatch):
    # Even if submit blows up, record_error swallows it (logging must not recurse).
    def boom(*a, **k):
        raise RuntimeError("pool down")

    monkeypatch.setattr(error_log._executor, "submit", boom)
    # Should not raise.
    error_log.record_error(
        method="GET", path="/x", status_code=500, error_type="X", detail="y"
    )
