import os
import json
import base64
import asyncio
import logging
import threading
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from backend.routes import supabase_admin, supabase_service
from backend.routes._deps import _require_admin_or_manager
from backend.tenancy import TenantContext, current_tenant, tenant_scope
from dotenv import load_dotenv
from starlette.concurrency import run_in_threadpool

load_dotenv()

router = APIRouter(prefix="/api/github-sync")


GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO = os.getenv("GITHUB_REPO", "MJCC-Portal/mjcc")
GITHUB_API = "https://api.github.com"
MAX_ATTEMPTS = 3
ARCHIVE_POLL_INTERVAL = 30
TENANT_PAGE_SIZE = 100
_drain_lock = threading.Lock()
log = logging.getLogger("mjcc.github_sync")


def _gh_headers() -> dict:
    return {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github.v3+json",
        "Content-Type": "application/json",
    }


async def _push_to_github(commit_id: str, payload: dict) -> str:
    """Push a JSON snapshot to MJCC-Portal/mjcc, return the blob SHA."""
    path = f"archives/{commit_id}.json"
    content = base64.b64encode(json.dumps(payload, default=str).encode()).decode()
    url = f"{GITHUB_API}/repos/{GITHUB_REPO}/contents/{path}"

    async with httpx.AsyncClient(timeout=15) as client:
        # Check if file already exists (need its SHA to update)
        existing = await client.get(url, headers=_gh_headers())
        body: dict = {
            "message": payload.get("message", f"archive: commit {commit_id[:8]}"),
            "content": content,
        }
        if existing.status_code == 200:
            body["sha"] = existing.json().get("sha")

        resp = await client.put(url, headers=_gh_headers(), json=body)
        if resp.status_code not in (200, 201):
            raise RuntimeError(f"GitHub API {resp.status_code}: {resp.text[:200]}")
        return resp.json()["content"]["sha"]


async def _drain_queue():
    """Process pending github_sync_queue rows."""
    # Nonblocking acquisition works across event loops without occupying a worker
    # while waiting. Cancellation before acquisition cannot leak the lock.
    while not _drain_lock.acquire(blocking=False):
        await asyncio.sleep(0.01)
    try:
        return await _drain_queue_locked()
    finally:
        _drain_lock.release()


async def _drain_queue_locked():
    supabase = supabase_service
    queue_r = await run_in_threadpool(
        lambda: (
            supabase.table("github_sync_queue")
            .select("*")
            .is_("synced_at", "null")
            .lt("attempts", MAX_ATTEMPTS)
            .order("created_at")
            .limit(10)
            .execute()
        )
    )
    rows = queue_r.data or []
    results = {"processed": 0, "failed": 0, "skipped": 0}

    for row in rows:
        queue_id = row["id"]
        commit_id = row.get("commit_id")
        payload = row.get("payload", {})

        try:
            sha = await _push_to_github(commit_id, payload)
            now = datetime.now(timezone.utc).isoformat()

            # Write SHA back to commits row
            if commit_id:
                await run_in_threadpool(
                    lambda: (
                        supabase.table("commits")
                        .update(
                            {
                                "github_sha": sha,
                                "github_synced_at": now,
                            }
                        )
                        .eq("commit_id", commit_id)
                        .execute()
                    )
                )

            # A row is complete only after its commit metadata is durable.
            # If that write fails or the process restarts, the row stays eligible
            # for an idempotent upload and retry on the next poll.
            await run_in_threadpool(
                lambda: (
                    supabase.table("github_sync_queue")
                    .update({"synced_at": now, "last_error": None})
                    .eq("id", queue_id)
                    .execute()
                )
            )
            results["processed"] += 1
        except Exception as e:
            error = str(e)[:500]
            await run_in_threadpool(
                lambda: (
                    supabase.table("github_sync_queue")
                    .update(
                        {
                            "attempts": row["attempts"] + 1,
                            "last_error": error,
                        }
                    )
                    .eq("id", queue_id)
                    .execute()
                )
            )
            results["failed"] += 1

    results["skipped"] = 0
    return results


async def _drain_queue_for_tenant(context):
    if context is None:
        return await _drain_queue()
    with tenant_scope(context):
        return await _drain_queue()


def _archive_tenants_page(offset: int) -> list[dict]:
    # Only discovery uses the unscoped admin client. Queue and commit access
    # continues through supabase_service inside an explicit tenant scope.
    return (
        supabase_admin.table("tenants")
        .select("id,slug")
        .order("id")
        .range(offset, offset + TENANT_PAGE_SIZE - 1)
        .execute()
    ).data or []


async def _poll_archive_queues(stop: asyncio.Event | None = None) -> None:
    if not GITHUB_TOKEN:
        return
    offset = 0
    while stop is None or not stop.is_set():
        tenants = await run_in_threadpool(_archive_tenants_page, offset)
        for tenant in tenants:
            if stop is not None and stop.is_set():
                return
            try:
                context = TenantContext(
                    id=str(tenant["id"]), slug=tenant["slug"], name=tenant["slug"]
                )
                result = await _drain_queue_for_tenant(context)
                if result["failed"]:
                    log.warning(
                        "Archive queue poll: %d failed uploads", result["failed"]
                    )
            except Exception as exc:
                # Exception text can contain credentials, URLs or payloads.
                # Log the failure class only; the queue retains retry state.
                log.warning("Archive tenant poll failed (%s)", type(exc).__name__)
        if len(tenants) < TENANT_PAGE_SIZE:
            return
        offset += TENANT_PAGE_SIZE


async def poll_archive_queue(stop: asyncio.Event) -> None:
    """Resume durable pending archives on startup, then poll every 30 seconds."""
    if not GITHUB_TOKEN:
        log.warning(
            "Automatic archive sync is disabled: GitHub token is not configured"
        )
    while not stop.is_set():
        try:
            await _poll_archive_queues(stop)
        except Exception as exc:
            log.warning("Archive queue discovery failed (%s)", type(exc).__name__)
        try:
            await asyncio.wait_for(stop.wait(), timeout=ARCHIVE_POLL_INTERVAL)
        except asyncio.TimeoutError:
            pass


@router.post("/run")
async def run_sync(
    background_tasks: BackgroundTasks,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Drain the github_sync_queue. Runs in background, returns immediately."""
    if not GITHUB_TOKEN:
        raise HTTPException(status_code=503, detail="GITHUB_TOKEN not configured.")
    background_tasks.add_task(_drain_queue_for_tenant, current_tenant())
    return {"ok": True, "message": "Sync queued in background."}


@router.get("/status")
def sync_status(auth_user: dict = Depends(_require_admin_or_manager)):
    """Return queue counts plus the latest sync rows for archive visibility."""
    try:
        all_r = (
            supabase_service.table("github_sync_queue")
            .select("attempts,synced_at")
            .execute()
        )
        rows = all_r.data or []
        recent_r = (
            supabase_service.table("github_sync_queue")
            .select("id,operation,commit_id,attempts,last_error,synced_at,created_at")
            .order("created_at", desc=True)
            .limit(25)
            .execute()
        )
        return {
            "total": len(rows),
            "synced": sum(1 for r in rows if r.get("synced_at")),
            "pending": sum(
                1
                for r in rows
                if not r.get("synced_at") and (r.get("attempts") or 0) < MAX_ATTEMPTS
            ),
            "failed": sum(
                1
                for r in rows
                if not r.get("synced_at") and (r.get("attempts") or 0) >= MAX_ATTEMPTS
            ),
            "recent": recent_r.data or [],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
