"""MJCC Agent — ReAct loop, conversation history, rate limiting, config management."""

import json
import re
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel

from backend.routes import supabase_service, jwt_validator
from backend.ai import engine
from backend.ai.tools import TOOL_REGISTRY, TOOL_MIN_ROLE, TOOL_DESCRIPTIONS, ROLE_LEVEL

router = APIRouter(prefix='/api/agent', tags=['agent'])

MAX_ITERATIONS = 8
HISTORY_TRIM   = 16     # turns sent to AI (keeps token count bounded)

DEFAULT_CONFIG: dict = {
    'enabled':    True,
    'min_role':   'staff',
    'rate_limit_per_hour': {'staff': 10, 'assistant': 15, 'manager': 30, 'admin': 60, 'sudo': 9999},
    'rate_limit_per_day':  {'staff': 30, 'assistant': 60, 'manager': 150, 'admin': 300, 'sudo': 9999},
    'allowed_tools': [
        'get_dashboard_stats', 'get_inventory', 'get_events',
        'get_menu', 'get_reorders', 'get_period_status',
    ],
    'max_turns':  20,
    'provider':   None,
    'model':      None,
}


# ── helpers ───────────────────────────────────────────────────────────────────

def _resolve_user(authorization: str) -> dict:
    token = authorization.replace('Bearer ', '').strip() if authorization else ''
    if not token:
        raise HTTPException(status_code=401, detail='Missing authorization token')

    if token.startswith('pin_'):
        uid = token.replace('pin_', '')
        try:
            r = supabase_service.table('user_profiles').select('*').eq('id', uid).single().execute()
            user = r.data
        except Exception:
            user = None
        if not user or not user.get('active'):
            raise HTTPException(status_code=401, detail='Invalid session')
        return user

    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail='Invalid or expired token')
    uid = claims.get('sub')
    if not uid:
        raise HTTPException(status_code=401, detail='Token missing user ID')
    try:
        r = supabase_service.table('user_profiles').select('*').eq('id', uid).single().execute()
        user = r.data
    except Exception:
        user = None
    if not user or not user.get('active'):
        raise HTTPException(status_code=401, detail='User not found or inactive')
    return user


def _load_config() -> dict:
    try:
        r = (
            supabase_service.table('app_settings')
            .select('setting_value')
            .eq('setting_key', 'agent_config')
            .limit(1)
            .execute()
        )
        if r.data:
            stored = r.data[0]['setting_value']
            if isinstance(stored, dict):
                return {**DEFAULT_CONFIG, **stored}
    except Exception:
        pass
    return dict(DEFAULT_CONFIG)


def _save_config(cfg: dict) -> None:
    now = datetime.now(timezone.utc).isoformat()
    supabase_service.table('app_settings').upsert(
        {'setting_key': 'agent_config', 'setting_value': cfg, 'updated_at': now},
        on_conflict='setting_key',
    ).execute()


def _check_rate_limit(user_id: str, user_role: str, cfg: dict) -> tuple[int, int]:
    """Returns (remaining_hour, remaining_day). Raises 429 if exceeded."""
    now  = datetime.now(timezone.utc)
    h1   = (now - timedelta(hours=1)).isoformat()
    d1   = (now - timedelta(days=1)).isoformat()
    lim_h = cfg.get('rate_limit_per_hour', {}).get(user_role, 10)
    lim_d = cfg.get('rate_limit_per_day',  {}).get(user_role, 30)

    r_h = supabase_service.table('agent_usage').select('id', count='exact').eq('user_id', user_id).gte('created_at', h1).execute()
    used_h = r_h.count or 0
    if used_h >= lim_h:
        raise HTTPException(status_code=429, detail=f'Rate limit: {lim_h} requests/hour reached. Try again later.')

    r_d = supabase_service.table('agent_usage').select('id', count='exact').eq('user_id', user_id).gte('created_at', d1).execute()
    used_d = r_d.count or 0
    if used_d >= lim_d:
        raise HTTPException(status_code=429, detail=f'Rate limit: {lim_d} requests/day reached. Try again tomorrow.')

    return max(0, lim_h - used_h - 1), max(0, lim_d - used_d - 1)


def _record_usage(user_id: str) -> None:
    try:
        supabase_service.table('agent_usage').insert({
            'user_id':    user_id,
            'created_at': datetime.now(timezone.utc).isoformat(),
        }).execute()
    except Exception:
        pass


def _store_turn(user_id: str, role: str, content: str,
                tool_name: str | None = None, tool_args: dict | None = None,
                tool_result: dict | None = None) -> None:
    try:
        row: dict = {'user_id': user_id, 'role': role, 'content': content}
        if tool_name:    row['tool_name']   = tool_name
        if tool_args:    row['tool_args']   = tool_args
        if tool_result:  row['tool_result'] = tool_result
        supabase_service.table('agent_conversations').insert(row).execute()
    except Exception:
        pass


def _load_history(user_id: str, limit: int = 20) -> list[dict]:
    try:
        r = (
            supabase_service.table('agent_conversations')
            .select('id,role,content,tool_name,tool_args,tool_result,created_at')
            .eq('user_id', user_id)
            .order('created_at', desc=True)
            .limit(limit)
            .execute()
        )
        return list(reversed(r.data or []))
    except Exception:
        return []


def _parse_tool_calls(text: str) -> list[dict]:
    matches = re.findall(r'<tool_call>(.*?)</tool_call>', text, re.DOTALL)
    calls = []
    for m in matches:
        try:
            calls.append(json.loads(m.strip()))
        except json.JSONDecodeError:
            pass
    return calls


def _tools_for_role(user_role: str, cfg: dict) -> set[str]:
    allowed = set(cfg.get('allowed_tools', []))
    level   = ROLE_LEVEL.get(user_role, 0)
    gated   = {k for k, v in TOOL_MIN_ROLE.items() if ROLE_LEVEL.get(v, 0) <= level}
    return allowed & gated


def _build_system_prompt(user: dict, cfg: dict) -> str:
    role_tools = _tools_for_role(user.get('role', 'staff'), cfg)
    now = datetime.now(timezone.utc).strftime('%A, %B %d %Y %H:%M UTC')
    return f"""You are MJCC AI, the intelligent system manager for the Miami Job Corps Cafeteria.
You assist {user.get('display_name') or user.get('username', 'staff')} ({user.get('role', 'staff')}) with cafeteria operations.
Current date/time: {now}

{TOOL_DESCRIPTIONS}

Your available tools for this session (based on role): {', '.join(sorted(role_tools)) or 'none'}

Rules:
1. Use tools to fetch real data before answering questions that need it.
2. You may call multiple tools by including multiple <tool_call> blocks in one response.
3. Be concise and helpful. Format numbers clearly (e.g. "$1,234.56", "47 items").
4. When creating events or modifying data, confirm what you did.
5. If a tool returns an error, explain it and offer alternatives.
6. Never hallucinate data — always use tools for facts about inventory, events, users, etc.
"""


# ── routes ────────────────────────────────────────────────────────────────────

class ChatRequest(BaseModel):
    message: str


@router.post('/chat')
async def agent_chat(body: ChatRequest, authorization: str = Header('')):
    user = _resolve_user(authorization)
    cfg  = _load_config()

    if not cfg.get('enabled', True):
        raise HTTPException(status_code=403, detail='MJCC AI Agent is currently disabled.')

    min_role  = cfg.get('min_role', 'staff')
    user_role = user.get('role', 'staff')
    if ROLE_LEVEL.get(user_role, 0) < ROLE_LEVEL.get(min_role, 10):
        raise HTTPException(status_code=403, detail=f'Agent requires {min_role} role or above.')

    user_id = user['id']
    rem_h, rem_d = _check_rate_limit(user_id, user_role, cfg)

    # Load recent conversation history
    history = _load_history(user_id, limit=cfg.get('max_turns', 20))
    messages: list[dict] = [{'role': 'system', 'content': _build_system_prompt(user, cfg)}]

    # Convert stored history to AI messages (last HISTORY_TRIM turns)
    for turn in history[-HISTORY_TRIM:]:
        r = turn['role']
        if r == 'user':
            messages.append({'role': 'user', 'content': turn['content']})
        elif r == 'assistant':
            messages.append({'role': 'assistant', 'content': turn['content']})
        # tool turns are embedded in subsequent user messages — skip separate role

    # Append new user message
    messages.append({'role': 'user', 'content': body.message})

    # Determine AI config for agent (can override data-entry provider)
    ai_cfg: dict | None = None
    if cfg.get('provider'):
        from backend.ai.context import get_ai_config
        base = get_ai_config()
        ai_cfg = {**base, 'provider': cfg['provider']}
        if cfg.get('model'):
            ai_cfg['model'] = cfg['model']

    role_tools = _tools_for_role(user_role, cfg)
    used_tool_calls: list[dict] = []
    final_response  = ''

    # ── ReAct loop ────────────────────────────────────────────────────────────
    for iteration in range(MAX_ITERATIONS):
        response_text = engine.complete(
            messages,
            config=ai_cfg,
            operation='agent_chat',
            called_by=user_id,
        )

        tool_calls = _parse_tool_calls(response_text)
        if not tool_calls:
            # Final answer — no tool calls
            final_response = response_text.strip()
            break

        # Execute all tool calls in this iteration
        tool_results_text = ''
        for tc in tool_calls:
            tool_name = tc.get('name', '')
            tool_args = tc.get('args', {})

            if tool_name not in role_tools:
                result = {'error': f"Tool '{tool_name}' is not available for your role or is disabled."}
            elif tool_name not in TOOL_REGISTRY:
                result = {'error': f"Unknown tool: '{tool_name}'"}
            else:
                try:
                    result = TOOL_REGISTRY[tool_name](tool_args, user_role)
                except Exception as exc:
                    result = {'error': str(exc)}

            used_tool_calls.append({
                'name':           tool_name,
                'args':           tool_args,
                'result_summary': _summarize_result(tool_name, result),
            })
            tool_results_text += f'\n<tool_result name="{tool_name}">{json.dumps(result, default=str)}</tool_result>'
            _store_turn(user_id, 'tool', json.dumps(result, default=str), tool_name, tool_args, result)

        # Append assistant response + tool results as next user turn
        messages.append({'role': 'assistant', 'content': response_text})
        messages.append({'role': 'user', 'content': f'Tool results:{tool_results_text}\n\nPlease provide your response based on the above data.'})

    else:
        final_response = 'I reached my step limit. Please try a more specific question.'

    # Persist the user message and final response
    _store_turn(user_id, 'user',      body.message)
    _store_turn(user_id, 'assistant', final_response)
    _record_usage(user_id)

    return {
        'response':   final_response,
        'tool_calls': used_tool_calls,
        'rate_limit': {'remaining_hour': rem_h, 'remaining_day': rem_d},
    }


def _summarize_result(tool_name: str, result: dict) -> str:
    if 'error' in result:
        return f'Error: {result["error"]}'
    summaries = {
        'get_dashboard_stats': lambda r: f"{r.get('inventory_items',0)} items, ${r.get('estimated_inventory_value',0):,.2f} value, {r.get('upcoming_events',0)} events, {r.get('items_below_par',0)} below par",
        'get_inventory':       lambda r: f"{r.get('total_items',0)} items, ${r.get('total_value',0):,.2f} total, {r.get('below_par_count',0)} below par",
        'get_events':          lambda r: f"{r.get('total',0)} events, {len(r.get('upcoming',[]))} upcoming",
        'get_menu':            lambda r: f"Menu for {r.get('day','')} — {len(r.get('menu',{}))} meal periods",
        'get_reorders':        lambda r: f"{r.get('reorder_count',0)} items need reordering",
        'get_period_status':   lambda r: f"Period: {r.get('period_label','')}, data present: {r.get('has_inventory_for_current_period',False)}",
        'get_users':           lambda r: f"{r.get('total_active',0)} active users across {len(r.get('by_role',{}))} roles",
        'get_haccp_logs':      lambda r: f"{r.get('count',0)} logs, {r.get('failures',0)} failures",
        'get_daily_logs':      lambda r: f"{r.get('count',0)} log entries",
        'create_event':        lambda r: f"Event created: {r.get('event',{}).get('title','')}",
        'get_ai_usage':        lambda r: f"{r.get('total_calls',0)} calls, {r.get('total_tokens',0)} tokens, ${r.get('total_cost',0):.4f}",
    }
    fn = summaries.get(tool_name)
    try:
        return fn(result) if fn else 'Done'
    except Exception:
        return 'Done'


@router.get('/history')
async def get_history(limit: int = 30, authorization: str = Header('')):
    user = _resolve_user(authorization)
    cfg  = _load_config()
    _check_min_role(user, cfg)
    turns = _load_history(user['id'], limit=limit)
    return {'turns': turns}


@router.delete('/history')
async def clear_history(authorization: str = Header('')):
    user = _resolve_user(authorization)
    cfg  = _load_config()
    _check_min_role(user, cfg)
    try:
        r = supabase_service.table('agent_conversations').delete().eq('user_id', user['id']).execute()
        deleted = len(r.data or [])
    except Exception:
        deleted = 0
    return {'deleted': deleted}


@router.get('/config')
async def get_config(authorization: str = Header('')):
    user = _resolve_user(authorization)
    cfg  = _load_config()
    # Return public-safe config (no secrets)
    return {
        'enabled':    cfg.get('enabled', True),
        'min_role':   cfg.get('min_role', 'staff'),
        'allowed_tools': cfg.get('allowed_tools', []),
        'max_turns':  cfg.get('max_turns', 20),
        'rate_limit_per_hour': cfg.get('rate_limit_per_hour', {}),
        'rate_limit_per_day':  cfg.get('rate_limit_per_day', {}),
        'has_provider_override': bool(cfg.get('provider')),
    }


class AgentConfigRequest(BaseModel):
    enabled:    bool | None              = None
    min_role:   str | None               = None
    allowed_tools: list[str] | None      = None
    max_turns:  int | None               = None
    rate_limit_per_hour: dict | None     = None
    rate_limit_per_day:  dict | None     = None
    provider:   str | None               = None
    model:      str | None               = None


@router.put('/config')
async def update_config(body: AgentConfigRequest, authorization: str = Header('')):
    user = _resolve_user(authorization)
    if user.get('role') != 'sudo':
        raise HTTPException(status_code=403, detail='Agent configuration requires sudo role.')
    cfg = _load_config()
    updates = body.model_dump(exclude_none=True)
    cfg.update(updates)
    _save_config(cfg)
    return cfg


def _check_min_role(user: dict, cfg: dict) -> None:
    min_role  = cfg.get('min_role', 'staff')
    user_role = user.get('role', 'staff')
    if ROLE_LEVEL.get(user_role, 0) < ROLE_LEVEL.get(min_role, 10):
        raise HTTPException(status_code=403, detail=f'Agent requires {min_role} role or above.')
