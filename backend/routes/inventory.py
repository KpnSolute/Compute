from flask import Blueprint, jsonify, request, session
from backend.supabase_client import get_client
from backend import calculators

inventory_bp = Blueprint('inventory', __name__, url_prefix='/api/inventory')

ALLOWED_FIELDS = {
    'on_hand', 'w1_issued', 'w2_issued', 'w3_issued', 'w4_issued',
    'w1_received', 'w2_received', 'w3_received', 'w4_received',
    'unit_price', 'par_level',
}

PRICE_FIELDS = {'unit_price', 'par_level'}


def _require_user():
    user = session.get('user')
    if not user:
        return None
    return user


def _require_admin():
    user = _require_user()
    if not user or user['role'] not in ('admin', 'manager'):
        return None
    return user


@inventory_bp.get('/summary')
def summary():
    user = _require_user()
    if not user:
        return jsonify(error='Not authenticated'), 401

    month = request.args.get('month', type=int)
    year = request.args.get('year', type=int)
    if month is None or year is None:
        return jsonify(error='month and year are required'), 400

    db = get_client()
    resp = db.table('dashboard_summary') \
        .select('*') \
        .eq('month', month) \
        .eq('year', year) \
        .execute()
    items = resp.data or []

    prior_month = month - 1 if month > 0 else 11
    prior_year = year if month > 0 else year - 1
    snap_resp = db.table('monthly_snapshots') \
        .select('grand_total') \
        .eq('month', prior_month) \
        .eq('year', prior_year) \
        .limit(1) \
        .execute()
    prior_total = float((snap_resp.data or [{}])[0].get('grand_total', 0) or 0)

    result = calculators.dashboard_summary(items, prior_total)
    return jsonify(result)


@inventory_bp.get('/items')
def items():
    user = _require_user()
    if not user:
        return jsonify(error='Not authenticated'), 401

    month = request.args.get('month', type=int)
    year = request.args.get('year', type=int)
    category = request.args.get('category')

    if month is None or year is None:
        return jsonify(error='month and year are required'), 400

    db = get_client()
    query = db.table('dashboard_summary') \
        .select('*') \
        .eq('month', month) \
        .eq('year', year)
    if category:
        query = query.eq('category', category)
    resp = query.execute()
    return jsonify(resp.data or [])


@inventory_bp.patch('/items/<item_id>')
def update_item(item_id):
    user = _require_user()
    if not user:
        return jsonify(error='Not authenticated'), 401

    data = request.get_json(silent=True) or {}
    field = data.get('field')
    value = data.get('value')
    month = data.get('month')
    year = data.get('year')

    if not field or value is None or month is None or year is None:
        return jsonify(error='field, value, month, and year are required'), 400
    if field not in ALLOWED_FIELDS:
        return jsonify(error=f'field must be one of: {",".join(ALLOWED_FIELDS)}'), 400
    if field in PRICE_FIELDS and user['role'] not in ('admin', 'manager'):
        return jsonify(error='Only admin/manager can change price or par_level'), 403

    db = get_client()

    if field == 'unit_price':
        db.table('inventory_items').update({field: value}).eq('id', item_id).execute()
    elif field == 'par_level':
        db.table('inventory_items').update({field: value}).eq('id', item_id).execute()
    else:
        db.table('monthly_inventory') \
            .update({field: value}) \
            .eq('item_id', item_id) \
            .eq('month', month) \
            .eq('year', year) \
            .execute()

    resp = db.table('dashboard_summary') \
        .select('*') \
        .eq('item_id', item_id) \
        .eq('month', month) \
        .eq('year', year) \
        .limit(1) \
        .execute()
    item_data = (resp.data or [{}])[0]
    return jsonify({
        'item_total': calculators.item_total(item_data),
        'ending_qty': calculators.ending_quantity(item_data),
    })


@inventory_bp.post('/save-snapshot')
def save_snapshot():
    user = _require_user()
    if not user:
        return jsonify(error='Not authenticated'), 401

    data = request.get_json(silent=True) or {}
    month = data.get('month')
    year = data.get('year')
    if month is None or year is None:
        return jsonify(error='month and year are required'), 400

    db = get_client()
    resp = db.table('dashboard_summary') \
        .select('*') \
        .eq('month', month) \
        .eq('year', year) \
        .execute()
    items = resp.data or []

    result = calculators.dashboard_summary(items)

    prior_month = month - 1 if month > 0 else 11
    prior_year = year if month > 0 else year - 1
    snap_resp = db.table('monthly_snapshots') \
        .select('grand_total') \
        .eq('month', prior_month) \
        .eq('year', prior_year) \
        .limit(1) \
        .execute()
    prior_total = float((snap_resp.data or [{}])[0].get('grand_total', 0) or 0)

    record = {
        'month': month,
        'year': year,
        'grand_total': result['grand_total'],
        'starting_total': round(prior_total, 2),
        'wk1_total': result['wk1_total'],
        'wk2_total': result['wk2_total'],
        'wk3_total': result['wk3_total'],
        'wk4_total': result['wk4_total'],
        'saved_by': None,
    }

    existing = db.table('monthly_snapshots') \
        .select('id') \
        .eq('month', month) \
        .eq('year', year) \
        .limit(1) \
        .execute()

    if existing.data:
        db.table('monthly_snapshots') \
            .update(record) \
            .eq('month', month) \
            .eq('year', year) \
            .execute()
    else:
        db.table('monthly_snapshots').insert(record).execute()

    return jsonify(record)


@inventory_bp.post('/rollover')
def rollover():
    user = _require_admin()
    if not user:
        return jsonify(error='Not authenticated or insufficient role'), 403

    data = request.get_json(silent=True) or {}
    from_month = data.get('from_month')
    from_year = data.get('from_year')
    if from_month is None or from_year is None:
        return jsonify(error='from_month and from_year are required'), 400

    db = get_client()

    resp = db.table('dashboard_summary') \
        .select('*') \
        .eq('month', from_month) \
        .eq('year', from_year) \
        .execute()
    items = resp.data or []

    result = calculators.dashboard_summary(items)

    record = {
        'month': from_month,
        'year': from_year,
        'grand_total': result['grand_total'],
        'starting_total': result['starting_total'],
        'wk1_total': result['wk1_total'],
        'wk2_total': result['wk2_total'],
        'wk3_total': result['wk3_total'],
        'wk4_total': result['wk4_total'],
        'saved_by': None,
    }
    existing = db.table('monthly_snapshots') \
        .select('id') \
        .eq('month', from_month) \
        .eq('year', from_year) \
        .limit(1) \
        .execute()
    if existing.data:
        db.table('monthly_snapshots') \
            .update(record) \
            .eq('month', from_month) \
            .eq('year', from_year) \
            .execute()
    else:
        db.table('monthly_snapshots').insert(record).execute()

    next_month = from_month + 1 if from_month < 11 else 0
    next_year = from_year if from_month < 11 else from_year + 1

    for i in items:
        ending_qty = calculators.ending_quantity(i)
        new_row = {
            'item_id': i['item_id'],
            'month': next_month,
            'year': next_year,
            'on_hand': ending_qty,
            'w1_received': 0, 'w2_received': 0,
            'w3_received': 0, 'w4_received': 0,
            'w1_issued': 0, 'w2_issued': 0,
            'w3_issued': 0, 'w4_issued': 0,
        }
        existing_item = db.table('monthly_inventory') \
            .select('id') \
            .eq('item_id', i['item_id']) \
            .eq('month', next_month) \
            .eq('year', next_year) \
            .limit(1) \
            .execute()
        if existing_item.data:
            db.table('monthly_inventory') \
                .update(new_row) \
                .eq('item_id', i['item_id']) \
                .eq('month', next_month) \
                .eq('year', next_year) \
                .execute()
        else:
            db.table('monthly_inventory').insert(new_row).execute()

    return jsonify({
        'next_month': next_month,
        'next_year': next_year,
        'starting_total': round(result['grand_total'], 2),
    })


@inventory_bp.get('/history')
def history():
    user = _require_user()
    if not user:
        return jsonify(error='Not authenticated'), 401

    db = get_client()
    resp = db.table('monthly_snapshots') \
        .select('*') \
        .order('year', desc=True) \
        .order('month', desc=True) \
        .execute()
    return jsonify(resp.data or [])


@inventory_bp.get('/categories')
def categories():
    user = _require_user()
    if not user:
        return jsonify(error='Not authenticated'), 401

    db = get_client()
    resp = db.table('inventory_categories') \
        .select('*, inventory_items!inner(count)') \
        .execute()
    return jsonify(resp.data or [])
