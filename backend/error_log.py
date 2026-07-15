"""Durable server-side error persistence — best-effort, non-blocking.

The live-tail log buffer (routes/api_logs.py) is an in-memory deque that is lost
on every restart/redeploy and rolls off after 1000 events. This module writes
5xx and actionable staff-facing 4xx (400/409/422/...) to the `error_logs` table
so a problem a staff member hit can still be assessed hours or days later, even
across deploys.

Writes are fire-and-forget on a tiny thread pool: an error being logged must
never add latency to the response, never raise, and never recurse into another
error. If persistence fails, we fall back to the normal logger and move on.
"""

from __future__ import annotations

import concurrent.futures
import logging

_log = logging.getLogger("mjcc.errors")

# Small dedicated pool so the sync Supabase insert never blocks the event loop.
_executor = concurrent.futures.ThreadPoolExecutor(
    max_workers=2, thread_name_prefix="errlog"
)


def _blocking_insert(row: dict) -> None:
    try:
        from backend.routes import supabase_service

        supabase_service.table("error_logs").insert(row).execute()
    except Exception:
        # Persistence is best-effort; the error itself was already logged.
        _log.debug("error_logs persist failed", exc_info=True)


def record_error(
    *,
    method: str | None,
    path: str | None,
    status_code: int | None,
    error_type: str | None,
    detail=None,
    traceback_str: str | None = None,
    user_hint: str | None = None,
    request_id: str | None = None,
) -> None:
    """Durably record one error. Fire-and-forget; never raises."""
    try:
        row = {
            "method": method,
            "path": path,
            "status_code": status_code,
            "error_type": error_type,
            "detail": str(detail)[:4000] if detail else None,
            "traceback": str(traceback_str)[:8000] if traceback_str else None,
            "user_hint": user_hint,
            "request_id": request_id,
        }
        _executor.submit(_blocking_insert, row)
    except Exception:
        pass
