import os
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException, Header
from pydantic import BaseModel
from supabase import create_client
from dotenv import load_dotenv
from typing import Optional
from backend.staging.dispatch import replay
from backend.routes import jwt_validator

load_dotenv(Path(__file__).resolve().parents[2] / '.env')

router = APIRouter(prefix="/api")

_svc = None


def _client():
    global _svc
    if _svc is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        _svc = create_client(url, key)
    return _svc


ENTITY_TYPES = {"inventory", "menu", "user", "compliance", "event", "ops"}


# ── models ──────────────────────────────────────────────────────────────────


class SubmitStagingBody(BaseModel):
    entity_type: str
    entity_id: str
    field_name: str
    old_value: Optional[str] = None
    new_value: str = ""
    change_type: str
    metadata: Optional[dict] = None
    summary: Optional[str] = None
    operation: Optional[str] = None
    full_payload: Optional[dict] = None


class ApproveCommitBody(BaseModel):
    staging_ids: list[str]
    message: str
    author_id: str


class RejectBody(BaseModel):
    review_note: Optional[str] = None


# ── helpers ──────────────────────────────────────────────────────────────────



def _get_auth_user(authorization: str = Header("")) -> dict:
    """Resolve caller from Bearer token (JWT or pin_). Raises 401 if missing or invalid."""
    token = (authorization or "").replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")
    if token.startswith("pin_"):
        user_id = token[4:]
        try:
            r = (
                _client()
                .table("user_profiles")
                .select("id,role,active")
                .eq("id", user_id)
                .eq("active", True)
                .limit(1)
                .execute()
            )
        except Exception:
            raise HTTPException(status_code=401, detail="Invalid session")
        if not r.data:
            raise HTTPException(status_code=401, detail="Invalid session")
        return r.data[0]
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")
    try:
        r = (
            _client()
            .table("user_profiles")
            .select("id,role,active")
            .eq("id", user_id)
            .eq("active", True)
            .limit(1)
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    if not r.data:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    return r.data[0]


def _require_admin_or_manager(auth_user: dict = Depends(_get_auth_user)) -> dict:
    if auth_user.get("role") not in ("admin", "manager", "sudo"):
        raise HTTPException(status_code=403, detail="Admin or manager role required")
    return auth_user


# ── routes ───────────────────────────────────────────────────────────────────


@router.get("/commits")
async def get_commits(
    limit: int = 50, offset: int = 0, auth_user: dict = Depends(_get_auth_user)
):
    try:
        commits_r = (
            _client()
            .table("commits")
            .select(
                "commit_id,message,author_id,status,branch,created_at,merged_at,github_sha,github_synced_at"
            )
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
            .execute()
        )
        if not commits_r.data:
            return []

        commit_ids = [c["commit_id"] for c in commits_r.data]
        counts_r = (
            _client()
            .table("commit_changes")
            .select("commit_id")
            .in_("commit_id", commit_ids)
            .execute()
        )
        count_map: dict[str, int] = {}
        for row in counts_r.data or []:
            count_map[row["commit_id"]] = count_map.get(row["commit_id"], 0) + 1

        author_ids = list(
            {c["author_id"] for c in commits_r.data if c.get("author_id")}
        )
        profiles_r = (
            _client()
            .table("user_profiles")
            .select("id,username,display_name,role")
            .in_("id", author_ids)
            .execute()
        )
        profile_map = {p["id"]: p for p in (profiles_r.data or [])}

        result = []
        for c in commits_r.data:
            profile = profile_map.get(c["author_id"], {})
            result.append(
                {
                    **c,
                    "change_count": count_map.get(c["commit_id"], 0),
                    "author_name": profile.get("display_name")
                    or profile.get("username")
                    or c["author_id"],
                    "submitter_role": profile.get("role"),
                }
            )
        # Order by push date (github_synced_at) for Source Control history, fallback to merged/created.
        result.sort(
            key=lambda c: (c.get("github_synced_at") or c.get("merged_at") or c.get("created_at") or ""),
            reverse=True,
        )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/staging")
async def get_staging(
    entity_type: Optional[str] = None, auth_user: dict = Depends(_get_auth_user)
):
    try:
        q = (
            _client()
            .table("staging_entries")
            .select(
                "entry_id,entity_type,entity_id,field_name,old_value_text,new_value_text,"
                "change_type,metadata,status,submitted_by,review_note,created_at,expires_at,"
                "operation,full_payload"
            )
            .eq("status", "pending")
        )
        if entity_type:
            q = q.eq("entity_type", entity_type)
        # Staff only see their own pending entries; managers/admins see all
        role = (auth_user.get("role") or "").lower()
        if role not in ("admin", "manager", "sudo"):
            q = q.eq("submitted_by", auth_user["id"])
        r = q.order("created_at", desc=True).execute()

        if not r.data:
            return []

        author_ids = list(
            {row["submitted_by"] for row in r.data if row.get("submitted_by")}
        )
        profiles_r = (
            _client()
            .table("user_profiles")
            .select("id,username,display_name,role")
            .in_("id", author_ids)
            .execute()
        )
        profile_map = {p["id"]: p for p in (profiles_r.data or [])}

        result = []
        for row in r.data:
            profile = profile_map.get(row["submitted_by"], {})
            result.append(
                {
                    **row,
                    "submitter_name": profile.get("display_name")
                    or profile.get("username")
                    or row["submitted_by"],
                    "submitter_role": profile.get("role"),
                }
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/staging", status_code=201)
async def submit_staging(
    body: SubmitStagingBody, auth_user: dict = Depends(_get_auth_user)
):
    if body.entity_type not in ENTITY_TYPES:
        raise HTTPException(
            status_code=422, detail=f"entity_type must be one of {sorted(ENTITY_TYPES)}"
        )
    try:
        # Reject staging to a published period — unless the caller is admin/manager.
        caller_role = (auth_user.get("role") or "").lower()
        if caller_role not in ("admin", "manager", "sudo"):
            if body.operation in ('inventory_save', 'inventory_week_update') and body.full_payload:
                inv_month = (body.full_payload or {}).get('month')
                inv_year = (body.full_payload or {}).get('year')
                if inv_month and inv_year:
                    db_month = max(0, int(inv_month) - 1)
                    ms_r = (
                        _client()
                        .table('month_status')
                        .select('status')
                        .eq('month', db_month)
                        .eq('year', int(inv_year))
                        .limit(1)
                        .execute()
                    )
                    ms_row = (ms_r.data or [None])[0]
                    if ms_row and ms_row.get('status') == 'published':
                        raise HTTPException(
                            status_code=403,
                            detail=f'Period {inv_month}/{inv_year} is published and cannot be modified.',
                        )

        # Dedup: if this submitter already has a pending entry for the same
        # entity_id + field_name, update it rather than stacking duplicates.
        existing_r = (
            _client()
            .table("staging_entries")
            .select("entry_id")
            .eq("entity_id", body.entity_id)
            .eq("field_name", body.field_name)
            .eq("submitted_by", auth_user["id"])
            .eq("status", "pending")
            .limit(1)
            .execute()
        )
        if existing_r.data:
            entry_id = existing_r.data[0]["entry_id"]
            update_fields = {
                "old_value_text": body.old_value,
                "new_value_text": body.new_value,
                "metadata": body.metadata or {},
                "operation": body.operation,
                "full_payload": body.full_payload,
            }
            r = _client().table("staging_entries").update(update_fields).eq("entry_id", entry_id).execute()
            if not r.data:
                raise HTTPException(status_code=500, detail="Dedup update returned no data.")
            return r.data[0]

        row = {
            "entity_type": body.entity_type,
            "entity_id": body.entity_id,
            "field_name": body.field_name,
            "old_value_text": body.old_value,
            "new_value_text": body.new_value,
            "change_type": body.change_type,
            "metadata": body.metadata or {},
            "status": "pending",
            "submitted_by": auth_user["id"],
            "source": "dashboard",
            "operation": body.operation,
            "full_payload": body.full_payload,
        }
        r = _client().table("staging_entries").insert(row).execute()
        if not r.data:
            raise HTTPException(status_code=500, detail="Insert returned no data.")
        return r.data[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/commits", status_code=201)
async def approve_commit(
    body: ApproveCommitBody,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    if not body.staging_ids:
        raise HTTPException(status_code=422, detail="staging_ids must not be empty.")
    try:
        author_id = auth_user["id"]
        now = datetime.now(timezone.utc).isoformat()

        # 1 — fetch staging entries
        staging_r = (
            _client()
            .table("staging_entries")
            .select("*")
            .in_("entry_id", body.staging_ids)
            .execute()
        )
        entries = staging_r.data or []

        # 2 — replay all operations before checking errors (P1.4). Inject
        # _staging_entry_id so insert-type dispatches (event_create, haccp_save,
        # daily_log_save) can skip on retry instead of duplicating rows.
        is_manager = auth_user.get("role") in ("admin", "manager", "sudo")
        replay_results = []
        for entry in entries:
            op = entry.get("operation")
            fp = entry.get("full_payload")
            if op and fp:
                extra = {"_staging_entry_id": entry["entry_id"]}
                if is_manager:
                    extra["_override_published"] = True
                result = replay(op, {**fp, **extra})
                replay_results.append(
                    {"entry_id": entry["entry_id"], "operation": op, "result": result}
                )

        replay_errors = [r for r in replay_results if r["result"].get("error")]
        if replay_errors:
            applied_ids = [
                r["entry_id"] for r in replay_results if not r["result"].get("error")
            ]
            detail = "; ".join(
                f"{r['operation']}: {r['result']['error']}" for r in replay_errors
            )
            raise HTTPException(
                status_code=500,
                detail=f"Replay failed: {detail}. Applied entries (no rollback): {applied_ids or 'none'}.",
            )

        # 3 — create commit row
        commit_r = (
            _client()
            .table("commits")
            .insert(
                {
                    "message": body.message,
                    "author_id": author_id,
                    "status": "merged",
                    "branch": "main",
                    "merged_at": now,
                    "merged_by": author_id,
                    "source": "dashboard",
                }
            )
            .execute()
        )
        if not commit_r.data:
            raise HTTPException(status_code=500, detail="Failed to create commit.")
        commit = commit_r.data[0]
        commit_id = commit["commit_id"]

        # 4 — insert commit_changes for each staging entry
        changes = []
        for entry in entries:
            changes.append(
                {
                    "commit_id": commit_id,
                    "entity_type": entry.get("entity_type", "inventory"),
                    "entity_id": entry.get("entity_id", ""),
                    "field_name": entry.get("field_name", ""),
                    "old_value_text": entry.get("old_value_text"),
                    "new_value_text": entry.get("new_value_text"),
                    "change_type": entry.get("change_type", "update"),
                    "metadata": entry.get("metadata", {}),
                }
            )
        if changes:
            _client().table("commit_changes").insert(changes).execute()

        # 5 — mark staging entries merged. NOTE: staging_entries_status_check only
        # permits ('pending','merged','rejected') — writing 'approved' here raised
        # 23514 and 500'd EVERY commit after the data already applied (latent prod
        # bug: 76 commits exist but all staging rows stuck 'pending'). Use 'merged'.
        _client().table("staging_entries").update(
            {
                "status": "merged",
                "reviewed_by": author_id,
                "reviewed_at": now,
            }
        ).in_("entry_id", body.staging_ids).execute()

        # 6 — enqueue github sync. NOTE: github_sync_queue_operation_check permits
        # ('push_inventory','push_archive_snapshot','push_invoice','push_menu',
        # 'push_items_catalog'). 'push_snapshot' was invalid → 23514 → the final
        # 500 in the commit flow (after status fix). Use 'push_archive_snapshot'.
        _client().table("github_sync_queue").insert(
            {
                "operation": "push_archive_snapshot",
                "payload": {
                    "commit_id": commit_id,
                    "message": body.message,
                    "change_count": len(changes),
                },
                "commit_id": commit_id,
                "attempts": 0,
            }
        ).execute()

        return {
            **commit,
            "change_count": len(changes),
            "replayed": len(replay_results),
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/staging/{entry_id}", status_code=204)
async def reject_staging(
    entry_id: str,
    review_note: Optional[str] = None,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    try:
        now = datetime.now(timezone.utc).isoformat()
        r = (
            _client()
            .table("staging_entries")
            .update(
                {
                    "status": "rejected",
                    "review_note": review_note,
                    "reviewed_by": auth_user["id"],
                    "reviewed_at": now,
                }
            )
            .eq("entry_id", entry_id)
            .eq("status", "pending")
            .execute()
        )
        if not r.data:
            raise HTTPException(status_code=404, detail="Staging entry not found or already processed.")
        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
