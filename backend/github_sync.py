"""
github_sync.py — GitHub API integration for MJCC data store.

Every inventory commit writes a JSON snapshot to MJCC-Portal/mjcc.
All writes are async (background thread) so they never block HTTP responses.
If GitHub is unreachable, the operation is queued in Supabase and retried.

Environment variables required:
    GITHUB_TOKEN   — PAT with contents:write on MJCC-Portal/mjcc
    GITHUB_REPO    — e.g. "MJCC-Portal/mjcc"
    GITHUB_BRANCH  — default "main"
"""

import base64
import json
import logging
import os
import threading
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv

load_dotenv()

logger = logging.getLogger(__name__)

GITHUB_TOKEN  = os.getenv("GITHUB_TOKEN", "")
GITHUB_REPO   = os.getenv("GITHUB_REPO", "MJCC-Portal/mjcc")
GITHUB_BRANCH = os.getenv("GITHUB_BRANCH", "main")

_CATEGORY_ORDER = [
    "Dairy", "Cereal", "Beverages", "Snacks", "Dry Goods",
    "Produce & Fresh", "Protein & Meat", "Frozen Foods", "Supplies",
]


# ── Errors ────────────────────────────────────────────────────────────

class GitHubDownError(Exception):
    """GitHub API is unreachable — network, DNS, or service outage."""


class GitHubAPIError(Exception):
    """GitHub returned a 4xx or 5xx response."""
    def __init__(self, status: int, message: str):
        self.status = status
        super().__init__(f"GitHub API {status}: {message}")


# ── Low-level HTTP ────────────────────────────────────────────────────

def _api(method: str, path: str, body: dict | None = None) -> dict:
    """
    Make a GitHub REST API call.
    path is relative, e.g. "/repos/MJCC-Portal/mjcc/contents/data/inventory/2026-05.json"
    Raises GitHubDownError on network failure, GitHubAPIError on 4xx/5xx.
    """
    if not GITHUB_TOKEN:
        raise GitHubAPIError(0, "GITHUB_TOKEN not configured")

    url = f"https://api.github.com{path}"
    headers = {
        "Authorization": f"Bearer {GITHUB_TOKEN}",
        "Accept": "application/vnd.github+json",
        "Content-Type": "application/json",
        "X-GitHub-Api-Version": "2022-11-28",
    }

    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(url, data=data, headers=headers, method=method)

    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            return json.loads(resp.read().decode())
    except urllib.error.HTTPError as e:
        raw = e.read().decode()
        try:
            msg = json.loads(raw).get("message", raw)
        except Exception:
            msg = raw[:200]
        raise GitHubAPIError(e.code, msg)
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise GitHubDownError(str(e))


def is_available() -> bool:
    """Quick health check — True if GitHub API is reachable."""
    try:
        _api("GET", "/zen")
        return True
    except (GitHubDownError, GitHubAPIError):
        return False


# ── File operations ───────────────────────────────────────────────────

def get_file_sha(path: str) -> str | None:
    """
    Return the current blob SHA for a file, or None if it doesn't exist.
    Required by GitHub API before updating an existing file.
    """
    try:
        data = _api("GET", f"/repos/{GITHUB_REPO}/contents/{path}?ref={GITHUB_BRANCH}")
        return data.get("sha")
    except GitHubAPIError as e:
        if e.status == 404:
            return None
        raise


def put_file(path: str, content: str, message: str, author_name: str,
             max_retries: int = 3) -> str:
    """
    Create or update a file in the data store repo.

    content   — plain string (UTF-8), function handles base64 encoding
    message   — Git commit message
    author    — display name of the person who triggered this

    Returns the GitHub commit SHA.
    Retries on 409 Conflict (optimistic lock — two writers at same instant).
    """
    content_b64 = base64.b64encode(content.encode()).decode()

    for attempt in range(max_retries):
        sha = get_file_sha(path)

        body: dict[str, Any] = {
            "message": message,
            "content": content_b64,
            "branch":  GITHUB_BRANCH,
            "committer": {
                "name":  author_name or "MJCC Portal",
                "email": "mjcc@food-service.local",
            },
        }
        if sha:
            body["sha"] = sha

        try:
            result = _api("PUT", f"/repos/{GITHUB_REPO}/contents/{path}", body)
            return result["commit"]["sha"]
        except GitHubAPIError as e:
            if e.status == 409 and attempt < max_retries - 1:
                # Optimistic lock conflict — re-read SHA and retry
                logger.warning(f"GitHub 409 on {path}, retry {attempt + 1}/{max_retries}")
                time.sleep(0.5 * (attempt + 1))
                continue
            raise

    raise GitHubAPIError(409, f"Conflict on {path} after {max_retries} retries")


def list_files(path: str) -> list[dict]:
    """
    List files in a directory in the data store repo.
    Returns list of {name, path, sha, size, download_url, type}.
    """
    try:
        result = _api("GET", f"/repos/{GITHUB_REPO}/contents/{path}?ref={GITHUB_BRANCH}")
        if isinstance(result, list):
            return result
        return []
    except GitHubAPIError as e:
        if e.status == 404:
            return []
        raise


def get_file_content(path: str) -> str:
    """
    Fetch and decode a file's content from the data store repo.
    Used by the archives pages to read historical JSON files.
    """
    data = _api("GET", f"/repos/{GITHUB_REPO}/contents/{path}?ref={GITHUB_BRANCH}")
    raw  = data.get("content", "")
    # GitHub wraps base64 in newlines
    return base64.b64decode(raw.replace("\n", "")).decode()


# ── Serialisation ─────────────────────────────────────────────────────

def _serialize_inventory(month: int, year: int, inv_data: dict,
                          commit_id: str | None = None) -> str:
    """
    Produce the canonical JSON string for an inventory snapshot.
    Categories are in fixed order; items sorted by desc within each category.
    This deterministic order makes git diff output human-readable.
    """
    month_names = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"]

    meta = {
        "_meta": {
            "month":        month,
            "year":         year,
            "month_name":   month_names[month] if 0 <= month <= 11 else "",
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "commit_id":    commit_id,
            "github_sha":   None,
        }
    }

    ordered: dict[str, list] = {}
    for cat in _CATEGORY_ORDER:
        if cat in inv_data:
            items = sorted(inv_data[cat], key=lambda i: i.get("desc", i.get("description", "")))
            ordered[cat] = items
    # Any extra categories not in the standard order go last
    for cat, items in inv_data.items():
        if cat not in ordered:
            ordered[cat] = sorted(items, key=lambda i: i.get("desc", i.get("description", "")))

    payload = {**meta, **ordered}
    return json.dumps(payload, indent=2, ensure_ascii=False)


# ── High-level push operations ────────────────────────────────────────

def push_inventory_snapshot(month: int, year: int, inv_data: dict,
                             commit_id: str, author_name: str,
                             message: str) -> str:
    """
    Write data/inventory/YYYY-MM.json to the data store repo.
    Called after every inventory commit. Overwrites the file for that month.
    Returns GitHub commit SHA.
    """
    path    = f"data/inventory/{year}-{str(month + 1).zfill(2)}.json"
    content = _serialize_inventory(month, year, inv_data, commit_id)
    sha     = put_file(path, content, message, author_name)
    logger.info(f"Pushed inventory snapshot {path} → {sha[:12]}")
    return sha


def push_archive_snapshot(month: int, year: int, inv_data: dict,
                           author_name: str) -> str:
    """
    Write data/archives/snapshots/YYYY-MM.json — immutable month-end record.
    Only called from rollover. Will not overwrite if the file already exists.
    Returns GitHub commit SHA.
    """
    path = f"data/archives/snapshots/{year}-{str(month + 1).zfill(2)}.json"

    # Check if already exists — never overwrite an archived snapshot
    if get_file_sha(path) is not None:
        logger.info(f"Archive snapshot {path} already exists — skipping")
        return ""

    month_names = ["January","February","March","April","May","June",
                   "July","August","September","October","November","December"]
    month_name  = month_names[month] if 0 <= month <= 11 else str(month)
    content     = _serialize_inventory(month, year, inv_data)
    message     = f"archive: {month_name} {year} month-end snapshot"
    sha         = put_file(path, content, message, author_name)
    logger.info(f"Pushed archive snapshot {path} → {sha[:12]}")
    return sha


def push_invoice_archive(date_str: str, invoice_text: str,
                          matches: list, author_name: str) -> str:
    """
    Write data/archives/invoices/YYYY-MM-DD-{n}.json.
    date_str format: "2026-05-31"
    Returns GitHub commit SHA.
    """
    # Find a free filename (avoid collision if multiple invoices same day)
    base = f"data/archives/invoices/{date_str}"
    for n in range(1, 20):
        path = f"{base}-{n}.json" if n > 1 else f"{base}.json"
        if get_file_sha(path) is None:
            break

    content = json.dumps({
        "date":     date_str,
        "applied_at": datetime.now(timezone.utc).isoformat(),
        "applied_by": author_name,
        "raw_text": invoice_text[:5000],  # cap size
        "matches":  matches,
    }, indent=2)

    sha = put_file(path, content, f"invoice: applied {date_str}", author_name)
    logger.info(f"Pushed invoice archive {path} → {sha[:12]}")
    return sha


def push_menu_cycle(cycle_data: dict, author_name: str, message: str = "") -> str:
    """Write data/menu/cycle.json."""
    content = json.dumps(cycle_data, indent=2)
    msg     = message or "menu: update 28-day cycle"
    sha     = put_file("data/menu/cycle.json", content, msg, author_name)
    logger.info(f"Pushed menu cycle → {sha[:12]}")
    return sha


# ── Async wrapper + Supabase queue ────────────────────────────────────

def _get_db():
    """Lazy import to avoid circular dependency with supabase_client."""
    from backend.supabase_client import get_client
    return get_client()


def _enqueue(operation: str, payload: dict, commit_id: str | None = None):
    """Store a failed sync operation in Supabase for retry."""
    try:
        db = _get_db()
        db.table("github_sync_queue").insert({
            "operation":  operation,
            "payload":    payload,
            "commit_id":  commit_id,
            "attempts":   1,
        }).execute()
        logger.info(f"Queued {operation} for retry")
    except Exception as e:
        logger.error(f"Failed to enqueue {operation}: {e}")


def _store_sha(commit_id: str, sha: str):
    """Write the GitHub SHA back into the commits row."""
    try:
        db = _get_db()
        db.table("commits").update({
            "github_sha":       sha,
            "github_synced_at": datetime.now(timezone.utc).isoformat(),
        }).eq("commit_id", commit_id).execute()
    except Exception as e:
        logger.warning(f"Could not store github_sha on commit {commit_id}: {e}")


def _run_async(fn, *args, **kwargs):
    """Fire fn in a daemon thread. Errors are logged, never raised."""
    def _wrapper():
        try:
            fn(*args, **kwargs)
        except Exception as e:
            logger.error(f"Async GitHub sync failed: {e}")
    threading.Thread(target=_wrapper, daemon=True).start()


def sync_inventory_after_commit(month: int, year: int, inv_data: dict,
                                  commit_id: str, author_name: str,
                                  message: str):
    """
    Called from routes/inventory.py after push_all_staging succeeds.
    Fires in a background thread — never blocks the HTTP response.

    On GitHub failure: queues the operation in Supabase for retry.
    On GitHub success: stores the SHA back on the commit row.
    """
    def _do():
        try:
            sha = push_inventory_snapshot(month, year, inv_data,
                                          commit_id, author_name, message)
            _store_sha(commit_id, sha)
        except GitHubDownError as e:
            logger.warning(f"GitHub unreachable during inventory sync: {e}")
            _enqueue("push_inventory", {
                "month": month, "year": year, "inv_data": inv_data,
                "commit_id": commit_id, "author_name": author_name,
                "message": message,
            }, commit_id)
        except GitHubAPIError as e:
            logger.error(f"GitHub API error during inventory sync: {e}")
            _enqueue("push_inventory", {
                "month": month, "year": year, "inv_data": inv_data,
                "commit_id": commit_id, "author_name": author_name,
                "message": message,
            }, commit_id)

    _run_async(_do)


def sync_archive_after_rollover(month: int, year: int, inv_data: dict,
                                  author_name: str):
    """Called from rollover endpoint. Async, queues on failure."""
    def _do():
        try:
            push_archive_snapshot(month, year, inv_data, author_name)
        except (GitHubDownError, GitHubAPIError) as e:
            logger.warning(f"GitHub archive sync failed: {e}")
            _enqueue("push_archive_snapshot", {
                "month": month, "year": year,
                "inv_data": inv_data, "author_name": author_name,
            })

    _run_async(_do)


# ── Retry queue processor ─────────────────────────────────────────────

def _process_queue_once():
    """
    Drain pending entries from github_sync_queue.
    Called by the background retry thread every 60 seconds.
    Skips if GitHub is currently unreachable.
    """
    try:
        if not is_available():
            return

        db      = _get_db()
        pending = (
            db.table("github_sync_queue")
            .select("*")
            .is_("synced_at", "null")
            .lt("attempts", 5)
            .order("created_at")
            .limit(10)
            .execute()
        )

        for row in (pending.data or []):
            entry_id  = row["id"]
            operation = row["operation"]
            payload   = row["payload"]
            commit_id = row.get("commit_id")

            try:
                sha = ""
                if operation == "push_inventory":
                    sha = push_inventory_snapshot(
                        payload["month"], payload["year"], payload["inv_data"],
                        payload["commit_id"], payload["author_name"], payload["message"],
                    )
                    if commit_id:
                        _store_sha(commit_id, sha)

                elif operation == "push_archive_snapshot":
                    sha = push_archive_snapshot(
                        payload["month"], payload["year"],
                        payload["inv_data"], payload["author_name"],
                    )

                elif operation == "push_invoice":
                    sha = push_invoice_archive(
                        payload["date_str"], payload["invoice_text"],
                        payload["matches"], payload["author_name"],
                    )

                elif operation == "push_menu":
                    sha = push_menu_cycle(
                        payload["cycle_data"], payload["author_name"],
                        payload.get("message", ""),
                    )

                # Mark as synced
                db.table("github_sync_queue").update({
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                    "last_error": None,
                }).eq("id", entry_id).execute()
                logger.info(f"Queue: synced {operation} (entry {entry_id[:8]})")

            except Exception as e:
                db.table("github_sync_queue").update({
                    "attempts":   row["attempts"] + 1,
                    "last_error": str(e)[:500],
                }).eq("id", entry_id).execute()
                logger.warning(f"Queue: retry failed for {operation}: {e}")

    except Exception as e:
        logger.error(f"Queue processor error: {e}")


def start_retry_worker():
    """
    Start the background retry thread.
    Called once from main.py at app startup.
    Checks the queue every 60 seconds.
    """
    def _loop():
        while True:
            time.sleep(60)
            _process_queue_once()

    t = threading.Thread(target=_loop, daemon=True, name="github-sync-retry")
    t.start()
    logger.info("GitHub sync retry worker started")


# ── Status helper (used by /api/github/status) ────────────────────────

def get_status() -> dict:
    """
    Return a status dict for the /api/github/status endpoint.
    Never raises — returns error info instead.
    """
    try:
        db      = _get_db()
        pending = (
            db.table("github_sync_queue")
            .select("id", count="exact")
            .is_("synced_at", "null")
            .lt("attempts", 5)
            .execute()
        )
        pending_count = pending.count or 0

        failed = (
            db.table("github_sync_queue")
            .select("id", count="exact")
            .is_("synced_at", "null")
            .gte("attempts", 5)
            .execute()
        )
        failed_count = failed.count or 0

        last_commit = (
            db.table("commits")
            .select("commit_id, github_sha, github_synced_at, message, created_at")
            .not_.is_("github_sha", "null")
            .order("github_synced_at", desc=True)
            .limit(1)
            .execute()
        )
        last_sync = last_commit.data[0] if last_commit.data else None

    except Exception as e:
        return {
            "connected":     False,
            "repo":          GITHUB_REPO,
            "branch":        GITHUB_BRANCH,
            "error":         str(e),
            "pending_count": 0,
            "failed_count":  0,
            "last_sync":     None,
        }

    connected = is_available()
    return {
        "connected":     connected,
        "repo":          GITHUB_REPO,
        "branch":        GITHUB_BRANCH,
        "error":         None if connected else "GitHub API unreachable",
        "pending_count": pending_count,
        "failed_count":  failed_count,
        "last_sync":     last_sync,
    }
