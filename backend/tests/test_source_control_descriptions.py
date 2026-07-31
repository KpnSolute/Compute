import importlib


def _import_sourcectrl(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setenv("SUPABASE_ANON_KEY", "anon")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "service")
    monkeypatch.setenv("SUPABASE_JWT_SECRET", "secret")
    return importlib.import_module("backend.routes.sourcectrl")


def test_pr_description_is_included_in_merge_commit_message(monkeypatch):
    sourcectrl = _import_sourcectrl(monkeypatch)

    message = sourcectrl._pr_commit_message(
        {"title": "Data Entry import - april.xlsx", "description": "May 2026"}
    )

    assert message == "Data Entry import - april.xlsx\n\nMay 2026"


def test_pr_commit_message_does_not_duplicate_title(monkeypatch):
    sourcectrl = _import_sourcectrl(monkeypatch)

    message = sourcectrl._pr_commit_message(
        {"title": "May 2026", "description": "May 2026"}
    )

    assert message == "May 2026"


def test_dispatch_exception_becomes_auditable_replay_failure(monkeypatch):
    sourcectrl = _import_sourcectrl(monkeypatch)

    def reject(_operation, _payload):
        raise RuntimeError(
            "Inventory over-pull rejected: requested 7.00, available 5.00"
        )

    result = sourcectrl._safe_replay(reject, "inventory_week_update", {})

    assert result["applied"] == 0
    assert "requested 7.00, available 5.00" in result["error"]
