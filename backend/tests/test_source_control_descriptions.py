import importlib
import asyncio


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


def test_transactions_can_be_scoped_to_one_commit(monkeypatch):
    sourcectrl = _import_sourcectrl(monkeypatch)
    filters = []

    class EmptyResult:
        data = []

    class Query:
        def select(self, _columns):
            return self

        def eq(self, column, value):
            filters.append((column, value))
            return self

        def order(self, _column, desc=False):
            return self

        def range(self, _start, _end):
            return self

        def execute(self):
            return EmptyResult()

    class Supabase:
        def table(self, table):
            assert table == "commit_changes"
            return Query()

    monkeypatch.setattr(sourcectrl, "supabase_service", Supabase())

    result = asyncio.run(
        sourcectrl.get_transactions(commit_id="commit-123", auth_user={"id": "user-1"})
    )

    assert result == []
    assert ("commit_id", "commit-123") in filters
