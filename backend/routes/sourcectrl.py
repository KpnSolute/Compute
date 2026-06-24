import logging
import os
from datetime import datetime, timezone
from pathlib import Path
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from supabase import create_client
from dotenv import load_dotenv
from typing import Optional
import re as _re
from backend.staging.dispatch import replay, validate_payload
from backend.ai import diff as diff_engine
from backend.routes._deps import (
    _get_auth_user,
    _require_admin_or_manager,
    ensure_pr_for_entries,
)

_WEEK_FIELD_RE = _re.compile(r"^w(\d)_")

# item_update diffs key `after` by payload name but `before` by DB column name;
# map so the tree shows the real old value (incl. renames/re-SKUs via new_sku->sku).
_BEFORE_ALIAS = {
    "desc": "description",
    "price": "unit_price",
    "par": "par_level",
    "category": "category_id",
    "new_sku": "sku",
}
# operation -> entity_type for the tree (the whole site, not just data entry).
_OP_ENTITY = {
    "inventory_save": "inventory",
    "inventory_week_update": "inventory",
    "item_update": "inventory",
    "item_delete": "inventory",
    "item_create": "inventory",
    "event_create": "event",
    "menu_save": "menu",
    "haccp_save": "compliance",
    "daily_log_save": "ops",
    "user_create": "user",
    "user_update": "user",
}


def _num(v) -> float:
    try:
        return float(v)
    except (TypeError, ValueError):
        return 0.0


def _summary_commit_changes(commit_id: str, applied_entries: list[dict]) -> list[dict]:
    """Legacy fallback: one summary commit_changes row per staging entry. Used only
    when the granular per-item diff is unavailable, so the tree is never empty."""
    return [
        {
            "commit_id": commit_id,
            "entity_type": entry.get("entity_type", "inventory"),
            "entity_id": entry.get("entity_id", ""),
            "field_name": entry.get("field_name", ""),
            "old_value_text": entry.get("old_value_text"),
            "new_value_text": entry.get("new_value_text"),
            "change_type": entry.get("change_type", "update"),
            "action": "enter",
            "metadata": entry.get("metadata", {}),
        }
        for entry in applied_entries
    ]


def _granular_commit_changes(
    commit_id: str, precomputed_diffs: list[dict] | None
) -> list[dict]:
    """Flatten per-item before/after diffs into granular commit_changes rows so the
    Source Control tree shows exactly what each commit changed, per SKU and field
    (e.g. "SKU 43992 — w1_received 0 -> 1"). Returns [] when no diffs are available
    so the caller can fall back to one summary row per entry.
    """
    if not precomputed_diffs:
        return []
    skus = {
        r.get("sku")
        for d in precomputed_diffs
        for r in d.get("rows", [])
        if r.get("sku")
    }
    id_map: dict[str, str] = {}
    if skus:
        try:
            rr = (
                _client()
                .table("inventory_items")
                .select("id,sku")
                .in_("sku", list(skus))
                .execute()
            )
            id_map = {x["sku"]: x["id"] for x in (rr.data or [])}
        except Exception:
            pass

    rows: list[dict] = []
    for d in precomputed_diffs:
        month = d.get("month")
        db_month = (month - 1) if isinstance(month, int) else None
        year = d.get("year")
        op = d.get("operation") or ""
        entity_type = _OP_ENTITY.get(op, "inventory")
        for r in d.get("rows", []):
            status = r.get("status") or "update"
            if status in ("unchanged", "missing"):
                continue
            # Entity label for the tree: SKU (inventory/item ops), else title/day.
            entity = r.get("sku") or r.get("title") or r.get("day") or ""
            before = r.get("before") if isinstance(r.get("before"), dict) else {}
            after = r.get("after") if isinstance(r.get("after"), dict) else {}
            for field in r.get("changes") or []:
                ov = before.get(field)
                if ov is None and field in _BEFORE_ALIAS:
                    ov = before.get(_BEFORE_ALIAS[field])
                nv = after.get(field)
                wk_m = _WEEK_FIELD_RE.match(field or "")
                # action CHECK allows only 'pull' | 'enter' | 'revert'.
                if status == "delete":
                    action = "revert"
                elif (field or "").endswith("_issued"):
                    action = "pull"
                else:
                    action = "enter"
                rows.append(
                    {
                        "commit_id": commit_id,
                        "item_id": id_map.get(r.get("sku") or ""),
                        "entity_type": entity_type,
                        "entity_id": entity,
                        "field": field,
                        "field_name": field,
                        "old_value": _num(ov),
                        "new_value": _num(nv),
                        "old_value_text": None if ov is None else str(ov),
                        "new_value_text": None if nv is None else str(nv),
                        "change_type": status,
                        "action": action,
                        "month": db_month,
                        "year": year,
                        "week_number": int(wk_m.group(1)) if wk_m else None,
                        "metadata": {
                            "operation": op,
                            "description": r.get("description"),
                        },
                    }
                )
    return rows


load_dotenv(Path(__file__).resolve().parents[2] / ".env")

log = logging.getLogger("mjcc.sourcectrl")

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


def _infer_entity_scope(entries: list[dict]) -> str:
    scopes = {entry.get("entity_type") or "unknown" for entry in entries}
    return next(iter(scopes)) if len(scopes) == 1 else "mixed"


ENTITY_TYPES = {"inventory", "menu", "user", "compliance", "event", "ops"}
BULK_CHUNK_SIZE = 100


def _chunks(values: list, size: int = BULK_CHUNK_SIZE):
    for idx in range(0, len(values), size):
        yield values[idx : idx + size]


def _select_staging_entries(entry_ids: list[str], columns: str = "*") -> list[dict]:
    rows: list[dict] = []
    for entry_chunk in _chunks(entry_ids):
        r = (
            _client()
            .table("staging_entries")
            .select(columns)
            .in_("entry_id", entry_chunk)
            .execute()
        )
        rows.extend(r.data or [])
    return rows


def _update_staging_entries(entry_ids: list[str], values: dict) -> None:
    for entry_chunk in _chunks(entry_ids):
        _client().table("staging_entries").update(values).in_(
            "entry_id", entry_chunk
        ).execute()


def _insert_commit_changes(changes: list[dict]) -> None:
    for change_chunk in _chunks(changes):
        _client().table("commit_changes").insert(change_chunk).execute()


def _inventory_overwrite_key(payload: dict) -> tuple | None:
    if not payload.get("overwrite"):
        return None
    month = int(payload.get("month") or 0)
    year = int(payload.get("year") or 0)
    week = int(payload.get("week") or 0)
    direction = (payload.get("direction") or "both").lower()
    if not month or not year:
        return None
    if week in (1, 2, 3, 4):
        return ("week", month, year, week, direction)
    return ("month", month, year)


def _assert_inventory_overwrite_allowed(
    sup, db_month: int, year: int, display_month: int
) -> None:
    status = (
        sup.table("month_status")
        .select("status")
        .eq("month", db_month)
        .eq("year", year)
        .limit(1)
        .execute()
    )
    row = (status.data or [None])[0]
    if row and row.get("status") == "published":
        raise HTTPException(
            status_code=403,
            detail=f"Cannot overwrite published inventory data for {display_month}/{year}.",
        )


def _apply_confirmed_inventory_overwrites(entries: list[dict]) -> list[dict]:
    """Clear confirmed Data Entry replacement scopes once per commit merge."""
    sup = _client()
    cleared: list[dict] = []
    seen: set[tuple] = set()
    for entry in entries:
        op = entry.get("operation")
        payload = entry.get("full_payload") or {}
        if op not in ("inventory_save", "inventory_week_update"):
            continue
        key = _inventory_overwrite_key(payload)
        if not key or key in seen:
            continue
        seen.add(key)

        if key[0] == "month":
            _, month, year = key
            db_month = max(0, month - 1)
            _assert_inventory_overwrite_allowed(sup, db_month, year, month)
            sup.table("monthly_inventory").delete().eq("month", db_month).eq(
                "year", year
            ).execute()
            cleared.append({"scope": "month", "month": month, "year": year})
            continue

        _, month, year, week, direction = key
        if direction not in ("received", "issued"):
            continue
        db_month = max(0, month - 1)
        _assert_inventory_overwrite_allowed(sup, db_month, year, month)
        col = f"w{week}_{direction}"
        sup.table("monthly_inventory").update({col: 0}).eq("month", db_month).eq(
            "year", year
        ).execute()
        cleared.append(
            {
                "scope": "week",
                "month": month,
                "year": year,
                "week": week,
                "direction": direction,
            }
        )
    return cleared


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


class OpenPRBody(BaseModel):
    title: str
    description: Optional[str] = None
    entry_ids: Optional[list[str]] = None


class ClosePRBody(BaseModel):
    note: Optional[str] = None


# ── core replay→commit helper ─────────────────────────────────────────────────


def _apply_entries(
    entries: list[dict],
    author_id: str,
    message: str,
    source: str,
    pr_id: Optional[str] = None,
) -> dict:
    """Replay entries and commit them as one atomic unit; return result dict.

    All-or-nothing:
    - Replay ALL entries first.
    - If ANY entry fails → create NO commit, mark nothing merged, leave every
      entry pending with a clear note, and raise HTTPException(409). Dispatch ops
      are idempotent upserts, so any writes that already landed reconcile on retry.
    - Only if EVERY entry succeeds → create the commit, insert commit_changes for
      all entries, mark them merged, and enqueue push_archive_snapshot.
    A commit therefore never represents a partial change.
    Returns {**commit_row, change_count, replayed, applied, failed:[]}.
    """
    now = datetime.now(timezone.utc).isoformat()

    # 0 — PRE-FLIGHT VALIDATION. Validate every entry BEFORE writing any. The
    #     replay loop below writes to the DB per-entry, so without this a failure
    #     midway (e.g. a negative quantity) would leave the earlier entries
    #     written as orphaned partial data even though the commit "aborts". This
    #     pass guarantees the commit is genuinely atomic: one bad row rejects the
    #     whole batch with nothing written.
    preflight_errors = []
    for entry in entries:
        op = entry.get("operation")
        fp = entry.get("full_payload")
        if op and fp:
            err = validate_payload(op, fp)
            if err:
                preflight_errors.append((entry["entry_id"], op, err))
    if preflight_errors:
        for entry_id, op, err in preflight_errors:
            _client().table("staging_entries").update(
                {"review_note": f"Validation failed (pre-commit) — {op}: {err}"}
            ).eq("entry_id", entry_id).execute()
        detail = "; ".join(f"{op}: {err}" for _, op, err in preflight_errors)
        log.warning(
            "[COMMIT] pre-flight validation failed — nothing written | %d/%d bad | %s",
            len(preflight_errors),
            len(entries),
            detail,
        )
        raise HTTPException(
            status_code=409,
            detail=(
                f"Commit rejected — {len(preflight_errors)} of {len(entries)} "
                f"change(s) failed validation; nothing was written. Fix and retry: {detail}"
            ),
        )

    # 0b — capture the per-item before/after diff NOW, before any state changes,
    #      so the commit tree can record exactly what changed (old -> new) per SKU.
    #      Best-effort: a diff failure must never block the commit.
    try:
        precomputed_diffs = diff_engine.diff_batch(entries)
    except Exception as exc:
        log.warning(
            "[COMMIT] diff precompute failed — tree falls back to summary rows: %s",
            exc,
        )
        precomputed_diffs = None

    # 1 — replay all operations. Published periods are read-only (enforced by the
    #     DB guard and the dispatch published-check); there is no override — to edit
    #     a closed period an admin reopens it (month_status.status='open') first.
    overwrite_clears = _apply_confirmed_inventory_overwrites(entries)
    replay_results = []
    for entry in entries:
        op = entry.get("operation")
        fp = entry.get("full_payload")
        if op and fp:
            extra = {
                "_staging_entry_id": entry["entry_id"],
            }
            result = replay(op, {**fp, **extra})
            replay_results.append(
                {"entry_id": entry["entry_id"], "operation": op, "result": result}
            )

    # 2 — all-or-nothing. If ANY entry failed to replay, abort the WHOLE commit:
    #     create no commit, mark nothing merged, leave every entry pending with a
    #     clear note. Dispatch operations are idempotent upserts, so any writes
    #     that already landed are harmless and reconcile when the fixed commit is
    #     retried. This guarantees a commit can never represent a partial change.
    replayed_ids = {r["entry_id"] for r in replay_results}
    failed_results = [r for r in replay_results if r["result"].get("error")]
    if failed_results:
        for r in replay_results:
            err = r["result"].get("error")
            note = (
                f"Commit aborted — left pending. {r['operation']}: {err}"
                if err
                else "Commit aborted (another change in this commit failed) — left pending for retry."
            )
            _client().table("staging_entries").update({"review_note": note}).eq(
                "entry_id", r["entry_id"]
            ).execute()
        detail = "; ".join(
            f"{r['operation']}: {r['result']['error']}" for r in failed_results
        )
        # Surface the same error the UI sees into the live tail / Render logs so
        # commit failures are observable without reproducing them in the browser.
        log.warning(
            "[COMMIT] aborted — %d of %d change(s) failed; nothing committed | %s",
            len(failed_results),
            len(replay_results),
            detail,
        )
        raise HTTPException(
            status_code=409,
            detail=(
                f"Commit aborted — {len(failed_results)} of {len(replay_results)} "
                f"change(s) failed; nothing was committed. Fix and retry: {detail}"
            ),
        )

    # All entries replayed cleanly → commit the whole set as one unit.
    applied_results = replay_results
    applied_entry_ids = list(replayed_ids)
    applied_entries = [e for e in entries if e["entry_id"] in replayed_ids]

    # 3 — create commit row for the applied set
    commit_row: dict = {
        "message": message,
        "author_id": author_id,
        "status": "merged",
        "branch": "main",
        "merged_at": now,
        "merged_by": author_id,
        "source": source,
    }
    if pr_id:
        commit_row["pull_request_id"] = pr_id

    commit_r = _client().table("commits").insert(commit_row).execute()
    if not commit_r.data:
        raise HTTPException(status_code=500, detail="Failed to create commit.")
    commit = commit_r.data[0]
    commit_id = commit["commit_id"]

    # 4 — commit_changes for the applied set. Prefer GRANULAR rows (one per SKU per
    #     changed field, with old -> new) built from the pre-replay diff, so the
    #     Source Control tree shows what actually changed. Fall back to one summary
    #     row per entry only if the diff was unavailable (tree is never empty).
    # Tree rows are for DISPLAY — the data is already applied + committed above, so
    # a commit_changes failure must NEVER abort the commit. Best-effort with a
    # summary-row fallback if the granular insert fails.
    try:
        changes = _granular_commit_changes(commit_id, precomputed_diffs)
        if not changes:
            changes = _summary_commit_changes(commit_id, applied_entries)
        if changes:
            _insert_commit_changes(changes)
    except Exception as exc:
        log.warning(
            "[COMMIT] granular commit_changes failed, retrying summary rows: %s", exc
        )
        try:
            _insert_commit_changes(_summary_commit_changes(commit_id, applied_entries))
        except Exception as exc2:
            log.warning("[COMMIT] summary commit_changes also failed: %s", exc2)

    # 5 — mark the whole set merged
    if applied_entry_ids:
        _update_staging_entries(
            applied_entry_ids,
            {
                "status": "merged",
                "reviewed_by": author_id,
                "reviewed_at": now,
            },
        )

    # 5b — flip weekly import_batches for this commit's staging batches to merged.
    #      The active-dedup unique index now enforces one-merged-per-scope; the
    #      ledger rows were written idempotently by dispatch_inventory_week.
    staging_batch_ids = list(
        {e.get("batch_id") for e in applied_entries if e.get("batch_id")}
    )
    if staging_batch_ids:
        try:
            _client().table("import_batches").update(
                {"status": "merged", "merged_at": now}
            ).in_("staging_batch_id", staging_batch_ids).eq(
                "status", "staged"
            ).execute()
        except Exception as exc:
            log.warning("[COMMIT] import_batches merge flip failed: %s", exc)

    # 6 — enqueue github sync
    # NOTE: github_sync_queue_operation_check permits push_archive_snapshot, not push_snapshot.
    _client().table("github_sync_queue").insert(
        {
            "operation": "push_archive_snapshot",
            "payload": {
                "commit_id": commit_id,
                "message": message,
                "change_count": len(changes),
            },
            "commit_id": commit_id,
            "attempts": 0,
        }
    ).execute()

    # 7 — post-session inventory audit: re-check each affected period for logical
    #     issues (negative endings, ledger drift, missing prices, duplicates) and
    #     write findings to inventory_audit_log for Data Entry. Best-effort — must
    #     never block a commit that already applied.
    try:
        periods = {
            (max(0, int(fp["month"]) - 1), int(fp["year"]))
            for e in applied_entries
            if e.get("operation") in ("inventory_save", "inventory_week_update")
            for fp in [e.get("full_payload") or {}]
            if isinstance(fp.get("month"), int) and isinstance(fp.get("year"), int)
        }
        for db_m, yr in periods:
            _client().rpc(
                "audit_inventory_period", {"p_month": db_m, "p_year": yr}
            ).execute()
    except Exception as exc:
        log.warning(
            "[COMMIT] post-commit inventory audit failed (non-blocking): %s", exc
        )

    return {
        **commit,
        "change_count": len(changes),
        "replayed": len(applied_results),
        "applied": len(applied_results),
        "overwrite_clears": overwrite_clears,
        "failed": [],
    }


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
                "commit_id,message,author_id,status,branch,created_at,merged_at,"
                "github_sha,github_synced_at,pull_request_id"
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

        # Enrich with PR number/title for commits back-linked to a pull request
        pr_ids = [
            c["pull_request_id"] for c in commits_r.data if c.get("pull_request_id")
        ]
        pr_map: dict[str, dict] = {}
        if pr_ids:
            prs_r = (
                _client()
                .table("pull_requests")
                .select("pr_id,pr_number,title")
                .in_("pr_id", pr_ids)
                .execute()
            )
            for pr in prs_r.data or []:
                pr_map[pr["pr_id"]] = pr

        result = []
        for c in commits_r.data:
            profile = profile_map.get(c["author_id"], {})
            pr = pr_map.get(c.get("pull_request_id") or "")
            result.append(
                {
                    **c,
                    "change_count": count_map.get(c["commit_id"], 0),
                    "author_name": profile.get("display_name")
                    or profile.get("username")
                    or c["author_id"],
                    "submitter_role": profile.get("role"),
                    "pr_number": pr["pr_number"] if pr else None,
                    "pr_title": pr["title"] if pr else None,
                }
            )
        result.sort(
            key=lambda c: (
                c.get("github_synced_at")
                or c.get("merged_at")
                or c.get("created_at")
                or ""
            ),
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
                "operation,full_payload,pull_request_id"
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


@router.get("/staging/mine")
async def get_my_staging(auth_user: dict = Depends(_get_auth_user)):
    """Return the current user's pending staging entries (not yet linked to a PR)."""
    try:
        r = (
            _client()
            .table("staging_entries")
            .select(
                "entry_id,operation,entity_type,entity_id,metadata,created_at,pull_request_id"
            )
            .eq("submitted_by", auth_user["id"])
            .eq("status", "pending")
            .is_("pull_request_id", "null")
            .order("created_at", desc=True)
            .execute()
        )
        entries = r.data or []
        return {"count": len(entries), "entries": entries}
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
        if body.full_payload and not body.operation:
            raise HTTPException(
                status_code=422,
                detail="operation is required when full_payload is provided.",
            )
        caller_role = (auth_user.get("role") or "").lower()
        if (
            body.operation in ("inventory_save", "inventory_week_update")
            and body.full_payload
        ):
            fp = body.full_payload or {}
            inv_month = fp.get("month")
            inv_year = fp.get("year")
            if inv_month and inv_year:
                db_month = max(0, int(inv_month) - 1)
                ms_r = (
                    _client()
                    .table("month_status")
                    .select("status")
                    .eq("month", db_month)
                    .eq("year", int(inv_year))
                    .limit(1)
                    .execute()
                )
                ms_row = (ms_r.data or [None])[0]
                if ms_row and ms_row.get("status") == "published":
                    raise HTTPException(
                        status_code=403,
                        detail=f"Period {inv_month}/{inv_year} is published and cannot be modified.",
                    )
        if caller_role not in ("admin", "manager", "sudo"):
            if (
                body.operation in ("inventory_save", "inventory_week_update")
                and body.full_payload
            ):
                fp = body.full_payload or {}
                # Staff cannot stage issued quantities — manager-only field
                if (
                    body.operation == "inventory_week_update"
                    and fp.get("direction") == "issued"
                ):
                    raise HTTPException(
                        status_code=403,
                        detail="Only managers can stage issued (pullout) quantities.",
                    )
                # Check for inventory_save payloads containing any issued field
                if body.operation == "inventory_save":
                    for item in fp.get("items", []):
                        if any(k in item for k in ("w1i", "w2i", "w3i", "w4i")):
                            raise HTTPException(
                                status_code=403,
                                detail="Only managers can stage issued (pullout) quantities.",
                            )
        # Dedup: update existing pending entry rather than stacking duplicates
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
            r = (
                _client()
                .table("staging_entries")
                .update(update_fields)
                .eq("entry_id", entry_id)
                .execute()
            )
            if not r.data:
                raise HTTPException(
                    status_code=500, detail="Dedup update returned no data."
                )
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
        entry = r.data[0]
        # Auto-wrap in a PR so it's reviewable as a unit, not a loose pending row.
        pr = ensure_pr_for_entries(
            [entry["entry_id"]],
            auth_user["id"],
            title=f"{body.entity_type} changes - {auth_user.get('display_name', 'staff')}",
            entity_scope=body.entity_type,
        )
        if pr:
            entry["pr_id"] = pr.get("pr_id")
            entry["pr_number"] = pr.get("pr_number")
        else:
            entry["warning"] = "Staging entry saved, but pull request auto-wrap failed."
        return entry
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/commits", status_code=201)
async def approve_commit(
    body: ApproveCommitBody,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Backward-compatible direct commit endpoint. Delegates to _apply_entries."""
    if not body.staging_ids:
        raise HTTPException(status_code=422, detail="staging_ids must not be empty.")
    try:
        entries = [
            entry
            for entry in _select_staging_entries(body.staging_ids)
            if entry.get("status") == "pending"
        ]
        return _apply_entries(
            entries,
            author_id=auth_user["id"],
            message=body.message,
            source="dashboard",
        )
    except HTTPException:
        raise
    except Exception as e:
        log.exception("[COMMIT] unexpected failure on POST /commits: %s", e)
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
            raise HTTPException(
                status_code=404, detail="Staging entry not found or already processed."
            )
        return None
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ── pull request routes ───────────────────────────────────────────────────────


@router.post("/pulls", status_code=201)
async def open_pull_request(
    body: OpenPRBody,
    auth_user: dict = Depends(_get_auth_user),
):
    """Open a PR from the caller's pending entries. Any signed-in user (lvl ≥ 10)."""
    try:
        entry_ids = list(body.entry_ids or [])
        if not entry_ids:
            # Default: all caller's own pending, unlinked entries
            r = (
                _client()
                .table("staging_entries")
                .select("entry_id")
                .eq("submitted_by", auth_user["id"])
                .eq("status", "pending")
                .is_("pull_request_id", "null")
                .execute()
            )
            entry_ids = [row["entry_id"] for row in (r.data or [])]

        if not entry_ids:
            raise HTTPException(
                status_code=422, detail="No pending entries to include in pull request."
            )

        entries = _select_staging_entries(
            entry_ids, "entry_id,entity_type,submitted_by,status,pull_request_id"
        )
        found_ids = {entry["entry_id"] for entry in entries}
        missing = [entry_id for entry_id in entry_ids if entry_id not in found_ids]
        if missing:
            raise HTTPException(
                status_code=404,
                detail={
                    "message": "Some staging entries were not found.",
                    "missing": missing,
                },
            )
        role = (auth_user.get("role") or "").lower()
        invalid = [
            entry["entry_id"]
            for entry in entries
            if entry.get("status") != "pending"
            or entry.get("pull_request_id")
            or (
                role not in ("admin", "manager", "sudo")
                and entry.get("submitted_by") != auth_user["id"]
            )
        ]
        if invalid:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "Some staging entries are not open for this pull request.",
                    "entry_ids": invalid,
                },
            )

        scope = _infer_entity_scope(entries)
        opened = (
            _client()
            .table("pull_requests")
            .insert(
                {
                    "title": body.title.strip() or "Untitled request",
                    "description": (body.description or "").strip(),
                    "author_id": auth_user["id"],
                    "entity_scope": scope,
                }
            )
            .execute()
        )
        pr = (opened.data or [None])[0]
        if not pr:
            raise HTTPException(
                status_code=500, detail="Failed to create pull request."
            )
        _update_staging_entries(entry_ids, {"pull_request_id": pr["pr_id"]})
        return pr
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pulls")
async def list_pull_requests(
    status: str = "open",
    limit: int = 50,
    offset: int = 0,
    auth_user: dict = Depends(_get_auth_user),
):
    """List PRs scoped by role (mirrors get_staging). Pass status='all' for no status filter."""
    try:
        q = (
            _client()
            .table("pull_requests")
            .select("*")
            .order("created_at", desc=True)
            .range(offset, offset + limit - 1)
        )
        if status and status != "all":
            q = q.eq("status", status)

        role = (auth_user.get("role") or "").lower()
        if role not in ("admin", "manager", "sudo"):
            q = q.eq("author_id", auth_user["id"])

        r = q.execute()
        prs = r.data or []
        if not prs:
            return []

        author_ids = list({pr["author_id"] for pr in prs if pr.get("author_id")})
        profiles_r = (
            _client()
            .table("user_profiles")
            .select("id,username,display_name,role")
            .in_("id", author_ids)
            .execute()
        )
        profile_map = {p["id"]: p for p in (profiles_r.data or [])}

        pr_ids = [pr["pr_id"] for pr in prs]
        counts_r = (
            _client()
            .table("staging_entries")
            .select("pull_request_id")
            .in_("pull_request_id", pr_ids)
            .execute()
        )
        count_map: dict[str, int] = {}
        for row in counts_r.data or []:
            pid = row["pull_request_id"]
            count_map[pid] = count_map.get(pid, 0) + 1

        result = []
        for pr in prs:
            entry_count = count_map.get(pr["pr_id"], 0)
            if entry_count == 0 and not pr.get("commit_id"):
                continue
            profile = profile_map.get(pr["author_id"], {})
            result.append(
                {
                    **pr,
                    "author_name": profile.get("display_name")
                    or profile.get("username")
                    or pr["author_id"],
                    "submitter_role": profile.get("role"),
                    "entry_count": entry_count,
                }
            )
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/pulls/{pr_id}")
async def get_pull_request(
    pr_id: str,
    auth_user: dict = Depends(_get_auth_user),
):
    """PR detail: PR row + linked staging entries + linked commit. Staff may only fetch their own."""
    try:
        pr_r = (
            _client()
            .table("pull_requests")
            .select("*")
            .eq("pr_id", pr_id)
            .limit(1)
            .execute()
        )
        if not pr_r.data:
            raise HTTPException(status_code=404, detail="Pull request not found.")
        pr = dict(pr_r.data[0])

        role = (auth_user.get("role") or "").lower()
        if (
            role not in ("admin", "manager", "sudo")
            and pr.get("author_id") != auth_user["id"]
        ):
            raise HTTPException(status_code=403, detail="Access denied.")

        entries_r = (
            _client()
            .table("staging_entries")
            .select("*")
            .eq("pull_request_id", pr_id)
            .execute()
        )
        entries = entries_r.data or []

        commit = None
        if pr.get("commit_id"):
            c_r = (
                _client()
                .table("commits")
                .select("*")
                .eq("commit_id", pr["commit_id"])
                .limit(1)
                .execute()
            )
            commit = (c_r.data or [None])[0]

        if pr.get("author_id"):
            p_r = (
                _client()
                .table("user_profiles")
                .select("id,username,display_name,role")
                .eq("id", pr["author_id"])
                .limit(1)
                .execute()
            )
            p = (p_r.data or [{}])[0]
            pr["author_name"] = (
                p.get("display_name") or p.get("username") or pr["author_id"]
            )
            pr["submitter_role"] = p.get("role")

        return {"pr": pr, "entries": entries, "commit": commit}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pulls/{pr_id}/merge")
async def merge_pull_request(
    pr_id: str,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    """Merge a PR: replay its pending entries → commit → finalize PR. Admin/manager/sudo only."""
    try:
        pr_r = (
            _client()
            .table("pull_requests")
            .select("*")
            .eq("pr_id", pr_id)
            .limit(1)
            .execute()
        )
        if not pr_r.data:
            raise HTTPException(status_code=404, detail="Pull request not found.")
        pr = pr_r.data[0]

        if pr.get("status") != "open" or pr.get("commit_id"):
            raise HTTPException(
                status_code=409,
                detail=f"Pull request is {pr.get('status')} and cannot be merged again.",
            )

        # Only pending entries; idempotent — re-merge only replays what's still pending
        entries_r = (
            _client()
            .table("staging_entries")
            .select("*")
            .eq("pull_request_id", pr_id)
            .eq("status", "pending")
            .execute()
        )
        entries = entries_r.data or []
        if not entries:
            raise HTTPException(status_code=422, detail="No pending entries to merge.")

        result = _apply_entries(
            entries,
            author_id=pr["author_id"],
            message=pr["title"],
            source="pull_request",
            pr_id=pr_id,
        )

        _client().rpc(
            "sc_finalize_merge",
            {
                "p_pr": pr_id,
                "p_commit": result["commit_id"],
                "p_merged_by": auth_user["id"],
            },
        ).execute()

        updated_pr_r = (
            _client()
            .table("pull_requests")
            .select("*")
            .eq("pr_id", pr_id)
            .limit(1)
            .execute()
        )
        updated_pr = (updated_pr_r.data or [pr])[0]
        return {**result, "pr": updated_pr}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/pulls/{pr_id}/close")
async def close_pull_request(
    pr_id: str,
    body: ClosePRBody = ClosePRBody(),
    auth_user: dict = Depends(_get_auth_user),
):
    """Close a PR. Admin/manager/sudo or the PR's own author."""
    try:
        pr_r = (
            _client()
            .table("pull_requests")
            .select("*")
            .eq("pr_id", pr_id)
            .limit(1)
            .execute()
        )
        if not pr_r.data:
            raise HTTPException(status_code=404, detail="Pull request not found.")
        pr = pr_r.data[0]

        role = (auth_user.get("role") or "").lower()
        if (
            role not in ("admin", "manager", "sudo")
            and pr.get("author_id") != auth_user["id"]
        ):
            raise HTTPException(
                status_code=403,
                detail="Only the PR author or an admin/manager can close this PR.",
            )

        if pr.get("status") not in ("open", "draft"):
            raise HTTPException(
                status_code=409,
                detail=f"Pull request is {pr.get('status')} — cannot close.",
            )

        _client().rpc(
            "sc_close_pull_request",
            {
                "p_pr": pr_id,
                "p_closed_by": auth_user["id"],
                "p_note": body.note or "",
            },
        ).execute()

        updated_pr_r = (
            _client()
            .table("pull_requests")
            .select("*")
            .eq("pr_id", pr_id)
            .limit(1)
            .execute()
        )
        return (updated_pr_r.data or [pr])[0]
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
