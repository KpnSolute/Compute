"""Phase 5: durable audit events — who / what / when / target / result.

Two release gates depend on this record existing and being honest:
  * "a staged Source Control request cannot be traced to a final outcome"
  * "a logout event lacks a reason"

Like error_log, recording must never raise, never block the action it
describes, and never carry credentials.
"""

from backend import audit_events


def _capture_rows(monkeypatch):
    rows = []
    monkeypatch.setattr(audit_events, "_blocking_insert", lambda row: rows.append(row))
    # Run submitted work inline so assertions are deterministic.
    monkeypatch.setattr(
        audit_events._executor, "submit", lambda fn, row: fn(row) or rows
    )
    return rows


def test_records_full_who_what_target_result(monkeypatch):
    rows = _capture_rows(monkeypatch)
    audit_events.record_audit_event(
        action="staging.submit:inventory_week_update",
        result="staged",
        actor={"id": "u-1", "display_name": "Othniel", "role": "manager"},
        method="POST",
        path="/api/staging",
        target_type="inventory",
        target_id="item-9",
        sku="3383435",
        category="Disposables",
        period_month=6,
        period_year=2026,
        staging_id="stg-1",
        pr_id="pr-7",
        status_code=201,
        duration_ms=42,
        request_id="req-abc",
    )
    assert len(rows) == 1
    row = rows[0]
    assert row["actor_id"] == "u-1"
    assert row["actor_name"] == "Othniel"
    assert row["actor_role"] == "manager"
    assert row["action"] == "staging.submit:inventory_week_update"
    assert row["result"] == "staged"
    assert row["sku"] == "3383435"
    assert row["period_month"] == 6 and row["period_year"] == 2026
    assert row["staging_id"] == "stg-1" and row["pr_id"] == "pr-7"
    assert row["status_code"] == 201 and row["duration_ms"] == 42
    assert row["request_id"] == "req-abc"


def test_unknown_result_is_coerced_to_failed(monkeypatch):
    """An unrecognised outcome must not create a state the gate can't see."""
    rows = _capture_rows(monkeypatch)
    audit_events.record_audit_event(action="commit.approve", result="probably-fine")
    assert rows[0]["result"] == "failed"


def test_session_teardown_always_carries_a_reason(monkeypatch):
    rows = _capture_rows(monkeypatch)
    audit_events.record_audit_event(
        action="session.teardown",
        result="expired",
        session_reason="idle",
        detail="no activity for 31 min",
    )
    assert rows[0]["session_reason"] == "idle"
    assert rows[0]["result"] == "expired"


def test_request_id_falls_back_to_the_context_var(monkeypatch):
    rows = _capture_rows(monkeypatch)
    token = audit_events.current_request_id.set("req-from-middleware")
    try:
        audit_events.record_audit_event(action="commit.approve", result="merged")
    finally:
        audit_events.current_request_id.reset(token)
    assert rows[0]["request_id"] == "req-from-middleware"


def test_detail_is_capped(monkeypatch):
    rows = _capture_rows(monkeypatch)
    audit_events.record_audit_event(action="x", result="failed", detail="D" * 9000)
    assert len(rows[0]["detail"]) == 4000


def test_never_raises_when_the_pool_is_down(monkeypatch):
    def boom(*a, **k):
        raise RuntimeError("pool down")

    monkeypatch.setattr(audit_events._executor, "submit", boom)
    # Must not raise — an audit failure cannot take down the audited action.
    audit_events.record_audit_event(action="staging.submit", result="staged")
