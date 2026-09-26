"""Thread-safe in-process API log capture and async subscriber delivery."""

from __future__ import annotations

import asyncio
import logging
import os
import time
import traceback
from collections import deque
from datetime import datetime, timezone
from threading import RLock
from typing import Any

MAX_EVENTS = 1000
HISTORY_ON_CONNECT = 80
_events: deque[dict[str, Any]] = deque(maxlen=MAX_EVENTS)
_subscribers: dict[asyncio.Queue, asyncio.AbstractEventLoop] = {}
_lock = RLock()
_handler_installed = False


def get_events() -> list[dict[str, Any]]:
    """Return an oldest-first snapshot safe to iterate outside the lock."""
    with _lock:
        return list(_events)


def subscribe(queue: asyncio.Queue) -> None:
    """Register on the queue's owning running loop before awaiting queue.get()."""
    loop = asyncio.get_running_loop()
    with _lock:
        _subscribers[queue] = loop


def unsubscribe(queue: asyncio.Queue) -> None:
    with _lock:
        _subscribers.pop(queue, None)


def _deliver(
    queue: asyncio.Queue, loop: asyncio.AbstractEventLoop, event: dict[str, Any]
) -> None:
    # This callback always runs on the owning loop; Queue is not thread-safe.
    with _lock:
        if _subscribers.get(queue) is not loop:
            return
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            _subscribers.pop(queue, None)


def _append_event(event: dict[str, Any]) -> None:
    # Serialize scheduling with appends so every subscriber sees ring order,
    # even when several worker threads emit concurrently.
    with _lock:
        _events.append(event)
        for queue, loop in list(_subscribers.items()):
            try:
                loop.call_soon_threadsafe(_deliver, queue, loop, event)
            except RuntimeError:
                # The loop may close between registration and scheduling.
                _subscribers.pop(queue, None)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public_path(path: str) -> str:
    if "token=" not in path:
        return path
    base, _, query = path.partition("?")
    parts = [
        "token=redacted" if item.startswith("token=") else item
        for item in query.split("&")
    ]
    return f"{base}?{'&'.join(parts)}"


def _status_band(status_code: int) -> str:
    if status_code >= 500:
        return "error"
    if status_code >= 400:
        return "warn"
    return "info"


def record_request(
    *,
    method: str,
    path: str,
    status_code: int,
    duration_ms: int,
    user_hint: str = "",
    client_ip: str = "",
    request_id: str = "",
    tenant_id: str | None = None,
) -> None:
    _append_event(
        {
            "id": f"{time.time_ns()}",
            "ts": _now_iso(),
            "type": "request",
            "level": _status_band(status_code),
            "source": "http",
            "message": f"{method} {_public_path(path)} -> {status_code}",
            "method": method,
            "path": _public_path(path),
            "status": status_code,
            "duration_ms": duration_ms,
            "user": user_hint,
            "ip": client_ip,
            "request_id": request_id,
            "tenant_id": tenant_id,
        }
    )


def record_log(
    level: str, source: str, message: str, extra: dict[str, Any] | None = None
) -> None:
    from backend.tenancy import current_tenant

    tenant = current_tenant()
    _append_event(
        {
            "id": f"{time.time_ns()}",
            "ts": _now_iso(),
            "type": "log",
            "level": level.lower(),
            "source": source,
            "message": message[:4000],
            "meta": extra or {},
            "tenant_id": tenant.id if tenant else None,
        }
    )


class InMemoryLogHandler(logging.Handler):
    """Capture Python log records into the portal ring buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
            if record.exc_info:
                message = f"{message}\n{''.join(traceback.format_exception(*record.exc_info))}"
            record_log(record.levelname, record.name, message)
        except Exception:
            pass


def install_log_capture() -> None:
    global _handler_installed
    with _lock:
        if _handler_installed:
            return
        handler = InMemoryLogHandler()
        mode = os.getenv("MJCC_LOG_MODE", "live").strip().lower()
        handler.setLevel(logging.DEBUG if mode in {"debug", "dev"} else logging.INFO)
        logging.getLogger().addHandler(handler)
        _handler_installed = True
        record_log("info", "mjcc.api_logs", "API log capture initialized.")
