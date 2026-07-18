"""Authenticated staging + approval rules.

Covers the two review-integrity gates the 2026-07-18 audit asked to see under
test:
  - check_direction_role: non-managers cannot stage issued/pulled quantities
    (shared by sourcectrl.submit_staging AND the data-entry upload path);
  - merge_pull_request segregation of duties: a PR's author (or the author of
    any entry inside it) cannot merge it unless admin/sudo.

In-memory fake Supabase per house pattern — zero network/DB.
"""

import asyncio
import os
import sys
from unittest.mock import patch

import pytest
from fastapi import HTTPException

sys.path.insert(
    0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
)

from backend.routes._deps import check_direction_role  # noqa: E402


# ── direction role-gate ──────────────────────────────────────────────────────


def test_staff_cannot_stage_issued_direction():
    with pytest.raises(HTTPException) as exc:
        check_direction_role(
            "staff", "inventory_week_update", {"direction": "issued", "items": []}
        )
    assert exc.value.status_code == 403


def test_staff_cannot_smuggle_pulled_columns_into_inventory_save():
    with pytest.raises(HTTPException) as exc:
        check_direction_role(
            "staff", "inventory_save", {"items": [{"sku": "A", "w2p": 3}]}
        )
    assert exc.value.status_code == 403


def test_staff_can_stage_received_direction():
    check_direction_role(
        "staff", "inventory_week_update", {"direction": "received", "items": []}
    )


def test_assistant_is_not_exempt():
    with pytest.raises(HTTPException):
        check_direction_role(
            "assistant", "inventory_week_update", {"direction": "issued"}
        )


@pytest.mark.parametrize("role", ["manager", "admin", "sudo"])
def test_manager_and_above_may_stage_issued(role):
    check_direction_role(role, "inventory_week_update", {"direction": "issued"})


def test_unrelated_operations_are_not_gated():
    check_direction_role("staff", "event_create", {"direction": "issued"})


# ── merge self-approval blocking ─────────────────────────────────────────────


class _Result:
    def __init__(self, data):
        self.data = data


class _Query:
    def __init__(self, rows):
        self._rows = rows

    def select(self, *_a, **_k):
        return self

    def eq(self, *_a, **_k):
        return self

    def limit(self, *_a, **_k):
        return self

    def execute(self):
        return _Result(self._rows)


class _FakeSupabase:
    def __init__(self, tables):
        self._tables = tables

    def table(self, name):
        return _Query(self._tables.get(name, []))


def _merge(pr_rows, entry_rows, auth_user):
    from backend.routes import sourcectrl

    fake = _FakeSupabase({"pull_requests": pr_rows, "staging_entries": entry_rows})
    with patch.object(sourcectrl, "supabase_service", fake):
        return asyncio.run(sourcectrl.merge_pull_request("pr-1", auth_user=auth_user))


def test_author_cannot_merge_own_pr():
    pr = {"pr_id": "pr-1", "author_id": "user-a", "status": "open", "commit_id": None}
    with pytest.raises(HTTPException) as exc:
        _merge([pr], [], {"id": "user-a", "role": "manager"})
    assert exc.value.status_code == 403
    assert "your own pull request" in exc.value.detail


def test_reviewer_cannot_merge_pr_containing_their_own_entries():
    pr = {"pr_id": "pr-1", "author_id": "user-a", "status": "open", "commit_id": None}
    entries = [{"entry_id": "e1", "submitted_by": "user-b", "status": "pending"}]
    with pytest.raises(HTTPException) as exc:
        _merge([pr], entries, {"id": "user-b", "role": "assistant"})
    assert exc.value.status_code == 403
    assert "your own staged changes" in exc.value.detail


@pytest.mark.parametrize("role", ["admin", "sudo"])
def test_admin_and_sudo_bypass_self_approval_gate(role):
    # Exempt callers get PAST the 403s; with no pending entries the merge then
    # fails 400/409-style deeper in — assert it is anything but the 403 gates.
    pr = {"pr_id": "pr-1", "author_id": "user-a", "status": "open", "commit_id": None}
    try:
        _merge([pr], [], {"id": "user-a", "role": role})
    except HTTPException as exc:
        assert exc.status_code != 403
