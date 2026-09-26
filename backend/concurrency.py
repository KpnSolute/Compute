"""Keep blocking operations off the event loop and inventory writes ordered.

The deployment intentionally remains one process. These locks coordinate that
process; they are not a substitute for database coordination when scaling out.
"""

import asyncio
import contextvars
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from copy import deepcopy
from functools import partial, wraps
from inspect import signature
from threading import RLock
from time import monotonic

from fastapi.params import Param
from starlette.responses import Response

from backend.tenancy import current_tenant, default_tenant_slug, tenancy_mode

inventory_write_lock = RLock()
_commit_executor = ThreadPoolExecutor(max_workers=1, thread_name_prefix="commit")
_audit_executor = ThreadPoolExecutor(
    max_workers=1, thread_name_prefix="inventory-audit"
)


def schedule_inventory_audit(handler, *args):
    """Run best-effort post-commit work outside the commit response path."""
    context = contextvars.copy_context()
    return _audit_executor.submit(context.run, handler, *args)


def serialized_inventory_write(handler):
    """Protect a complete synchronous mutation, including its state checks."""

    @wraps(handler)
    def guarded(*args, **kwargs):
        with inventory_write_lock:
            return handler(*args, **kwargs)

    # FastAPI inspects annotations in the wrapper's globals. Resolve postponed
    # annotations against the original handler before crossing module boundaries.
    guarded.__signature__ = signature(handler, eval_str=True)
    return guarded


def inventory_snapshot_read(handler):
    """Serve a recent tenant snapshot only while the process's replay lock is busy.

    Authentication still runs as a FastAPI dependency on every request. Cold or
    expired reads wait for the lock; an available lock always means a fresh read.
    Other inventory readers retain their existing wait-for-write behavior.
    """
    handler_signature = signature(handler, eval_str=True)
    snapshots = OrderedDict()
    cache_lock = RLock()
    ttl_seconds = 60
    max_entries = 64

    def cache_key(arguments):
        context = current_tenant()
        if context is not None:
            tenant = ("tenant", context.id) if context.id else None
        elif tenancy_mode() == "legacy":
            slug = default_tenant_slug()
            tenant = ("legacy", slug) if slug else None
        else:
            tenant = None
        month, year = arguments.get("month"), arguments.get("year")
        if tenant is None or any(
            value is not None and type(value) is not int for value in (month, year)
        ):
            return None
        # The handler treats a partial period as a request for the latest period.
        period = (
            (month, year) if month is not None and year is not None else (None, None)
        )
        return tenant, *period

    def fresh(bound, key):
        try:
            result = handler(*bound.args, **bound.kwargs)
        except Exception:
            # A fresh failure must not leave a previous success available later.
            with cache_lock:
                snapshots.pop(key, None)
            raise
        if key is not None and not (
            isinstance(result, Response) and result.status_code >= 400
        ):
            saved = deepcopy(result)
            now = monotonic()
            with cache_lock:
                for expired in [
                    k
                    for k, (stamp, _) in snapshots.items()
                    if now - stamp >= ttl_seconds
                ]:
                    del snapshots[expired]
                snapshots[key] = (now, saved)
                snapshots.move_to_end(key)
                while len(snapshots) > max_entries:
                    snapshots.popitem(last=False)
        return result

    @wraps(handler)
    def guarded(*args, **kwargs):
        bound = handler_signature.bind(*args, **kwargs)
        bound.apply_defaults()
        for name in ("month", "year"):
            if isinstance(bound.arguments.get(name), Param):
                bound.arguments[name] = bound.arguments[name].default
        key = cache_key(bound.arguments)
        if inventory_write_lock.acquire(blocking=False):
            try:
                return fresh(bound, key)
            finally:
                inventory_write_lock.release()
        if key is not None:
            with cache_lock:
                entry = snapshots.get(key)
                if entry is not None and monotonic() - entry[0] < ttl_seconds:
                    return deepcopy(entry[1])
                snapshots.pop(key, None)
        with inventory_write_lock:
            return fresh(bound, key)

    guarded.__signature__ = handler_signature
    return guarded


async def run_commit(handler, *args):
    """Queue commit work without occupying FastAPI's general worker capacity."""
    context = contextvars.copy_context()
    work = partial(serialized_inventory_write(handler), *args)
    return await asyncio.get_running_loop().run_in_executor(
        _commit_executor, context.run, work
    )
