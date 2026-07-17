"""Shared FastAPI dependencies for MJCC routes — auth resolution and role guards."""

import logging

from fastapi import Header, HTTPException, Depends
from backend.routes import supabase_service, jwt_validator

ROLE_LEVEL = {"staff": 10, "assistant": 20, "manager": 30, "admin": 40, "sudo": 50}

log = logging.getLogger("mjcc.routes.deps")
BULK_CHUNK_SIZE = 100


def _chunks(values: list, size: int = BULK_CHUNK_SIZE):
    for idx in range(0, len(values), size):
        yield values[idx : idx + size]


def _get_auth_user(authorization: str = Header("")) -> dict:
    """Resolve caller from Bearer token (JWT or pin_). Raises 401 if missing or invalid.

    Returns the full user_profiles row (single source of truth for auth across all
    routers). Selecting `*` keeps every consumer working whether it reads id/role
    or richer profile fields.
    """
    token = (authorization or "").replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")
    if token.startswith("pin_"):
        user_id = token[4:]
        try:
            r = (
                supabase_service.table("user_profiles")
                .select("*")
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
            supabase_service.table("user_profiles")
            .select("*")
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


# alias — same threshold (manager, admin, sudo all qualify)
_require_manager = _require_admin_or_manager


def _require_assistant(auth_user: dict = Depends(_get_auth_user)) -> dict:
    if ROLE_LEVEL.get(auth_user.get("role"), 0) < 20:
        raise HTTPException(status_code=403, detail="Assistant role or higher required")
    return auth_user


def check_direction_role(
    caller_role: str,
    operation: str,
    full_payload: dict | None,
) -> None:
    """Raise 403 if a non-manager caller tries to stage issued/pulled quantities.

    Mirrors the inline check that was previously only in sourcectrl.submit_staging
    so that the data-entry upload path enforces the same restriction (WS1 parity).
    Error shape is identical so existing frontend error handling is unaffected.
    """
    if (caller_role or "").lower() in ("admin", "manager", "sudo"):
        return
    fp = full_payload or {}
    if operation not in (
        "inventory_save",
        "inventory_week_update",
        "monthly_invoice_totals_update",
    ):
        return
    if operation == "inventory_week_update" and fp.get("direction") == "issued":
        raise HTTPException(
            status_code=403,
            detail="Only managers can stage issued (pullout) quantities.",
        )
    if operation == "inventory_save":
        for item in fp.get("items", []):
            if any(k in item for k in ("w1p", "w2p", "w3p")):
                raise HTTPException(
                    status_code=403,
                    detail="Only managers can stage issued (pullout) quantities.",
                )


def ensure_pr_for_entries(
    entry_ids: list[str],
    author_id: str,
    title: str,
    description: str = "",
    entity_scope: str | None = None,
) -> dict | None:
    """Wrap newly-staged entries in a pull request, automatically.

    Every entry that lands in `staging_entries` as status='pending' (manual edits
    via stage_change, AI Data Entry uploads) should immediately belong to a PR so
    it's reviewable as a coherent unit instead of floating as a loose row — this
    is what makes the Source Control "Pull Requests" tab actually have data, and
    is what a push/review modal groups by.

    Behavior:
      1. If the author already has an OPEN pr, attach these entries to it
         (so uploading several invoices in one sitting = one PR, not N).
      2. Otherwise open a new PR titled `title`.

    Never raises — PR wrapping is a UX nicety, not a correctness requirement.
    A failure here must not block the underlying staging write that already
    succeeded. Returns the PR dict, or None if entry_ids is empty or this
    failed (best-effort).
    """
    if not entry_ids:
        return None
    clean_description = (description or "").strip()
    try:
        valid_rows = []
        for entry_chunk in _chunks(entry_ids):
            valid_r = (
                supabase_service.table("staging_entries")
                .select("entry_id,entity_type")
                .in_("entry_id", entry_chunk)
                .eq("submitted_by", author_id)
                .eq("status", "pending")
                .is_("pull_request_id", "null")
                .execute()
            )
            valid_rows.extend(valid_r.data or [])
        valid_ids = [row["entry_id"] for row in valid_rows]
        if not valid_ids:
            return None

        inferred_scope = entity_scope or "mixed"
        scopes = {row.get("entity_type") or "unknown" for row in valid_rows}
        if not entity_scope and len(scopes) == 1:
            inferred_scope = next(iter(scopes))

        pr_r = (
            supabase_service.table("pull_requests")
            .select("*")
            .eq("author_id", author_id)
            .eq("status", "open")
            .eq("entity_scope", inferred_scope)
            .order("created_at", desc=True)
            .limit(1)
            .execute()
        )
        pr = (pr_r.data or [None])[0]
        if not pr:
            opened = (
                supabase_service.table("pull_requests")
                .insert(
                    {
                        "title": title.strip() or "Untitled request",
                        "description": clean_description,
                        "author_id": author_id,
                        "entity_scope": inferred_scope,
                    }
                )
                .execute()
            )
            pr = (opened.data or [None])[0]
        elif clean_description:
            existing_description = (pr.get("description") or "").strip()
            if clean_description not in existing_description:
                next_description = (
                    f"{existing_description}\n\n{clean_description}"
                    if existing_description
                    else clean_description
                )
                updated = (
                    supabase_service.table("pull_requests")
                    .update({"description": next_description[:2000]})
                    .eq("pr_id", pr["pr_id"])
                    .execute()
                )
                pr = (updated.data or [pr])[0]
        if not pr:
            return None

        for entry_chunk in _chunks(valid_ids):
            supabase_service.table("staging_entries").update(
                {"pull_request_id": pr["pr_id"]}
            ).in_("entry_id", entry_chunk).execute()
        return pr
    except Exception:
        log.exception("Failed to auto-wrap staging entries in pull request")
        return None
