import os
import platform
import time
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Response
from fastapi.responses import HTMLResponse

from backend.ai import context as ai_context
from backend.routes import SUPABASE_URL, supabase_admin
from backend.tenancy import (
    TENANT_TABLES,
    TENANT_VIEWS,
    resolve_public_tenant,
    tenancy_mode,
)

router = APIRouter(tags=["health"])

STARTED_AT = datetime.now(timezone.utc)


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _elapsed_ms(start: float) -> int:
    return int((time.monotonic() - start) * 1000)


def _status(ok: bool, degraded: bool = False) -> str:
    if ok and not degraded:
        return "operational"
    if ok and degraded:
        return "degraded"
    return "outage"


def _count(
    table: str, column: str = "id", **filters: Any
) -> tuple[int | None, str | None]:
    try:
        q = supabase_admin.table(table).select(column, count="exact").limit(1)
        if tenancy_mode() != "legacy" and (
            table in TENANT_TABLES or table in TENANT_VIEWS
        ):
            q = q.eq("tenant_id", resolve_public_tenant(supabase_admin, None).id)
        for key, value in filters.items():
            if value is None:
                q = q.is_(key, "null")
            else:
                q = q.eq(key, value)
        res = q.execute()
        return int(res.count or 0), None
    except Exception as exc:
        return None, str(exc)[:180]


def _failed_sync_count() -> tuple[int | None, str | None]:
    try:
        res = (
            supabase_admin.table("github_sync_queue")
            .select("id,last_error")
            .eq(
                "tenant_id",
                resolve_public_tenant(supabase_admin, None).id,
            )
            if tenancy_mode() != "legacy"
            else supabase_admin.table("github_sync_queue").select("id,last_error")
        )
        res = res.limit(100).execute()
        rows = res.data or []
        return sum(1 for row in rows if row.get("last_error")), None
    except Exception as exc:
        return None, str(exc)[:180]


def _component(
    name: str, status: str, latency_ms: int, summary: str, **meta: Any
) -> dict:
    return {
        "name": name,
        "status": status,
        "latency_ms": latency_ms,
        "summary": summary,
        "meta": {k: v for k, v in meta.items() if v is not None},
    }


def collect_system_status() -> dict:
    checks: list[dict] = []

    started = time.monotonic()
    checks.append(
        _component(
            "API", "operational", _elapsed_ms(started), "FastAPI process is responding."
        )
    )

    started = time.monotonic()
    settings_count, settings_error = _count("app_settings", "setting_key")
    checks.append(
        _component(
            "Supabase Database",
            _status(settings_error is None),
            _elapsed_ms(started),
            "Service-role database query succeeded."
            if settings_error is None
            else "Database query failed.",
            settings_count=settings_count,
            error=settings_error,
        )
    )

    started = time.monotonic()
    user_count, user_error = _count("user_profiles", active=True)
    checks.append(
        _component(
            "Supabase Auth Profiles",
            _status(
                user_error is None and (user_count or 0) > 0,
                user_error is None and (user_count or 0) == 0,
            ),
            _elapsed_ms(started),
            f"{user_count or 0} active profile(s) visible."
            if user_error is None
            else "Auth profile lookup failed.",
            active_profiles=user_count,
            error=user_error,
        )
    )

    started = time.monotonic()
    item_count, item_error = _count("inventory_items")
    monthly_count, monthly_error = _count("monthly_inventory")
    inventory_error = item_error or monthly_error
    checks.append(
        _component(
            "Inventory Data",
            _status(inventory_error is None),
            _elapsed_ms(started),
            "Inventory tables are reachable."
            if inventory_error is None
            else "Inventory table lookup failed.",
            inventory_items=item_count,
            monthly_inventory_rows=monthly_count,
            error=inventory_error,
        )
    )

    started = time.monotonic()
    try:
        ai_cfg = ai_context.get_ai_config()
        tools = ai_context.get_ai_tools_config()
        has_key = bool(ai_cfg.get("api_key"))
        checks.append(
            _component(
                "AI Stack",
                _status(
                    bool(ai_cfg.get("provider")) and bool(ai_cfg.get("model")),
                    not has_key,
                ),
                _elapsed_ms(started),
                f"{ai_cfg.get('provider', 'unknown')} / {ai_cfg.get('model', 'unknown')}",
                provider=ai_cfg.get("provider"),
                model=ai_cfg.get("model"),
                vision=bool(ai_cfg.get("is_vision")),
                has_key=has_key,
                enabled_tools=[k for k, enabled in tools.items() if enabled],
            )
        )
    except Exception as exc:
        checks.append(
            _component(
                "AI Stack",
                "outage",
                _elapsed_ms(started),
                "AI config lookup failed.",
                error=str(exc)[:180],
            )
        )

    started = time.monotonic()
    staging_count, staging_error = _count(
        "staging_entries", "entry_id", status="pending"
    )
    pr_count, pr_error = _count("pull_requests", "pr_id", status="open")
    source_error = staging_error or pr_error
    checks.append(
        _component(
            "Source Control",
            _status(source_error is None),
            _elapsed_ms(started),
            "Source Control tables are reachable."
            if source_error is None
            else "Source Control lookup failed.",
            pending_staging=staging_count,
            open_pull_requests=pr_count,
            error=source_error,
        )
    )

    started = time.monotonic()
    pending_sync, pending_error = _count("github_sync_queue", synced_at=None)
    failed_sync, failed_error = _failed_sync_count()
    sync_error = pending_error or failed_error
    checks.append(
        _component(
            "GitHub Archive Sync",
            _status(sync_error is None),
            _elapsed_ms(started),
            "GitHub sync queue is queryable."
            if sync_error is None
            else "GitHub sync queue lookup failed.",
            pending_queue=pending_sync,
            failed_queue=failed_sync,
            configured=bool(os.getenv("GITHUB_TOKEN")),
            repo=os.getenv("GITHUB_REPO", "MJCC-Portal/mjcc"),
            error=sync_error,
        )
    )

    order = {"operational": 0, "degraded": 1, "outage": 2}
    overall = max((c["status"] for c in checks), key=lambda s: order.get(s, 2))
    return {
        "service": "MJCC Management API",
        "status": overall,
        "checked_at": _utc_now(),
        "started_at": STARTED_AT.isoformat(),
        "uptime_seconds": int(
            (datetime.now(timezone.utc) - STARTED_AT).total_seconds()
        ),
        "environment": os.getenv("RENDER_SERVICE_NAME")
        or os.getenv("ENVIRONMENT")
        or "unknown",
        "components": checks,
    }


def system_info() -> dict:
    return {
        "service": "MJCC Management API",
        "version": os.getenv("RENDER_GIT_COMMIT", "")[:12] or "local",
        "environment": os.getenv("RENDER_SERVICE_NAME")
        or os.getenv("ENVIRONMENT")
        or "unknown",
        "region": os.getenv("RENDER_REGION", "unknown"),
        "python": platform.python_version(),
        "platform": platform.system(),
        "supabase_project": (SUPABASE_URL or "").split("//")[-1].split(".")[0],
        "github_archive_repo": os.getenv("GITHUB_REPO", "MJCC-Portal/mjcc"),
        "started_at": STARTED_AT.isoformat(),
        "checked_at": _utc_now(),
        "endpoints": {
            "live": "/health/live",
            "ready": "/health/ready",
            "status_json": "/api/system/status",
            "info": "/api/system/info",
            "status_page": "/status",
            "log_portal": "/portal/logs",
        },
    }


@router.get("/health/live")
async def health_live():
    return {"status": "ok", "service": "MJCC Management API", "checked_at": _utc_now()}


@router.get("/health/ready")
async def health_ready(response: Response):
    payload = collect_system_status()
    if any(c["status"] == "outage" for c in payload["components"][:4]):
        response.status_code = 503
    return payload


@router.get("/api/system/status")
async def api_system_status():
    return collect_system_status()


@router.get("/api/system/info")
async def api_system_info():
    return system_info()


def _pill(status: str) -> str:
    return {
        "operational": "Operational",
        "degraded": "Degraded",
        "outage": "Outage",
    }.get(status, status.title())


def render_status_page(payload: dict) -> str:
    color = {"operational": "#2f9e44", "degraded": "#f59f00", "outage": "#e03131"}
    rows = []
    for comp in payload["components"]:
        c = color.get(comp["status"], "#868e96")
        bars = "".join(f'<span style="background:{c}"></span>' for _ in range(60))
        rows.append(
            f"""
            <section class="component">
              <div class="topline">
                <h2>{comp["name"]}</h2>
                <strong style="color:{c}">{_pill(comp["status"])}</strong>
              </div>
              <div class="bars">{bars}</div>
              <div class="meta">
                <span>{comp["summary"]}</span>
                <span>{comp["latency_ms"]} ms</span>
              </div>
            </section>
            """
        )
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta http-equiv="refresh" content="60" />
  <title>MJCC API Status</title>
  <style>
    body {{ margin:0; font-family: Arial, sans-serif; background:#f7f6f2; color:#1f2933; }}
    main {{ max-width: 920px; margin: 48px auto; padding: 0 18px 48px; }}
    header {{ margin-bottom: 28px; }}
    h1 {{ margin:0 0 8px; font-size: 34px; }}
    p {{ margin:0; color:#667085; }}
    .overall {{ display:inline-flex; gap:10px; align-items:center; margin-top:18px; padding:10px 14px; border:1px solid #ddd8cf; background:white; }}
    .dot {{ width:10px; height:10px; border-radius:50%; background:{color.get(payload["status"], "#868e96")}; }}
    .component {{ background:white; border:1px solid #ddd8cf; padding:20px; }}
    .component + .component {{ border-top:0; }}
    .topline {{ display:flex; justify-content:space-between; gap:18px; align-items:center; }}
    h2 {{ margin:0; font-size:18px; font-weight:600; }}
    .bars {{ display:grid; grid-template-columns: repeat(60, 1fr); gap:4px; margin:16px 0 10px; }}
    .bars span {{ height:34px; border-radius:1px; }}
    .meta {{ display:flex; justify-content:space-between; gap:18px; color:#667085; font-size:14px; }}
    .links {{ margin-top:22px; display:flex; gap:14px; flex-wrap:wrap; }}
    a {{ color:#175cd3; text-decoration:none; }}
    @media (max-width: 640px) {{
      main {{ margin-top: 24px; }}
      .bars {{ gap:2px; }}
      .bars span {{ height:24px; }}
      .meta, .topline {{ flex-direction:column; align-items:flex-start; }}
    }}
  </style>
</head>
<body>
  <main>
    <header>
      <h1>MJCC API Status</h1>
      <p>Live production health for API, database, inventory, AI, auth profiles, and source control.</p>
      <div class="overall"><span class="dot"></span><strong>{_pill(payload["status"])}</strong><span>{payload["checked_at"]}</span></div>
    </header>
    {"".join(rows)}
    <nav class="links">
      <a href="/health/live">Live JSON</a>
      <a href="/health/ready">Readiness JSON</a>
      <a href="/api/system/status">Detailed JSON</a>
      <a href="/api/system/info">System Info</a>
      <a href="/portal/logs">API Log Portal</a>
    </nav>
  </main>
</body>
</html>"""


@router.get("/status", response_class=HTMLResponse)
async def status_page():
    return HTMLResponse(render_status_page(collect_system_status()))
