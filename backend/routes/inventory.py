import logging

from flask import Blueprint, jsonify, request

from backend import calculators
from backend.ai_parser import parse_invoice_text
from backend.auth_middleware import resolve_user
from backend.supabase_client import get_client
from backend.validation import (
    INVENTORY_ITEM_UPDATE_SCHEMA,
    INVOICE_APPLY_SCHEMA,
    INVOICE_PARSE_SCHEMA,
    ROLLOVER_SCHEMA,
    SAVE_SNAPSHOT_SCHEMA,
    validate_json,
)

inventory_bp = Blueprint('inventory', __name__, url_prefix='/api/inventory')
logger = logging.getLogger(__name__)

# Note: Rate limiter is initialized in main.py and shared via app.extensions

ALLOWED_FIELDS = {
    'on_hand',
    'w1_issued',
    'w2_issued',
    'w3_issued',
    'w4_issued',
    'w1_received',
    'w2_received',
    'w3_received',
    'w4_received',
    'unit_price',
    'par_level',
}

PRICE_FIELDS = {'unit_price', 'par_level'}


@inventory_bp.get('/summary')
def summary():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)
        if month is None or year is None:
            return jsonify(error='month and year are required'), 400
        if not (0 <= month <= 11 and 2020 <= year <= 2030):
            return jsonify(error='month must be 0-11, year must be 2020-2030'), 400

        db = get_client()
        resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
        items = resp.data or []

        prior_month = month - 1 if month > 0 else 11
        prior_year = year if month > 0 else year - 1
        snap_resp = (
            db.table('monthly_snapshots')
            .select('grand_total')
            .eq('month', prior_month)
            .eq('year', prior_year)
            .limit(1)
            .execute()
        )
        prior_total = float((snap_resp.data or [{}])[0].get('grand_total', 0) or 0)

        result = calculators.dashboard_summary(items, prior_total)
        result['data_source'] = 'LIVE_SUPABASE'
        return jsonify(result)
    except Exception as e:
        logger.exception(f'Error in summary endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.get('/items')
def items():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        # Validate query parameters
        is_valid, validated_data_or_error, status_code = validate_json(
            {
                'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
                'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
                'category': {'type': 'str', 'required': False},
                'page': {'type': 'int', 'required': False, 'min': 1, 'default': 1},
                'per_page': {'type': 'int', 'required': False, 'min': 1, 'max': 100, 'default': 50},
            }
        )
        # For GET requests, we need to get data from args instead of JSON
        if not is_valid:
            return validated_data_or_error, status_code

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)
        category = request.args.get('category')
        page = request.args.get('page', type=int, default=1)
        per_page = request.args.get('per_page', type=int, default=50)

        if month is None or year is None:
            return jsonify(error='month and year are required'), 400

        db = get_client()
        query = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year)
        if category:
            query = query.eq('category', category)

        # Get total count for pagination metadata
        count_query = db.table('dashboard_summary').select('*', count='exact').eq('month', month).eq('year', year)
        if category:
            count_query = count_query.eq('category', category)
        count_resp = count_query.execute()
        total_count = count_resp.count if hasattr(count_resp, 'count') else len(count_resp.data or [])

        # Apply pagination
        offset = (page - 1) * per_page
        query = query.range(offset, offset + per_page - 1)
        resp = query.execute()

        # Return paginated response
        return jsonify(
            {
                'items': resp.data or [],
                'pagination': {
                    'page': page,
                    'per_page': per_page,
                    'total_count': total_count,
                    'total_pages': (total_count + per_page - 1) // per_page,
                    'has_next': page < ((total_count + per_page - 1) // per_page),
                    'has_prev': page > 1,
                },
            }
        )
    except Exception as e:
        logger.exception(f'Error in items endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.patch('/items/<item_id>')
def update_item(item_id):
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        # Validate request body
        is_valid, validated_data_or_error, status_code = validate_json(INVENTORY_ITEM_UPDATE_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        field = data.get('field')
        value = data.get('value')
        month = data.get('month')
        year = data.get('year')

        field_map = {
            'onHand': 'on_hand',
            'w1i': 'w1_issued',
            'w2i': 'w2_issued',
            'w3i': 'w3_issued',
            'w4i': 'w4_issued',
            'w1r': 'w1_received',
            'w2r': 'w2_received',
            'w3r': 'w3_received',
            'w4r': 'w4_received',
            'price': 'unit_price',
            'par': 'par_level',
            'on_hand': 'on_hand',
            'w1_issued': 'w1_issued',
            'w2_issued': 'w2_issued',
            'w3_issued': 'w3_issued',
            'w4_issued': 'w4_issued',
            'w1_received': 'w1_received',
            'w2_received': 'w2_received',
            'w3_received': 'w3_received',
            'w4_received': 'w4_received',
            'unit_price': 'unit_price',
            'par_level': 'par_level',
        }

        db_field = field_map.get(field)
        if not db_field:
            return jsonify(error=f'Unknown field: {field}'), 400
        if db_field not in ALLOWED_FIELDS:
            return jsonify(error=f'field must be one of: {",".join(ALLOWED_FIELDS)}'), 400
        if db_field in PRICE_FIELDS and user['role'] not in ('admin', 'manager'):
            return jsonify(error='Only admin/manager can change price or par_level'), 403

        db = get_client()

        if db_field == 'unit_price':
            db.table('inventory_items').update({db_field: value}).eq('id', item_id).execute()
        elif db_field == 'par_level':
            db.table('inventory_items').update({db_field: value}).eq('id', item_id).execute()
        else:
            db.table('monthly_inventory').update({db_field: value}).eq('item_id', item_id).eq('month', month).eq(
                'year', year
            ).execute()

        resp = (
            db.table('dashboard_summary')
            .select('*')
            .eq('item_id', item_id)
            .eq('month', month)
            .eq('year', year)
            .limit(1)
            .execute()
        )
        item_data = (resp.data or [{}])[0]
        return jsonify(
            {
                'item_total': calculators.item_total(item_data),
                'ending_qty': calculators.ending_quantity(item_data),
            }
        )
    except Exception as e:
        logger.exception(f'Error in update_item endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.post('/save-snapshot')
def save_snapshot():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        # Validate request body
        is_valid, validated_data_or_error, status_code = validate_json(SAVE_SNAPSHOT_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        month = data.get('month')
        year = data.get('year')

        db = get_client()
        resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
        items = resp.data or []

        result = calculators.dashboard_summary(items)

        prior_month = month - 1 if month > 0 else 11
        prior_year = year if month > 0 else year - 1
        snap_resp = (
            db.table('monthly_snapshots')
            .select('grand_total')
            .eq('month', prior_month)
            .eq('year', prior_year)
            .limit(1)
            .execute()
        )
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

        existing = db.table('monthly_snapshots').select('id').eq('month', month).eq('year', year).limit(1).execute()

        if existing.data:
            db.table('monthly_snapshots').update(record).eq('month', month).eq('year', year).execute()
        else:
            db.table('monthly_snapshots').insert(record).execute()

        return jsonify(record)
    except Exception as e:
        logger.exception(f'Error in save_snapshot endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.post('/rollover')
def rollover():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if user['role'] not in ('admin', 'manager'):
            return jsonify(error='Insufficient role'), 403

        # Validate request body
        is_valid, validated_data_or_error, status_code = validate_json(ROLLOVER_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        from_month = data.get('from_month')
        from_year = data.get('from_year')

        db = get_client()

        resp = db.table('dashboard_summary').select('*').eq('month', from_month).eq('year', from_year).execute()
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
        existing = (
            db.table('monthly_snapshots').select('id').eq('month', from_month).eq('year', from_year).limit(1).execute()
        )
        if existing.data:
            db.table('monthly_snapshots').update(record).eq('month', from_month).eq('year', from_year).execute()
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
                'w1_received': 0,
                'w2_received': 0,
                'w3_received': 0,
                'w4_received': 0,
                'w1_issued': 0,
                'w2_issued': 0,
                'w3_issued': 0,
                'w4_issued': 0,
            }
            existing_item = (
                db.table('monthly_inventory')
                .select('id')
                .eq('item_id', i['item_id'])
                .eq('month', next_month)
                .eq('year', next_year)
                .limit(1)
                .execute()
            )
            if existing_item.data:
                db.table('monthly_inventory').update(new_row).eq('item_id', i['item_id']).eq('month', next_month).eq(
                    'year', next_year
                ).execute()
            else:
                db.table('monthly_inventory').insert(new_row).execute()

        return jsonify(
            {
                'next_month': next_month,
                'next_year': next_year,
                'starting_total': round(result['grand_total'], 2),
            }
        )
    except Exception as e:
        logger.exception(f'Error in rollover endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.get('/history')
def history():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        db = get_client()
        resp = db.table('monthly_snapshots').select('*').order('year', desc=True).order('month', desc=True).execute()
        return jsonify(resp.data or [])
    except Exception as e:
        logger.exception(f'Error in history endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.get('/categories')
def categories():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        db = get_client()
        resp = db.table('inventory_categories').select('*, inventory_items!inner(count)').execute()
        return jsonify(resp.data or [])
    except Exception as e:
        logger.exception(f'Error in categories endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.post('/parse-invoice')
def parse_invoice():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if user['role'] not in ('admin', 'manager'):
            return jsonify(error='Insufficient role'), 403

        # Validate request body
        is_valid, validated_data_or_error, status_code = validate_json(INVOICE_PARSE_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        invoice_text = (data.get('text') or '').strip()
        month = data.get('month')
        year = data.get('year')

        if month is None or year is None:
            return jsonify(error='month and year are required'), 400

        if not invoice_text:
            return jsonify(error='text is required'), 400

        db = get_client()
        cat_resp = (
            db.table('dashboard_summary')
            .select('item_id, sku, description, unit_price')
            .eq('month', month)
            .eq('year', year)
            .execute()
        )
        catalog_items = cat_resp.data or []

        try:
            result = parse_invoice_text(catalog_items, invoice_text)
        except Exception as e:
            logger.exception(f'AI parsing failed: {e}')
            return jsonify(error=f'AI parsing failed: {str(e)}'), 500

        return jsonify({'matches': result})
    except Exception as e:
        logger.exception(f'Error in parse_invoice endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.post('/apply-invoice')
def apply_invoice():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if user['role'] not in ('admin', 'manager'):
            return jsonify(error='Insufficient role'), 403

        # Validate request body
        is_valid, validated_data_or_error, status_code = validate_json(INVOICE_APPLY_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        matches = data.get('matches', [])
        week_field = data.get('week_field', 'w1r')
        month = data.get('month')
        year = data.get('year')

        field_map = {'w1r': 'w1_received', 'w2r': 'w2_received', 'w3r': 'w3_received', 'w4r': 'w4_received'}
        db_field = field_map.get(week_field)
        if not db_field:
            return jsonify(error='week_field must be w1r, w2r, w3r, or w4r'), 400

        db = get_client()
        applied = []
        skipped = []

        for m in matches:
            item_id = m.get('itemId')
            qty = float(m.get('qty', 0))
            if not item_id or item_id == 'NEW' or qty <= 0:
                skipped.append(m)
                continue

            existing = (
                db.table('monthly_inventory')
                .select('id')
                .eq('item_id', item_id)
                .eq('month', month)
                .eq('year', year)
                .limit(1)
                .execute()
            )

            current_qty = 0
            if existing.data:
                cur = (
                    db.table('monthly_inventory')
                    .select(db_field)
                    .eq('item_id', item_id)
                    .eq('month', month)
                    .eq('year', year)
                    .limit(1)
                    .execute()
                )
                current_qty = float((cur.data or [{}])[0].get(db_field, 0) or 0)

                db.table('monthly_inventory').update({db_field: current_qty + qty}).eq('item_id', item_id).eq(
                    'month', month
                ).eq('year', year).execute()
            else:
                db.table('monthly_inventory').insert(
                    {
                        'item_id': item_id,
                        'month': month,
                        'year': year,
                        db_field: qty,
                    }
                ).execute()

            applied.append({'item_id': item_id, 'qty': qty, 'field': db_field})

        return jsonify({'applied': applied, 'skipped': skipped})
    except Exception as e:
        logger.exception(f'Error in apply_invoice endpoint: {e}')
        return jsonify(error='Internal server error'), 500
