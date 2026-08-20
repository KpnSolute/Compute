"""Shared FastAPI dependencies for MJCC routes — auth resolution and role guards."""

import logging
from collections.abc import AsyncIterator

from fastapi import Depends, Header, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from backend.routes import (
    jwt_validator,
    supabase_admin,
    supabase_service,
)
from backend.staff_sessions import (
    staff_session_credential_version,
    verify_staff_session,
)
from backend.tenancy import (
    TenantContextError,
    resolve_public_tenant,
    resolve_user_tenant,
    tenant_scope,
    tenancy_mode,
)

ROLE_LEVEL = {"staff": 10, "assistant": 20, "manager": 30, "admin": 40, "sudo": 50}

log = logging.getLogger("mjcc.routes.deps")
BULK_CHUNK_SIZE = 100


def _chunks(values: list, size: int = BULK_CHUNK_SIZE):
    for idx in range(0, len(values), size):
        yield values[idx : idx + size]


def _profile_for_staff_session(claims: dict) -> dict:
    """Resolve the profile behind a verified tenant-local staff session.

    The signature has already been checked. What is checked here is everything a
    signature cannot prove: that the account still exists and is active, and that
    the PIN generation the session was minted from is still the current one.

    ``credential_version`` is what makes a PIN reset actually revoke. Every
    credential write increments ``user_profiles.pin_version``; a session carrying
    an older generation stops verifying on its next request rather than living
    out its twelve-hour expiry with a credential that has been rotated away.
    """
    user_id = str(claims.get("sub") or "")
    try:
        found = (
            supabase_admin.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .eq("active", True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="Invalid session") from exc
    if not found.data:
        raise HTTPException(status_code=401, detail="Invalid session")
    profile = found.data[0]

    current_version = int(profile.get("pin_version") or 0)
    if staff_session_credential_version(claims) != current_version:
        raise HTTPException(
            status_code=401,
            detail="This staff credential has changed. Sign in again.",
        )

    return {
        **profile,
        "_auth_method": "staff_session",
        "_staff_tenant_id": str(claims.get("tenant_id") or ""),
        "_staff_session_id": str(claims.get("jti") or ""),
    }


def _profile_for_token(authorization: str) -> dict:
    """Resolve the caller from a Bearer token. Raises 401 if missing or invalid.

    Returns the full user_profiles row (single source of truth for auth across all
    routers). Selecting `*` keeps every consumer working whether it reads id/role
    or richer profile fields.

    Three token shapes reach this function:

    * a signed tenant-local staff session (:mod:`backend.staff_sessions`);
    * a Supabase Auth JWT for admin/manager accounts.

    The unsigned ``pin_<profile-id>`` shape is not one of them. It was accepted
    until now, and it was not a token at all: the string after the prefix was the
    user's own primary key, so anyone who learned a staff member's row id --- from
    a URL, an export, a screenshot of an admin table --- could authenticate as
    them, forever, with no signature and no expiry. It is rejected here in every
    mode, before any lookup, so no code path can resurrect it.
    """
    token = (authorization or "").replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")
    if token.startswith("pin_"):
        raise HTTPException(
            status_code=401,
            detail="Unsigned staff tokens are no longer accepted. Sign in again.",
        )

    staff_claims = verify_staff_session(token)
    if staff_claims:
        return _profile_for_staff_session(staff_claims)

    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")
    try:
        r = (
            supabase_admin.table("user_profiles")
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
    return {**r.data[0], "_auth_method": "jwt"}


async def _get_auth_user(
    request: Request,
    authorization: str = Header(""),
    x_kpn_workspace: str = Header("", alias="X-Kpn-Workspace"),
    x_kpn_tenant_id: str = Header("", alias="X-Kpn-Tenant-Id"),
) -> AsyncIterator[dict]:
    """Authenticate and bind the request to an active workspace membership.

    This dependency MUST stay ``async``. A sync generator dependency is entered
    by FastAPI through ``contextmanager_in_threadpool``, so anything it sets on
    a ContextVar lands in a worker thread's context and is invisible to the
    route handler — which made every tenant-scoped query raise
    ``TenantContextError`` and then fail teardown with "Token was created in a
    different Context". Entering the scope from the async task keeps the tenant
    binding in the same context the endpoint runs in.

    The Supabase calls below are blocking, so they are pushed to a threadpool
    explicitly rather than running on the event loop.
    """
    user = await run_in_threadpool(_profile_for_token, authorization)
    if tenancy_mode() == "legacy":
        if user.get("_auth_method") == "pin" and user.get("role") != "staff":
            raise HTTPException(
                status_code=403,
                detail="Elevated access requires password authentication",
            )
        yield user
        return
    try:
        context, workspaces = await run_in_threadpool(
            resolve_user_tenant,
            supabase_admin,
            str(user["id"]),
            x_kpn_workspace or None,
        )
    except TenantContextError as exc:
        raise HTTPException(status_code=403, detail=str(exc)) from exc
    tenant_user = {
        **user,
        "role": context.role or user.get("role"),
        "tenant": {
            "id": context.id,
            "slug": context.slug,
            "name": context.name,
            "role": context.role,
        },
        "workspaces": workspaces,
    }
    if x_kpn_tenant_id.strip() and str(context.id) != x_kpn_tenant_id.strip():
        raise HTTPException(status_code=403, detail="Immutable tenant context mismatch")
    if tenant_user.get("_auth_method") == "pin" and context.role != "staff":
        raise HTTPException(
            status_code=403,
            detail="Elevated access requires password authentication",
        )
    request.state.tenant_id = context.id
    request.state.tenant_slug = context.slug
    with tenant_scope(context):
        yield tenant_user


async def _get_public_tenant(
    request: Request,
    x_kpn_workspace: str = Header("", alias="X-Kpn-Workspace"),
    x_kpn_tenant_id: str = Header("", alias="X-Kpn-Tenant-Id"),
) -> AsyncIterator[dict]:
    """Bind a public endpoint to one active workspace.

    Async for the same reason as :func:`_get_auth_user`.
    """
    if tenancy_mode() == "legacy":
        yield {}
        return
    try:
        context = await run_in_threadpool(
            resolve_public_tenant, supabase_admin, x_kpn_workspace or None
        )
    except TenantContextError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    if x_kpn_tenant_id.strip() and str(context.id) != x_kpn_tenant_id.strip():
        raise HTTPException(status_code=403, detail="Immutable tenant context mismatch")
    request.state.tenant_id = context.id
    request.state.tenant_slug = context.slug
    with tenant_scope(context):
        yield {"id": context.id, "slug": context.slug, "name": context.name}


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
