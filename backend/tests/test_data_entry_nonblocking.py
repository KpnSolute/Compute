"""Workers must leave the event loop responsive and retain workspace context."""

import asyncio
import contextvars
import io
import json
import threading
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi import HTTPException, UploadFile
from botocore.exceptions import EndpointConnectionError
from postgrest.exceptions import APIError

from backend.routes import data_entry as de
from backend.routes import file_archive as fa
from backend.concurrency import inventory_write_lock


workspace = contextvars.ContextVar("upload_test_workspace")


def upload():
    return UploadFile(filename="report.csv", file=io.BytesIO(b"a,b\n1,2"))


@pytest.fixture
def prepared(monkeypatch):
    monkeypatch.setattr(de, "_data_entry_period_settings", lambda: {"max_year": 2200})
    monkeypatch.setattr(de, "_assert_not_published", lambda *args: None)
    monkeypatch.setattr(de.ctx, "get_ai_config", lambda: {"provider": "test"})
    monkeypatch.setattr(de.ctx, "get_ai_tools_config", lambda: {})
    monkeypatch.setattr(de, "archive_is_configured", lambda: False)
    monkeypatch.delenv("DATA_ENTRY_ARCHIVE_POLICY", raising=False)
    monkeypatch.setattr(de, "check_archive", lambda: {"ok": True, "reason": "ok"})
    monkeypatch.setattr(
        de,
        "_extract_ops",
        lambda *a, **k: ([{"operation": "budget_save", "payload": {}}], {}),
    )
    monkeypatch.setattr(de, "supabase_service", MagicMock())
    monkeypatch.setattr(de, "_resolve_items", lambda ops, *a, **k: (ops, []))
    monkeypatch.setattr(de, "_supersede_stale_pending", lambda *a: None)
    monkeypatch.setattr(de, "_open_weekly_import_batch", lambda *a, **k: None)
    monkeypatch.setattr(de, "_insert_sku_queue", lambda *a: 0)
    monkeypatch.setattr(de, "ensure_pr_for_entries", lambda *a, **k: {"pr_id": "pr"})
    monkeypatch.setattr(de, "_stage_entries", lambda *a: [{"entry_id": "entry"}])
    return SimpleNamespace(is_disconnected=AsyncMock(return_value=False))


async def response(request):
    return await de.upload_file(
        request,
        upload(),
        hint=None,
        month=9,
        year=2026,
        week=0,
        direction="received",
        description=None,
        overwrite=False,
        auth_user={"id": "user", "role": "manager"},
    )


async def collect(stream):
    return [event async for event in stream.body_iterator]


@pytest.mark.parametrize("blocked", ["staging", "archive"])
def test_post_parse_heartbeat_and_workspace_while_blocked(
    monkeypatch, prepared, blocked
):
    entered, release = threading.Event(), threading.Event()
    seen = []

    def block(*args, **kwargs):
        seen.append(workspace.get())
        entered.set()
        assert release.wait(3)
        return [{"entry_id": "entry"}] if blocked == "staging" else {"id": "archive"}

    if blocked == "staging":
        monkeypatch.setattr(de, "_stage_entries", block)
    else:
        monkeypatch.setattr(de, "archive_is_configured", lambda: True)
        monkeypatch.setattr(de, "archive_file_bytes", block)
    original_wait = asyncio.wait

    async def short_wait(tasks, timeout):
        return await original_wait(tasks, timeout=0.01)

    monkeypatch.setattr(de.asyncio, "wait", short_wait)

    async def run():
        token = workspace.set("tenant-two")
        try:
            stream = await response(prepared)
            task = asyncio.create_task(collect(stream))
            try:
                for _ in range(100):
                    if entered.is_set():
                        break
                    await asyncio.sleep(0.005)
                assert entered.is_set()
                await asyncio.sleep(0.04)
                assert not task.done()
                acquired = inventory_write_lock.acquire(blocking=False)
                if acquired:
                    inventory_write_lock.release()
                assert acquired is (blocked == "archive")
            finally:
                release.set()
            events = await asyncio.wait_for(task, 2)
            assert b": heartbeat\n\n" in events
            result = json.loads(events[-1][6:])
            assert result["__ok"] is True
            assert result["staging_ids"] == ["entry"]
            assert result["pr_id"] == "pr"
            assert seen == ["tenant-two"]
        finally:
            workspace.reset(token)

    asyncio.run(run())


def test_commit_lock_blocks_state_checks_and_staging_but_not_archive(
    monkeypatch, prepared
):
    archived = threading.Event()
    checked, resolved, superseded, staged = (
        MagicMock(),
        MagicMock(),
        MagicMock(),
        MagicMock(),
    )
    monkeypatch.setattr(de, "archive_is_configured", lambda: True)

    def archive(**kwargs):
        archived.set()
        return {"id": "archive"}

    # The first period check precedes parsing; only the second is serialized.
    checks = []

    def published(*args):
        checks.append("checked")
        if len(checks) > 1:
            checked()

    monkeypatch.setattr(de, "_assert_not_published", published)
    monkeypatch.setattr(de, "archive_file_bytes", archive)

    def resolve(ops, *args, **kwargs):
        resolved()
        return ops, []

    monkeypatch.setattr(de, "_resolve_items", resolve)
    monkeypatch.setattr(de, "_supersede_stale_pending", superseded)
    monkeypatch.setattr(de, "_stage_entries", staged)
    staged.return_value = [{"entry_id": "entry"}]

    async def run():
        inventory_write_lock.acquire()
        try:
            task = asyncio.create_task(collect(await response(prepared)))
            for _ in range(100):
                if archived.is_set():
                    break
                await asyncio.sleep(0.005)
            assert archived.is_set()
            await asyncio.sleep(0.03)
            checked.assert_not_called()
            resolved.assert_not_called()
            superseded.assert_not_called()
            staged.assert_not_called()
            assert not task.done()
        finally:
            inventory_write_lock.release()
        events = await asyncio.wait_for(task, 2)
        assert json.loads(events[-1][6:])["__ok"] is True
        checked.assert_called_once()
        resolved.assert_called_once()
        superseded.assert_called_once()
        staged.assert_called_once()

    asyncio.run(run())


def test_period_closed_during_parse_rejected_inside_lock(monkeypatch, prepared):
    monkeypatch.setattr(
        de,
        "_assert_not_published",
        MagicMock(side_effect=[None, HTTPException(422, "Period closed")]),
    )
    stage = MagicMock()
    monkeypatch.setattr(de, "_stage_entries", stage)

    async def run():
        events = await collect(await response(prepared))
        assert json.loads(events[-1][6:]) == {
            "__ok": False,
            "status": 422,
            "detail": "Period closed",
        }
        stage.assert_not_called()

    asyncio.run(run())


def test_cancelled_parse_never_archives_or_stages(monkeypatch, prepared):
    entered, release = threading.Event(), threading.Event()
    archive, stage = MagicMock(), MagicMock()
    monkeypatch.setattr(de, "archive_is_configured", lambda: True)
    monkeypatch.setattr(de, "archive_file_bytes", archive)
    monkeypatch.setattr(de, "_stage_entries", stage)
    prepared.is_disconnected.side_effect = [False, False, True]

    def parse(*args, **kwargs):
        entered.set()
        assert release.wait(3)
        return [{"operation": "budget_save", "payload": {}}], {}

    monkeypatch.setattr(de, "_extract_ops", parse)

    async def run():
        task = asyncio.create_task(collect(await response(prepared)))
        try:
            for _ in range(100):
                if entered.is_set():
                    break
                await asyncio.sleep(0.005)
            assert entered.is_set()
            archive.assert_not_called()
            stage.assert_not_called()
        finally:
            release.set()
        assert await asyncio.wait_for(task, 2) == []
        archive.assert_not_called()
        stage.assert_not_called()

    asyncio.run(run())


def test_staging_failure_keeps_error_and_compensation(monkeypatch, prepared):
    rollback = MagicMock()
    monkeypatch.setattr(de, "_rollback_failed_upload", rollback)
    monkeypatch.setattr(
        de, "_stage_entries", MagicMock(side_effect=RuntimeError("stage broke"))
    )

    async def run():
        events = await collect(await response(prepared))
        assert json.loads(events[-1][6:]) == {
            "__ok": False,
            "status": 500,
            "detail": "Staging failed: stage broke",
        }
        rollback.assert_called_once()

    asyncio.run(run())


@pytest.mark.parametrize(
    "error,status,detail",
    [
        (HTTPException(409, {"error": "duplicate"}), 409, {"error": "duplicate"}),
        (RuntimeError("bad parse"), 422, "Extraction failed: bad parse"),
    ],
)
def test_parse_errors_do_not_write(monkeypatch, prepared, error, status, detail):
    archive, stage = MagicMock(), MagicMock()
    monkeypatch.setattr(de, "archive_is_configured", lambda: True)
    monkeypatch.setattr(de, "archive_file_bytes", archive)
    monkeypatch.setattr(de, "_stage_entries", stage)
    monkeypatch.setattr(de, "_extract_ops", MagicMock(side_effect=error))

    async def run():
        events = await collect(await response(prepared))
        assert json.loads(events[-1][6:]) == {
            "__ok": False,
            "status": status,
            "detail": detail,
        }
        archive.assert_not_called()
        stage.assert_not_called()

    asyncio.run(run())


def test_post_parse_role_error_is_unchanged(monkeypatch, prepared):
    stage = MagicMock()
    monkeypatch.setattr(de, "_stage_entries", stage)
    monkeypatch.setattr(
        de, "check_direction_role", MagicMock(side_effect=HTTPException(403, "Denied"))
    )

    async def run():
        events = await collect(await response(prepared))
        assert json.loads(events[-1][6:]) == {
            "__ok": False,
            "status": 403,
            "detail": "Denied",
        }
        stage.assert_not_called()

    asyncio.run(run())


def test_required_archive_error_stops_staging(monkeypatch, prepared):
    stage = MagicMock()
    monkeypatch.setattr(de, "_stage_entries", stage)
    monkeypatch.setenv("DATA_ENTRY_ARCHIVE_POLICY", "required")
    monkeypatch.setattr(
        de, "archive_file_bytes", MagicMock(side_effect=RuntimeError("offline"))
    )

    async def run():
        events = await collect(await response(prepared))
        last = json.loads(events[-1][6:])
        assert last["__ok"] is False and last["status"] == 503
        assert last["detail"].startswith(
            "The original file could not be archived; parsing was stopped safely."
        )
        assert last["detail"].endswith("[archive:unknown]")
        stage.assert_not_called()

    asyncio.run(run())


def test_archive_preflight_outage_skips_parse_and_staging(monkeypatch, prepared):
    extract, stage, archive = MagicMock(), MagicMock(), MagicMock()
    monkeypatch.setattr(de, "_extract_ops", extract)
    monkeypatch.setattr(de, "_stage_entries", stage)
    monkeypatch.setattr(de, "archive_file_bytes", archive)
    monkeypatch.setenv("DATA_ENTRY_ARCHIVE_POLICY", "required")
    monkeypatch.setattr(
        de, "check_archive", lambda: {"ok": False, "reason": "storage_unreachable"}
    )

    async def run():
        events = await collect(await response(prepared))
        last = json.loads(events[-1][6:])
        assert last["status"] == 503
        assert "the file was not parsed" in last["detail"]
        assert last["detail"].endswith("[archive:storage_unreachable]")
        extract.assert_not_called()
        archive.assert_not_called()
        stage.assert_not_called()

    asyncio.run(run())


def test_archive_preflight_ambiguous_failure_still_attempts_real_write(
    monkeypatch, prepared
):
    # A key that cannot HEAD the bucket may still be able to PUT; do not block.
    archive = MagicMock(return_value={"id": "archive"})
    monkeypatch.setattr(de, "archive_file_bytes", archive)
    monkeypatch.setenv("DATA_ENTRY_ARCHIVE_POLICY", "required")
    monkeypatch.setattr(
        de, "check_archive", lambda: {"ok": False, "reason": "storage_auth_failed"}
    )

    async def run():
        events = await collect(await response(prepared))
        assert json.loads(events[-1][6:])["__ok"] is True
        archive.assert_called_once()

    asyncio.run(run())


def test_preflight_pdf_cpu_worker_preserves_context(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    seen = []
    monkeypatch.setattr(de, "_data_entry_period_settings", lambda: {})

    def classify(content):
        seen.append(workspace.get())
        entered.set()
        assert release.wait(3)
        return False

    monkeypatch.setattr(de.file_parser, "_pdf_has_native_text", classify)

    async def run():
        token = workspace.set("tenant-two")
        try:
            pdf = UploadFile(filename="scan.pdf", file=io.BytesIO(b"%PDF"))
            task = asyncio.create_task(de.preflight_pdf(pdf, {"id": "user"}))
            try:
                for _ in range(100):
                    if entered.is_set():
                        break
                    await asyncio.sleep(0.005)
                assert entered.is_set()
                assert not task.done()
            finally:
                release.set()
            result = await asyncio.wait_for(task, 2)
            assert result["image_only"] is True
            assert seen == ["tenant-two"]
        finally:
            workspace.reset(token)

    asyncio.run(run())


@pytest.mark.parametrize(
    "error,status",
    [(ValueError("bad category"), 422), (RuntimeError("storage down"), 503)],
)
def test_archive_error_mapping(error, status, monkeypatch):
    monkeypatch.setattr(fa, "archive_file_bytes", MagicMock(side_effect=error))

    async def run():
        with pytest.raises(HTTPException) as caught:
            await fa.upload_file(upload(), "document", None, 0, 0, 0, {"id": "user"})
        assert caught.value.status_code == status
        assert caught.value.detail == str(error)

    asyncio.run(run())


def test_file_archive_upload_responsive_and_context(monkeypatch):
    entered, release = threading.Event(), threading.Event()
    seen = []

    def archive(**kwargs):
        seen.append(workspace.get())
        entered.set()
        assert release.wait(3)
        return {"id": "stored"}

    monkeypatch.setattr(fa, "archive_file_bytes", archive)

    async def run():
        token = workspace.set("tenant-two")
        try:
            task = asyncio.create_task(
                fa.upload_file(upload(), "document", None, 0, 0, 0, {"id": "user"})
            )
            try:
                for _ in range(100):
                    if entered.is_set():
                        break
                    await asyncio.sleep(0.005)
                assert entered.is_set()
                assert not task.done()
            finally:
                release.set()
            assert await asyncio.wait_for(task, 2) == {"id": "stored"}
            assert seen == ["tenant-two"]
        finally:
            workspace.reset(token)

    asyncio.run(run())


@pytest.mark.parametrize(
    "reason", ["storage_unreachable", "storage_error", "storage_auth_failed", "unknown"]
)
def test_best_effort_archive_outage_stages_with_warning(monkeypatch, prepared, reason):
    monkeypatch.setenv("MJCC_ARCHIVE_REQUIRED", "true")
    monkeypatch.setattr(de, "archive_is_configured", lambda: True)
    monkeypatch.setattr(de, "check_archive", lambda: {"ok": False, "reason": reason})
    archive = MagicMock()
    monkeypatch.setattr(de, "archive_file_bytes", archive)

    async def run():
        result = json.loads((await collect(await response(prepared)))[-1][6:])
        assert result["__ok"] is True
        assert result["staged_count"] == 1
        assert result["archive_status"] == "not_saved"
        assert result["archive_file_id"] is None
        assert "Keep your copy" in result["archive_warning"]
        archive.assert_not_called()

    asyncio.run(run())


@pytest.mark.parametrize("failure", ["metadata", "write"])
def test_best_effort_archive_write_failure_stages(monkeypatch, prepared, failure):
    monkeypatch.setattr(de, "archive_is_configured", lambda: True)
    error = (
        APIError(
            {
                "message": "metadata insert unavailable",
                "code": "XX000",
                "hint": None,
                "details": None,
            }
        )
        if failure == "metadata"
        else EndpointConnectionError(endpoint_url="https://archive.invalid")
    )
    archive = MagicMock(side_effect=error)
    monkeypatch.setattr(de, "archive_file_bytes", archive)

    async def run():
        result = json.loads((await collect(await response(prepared)))[-1][6:])
        assert result["__ok"] is True
        assert result["staged_count"] == 1
        assert result["archive_status"] == "not_saved"
        assert result["archive_file_id"] is None
        assert result["archive_warning"]
        assert archive.call_args.kwargs["client_options"] == {
            "connect_timeout": 3,
            "read_timeout": 8,
            "attempts": 0,
        }

    asyncio.run(run())


@pytest.mark.parametrize("policy", ["best_effort", "disabled"])
def test_optional_unconfigured_archive_stages_with_warning(
    monkeypatch, prepared, policy
):
    monkeypatch.setenv("DATA_ENTRY_ARCHIVE_POLICY", policy)
    probe, archive = MagicMock(), MagicMock()
    monkeypatch.setattr(de, "check_archive", probe)
    monkeypatch.setattr(de, "archive_file_bytes", archive)

    async def run():
        result = json.loads((await collect(await response(prepared)))[-1][6:])
        assert result["__ok"] is True
        assert result["archive_status"] == "not_saved"
        assert result["archive_warning"]
        probe.assert_not_called()
        archive.assert_not_called()

    asyncio.run(run())


def test_best_effort_success_reports_saved_original(monkeypatch, prepared):
    monkeypatch.setattr(de, "archive_is_configured", lambda: True)
    monkeypatch.setattr(
        de, "archive_file_bytes", MagicMock(return_value={"id": "original"})
    )

    async def run():
        result = json.loads((await collect(await response(prepared)))[-1][6:])
        assert result["__ok"] is True
        assert result["archive_status"] == "saved"
        assert result["archive_file_id"] == "original"
        assert "archive_warning" not in result

    asyncio.run(run())


def test_required_unconfigured_archive_blocks_parse(monkeypatch, prepared):
    monkeypatch.setenv("DATA_ENTRY_ARCHIVE_POLICY", "required")
    monkeypatch.setattr(
        de, "check_archive", lambda: {"ok": False, "reason": "not_configured"}
    )
    extract, stage = MagicMock(), MagicMock()
    monkeypatch.setattr(de, "_extract_ops", extract)
    monkeypatch.setattr(de, "_stage_entries", stage)

    async def run():
        result = json.loads((await collect(await response(prepared)))[-1][6:])
        assert result["__ok"] is False
        assert result["status"] == 503
        assert result["detail"].endswith("[archive:not_configured]")
        extract.assert_not_called()
        stage.assert_not_called()

    asyncio.run(run())


def test_disabled_archive_skips_configured_storage(monkeypatch, prepared):
    monkeypatch.setenv("DATA_ENTRY_ARCHIVE_POLICY", "disabled")
    monkeypatch.setattr(de, "archive_is_configured", lambda: True)
    probe, archive = MagicMock(), MagicMock()
    monkeypatch.setattr(de, "check_archive", probe)
    monkeypatch.setattr(de, "archive_file_bytes", archive)

    async def run():
        result = json.loads((await collect(await response(prepared)))[-1][6:])
        assert result["__ok"] is True
        assert result["archive_status"] == "not_saved"
        probe.assert_not_called()
        archive.assert_not_called()

    asyncio.run(run())


def test_invalid_archive_policy_rejected_before_parse(monkeypatch, prepared):
    monkeypatch.setenv("DATA_ENTRY_ARCHIVE_POLICY", "typo")
    extract = MagicMock()
    monkeypatch.setattr(de, "_extract_ops", extract)
    with pytest.raises(HTTPException) as error:
        asyncio.run(response(prepared))
    assert error.value.status_code == 503
    extract.assert_not_called()
