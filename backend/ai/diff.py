"""
Row-level diff engine.
Given staged entries (batch), compute before/after per row against live DB.
"""
import os
from supabase import create_client

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


# ── per-operation diff handlers ───────────────────────────────────────────────

def _diff_inventory_item(item: dict) -> dict:
    """Compare a single inventory item payload against live inventory_items."""
    sku = item.get('sku', '')
    r = (
        _client()
        .table('inventory_items')
        .select('id,sku,description,unit_price,par_level,on_hand,unit')
        .eq('sku', sku)
        .limit(1)
        .execute()
    )
    live = r.data[0] if r.data else None

    after = {
        'sku': sku,
        'description': item.get('desc', ''),
        'unit_price': item.get('price', 0.0),
        'par_level': item.get('par', 0),
        'on_hand': item.get('onHand', 0),
        'category': item.get('category', ''),
    }

    if not live:
        return {
            'sku': sku,
            'description': after['description'],
            'status': 'new',
            'before': None,
            'after': after,
            'changes': list(after.keys()),
        }

    before = {
        'sku': live['sku'],
        'description': live.get('description', ''),
        'unit_price': float(live.get('unit_price') or 0),
        'par_level': int(live.get('par_level') or 0),
        'on_hand': int(live.get('on_hand') or 0),
    }

    changed_fields = [
        k for k in ('description', 'unit_price', 'par_level', 'on_hand')
        if before.get(k) != after.get(k)
    ]

    return {
        'sku': sku,
        'description': after['description'] or before['description'],
        'status': 'update' if changed_fields else 'unchanged',
        'before': before,
        'after': after,
        'changes': changed_fields,
    }


def _diff_inventory_save(payload: dict) -> dict:
    items = payload.get('items', [])
    rows = [_diff_inventory_item(it) for it in items]
    new_count = sum(1 for r in rows if r['status'] == 'new')
    update_count = sum(1 for r in rows if r['status'] == 'update')
    unchanged_count = sum(1 for r in rows if r['status'] == 'unchanged')
    return {
        'table': 'inventory_items + monthly_inventory',
        'operation': 'inventory_save',
        'summary': f'{new_count} new, {update_count} updates, {unchanged_count} unchanged',
        'month': payload.get('month'),
        'year': payload.get('year'),
        'rows': rows,
    }


def _diff_event_create(payload: dict) -> dict:
    title = payload.get('title', '')
    date = payload.get('date', '')
    q = _client().table('events').select('id,title,date,cat,status')
    if title:
        q = q.eq('title', title)
    if date:
        q = q.eq('date', date)
    r = q.limit(1).execute()
    existing = r.data[0] if r.data else None

    after = {k: v for k, v in payload.items() if v is not None}
    if existing:
        before = {k: existing.get(k) for k in after}
        changed = [k for k in after if after[k] != before.get(k)]
        return {
            'table': 'events',
            'operation': 'event_create',
            'summary': '1 update (event already exists)',
            'rows': [{'title': title, 'date': date, 'status': 'update',
                      'before': before, 'after': after, 'changes': changed}],
        }

    return {
        'table': 'events',
        'operation': 'event_create',
        'summary': '1 new event',
        'rows': [{'title': title, 'date': date, 'status': 'new',
                  'before': None, 'after': after, 'changes': list(after.keys())}],
    }


def _diff_haccp_save(payload: dict) -> dict:
    return {
        'table': 'haccp_logs',
        'operation': 'haccp_save',
        'summary': '1 new HACCP log entry (insert-only)',
        'rows': [{'status': 'new', 'before': None, 'after': payload, 'changes': list(payload.keys())}],
    }


def _diff_daily_log_save(payload: dict) -> dict:
    return {
        'table': 'daily_operations_logs',
        'operation': 'daily_log_save',
        'summary': '1 new operations log entry (insert-only)',
        'rows': [{'status': 'new', 'before': None, 'after': payload, 'changes': list(payload.keys())}],
    }


def _diff_menu_save(payload: dict) -> dict:
    day = payload.get('day', '')
    data = payload.get('data', {})
    r = (
        _client()
        .table('menu_entries')
        .select('meal_type,items')
        .eq('day_of_week', day)
        .execute()
    )
    existing = {row['meal_type']: row['items'] for row in (r.data or [])}
    rows = []
    for meal_type, items in data.items():
        before_items = existing.get(meal_type)
        status = 'new' if before_items is None else 'update'
        rows.append({
            'day': day,
            'meal_type': meal_type,
            'status': status,
            'before': {'items': before_items},
            'after': {'items': items},
            'changes': ['items'] if before_items != items else [],
        })
    return {
        'table': 'menu_entries',
        'operation': 'menu_save',
        'summary': f'{len(rows)} meal slots for {day}',
        'rows': rows,
    }


# ── public API ────────────────────────────────────────────────────────────────

_DIFF_HANDLERS = {
    'inventory_save': _diff_inventory_save,
    'event_create': _diff_event_create,
    'haccp_save': _diff_haccp_save,
    'daily_log_save': _diff_daily_log_save,
    'menu_save': _diff_menu_save,
}


def diff_staging_entry(entry: dict) -> dict:
    """Compute row-level diff for a single staging entry."""
    op = entry.get('operation') or ''
    payload = entry.get('full_payload') or {}
    handler = _DIFF_HANDLERS.get(op)
    if not handler:
        return {
            'table': 'unknown',
            'operation': op,
            'summary': 'No diff handler for this operation',
            'rows': [],
        }
    result = handler(payload)
    result['entry_id'] = entry.get('entry_id')
    return result


def diff_batch(batch_entries: list[dict]) -> list[dict]:
    """Compute row-level diffs for all entries in a batch."""
    return [diff_staging_entry(e) for e in batch_entries]
