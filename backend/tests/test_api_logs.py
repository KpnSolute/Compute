from backend.routes.api_logs import (
    _audit_level,
    _legacy_audit_event,
    _summarize_request_events,
    _token_actor_hint,
)


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


def test_request_stats_group_actor_route_status_and_latency():
    summary = _summarize_request_events(
        [
            {
                "actor_name": "Othniel",
                "path": "/api/inventory",
                "status_code": 200,
                "duration_ms": 10,
            },
            {
                "actor_name": "Othniel",
                "path": "/api/inventory",
                "status_code": 409,
                "duration_ms": 30,
            },
            {
                "actor_name": None,
                "actor_id": "staff-2",
                "path": "/api/logs",
                "status_code": 500,
                "duration_ms": 100,
            },
        ]
    )
    assert summary["request_count"] == 3
    assert summary["actor_count"] == 2
    assert summary["by_actor"][0] == {"actor": "Othniel", "requests": 2}
    assert summary["by_status"] == {"200": 1, "409": 1, "500": 1}
    assert summary["duration_ms"] == {"avg": 46.7, "max": 100}


def test_pin_actor_hint_contains_only_safe_staff_identity():
    assert _token_actor_hint("Bearer pin_staff-123456") == {
        "id": "staff-123456",
        "display_name": "staff:staff-12",
        "role": "staff",
    }
