from backend.routes.api_logs import _audit_level, _legacy_audit_event


def test_audit_event_maps_to_legacy_log_shape():
    event = _legacy_audit_event(
        {
            "id": "evt-1",
            "created_at": "2026-07-29T23:00:00+00:00",
            "actor_name": "Othniel",
            "actor_role": "manager",
            "action": "commit.approve",
            "target_type": "commit",
            "target_id": "commit-1",
            "result": "merged",
            "request_id": "req-1",
        }
    )
    assert event["type"] == "audit"
    assert event["message"] == "commit.approve -> merged"
    assert event["user"] == "Othniel"
    assert event["target"] == "commit/commit-1"
    assert event["request_id"] == "req-1"


def test_audit_result_levels_are_safe_for_legacy_filters():
    assert _audit_level("failed") == "error"
    assert _audit_level("rejected") == "warn"
    assert _audit_level("merged") == "info"
