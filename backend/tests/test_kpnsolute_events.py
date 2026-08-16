import json

from backend import kpnsolute_events


def test_publish_is_disabled_without_configuration(monkeypatch):
    monkeypatch.delenv("KPNSOLUTE_EVENTS_URL", raising=False)
    monkeypatch.delenv("KPNSOLUTE_EVENTS_PUBLISHER_KEY", raising=False)
    monkeypatch.delenv("KPNSOLUTE_TENANT_ID", raising=False)
    assert kpnsolute_events.publish_menu_day({"cycle_day": 1}) is False


def test_publish_emits_tenant_scoped_cloudevent(monkeypatch):
    monkeypatch.setenv("KPNSOLUTE_EVENTS_URL", "https://events.example.test")
    monkeypatch.setenv("KPNSOLUTE_EVENTS_PUBLISHER_KEY", "publisher-test-key")
    monkeypatch.setenv("KPNSOLUTE_TENANT_ID", "mjcc")
    captured = {}

    class Response:
        status_code = 202

    def fake_post(url, *, content, headers, timeout):
        captured.update(url=url, content=content, headers=headers, timeout=timeout)
        return Response()

    monkeypatch.setattr(kpnsolute_events.httpx, "post", fake_post)
    data = {
        "rotation_id": "primary",
        "cycle_day": 4,
        "meals": {"Lunch": [{"item_name": "Soup", "slot_name": "Entree"}]},
    }
    assert kpnsolute_events.publish_menu_day(data, correlation_id="request-123") is True
    event = json.loads(captured["content"])
    assert captured["url"] == "https://events.example.test/v1/events"
    assert event["specversion"] == "1.0"
    assert event["tenantid"] == "mjcc"
    assert event["type"] == kpnsolute_events.MENU_DAY_UPDATED
    assert event["correlationid"] == "request-123"
    assert event["data"] == data


def test_publish_cycle_uses_cycle_contract(monkeypatch):
    monkeypatch.setenv("KPNSOLUTE_EVENTS_URL", "https://events.example.test")
    monkeypatch.setenv("KPNSOLUTE_EVENTS_PUBLISHER_KEY", "publisher-test-key")
    monkeypatch.setenv("KPNSOLUTE_TENANT_ID", "mjcc")
    captured = {}

    class Response:
        status_code = 202

    def fake_post(url, *, content, headers, timeout):
        captured["event"] = json.loads(content)
        return Response()

    monkeypatch.setattr(kpnsolute_events.httpx, "post", fake_post)
    assert kpnsolute_events.publish_menu_cycle(
        {"rotation_id": "primary", "anchor_date": "2026-08-02", "days": []}
    )
    assert captured["event"]["type"] == kpnsolute_events.MENU_CYCLE_UPDATED
    assert captured["event"]["subject"] == "menu-rotations/primary"


def test_background_publish_uses_captured_workspace(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "enforced")
    monkeypatch.setenv("KPNSOLUTE_EVENTS_URL", "https://events.example.test")
    monkeypatch.setenv("KPNSOLUTE_EVENTS_PUBLISHER_KEY", "publisher-test-key")
    captured = {}

    class Response:
        status_code = 202

    def fake_post(url, *, content, headers, timeout):
        captured["event"] = json.loads(content)
        return Response()

    monkeypatch.setattr(kpnsolute_events.httpx, "post", fake_post)
    assert kpnsolute_events.publish_menu_day(
        {"cycle_day": 2},
        tenant={"id": "tenant-uuid", "slug": "acme"},
    )
    assert captured["event"]["tenantid"] == "tenant-uuid"
    assert captured["event"]["source"].endswith("/workspaces/acme")
