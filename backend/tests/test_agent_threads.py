"""MyAI conversation threads: the per-user cap and the ownership boundary.

These exercise the helpers directly, the way the other route tests here do,
with a fake standing in for the Supabase client. The ownership cases matter
most: the agent store leaked across accounts once already, so "a thread is
only reachable by its owner" is pinned down rather than assumed.
"""

import pytest
from fastapi import HTTPException

from backend.routes import agent


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    """Records the fluent chain so a test can assert what was filtered on."""

    def __init__(self, table, store):
        self.table = table
        self.store = store
        self.op = "select"
        self.filters: dict = {}
        self.payload = None

    def select(self, *_args, **_kwargs):
        return self

    def insert(self, row):
        self.op = "insert"
        self.payload = row
        return self

    def update(self, row):
        self.op = "update"
        self.payload = row
        return self

    def delete(self):
        self.op = "delete"
        return self

    def eq(self, column, value):
        self.filters[column] = value
        return self

    def order(self, *_args, **_kwargs):
        return self

    def limit(self, *_args, **_kwargs):
        return self

    def execute(self):
        return self.store.run(self)


class FakeDB:
    def __init__(self, threads=None, turns=None):
        self.threads = [dict(t) for t in (threads or [])]
        self.turns = [dict(t) for t in (turns or [])]
        self.calls: list[tuple] = []

    def table(self, name):
        return _Query(name, self)

    def run(self, query):
        self.calls.append((query.table, query.op, dict(query.filters)))
        rows = self.threads if query.table == "agent_threads" else self.turns
        if query.op == "insert":
            row = dict(query.payload)
            row.setdefault("id", f"thread-{len(rows) + 1}")
            rows.append(row)
            return _Result([row])
        matched = [
            row
            for row in rows
            if all(row.get(key) == value for key, value in query.filters.items())
        ]
        if query.op == "delete":
            for row in matched:
                rows.remove(row)
        elif query.op == "update":
            for row in matched:
                row.update(query.payload)
        return _Result(matched)


def _install(monkeypatch, db):
    monkeypatch.setattr(agent, "supabase_service", db)
    return db


def _threads_for(user_id, count):
    return [
        {"id": f"thread-{i}", "user_id": user_id, "title": f"Chat {i}"}
        for i in range(1, count + 1)
    ]


def test_create_thread_refuses_past_the_cap(monkeypatch):
    db = _install(
        monkeypatch, FakeDB(threads=_threads_for("user-1", agent.MAX_THREADS))
    )

    with pytest.raises(HTTPException) as exc:
        agent._create_thread("user-1")

    assert exc.value.status_code == 409
    assert str(agent.MAX_THREADS) in exc.value.detail
    assert len(db.threads) == agent.MAX_THREADS


def test_create_thread_allowed_one_below_the_cap(monkeypatch):
    db = _install(
        monkeypatch, FakeDB(threads=_threads_for("user-1", agent.MAX_THREADS - 1))
    )

    created = agent._create_thread("user-1", "Menu planning")

    assert created["title"] == "Menu planning"
    assert len(db.threads) == agent.MAX_THREADS


def test_another_users_threads_do_not_count_toward_my_cap(monkeypatch):
    _install(
        monkeypatch,
        FakeDB(threads=_threads_for("someone-else", agent.MAX_THREADS)),
    )

    created = agent._create_thread("user-1")

    assert created["user_id"] == "user-1"


def test_thread_row_requires_a_matching_owner(monkeypatch):
    db = _install(
        monkeypatch,
        FakeDB(threads=[{"id": "thread-1", "user_id": "owner", "title": "Private"}]),
    )

    assert agent._thread_row("thread-1", "owner") is not None
    assert agent._thread_row("thread-1", "intruder") is None
    # Ownership is part of the query, not a check applied afterwards.
    assert all("user_id" in filters for _table, _op, filters in db.calls)


def test_resolve_thread_rejects_a_thread_owned_by_someone_else(monkeypatch):
    _install(
        monkeypatch,
        FakeDB(threads=[{"id": "thread-1", "user_id": "owner", "title": "Private"}]),
    )

    with pytest.raises(HTTPException) as exc:
        agent._resolve_thread("intruder", "thread-1")

    assert exc.value.status_code == 404


def test_resolve_thread_rejects_an_unknown_thread(monkeypatch):
    _install(monkeypatch, FakeDB())

    with pytest.raises(HTTPException) as exc:
        agent._resolve_thread("user-1", "no-such-thread")

    assert exc.value.status_code == 404


def test_resolve_thread_opens_a_first_conversation_when_none_exists(monkeypatch):
    db = _install(monkeypatch, FakeDB())

    thread = agent._resolve_thread("user-1", None)

    assert thread["user_id"] == "user-1"
    assert len(db.threads) == 1


def test_resolve_thread_without_an_id_reuses_the_existing_one(monkeypatch):
    db = _install(
        monkeypatch,
        FakeDB(threads=[{"id": "thread-1", "user_id": "user-1", "title": "Chat"}]),
    )

    thread = agent._resolve_thread("user-1", None)

    assert thread["id"] == "thread-1"
    assert len(db.threads) == 1


def test_create_thread_defaults_and_clamps_the_title(monkeypatch):
    _install(monkeypatch, FakeDB())

    assert agent._create_thread("user-1", "   ")["title"] == "New chat"
    assert agent._create_thread("user-1", None)["title"] == "New chat"
    assert len(agent._create_thread("user-1", "x" * 200)["title"]) == 80


def test_history_is_scoped_to_one_conversation(monkeypatch):
    db = _install(monkeypatch, FakeDB())

    agent._load_history("user-1", limit=10, thread_id="thread-1")

    _table, _op, filters = db.calls[-1]
    assert filters == {"user_id": "user-1", "thread_id": "thread-1"}


def test_history_without_a_thread_returns_the_whole_log(monkeypatch):
    db = _install(monkeypatch, FakeDB())

    agent._load_history("user-1", limit=10)

    _table, _op, filters = db.calls[-1]
    assert filters == {"user_id": "user-1"}


def test_stored_turns_carry_the_conversation(monkeypatch):
    db = _install(monkeypatch, FakeDB())

    agent._store_turn("user-1", "user", "hello", thread_id="thread-1")

    assert db.turns[-1]["thread_id"] == "thread-1"


def test_stored_turns_omit_the_conversation_when_absent(monkeypatch):
    db = _install(monkeypatch, FakeDB())

    agent._store_turn("user-1", "user", "hello")

    assert "thread_id" not in db.turns[-1]


class BrokenThreadsDB(FakeDB):
    """A database where agent_threads does not exist yet.

    This is the real state between deploying the code and applying migration
    055, so the assistant has to keep working through it.
    """

    def run(self, query):
        if query.table == "agent_threads":
            raise RuntimeError('relation "agent_threads" does not exist')
        return super().run(query)


def test_conversations_are_optional_when_the_table_is_missing(monkeypatch):
    _install(monkeypatch, BrokenThreadsDB())

    assert agent._resolve_thread("user-1", None) is None


def test_listing_conversations_is_empty_when_the_table_is_missing(monkeypatch):
    _install(monkeypatch, BrokenThreadsDB())

    assert agent._list_threads("user-1") == []


def test_turns_still_record_when_conversations_are_unavailable(monkeypatch):
    db = _install(monkeypatch, BrokenThreadsDB())

    agent._store_turn("user-1", "user", "still works", thread_id=None)

    assert db.turns[-1]["content"] == "still works"
    assert "thread_id" not in db.turns[-1]
