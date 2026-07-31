"""Durable structured audit trail — best-effort, non-blocking.

Answers "who did what, to which target, when, and how did it end" for
state-changing actions and session lifecycle events, in a table that survives
restarts and redeploys (migration 046). `error_log.py` is its failure-only
sibling; this module records successes too, which is what makes a staged
Source Control request traceable to a final outcome.

Writes are fire-and-forget on a tiny thread pool: recording an event must never
add latency to the response, never raise, and never take down the action it is
describing. If persistence fails the event still reaches the normal logger.

NEVER pass passwords, PINs, access tokens, or raw request payloads to this
module. `detail` is for safe diagnostic context only; it is truncated but not
scrubbed, so the caller is responsible for what it hands over.
"""

from __future__ import annotations

import concurrent.futures
import contextvars
import logging

_log = logging.getLogger("mjcc.audit")

# Set once per request by the middleware in backend/main.py so deep call sites
# (dispatchers, staging helpers) can stamp the correlation id without every
# signature in between having to thread a Request through.
current_request_id: contextvars.ContextVar[str | None] = contextvars.ContextVar(
    "mjcc_request_id", default=None
)

# Small dedicated pool so the sync Supabase insert never blocks the event loop.
_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=2, thread_name_prefix="auditlog"
)

# Terminal states an audited action can reach. Anything else is coerced to
# 'failed' rather than silently stored, so a typo can't create a state the
# release gate ("every staged request traces to a final outcome") won't see.
RESULTS = frozenset(
    {"accepted", "staged", "merged", "rejected", "failed", "expired", "observed"}
)

_MAX_DETAIL = 4000


def _blocking_insert(row: dict) -> None:
    try:
        from backend.routes import supabase_service

        supabase_service.table("audit_events").insert(row).execute()
    except Exception:
        # Best-effort; the event was already emitted to the application log.
        _log.debug("audit_events persist failed", exc_info=True)


def _int_or_none(value):
    try:
        return int(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def record_audit_event(
    *,
    action: str,
    result: str,
    actor: dict | None = None,
    actor_id: str | None = None,
    actor_name: str | None = None,
    actor_role: str | None = None,
    method: str | None = None,
    path: str | None = None,
    target_type: str | None = None,
    target_id: str | None = None,
    sku: str | None = None,
    category: str | None = None,
    period_month=None,
    period_year=None,
    staging_id: str | None = None,
    pr_id: str | None = None,
    commit_id: str | None = None,
    status_code=None,
    duration_ms=None,
    error_type: str | None = None,
    detail=None,
    session_reason: str | None = None,
    request_id: str | None = None,
    emit_log: bool = True,
) -> None:
    """Durably record one audit event. Fire-and-forget; never raises.

    `actor` accepts the auth-user dict the route dependencies already build, so
    call sites don't have to unpack it; explicit actor_* arguments win over it.
    """
    try:
        actor = actor or {}
        resolved_result = result if result in RESULTS else "failed"
        row = {
            "actor_id": actor_id or actor.get("id") or actor.get("user_id"),
            "actor_name": actor_name
            or actor.get("display_name")
            or actor.get("username"),
            "actor_role": actor_role or actor.get("role"),
            "action": action,
            "method": method,
            "path": path,
            "target_type": target_type,
            "target_id": str(target_id) if target_id is not None else None,
            "sku": sku,
            "category": category,
            "period_month": _int_or_none(period_month),
            "period_year": _int_or_none(period_year),
            "staging_id": str(staging_id) if staging_id is not None else None,
            "pr_id": str(pr_id) if pr_id is not None else None,
            "commit_id": str(commit_id) if commit_id is not None else None,
            "result": resolved_result,
            "status_code": _int_or_none(status_code),
            "duration_ms": _int_or_none(duration_ms),
            "error_type": error_type,
            "detail": str(detail)[:_MAX_DETAIL] if detail else None,
            "session_reason": session_reason,
            "request_id": request_id or current_request_id.get(),
        }
        if emit_log:
            _log.info(
                "[AUDIT] %s -> %s | actor=%s role=%s target=%s/%s period=%s/%s "
                "staging=%s pr=%s commit=%s req=%s",
                action,
                resolved_result,
                row["actor_name"] or row["actor_id"],
                row["actor_role"],
                row["target_type"],
                row["target_id"],
                row["period_month"],
                row["period_year"],
                row["staging_id"],
                row["pr_id"],
                row["commit_id"],
                row["request_id"],
            )
        _executor.submit(_blocking_insert, row)
    except Exception:
        pass
