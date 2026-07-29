"""Protected API log portal with in-process request/log tailing."""

from __future__ import annotations

import asyncio
import json
import logging
import time
import traceback
from collections import deque
from datetime import datetime, timedelta, timezone
from typing import Any, AsyncGenerator

import jwt
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, StreamingResponse

from backend.routes import jwt_validator, supabase, supabase_service
from backend.routes._deps import ROLE_LEVEL, _get_auth_user

MAX_EVENTS = 1000
HISTORY_ON_CONNECT = 80
_events: deque[dict[str, Any]] = deque(maxlen=MAX_EVENTS)
_subscribers: list[asyncio.Queue] = []
_handler_installed = False

router = APIRouter(tags=["api-logs"])


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _public_path(path: str) -> str:
    if "token=" not in path:
        return path
    base, _, query = path.partition("?")
    parts = []
    for item in query.split("&"):
        if item.startswith("token="):
            parts.append("token=redacted")
        else:
            parts.append(item)
    return f"{base}?{'&'.join(parts)}"


def _append_event(event: dict[str, Any]) -> None:
    _events.append(event)
    stale: list[asyncio.Queue] = []
    for queue in list(_subscribers):
        try:
            queue.put_nowait(event)
        except asyncio.QueueFull:
            stale.append(queue)
    for queue in stale:
        try:
            _subscribers.remove(queue)
        except ValueError:
            pass


def _status_band(status_code: int) -> str:
    if status_code >= 500:
        return "error"
    if status_code >= 400:
        return "warn"
    return "info"


def _token_user_hint(authorization: str | None) -> str:
    """Return a display hint from a bearer token without storing or validating it."""
    token = (authorization or "").replace("Bearer ", "").strip()
    if not token:
        return ""
    if token.startswith("pin_"):
        return f"staff:{token[4:12]}"
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except Exception:
        return "authenticated"
    email = str(claims.get("email") or "")
    if email:
        return email.split("@", 1)[0]
    role = str(claims.get("role") or "")
    sub = str(claims.get("sub") or "")
    if role and sub:
        return f"{role}:{sub[:8]}"
    return sub[:8] if sub else "authenticated"


def record_request(
    *,
    method: str,
    path: str,
    status_code: int,
    duration_ms: int,
    user_hint: str = "",
    client_ip: str = "",
    request_id: str = "",
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
        }
    )


def record_log(
    level: str, source: str, message: str, extra: dict[str, Any] | None = None
) -> None:
    _append_event(
        {
            "id": f"{time.time_ns()}",
            "ts": _now_iso(),
            "type": "log",
            "level": level.lower(),
            "source": source,
            "message": message[:4000],
            "meta": extra or {},
        }
    )


def _audit_level(result: str) -> str:
    if result == "failed":
        return "error"
    if result in {"rejected", "expired"}:
        return "warn"
    return "info"


def _legacy_audit_event(row: dict[str, Any]) -> dict[str, Any]:
    """Map a durable audit row into the legacy live-tail event shape."""
    result = str(row.get("result") or "observed")
    actor = row.get("actor_name") or row.get("actor_id") or "unknown"
    target = "/".join(
        str(value) for value in (row.get("target_type"), row.get("target_id")) if value
    )
    return {
        "id": f"audit:{row.get('id')}",
        "ts": row.get("created_at"),
        "type": "audit",
        "level": _audit_level(result),
        "source": "mjcc.audit",
        "message": f"{row.get('action') or 'audit'} -> {result}",
        "action": row.get("action"),
        "result": result,
        "actor": actor,
        "user": actor,
        "role": row.get("actor_role"),
        "target": target,
        "path": row.get("path"),
        "status": row.get("status_code"),
        "duration_ms": row.get("duration_ms"),
        "request_id": row.get("request_id"),
        "session_reason": row.get("session_reason"),
        "meta": {
            "sku": row.get("sku"),
            "category": row.get("category"),
            "period_month": row.get("period_month"),
            "period_year": row.get("period_year"),
            "staging_id": row.get("staging_id"),
            "pr_id": row.get("pr_id"),
            "commit_id": row.get("commit_id"),
            "detail": row.get("detail"),
            "error_type": row.get("error_type"),
        },
    }


def _read_audit_events(limit: int) -> list[dict[str, Any]]:
    """Read durable audit rows without breaking legacy logs if migration 046 is pending."""
    try:
        result = (
            supabase_service.table("audit_events")
            .select(
                "id,created_at,actor_id,actor_name,actor_role,action,method,path,"
                "target_type,target_id,sku,category,period_month,period_year,"
                "staging_id,pr_id,commit_id,result,status_code,duration_ms,"
                "error_type,detail,session_reason,request_id"
            )
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return [_legacy_audit_event(row) for row in (result.data or [])]
    except Exception:
        # The application can deploy before the schema migration; the legacy
        # in-memory tail must remain usable while durable storage is pending.
        logging.getLogger("mjcc.api_logs").debug(
            "Could not read audit_events; migration may be pending", exc_info=True
        )
        return []


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
    if _handler_installed:
        return
    handler = InMemoryLogHandler()
    handler.setLevel(logging.INFO)
    logging.getLogger().addHandler(handler)
    _handler_installed = True
    record_log("info", "mjcc.api_logs", "API log capture initialized.")


def require_elevated_user(auth_user: dict = Depends(_get_auth_user)) -> dict:
    role = (auth_user or {}).get("role", "")
    if ROLE_LEVEL.get(role, 0) < ROLE_LEVEL["manager"]:
        raise HTTPException(status_code=403, detail="Admin or manager role required")
    return auth_user


def _user_from_token(token: str) -> dict:
    token = (token or "").replace("Bearer ", "").strip()
    if not token:
        raise HTTPException(status_code=401, detail="Missing token")
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")
    try:
        result = (
            supabase_service.table("user_profiles")
            .select("id,username,display_name,role,active")
            .eq("id", user_id)
            .eq("active", True)
            .limit(1)
            .execute()
        )
    except Exception as exc:
        raise HTTPException(status_code=401, detail="User lookup failed") from exc
    if not result.data:
        raise HTTPException(status_code=401, detail="User not found or inactive")
    user = result.data[0]
    if ROLE_LEVEL.get(user.get("role", ""), 0) < ROLE_LEVEL["manager"]:
        raise HTTPException(status_code=403, detail="Admin or manager role required")
    return user


@router.get("/api/system/logs")
async def get_api_logs(
    limit: int = Query(250, ge=1, le=MAX_EVENTS),
    kind: str = Query("all", pattern="^(all|request|log|audit)$"),
    level: str = Query("all"),
    include_durable: bool = Query(True),
    auth_user: dict = Depends(require_elevated_user),
) -> JSONResponse:
    _ = auth_user
    entries = list(_events)
    if include_durable:
        entries.extend(_read_audit_events(limit))
        entries.sort(key=lambda entry: entry.get("ts") or "")
    entries = entries[-limit:]
    if kind != "all":
        entries = [entry for entry in entries if entry.get("type") == kind]
    if level != "all":
        levels = {item.strip().lower() for item in level.split(",") if item.strip()}
        entries = [entry for entry in entries if entry.get("level") in levels]
    entries.reverse()
    return JSONResponse(
        {"entries": entries, "buffered": len(_events), "max": MAX_EVENTS}
    )


@router.get("/api/system/logs/audit")
async def get_audit_logs(
    limit: int = Query(250, ge=1, le=500),
    auth_user: dict = Depends(require_elevated_user),
) -> JSONResponse:
    """Durable who/what/when audit events for the legacy operator surface."""
    _ = auth_user
    return JSONResponse({"events": _read_audit_events(limit)})


@router.get("/api/system/logs/errors")
async def get_persisted_errors(
    limit: int = Query(100, ge=1, le=500),
    status_min: int = Query(400, ge=400, le=599),
    since_hours: int = Query(168, ge=1, le=2160),
    auth_user: dict = Depends(require_elevated_user),
) -> JSONResponse:
    """Durable error history from error_logs — survives restarts/redeploys.

    Unlike the in-memory live tail above, this is what an operator opens after a
    staff member reports "it errored earlier": persisted 5xx + actionable 4xx,
    newest first, filterable by minimum status and lookback window.
    """
    _ = auth_user
    since = (datetime.now(timezone.utc) - timedelta(hours=since_hours)).isoformat()
    try:
        result = (
            supabase_service.table("error_logs")
            .select(
                "id, created_at, method, path, status_code, error_type, detail, user_hint, request_id"
            )
            .gte("status_code", status_min)
            .gte("created_at", since)
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return JSONResponse({"errors": result.data or []})
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Could not load errors: {exc}")


@router.get("/api/system/logs/stream")
async def stream_api_logs(token: str = Query("")) -> StreamingResponse:
    _user_from_token(token)

    async def events() -> AsyncGenerator[str, None]:
        queue: asyncio.Queue = asyncio.Queue(maxsize=250)
        _subscribers.append(queue)
        try:
            for event in list(_events)[-HISTORY_ON_CONNECT:]:
                yield f"event: history\ndata: {json.dumps(event)}\n\n"
            yield 'event: ready\ndata: {"ok": true}\n\n'
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=25)
                    yield f"event: log\ndata: {json.dumps(event)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            try:
                _subscribers.remove(queue)
            except ValueError:
                pass

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.post("/portal/logs/login")
async def portal_logs_login(request: Request) -> JSONResponse:
    try:
        body = await request.json()
    except Exception:
        body = {}
    username = str(body.get("username", "")).strip()
    password = str(body.get("password", ""))
    if not username or not password:
        raise HTTPException(status_code=400, detail="Username and password required")

    email = username if "@" in username else f"{username}@mjc-cafeteria.com"
    try:
        response = supabase.auth.sign_in_with_password(
            {"email": email, "password": password}
        )
    except Exception as exc:
        record_log(
            "warning", "mjcc.api_logs", f"Portal log login failed for {username}."
        )
        raise HTTPException(status_code=401, detail="Invalid credentials") from exc
    session = getattr(response, "session", None)
    if not session or not getattr(session, "access_token", None):
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = _user_from_token(session.access_token)
    public_user = {
        "username": user.get("username"),
        "display_name": user.get("display_name") or user.get("username"),
        "role": user.get("role"),
    }
    record_log(
        "info",
        "mjcc.api_logs",
        f"Portal log login succeeded for {public_user['username']}.",
    )
    return JSONResponse({"token": session.access_token, "user": public_user})


def _portal_html(auto_token: str = "") -> str:
    # auto_token: if provided (from ?token= param), JS skips the login form.
    safe = (
        auto_token.replace('"', "")
        .replace("'", "")
        .replace("<", "")
        .replace(">", "")
        .replace("\\", "")
    )
    auto_js = f'window._autoToken = "{safe}";' if safe else ""
    # Inline HTML keeps this usable directly from the API service with no frontend deploy coupling.
    return (
        """<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>MJCC API Logs</title>
  <style>
    :root{color-scheme:dark;--bg:#0f141b;--panel:#171d27;--panel2:#10161f;--line:#2b3442;--text:#eef2f7;--muted:#8b98aa;--blue:#58a6ff;--green:#3fb950;--amber:#d29922;--red:#f85149}
    *{box-sizing:border-box} body{margin:0;background:var(--bg);color:var(--text);font-family:Segoe UI,system-ui,Arial,sans-serif}
    main{max-width:1180px;margin:0 auto;padding:22px 14px 44px}
    h1{font-size:24px;margin:0} .sub{color:var(--muted);font-size:13px;margin-top:5px}
    .login{max-width:390px;margin:12vh auto;background:var(--panel);border:1px solid var(--line);padding:24px;border-radius:8px}
    label{display:block;color:var(--muted);font-size:12px;font-weight:700;margin:14px 0 6px}
    input,select{background:var(--panel2);border:1px solid var(--line);color:var(--text);border-radius:6px;padding:9px 10px;min-height:38px}
    input:focus,select:focus{outline:1px solid var(--blue);border-color:var(--blue)}
    .login input{width:100%} button{border:1px solid var(--line);background:#1f6feb;color:white;border-radius:6px;padding:9px 13px;font-weight:700;cursor:pointer} button:disabled{opacity:.55}
    .err{min-height:20px;color:var(--red);font-size:13px;margin-top:10px}.portal{display:none}
    .top{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin-bottom:16px}
    .who{border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:6px 10px;color:var(--muted);font-size:12px}
    .controls{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:14px 0}.controls input{min-width:260px;flex:1}
    .pill{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);background:var(--panel);border-radius:999px;padding:5px 10px;font-size:12px;color:var(--muted)}
    .dot{width:8px;height:8px;border-radius:50%;background:var(--amber)}.live .dot{background:var(--green)}.down .dot{background:var(--red)}
    .table{border:1px solid var(--line);background:var(--panel);border-radius:8px;overflow:auto;max-height:72vh}
    table{border-collapse:collapse;width:100%;font-size:12.5px} th{position:sticky;top:0;background:var(--panel2);color:var(--muted);text-align:left;padding:8px;border-bottom:1px solid var(--line);z-index:1}
    td{padding:7px 8px;border-bottom:1px solid #202938;vertical-align:top} tr.flash{animation:flash .7s ease}@keyframes flash{from{background:#17324d}to{background:transparent}}
    .type{font-weight:800;text-transform:uppercase;font-size:10px;letter-spacing:.08em}.request{color:var(--blue)}.log{color:#bc8cff}
    .info{color:var(--green)}.warning,.warn{color:var(--amber)}.error,.critical{color:var(--red)}.debug{color:var(--muted)}
    .msg{max-width:520px;white-space:pre-wrap;word-break:break-word}.path{max-width:340px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
    @media(max-width:720px){main{padding:14px 8px}.controls input{min-width:100%}.hide-sm{display:none}td,th{padding:6px 5px}}
  </style>
</head>
<body>
<main>
  <section id="login" class="login">
    <h1>MJCC API Logs</h1>
    <p class="sub">Admin, sudo, and manager access only.</p>
    <label>Username</label><input id="username" autocomplete="username" placeholder="jeremiah" />
    <label>Password</label><input id="password" type="password" autocomplete="current-password" />
    <button id="loginBtn" style="width:100%;margin-top:16px" onclick="login()">Sign in</button>
    <div id="error" class="err"></div>
  </section>
  <section id="portal" class="portal">
    <div class="top">
      <div><h1>MJCC API Live Tail</h1><p class="sub">Recent backend logs and requests from this API process. Render restarts clear the buffer.</p></div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span id="state" class="pill"><span class="dot"></span><span>Connecting</span></span><span id="who" class="who"></span><button onclick="logout()">Sign out</button></div>
    </div>
    <div class="controls">
      <input id="filter" placeholder="Filter message, path, user, source..." oninput="draw()" />
      <select id="kind" onchange="draw()"><option value="all">All</option><option value="request">Requests</option><option value="log">Backend logs</option><option value="audit">Audit events</option></select>
      <select id="level" onchange="draw()"><option value="all">All levels</option><option value="error,critical">Errors</option><option value="warn,warning">Warnings</option><option value="info">Info</option></select>
      <button onclick="loadHistory()">Refresh</button>
    </div>
    <div class="table"><table><thead><tr><th>Time</th><th>Type</th><th>Level</th><th>Source / Method</th><th>Message / Path</th><th class="hide-sm">Status</th><th class="hide-sm">ms</th><th class="hide-sm">User</th></tr></thead><tbody id="rows"></tbody></table></div>
  </section>
</main>
<script>
"""
        + auto_js
        + """
let token='', user={}, source=null, events=[];
const maxRows=500;
function $(id){return document.getElementById(id)}
if(window._autoToken){token=window._autoToken;$('login').style.display='none';$('portal').style.display='block';loadHistory().then(()=>connect());}
function esc(v){return String(v ?? '').replace(/[&<>"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]))}
async function login(){
  $('error').textContent=''; $('loginBtn').disabled=true;
  try{
    const res=await fetch('/portal/logs/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:$('username').value.trim(),password:$('password').value})});
    const data=await res.json().catch(()=>({}));
    if(!res.ok) throw new Error(data.detail || 'Login failed');
    token=data.token; user=data.user; $('who').textContent=`${user.display_name || user.username} - ${user.role}`;
    $('login').style.display='none'; $('portal').style.display='block'; await loadHistory(); connect();
  }catch(e){$('error').textContent=e.message || 'Login failed'} finally{$('loginBtn').disabled=false}
}
function logout(){ if(source) source.close(); token=''; events=[]; $('portal').style.display='none'; $('login').style.display='block'; $('password').value=''; }
async function loadHistory(){
  const res=await fetch('/api/system/logs?limit=300',{headers:{Authorization:`Bearer ${token}`}});
  const data=await res.json(); events=(data.entries || []).slice().reverse(); draw();
}
function connect(){
  if(source) source.close(); const state=$('state'); state.className='pill'; state.lastElementChild.textContent='Connecting';
  source=new EventSource('/api/system/logs/stream?token='+encodeURIComponent(token));
  source.addEventListener('ready',()=>{state.className='pill live'; state.lastElementChild.textContent='Live'});
  source.addEventListener('history',e=>push(JSON.parse(e.data),false));
  source.addEventListener('log',e=>push(JSON.parse(e.data),true));
  source.onerror=()=>{state.className='pill down'; state.lastElementChild.textContent='Reconnecting'};
}
function push(event,flash){event.flash=flash; if(!events.find(e=>e.id===event.id)) events.push(event); events=events.slice(-maxRows); draw();}
function draw(){
  const f=$('filter').value.toLowerCase(), k=$('kind').value, levels=$('level').value;
  const levelSet=levels==='all'?null:new Set(levels.split(','));
  const visible=events.slice().reverse().filter(e=>{
    if(k!=='all' && e.type!==k) return false; if(levelSet && !levelSet.has(String(e.level).toLowerCase())) return false;
    const hay=[e.message,e.path,e.source,e.user,e.method,e.status].join(' ').toLowerCase(); return !f || hay.includes(f);
  }).slice(0,300);
  $('rows').innerHTML=visible.map(e=>{
    const type=esc(e.type||'log'), level=esc(e.level||''), src=esc(e.type==='request'?e.method:e.source), msg=esc(e.type==='request'?(e.path||e.message):e.message);
    const rowClass=e.flash?' class="flash"':''; e.flash=false;
    return `<tr${rowClass}><td>${esc((e.ts||'').replace('T',' ').replace(/\\.\\d+\\+00:00/,'Z'))}</td><td class="type ${type}">${type}</td><td class="${level}">${level}</td><td>${src}</td><td class="${e.type==='request'?'path':'msg'}" title="${msg}">${msg}</td><td class="hide-sm ${level}">${esc(e.status||'')}</td><td class="hide-sm">${esc(e.duration_ms||'')}</td><td class="hide-sm">${esc(e.user||'')}</td></tr>`;
  }).join('') || '<tr><td colspan="8" style="color:var(--muted);padding:24px;text-align:center">No log events yet.</td></tr>';
}
document.addEventListener('keydown',e=>{if(e.key==='Enter' && $('login').style.display!=='none') login()});
</script>
</body>
</html>"""
    )


@router.get("/portal/logs", response_class=HTMLResponse)
async def api_log_portal(token: str = Query(default="")) -> HTMLResponse:
    return HTMLResponse(_portal_html(auto_token=token.strip()))


def portal_link() -> str:
    return '<a href="/portal/logs">API Log Portal</a>'
