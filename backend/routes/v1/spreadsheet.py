import io
import logging

from flask import Blueprint, jsonify, request

from backend.auth_middleware import resolve_user
from backend.supabase_client import get_client

spreadsheet_bp = Blueprint('spreadsheet', __name__, url_prefix='/spreadsheet')
logger = logging.getLogger(__name__)

MANAGER_ROLES = ('admin', 'manager')
MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
               'July', 'August', 'September', 'October', 'November', 'December']

WRITABLE_FIELDS = {
    'on_hand', 'w1_received', 'w2_received', 'w3_received', 'w4_received',
    'w1_issued', 'w2_issued', 'w3_issued', 'w4_issued',
}

COLUMN_ALIASES = {
    'barcode':      ['barcode', 'barcode_id', 'barcode id', 'code', 'upc'],
    'on_hand':      ['on_hand', 'on hand', 'opening', 'start', 'beginning', 'opening balance', 'begin'],
    'w1_received':  ['w1_received', 'w1 received', 'week 1 received', 'wk1 rec', 'w1r'],
    'w2_received':  ['w2_received', 'w2 received', 'week 2 received', 'wk2 rec', 'w2r'],
    'w3_received':  ['w3_received', 'w3 received', 'week 3 received', 'wk3 rec', 'w3r'],
    'w4_received':  ['w4_received', 'w4 received', 'week 4 received', 'wk4 rec', 'w4r'],
    'w1_issued':    ['w1_issued', 'w1 issued', 'week 1 issued', 'wk1 iss', 'w1i', 'w1 pulled', 'w1 used'],
    'w2_issued':    ['w2_issued', 'w2 issued', 'week 2 issued', 'wk2 iss', 'w2i', 'w2 pulled', 'w2 used'],
    'w3_issued':    ['w3_issued', 'w3 issued', 'week 3 issued', 'wk3 iss', 'w3i', 'w3 pulled', 'w3 used'],
    'w4_issued':    ['w4_issued', 'w4 issued', 'week 4 issued', 'wk4 iss', 'w4i', 'w4 pulled', 'w4 used'],
}


def _find_col(cols_lower: dict, field: str):
    for alias in COLUMN_ALIASES.get(field, [field]):
        if alias.lower() in cols_lower:
            return cols_lower[alias.lower()]
    return None


def _target_fields(week_target: str, direction: str) -> list:
    if week_target == 'month':
        fields = ['on_hand']
        if direction in ('received', 'both'):
            fields += ['w1_received', 'w2_received', 'w3_received', 'w4_received']
        if direction in ('issued', 'both'):
            fields += ['w1_issued', 'w2_issued', 'w3_issued', 'w4_issued']
    else:
        n = week_target[1]
        fields = []
        if direction in ('received', 'both'):
            fields.append(f'w{n}_received')
        if direction in ('issued', 'both'):
            fields.append(f'w{n}_issued')
    return fields


@spreadsheet_bp.post('/upload')
def upload():
    """
    Step 1 of 2: Parse an XLSX and return a preview.
    Does NOT write to the database. The client sends the preview back to /apply after confirmation.
    """
    user = resolve_user()
    if not user:
        return jsonify(error='Not authenticated'), 401
    if user['role'] not in MANAGER_ROLES:
        return jsonify(error='Insufficient role'), 403

    file = request.files.get('file')
    if not file:
        return jsonify(error='No file uploaded'), 400
    if not (file.filename or '').lower().endswith(('.xlsx', '.xls')):
        return jsonify(error='File must be an Excel spreadsheet (.xlsx or .xls)'), 400

    try:
        month = int(request.form.get('month', 0))
        year  = int(request.form.get('year', 2026))
    except (TypeError, ValueError):
        return jsonify(error='month and year must be integers'), 400

    if not (0 <= month <= 11 and 2020 <= year <= 2030):
        return jsonify(error='month must be 0-11, year must be 2020-2030'), 400

    week_target = request.form.get('week_target', 'month')
    direction   = request.form.get('direction', 'both')
    notes       = (request.form.get('notes') or '').strip()

    if week_target not in ('month', 'w1', 'w2', 'w3', 'w4'):
        return jsonify(error='week_target must be month, w1, w2, w3, or w4'), 400
    if direction not in ('received', 'issued', 'both'):
        return jsonify(error='direction must be received, issued, or both'), 400

    try:
        import pandas as pd
        df = pd.read_excel(io.BytesIO(file.read()), engine='openpyxl')
    except Exception as e:
        return jsonify(error=f'Could not read file: {str(e)}'), 400

    df.columns = [str(c).strip() for c in df.columns]
    cols_lower = {c.lower(): c for c in df.columns}

    barcode_col = _find_col(cols_lower, 'barcode')
    if not barcode_col:
        return jsonify(error='No barcode column found. Expected: barcode, barcode_id, or UPC'), 400

    target_fields = _target_fields(week_target, direction)
    if not target_fields:
        return jsonify(error='No fields to import for the given week_target and direction'), 400

    try:
        db = get_client()
        catalog   = db.table('inventory_items').select('id, barcode_id, description, category').execute().data or []
        barcode_map = {i['barcode_id']: i for i in catalog if i.get('barcode_id')}

        cur_resp = (
            db.table('monthly_inventory').select('*')
            .eq('month', month).eq('year', year)
            .execute()
        )
        current_data = {r['item_id']: r for r in (cur_resp.data or [])}
    except Exception as e:
        logger.exception(f'DB error in spreadsheet upload: {e}')
        return jsonify(error='Database error'), 500

    import pandas as pd
    rows, skipped = [], []

    for _, df_row in df.iterrows():
        barcode = str(df_row.get(barcode_col) or '').strip()
        if not barcode or barcode.lower() in ('nan', 'none', ''):
            continue

        item = barcode_map.get(barcode)
        if not item:
            skipped.append({'barcode': barcode, 'reason': 'Not in catalog'})
            continue

        proposed = {}
        for field in target_fields:
            col = _find_col(cols_lower, field)
            if col:
                val = df_row.get(col)
                try:
                    proposed[field] = round(float(val), 3) if pd.notna(val) else None
                except (TypeError, ValueError):
                    proposed[field] = None

        if not any(v is not None for v in proposed.values()):
            skipped.append({'barcode': barcode, 'reason': 'No numeric values found'})
            continue

        current = current_data.get(item['id'], {})
        rows.append({
            'item_id':     item['id'],
            'barcode':     barcode,
            'description': item.get('description', ''),
            'category':    item.get('category', ''),
            'month':       month,
            'year':        year,
            'proposed':    proposed,
            'current':     {f: float(current.get(f) or 0) for f in target_fields},
        })

    return jsonify({
        'rows':         rows,
        'row_count':    len(rows),
        'skipped_count': len(skipped),
        'skipped':      skipped[:20],
        'fields':       target_fields,
        'period':       {'month': month, 'year': year, 'month_name': MONTH_NAMES[month]},
        'week_target':  week_target,
        'direction':    direction,
        'notes':        notes,
    })


@spreadsheet_bp.post('/apply')
def apply():
    """
    Step 2 of 2: Write confirmed rows to monthly_inventory.
    Receives the rows returned by /upload after the manager confirms the preview.
    """
    user = resolve_user()
    if not user:
        return jsonify(error='Not authenticated'), 401
    if user['role'] not in MANAGER_ROLES:
        return jsonify(error='Insufficient role'), 403

    data  = request.get_json(silent=True) or {}
    rows  = data.get('rows', [])
    notes = (data.get('notes') or '').strip()

    if not rows:
        return jsonify(error='No rows to apply'), 400
    if len(rows) > 1000:
        return jsonify(error='Too many rows — max 1000 per import'), 400

    db = get_client(admin=True)
    applied, errors = 0, []

    for row in rows:
        item_id  = row.get('item_id')
        month    = row.get('month')
        year     = row.get('year')
        proposed = row.get('proposed') or {}

        if not item_id or month is None or year is None:
            continue

        fields = {k: v for k, v in proposed.items() if k in WRITABLE_FIELDS and v is not None}
        if not fields:
            continue

        try:
            existing = (
                db.table('monthly_inventory').select('id')
                .eq('item_id', item_id).eq('month', month).eq('year', year)
                .limit(1).execute()
            )
            if existing.data:
                db.table('monthly_inventory').update(fields).eq('item_id', item_id).eq('month', month).eq('year', year).execute()
            else:
                db.table('monthly_inventory').insert({'item_id': item_id, 'month': month, 'year': year, **fields}).execute()
            applied += 1
        except Exception as e:
            errors.append({'item_id': item_id, 'error': str(e)})
            logger.exception(f'Error applying row for item {item_id}: {e}')

    return jsonify({'applied': applied, 'error_count': len(errors), 'errors': errors[:10]})
