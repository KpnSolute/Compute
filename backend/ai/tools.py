"""MJCC Agent tool registry — real Supabase queries for the ReAct agent loop."""

import os
from datetime import datetime, timedelta, timezone

from supabase import create_client

ROLE_LEVEL: dict[str, int] = {
    'staff': 10,
    'assistant': 20,
    'manager': 30,
    'admin': 40,
    'sudo': 50,
}

TOOL_MIN_ROLE: dict[str, str] = {
    'get_dashboard_stats': 'staff',
    'get_inventory':       'staff',
    'get_events':          'staff',
    'get_menu':            'staff',
    'get_reorders':        'staff',
    'get_period_status':   'staff',
    'get_users':           'manager',
    'get_haccp_logs':      'manager',
    'get_daily_logs':      'manager',
    'create_event':        'manager',
    'get_ai_usage':        'admin',
}

_svc = None


def _client():
    global _svc
    if _svc is None:
        url = os.getenv('SUPABASE_URL')
        key = os.getenv('SUPABASE_SERVICE_KEY')
        if not url or not key:
            raise RuntimeError('SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.')
        _svc = create_client(url, key)
    return _svc


def _role_ok(user_role: str, min_role: str) -> bool:
    return ROLE_LEVEL.get(user_role, 0) >= ROLE_LEVEL.get(min_role, 99)


# ── tool implementations ──────────────────────────────────────────────────────

def get_dashboard_stats(args: dict, user_role: str) -> dict:
    try:
        svc = _client()
        now = datetime.now(timezone.utc)
        users_r   = svc.table('user_profiles').select('id', count='exact').eq('active', True).execute()
        events_r  = svc.table('events').select('id', count='exact').eq('status', 'upcoming').execute()
        items_r   = svc.table('inventory_items').select('id,unit_price,par_level').execute()
        inv_r     = svc.table('monthly_inventory').select('item_id,on_hand').eq('month', now.month).eq('year', now.year).execute()
        inv_map   = {r['item_id']: r['on_hand'] for r in (inv_r.data or [])}
        total_val = 0.0
        reorder_n = 0
        for item in (items_r.data or []):
            oh = inv_map.get(item['id'], 0)
            total_val += oh * (item.get('unit_price') or 0)
            if oh < (item.get('par_level') or 0):
                reorder_n += 1
        return {
            'active_users':             users_r.count or 0,
            'upcoming_events':          events_r.count or 0,
            'inventory_items':          len(items_r.data or []),
            'items_below_par':          reorder_n,
            'estimated_inventory_value': round(total_val, 2),
            'period':                   f'{now.strftime("%B")} {now.year}',
        }
    except Exception as exc:
        return {'error': str(exc)}


def get_inventory(args: dict, user_role: str) -> dict:
    now = datetime.now(timezone.utc)
    month = int(args.get('month', now.month))
    year  = int(args.get('year',  now.year))
    try:
        svc   = _client()
        items = svc.table('inventory_items').select(
            'id,sku,description,category_id,unit_price,par_level,unit,inventory_categories(name)'
        ).execute()
        inv     = svc.table('monthly_inventory').select('item_id,on_hand').eq('month', month).eq('year', year).execute()
        inv_map = {r['item_id']: r['on_hand'] for r in (inv.data or [])}
        result    = []
        new_items = []
        total_val = 0.0
        for item in (items.data or []):
            sku      = (item.get('sku') or '').strip()
            is_new   = not sku
            cat_name = ((item.get('inventory_categories') or {}).get('name') or '') if not is_new else 'New Items'
            oh  = inv_map.get(item['id'], 0)
            par = item.get('par_level') or 0
            val = oh * (item.get('unit_price') or 0)
            total_val += val
            row = {
                'sku':          sku or f'(new:{item["id"][:8]})',
                'description':  item['description'],
                'category':     cat_name,
                'on_hand':      oh,
                'par_level':    par,
                'below_par':    oh < par,
                'unit':         item.get('unit', ''),
                'value':        round(val, 2),
                'is_new_item':  is_new,
            }
            if is_new:
                new_items.append(row)
            else:
                result.append(row)
        all_items = result + new_items
        below = [r for r in all_items if r['below_par']]
        cats  = sorted(set(r['category'] for r in result if r['category']))
        return {
            'month':            month,
            'year':             year,
            'total_items':      len(all_items),
            'new_items_count':  len(new_items),
            'total_value':      round(total_val, 2),
            'below_par_count':  len(below),
            'below_par_items':  below[:15],
            'categories':       cats,
            'new_items':        new_items[:10],
        }
    except Exception as exc:
        return {'error': str(exc)}


def get_events(args: dict, user_role: str) -> dict:
    try:
        svc = _client()
        r   = svc.table('events').select('title,date,cat,status,description').order('date').limit(30).execute()
        rows = r.data or []
        upcoming   = [e for e in rows if e.get('status') in ('upcoming', 'active')]
        completed  = [e for e in rows if e.get('status') == 'completed']
        return {
            'total':    len(rows),
            'upcoming': upcoming[:10],
            'recently_completed': completed[-3:],
        }
    except Exception as exc:
        return {'error': str(exc)}


def get_menu(args: dict, user_role: str) -> dict:
    day = args.get('day', 'Mon')
    valid = {'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'}
    if day not in valid:
        return {'error': f'Invalid day "{day}". Use: Mon Tue Wed Thu Fri Sat Sun'}
    try:
        svc      = _client()
        cycle_r  = svc.table('menu_cycles').select('id').eq('active', True).limit(1).execute()
        if not cycle_r.data:
            return {'day': day, 'menu': {}, 'note': 'No active menu cycle'}
        cycle_id = cycle_r.data[0]['id']
        entries  = svc.table('menu_entries').select('meal_type,items').eq('day_of_week', day).eq('cycle_id', cycle_id).execute()
        import json
        menu: dict = {}
        for row in (entries.data or []):
            raw = row.get('items') or '[]'
            items = raw if isinstance(raw, list) else json.loads(raw)
            menu[row['meal_type']] = items
        return {'day': day, 'menu': menu}
    except Exception as exc:
        return {'error': str(exc)}


def get_reorders(args: dict, user_role: str) -> dict:
    now = datetime.now(timezone.utc)
    try:
        svc    = _client()
        items  = svc.table('inventory_items').select('id,sku,description,par_level,unit,unit_price').execute()
        inv    = svc.table('monthly_inventory').select('item_id,on_hand').eq('month', now.month).eq('year', now.year).execute()
        inv_map = {r['item_id']: r['on_hand'] for r in (inv.data or [])}
        reorders = []
        for item in (items.data or []):
            oh  = inv_map.get(item['id'], 0)
            par = item.get('par_level') or 0
            if oh < par:
                reorders.append({
                    'sku':         item['sku'],
                    'description': item['description'],
                    'on_hand':     oh,
                    'par_level':   par,
                    'shortage':    par - oh,
                    'unit':        item.get('unit', ''),
                })
        reorders.sort(key=lambda x: x['shortage'], reverse=True)
        return {
            'period':        f'{now.strftime("%B")} {now.year}',
            'reorder_count': len(reorders),
            'items':         reorders[:20],
        }
    except Exception as exc:
        return {'error': str(exc)}


def get_period_status(args: dict, user_role: str) -> dict:
    now = datetime.now(timezone.utc)
    try:
        svc = _client()
        r   = svc.table('monthly_inventory').select('month,year', count='exact').eq('month', now.month).eq('year', now.year).execute()
        has_current = (r.count or 0) > 0
        return {
            'current_month': now.month,
            'current_year':  now.year,
            'has_inventory_for_current_period': has_current,
            'period_label': now.strftime('%B %Y'),
        }
    except Exception as exc:
        return {'error': str(exc)}


def get_users(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, 'manager'):
        return {'error': 'Requires manager role or above'}
    try:
        svc = _client()
        r   = svc.table('user_profiles').select('username,display_name,role,active,job_title').execute()
        rows = r.data or []
        active = [u for u in rows if u.get('active')]
        by_role: dict[str, list] = {}
        for u in active:
            by_role.setdefault(u['role'], []).append(u.get('display_name') or u['username'])
        return {
            'total_active':   len(active),
            'total_inactive': len(rows) - len(active),
            'by_role':        by_role,
        }
    except Exception as exc:
        return {'error': str(exc)}


def get_haccp_logs(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, 'manager'):
        return {'error': 'Requires manager role or above'}
    limit = min(int(args.get('limit', 10)), 50)
    try:
        svc  = _client()
        r    = svc.table('haccp_logs').select('timestamp,location,temperature,unit,checked_by,notes').order('timestamp', desc=True).limit(limit).execute()
        rows = r.data or []
        return {
            'count':  len(rows),
            'recent': rows,
        }
    except Exception as exc:
        return {'error': str(exc)}


def get_daily_logs(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, 'manager'):
        return {'error': 'Requires manager role or above'}
    limit = min(int(args.get('limit', 10)), 50)
    try:
        svc = _client()
        r   = svc.table('daily_operations_logs').select('entry_type,title,description,severity,created_by,created_at').order('created_at', desc=True).limit(limit).execute()
        return {'count': len(r.data or []), 'logs': r.data or []}
    except Exception as exc:
        return {'error': str(exc)}


def create_event(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, 'manager'):
        return {'error': 'Requires manager role or above'}
    for f in ('title', 'date'):
        if not args.get(f):
            return {'error': f'Missing required field: {f}'}
    try:
        svc = _client()
        payload = {
            'title':          args['title'],
            'date':           args['date'],
            'cat':            args.get('cat', 'General'),
            'description':    args.get('description', ''),
            'status':         'upcoming',
            'theme':          args.get('theme'),
            'suggested_menu': args.get('suggested_menu'),
        }
        r = svc.table('events').insert(payload).execute()
        return {'created': True, 'event': r.data[0] if r.data else payload}
    except Exception as exc:
        return {'error': str(exc)}


def get_ai_usage(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, 'admin'):
        return {'error': 'Requires admin role or above'}
    days = min(int(args.get('days', 7)), 90)
    try:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        svc   = _client()
        r     = svc.table('ai_usage_logs').select('provider,tokens_in,tokens_out,cost_usd,success,duration_ms').gte('created_at', since).execute()
        rows  = r.data or []
        return {
            'period_days':   days,
            'total_calls':   len(rows),
            'successful':    sum(1 for x in rows if x.get('success')),
            'total_tokens':  sum((x.get('tokens_in', 0) + x.get('tokens_out', 0)) for x in rows),
            'total_cost':    round(sum(x.get('cost_usd', 0) for x in rows), 4),
            'avg_latency_ms': int(sum(x.get('duration_ms', 0) for x in rows) / len(rows)) if rows else 0,
        }
    except Exception as exc:
        return {'error': str(exc)}


# ── registry ──────────────────────────────────────────────────────────────────

TOOL_REGISTRY: dict[str, object] = {
    'get_dashboard_stats': get_dashboard_stats,
    'get_inventory':       get_inventory,
    'get_events':          get_events,
    'get_menu':            get_menu,
    'get_reorders':        get_reorders,
    'get_period_status':   get_period_status,
    'get_users':           get_users,
    'get_haccp_logs':      get_haccp_logs,
    'get_daily_logs':      get_daily_logs,
    'create_event':        create_event,
    'get_ai_usage':        get_ai_usage,
}

TOOL_DESCRIPTIONS = """
Available tools (call with <tool_call>{"name":"...","args":{...}}</tool_call>):
- get_dashboard_stats: Active users, upcoming events, inventory items count, items below par, estimated value, current period
- get_inventory(month:int, year:int): Full inventory for a period — items, on-hand, below-par list, total value
- get_events(): Upcoming and recent events/programs
- get_menu(day:str): Menu for a day of the week (Mon/Tue/Wed/Thu/Fri/Sat/Sun) — meal periods and items
- get_reorders(): Items currently below par level sorted by shortage severity
- get_period_status(): Current inventory period and whether it has data
- get_users(): Active staff by role [manager+ only]
- get_haccp_logs(limit:int): Recent temperature/compliance logs and failures [manager+ only]
- get_daily_logs(limit:int): Recent daily operations entries [manager+ only]
- create_event(title:str, date:str YYYY-MM-DD, cat:str, description:str): Create a new event [manager+ only]
- get_ai_usage(days:int): AI token/cost usage statistics [admin+ only]

You may call multiple tools in a single response by including multiple <tool_call> blocks.
When you have a complete answer, respond normally without any <tool_call> tags.
"""
