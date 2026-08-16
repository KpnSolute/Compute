import os
import json
import base64
import httpx
from datetime import datetime, timezone
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException
from backend.routes import supabase_service
from backend.routes._deps import _require_admin_or_manager
from backend.tenancy import current_tenant, tenant_scope
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/api/github-sync")


GITHUB_TOKEN = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO = os.getenv("GITHUB_REPO", "MJCC-Portal/mjcc")
GITHUB_API = "https://api.github.com"
MAX_ATTEMPTS = 3


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
    supabase = supabase_service
    queue_r = (
        supabase.table("github_sync_queue")
        .select("*")
        .is_("synced_at", "null")
        .lt("attempts", MAX_ATTEMPTS)
        .order("created_at")
        .limit(10)
        .execute()
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

            # Mark queue row synced
            supabase.table("github_sync_queue").update(
                {
                    "synced_at": now,
                    "last_error": None,
                }
            ).eq("id", queue_id).execute()

            # Write SHA back to commits row
            if commit_id:
                supabase.table("commits").update(
                    {
                        "github_sha": sha,
                        "github_synced_at": now,
                    }
                ).eq("commit_id", commit_id).execute()

            results["processed"] += 1
        except Exception as e:
            supabase.table("github_sync_queue").update(
                {
                    "attempts": row["attempts"] + 1,
                    "last_error": str(e)[:500],
                }
            ).eq("id", queue_id).execute()
            results["failed"] += 1

    results["skipped"] = 0
    return results


async def _drain_queue_for_tenant(context):
    if context is None:
        return await _drain_queue()
    with tenant_scope(context):
        return await _drain_queue()


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
async def sync_status(auth_user: dict = Depends(_require_admin_or_manager)):
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
