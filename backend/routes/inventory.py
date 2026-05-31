import logging
from concurrent.futures import ThreadPoolExecutor
from concurrent.futures import TimeoutError as FuturesTimeout

from flask import Blueprint, jsonify, request

from backend import calculators
from backend.ai_parser import parse_invoice_text
from backend.rbac import resolve_user
from backend.response import api_response, created_response, error_response
from backend.supabase_client import get_client
from backend.validation import (
    CREATE_VERSION_SCHEMA,
    INVENTORY_ITEM_UPDATE_SCHEMA,
    INVOICE_APPLY_SCHEMA,
    INVOICE_PARSE_SCHEMA,
    ITEM_CREATE_SCHEMA,
    PENDING_SUBMIT_SCHEMA,
    PUBLISH_SCHEMA,
    ROLLOVER_SCHEMA,
    validate_json,
)

inventory_bp = Blueprint('inventory', __name__, url_prefix='/api/inventory')
logger = logging.getLogger(__name__)

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
STAFF_ALLOWED_FIELDS = {'w1_issued', 'w2_issued', 'w3_issued', 'w4_issued'}


def _is_manager(user):
    return user.get('role') in ('admin', 'manager')


# ── Existing Endpoints ───────────────────────────────────────────────


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

        executor = ThreadPoolExecutor(max_workers=1)
        future = executor.submit(calculators.dashboard_summary, items, prior_total)
        try:
            result = future.result(timeout=25)
        except FuturesTimeout:
            result = {
                'total_items': len(items),
                'grand_total': calculators.grand_total(items),
                'reorder_count': len(calculators.reorder_alerts(items)),
                'data_source': 'LIVE_SUPABASE_PARTIAL',
                'note': 'Full computation timed out — showing partial summary.',
            }
        finally:
            executor.shutdown(wait=False)
        result['data_source'] = result.get('data_source', 'LIVE_SUPABASE')
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

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)
        category = request.args.get('category')
        page = request.args.get('page', type=int, default=1)
        per_page = request.args.get('per_page', type=int, default=50)

        if month is None or year is None:
            return jsonify(error='month and year are required'), 400
        if not (0 <= month <= 11 and 2020 <= year <= 2030):
            return jsonify(error='month must be 0-11, year must be 2020-2030'), 400

        db = get_client()
        query = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year)
        if category:
            query = query.eq('category', category)

        count_query = db.table('dashboard_summary').select('*', count='exact').eq('month', month).eq('year', year)
        if category:
            count_query = count_query.eq('category', category)
        count_resp = count_query.execute()
        total_count = count_resp.count if hasattr(count_resp, 'count') else len(count_resp.data or [])

        offset = (page - 1) * per_page
        query = query.range(offset, offset + per_page - 1)
        resp = query.execute()

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
        if db_field in PRICE_FIELDS and not _is_manager(user):
            return jsonify(error='Only admin/manager can change price or par_level'), 403

        if user['role'] == 'staff' and db_field not in STAFF_ALLOWED_FIELDS:
            return jsonify(error='Staff can only update weekly issued quantities'), 403

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


@inventory_bp.post('/rollover')
def rollover():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if not _is_manager(user):
            return jsonify(error='Insufficient role'), 403

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
        if not _is_manager(user):
            return jsonify(error='Insufficient role'), 403

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

        matched_ids = [r['itemId'] for r in result if r.get('itemId') and r['itemId'] != 'NEW']
        if matched_ids:
            cur_resp = (
                db.table('monthly_inventory')
                .select('item_id,w1_received,w2_received,w3_received,w4_received')
                .in_('item_id', matched_ids)
                .eq('month', month)
                .eq('year', year)
                .execute()
            )
            cur_map = {r['item_id']: r for r in (cur_resp.data or [])}
        else:
            cur_map = {}
        for r in result:
            cur = cur_map.get(r.get('itemId'), {})
            r['currentW1R'] = float(cur.get('w1_received') or 0)
            r['currentW2R'] = float(cur.get('w2_received') or 0)
            r['currentW3R'] = float(cur.get('w3_received') or 0)
            r['currentW4R'] = float(cur.get('w4_received') or 0)

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
        if not _is_manager(user):
            return jsonify(error='Insufficient role'), 403

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

            db.rpc(
                'increment_inventory_field',
                {
                    'p_item_id': item_id,
                    'p_month': month,
                    'p_year': year,
                    'p_field': db_field,
                    'p_amount': qty,
                },
            ).execute()

            applied.append({'item_id': item_id, 'qty': qty, 'field': db_field})

        return jsonify({'applied': applied, 'skipped': skipped})
    except Exception as e:
        logger.exception(f'Error in apply_invoice endpoint: {e}')
        return jsonify(error='Internal server error'), 500


# ── Version History / Rollback ──────────────────────────────────────


@inventory_bp.post('/versions')
def create_version():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if not _is_manager(user):
            return jsonify(error='Insufficient role'), 403

        is_valid, validated_data_or_error, status_code = validate_json(CREATE_VERSION_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        month = data.get('month')
        year = data.get('year')
        message = data.get('message', '')

        db = get_client()

        items_resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
        items = items_resp.data or []

        parent_resp = (
            db.table('inventory_versions')
            .select('version_id')
            .eq('month', month)
            .eq('year', year)
            .order('created_at', desc=True)
            .limit(1)
            .execute()
        )
        parent_id = parent_resp.data[0]['version_id'] if parent_resp.data else None

        summary = calculators.dashboard_summary(items)

        version_record = {
            'snapshot_data': {'items': items},
            'summary_data': summary,
            'created_by': user['id'],
            'message': message or f'Snapshot {month + 1}/{year}',
            'parent_version_id': parent_id,
            'month': month,
            'year': year,
        }

        result = db.table('inventory_versions').insert(version_record).execute()
        created = result.data[0] if result.data else version_record

        logger.info(f'Version created by {user["username"]}: {created.get("version_id")}')
        return jsonify(created), 201

    except Exception as e:
        logger.exception(f'Error in create_version endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.get('/versions')
def list_versions():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)

        db = get_client()
        query = db.table('inventory_versions').select(
            'version_id, created_by, created_at, message, parent_version_id, month, year, summary_data'
        )

        if month is not None:
            query = query.eq('month', month)
        if year is not None:
            query = query.eq('year', year)

        resp = query.order('created_at', desc=True).limit(100).execute()
        versions = resp.data or []

        if versions:
            creator_ids = list(set(v.get('created_by') for v in versions if v.get('created_by')))
            if creator_ids:
                try:
                    profiles = (
                        db.table('user_profiles').select('id, display_name, username').in_('id', creator_ids).execute()
                    )
                    profile_map = {p['id']: p for p in (profiles.data or [])}
                    for v in versions:
                        creator = profile_map.get(v.get('created_by'))
                        if creator:
                            v['created_by_name'] = creator.get('display_name') or creator.get('username')
                except Exception:
                    pass

        return jsonify(versions)

    except Exception as e:
        logger.exception(f'Error in list_versions endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.get('/versions/<version_id>')
def get_version(version_id):
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        db = get_client()
        resp = db.table('inventory_versions').select('*').eq('version_id', version_id).limit(1).execute()
        if not resp.data:
            return jsonify(error='Version not found'), 404

        return jsonify(resp.data[0])

    except Exception as e:
        logger.exception(f'Error in get_version endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.post('/versions/<version_id>/restore')
def restore_version(version_id):
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if not _is_manager(user):
            return jsonify(error='Insufficient role'), 403

        db = get_client()

        version_resp = db.table('inventory_versions').select('*').eq('version_id', version_id).limit(1).execute()
        if not version_resp.data:
            return jsonify(error='Version not found'), 404

        version = version_resp.data[0]
        items = version.get('snapshot_data', {}).get('items', [])
        month = version.get('month')
        year = version.get('year')

        if not items:
            return jsonify(error='Version has no snapshot data'), 400

        restored_count = 0
        errors = []

        for item in items:
            item_id = item.get('item_id')
            if not item_id:
                continue

            price = item.get('unit_price')
            par = item.get('par_level')
            if price is not None or par is not None:
                updates = {}
                if price is not None:
                    updates['unit_price'] = price
                if par is not None:
                    updates['par_level'] = par
                if updates:
                    try:
                        db.table('inventory_items').update(updates).eq('id', item_id).execute()
                    except Exception as e:
                        errors.append(f'Item {item_id} price/par: {str(e)}')

            monthly_record = {
                'on_hand': item.get('on_hand', 0),
                'w1_received': item.get('w1_received', 0),
                'w2_received': item.get('w2_received', 0),
                'w3_received': item.get('w3_received', 0),
                'w4_received': item.get('w4_received', 0),
                'w1_issued': item.get('w1_issued', 0),
                'w2_issued': item.get('w2_issued', 0),
                'w3_issued': item.get('w3_issued', 0),
                'w4_issued': item.get('w4_issued', 0),
            }

            existing = (
                db.table('monthly_inventory')
                .select('id')
                .eq('item_id', item_id)
                .eq('month', month)
                .eq('year', year)
                .limit(1)
                .execute()
            )

            try:
                if existing.data:
                    db.table('monthly_inventory').update(monthly_record).eq('item_id', item_id).eq('month', month).eq(
                        'year', year
                    ).execute()
                else:
                    monthly_record['item_id'] = item_id
                    monthly_record['month'] = month
                    monthly_record['year'] = year
                    db.table('monthly_inventory').insert(monthly_record).execute()
                restored_count += 1
            except Exception as e:
                errors.append(f'Item {item_id} monthly: {str(e)}')

        logger.info(
            f'Version {version_id} restored by {user["username"]}: {restored_count} items, {len(errors)} errors'
        )

        return jsonify(
            {
                'restored_count': restored_count,
                'errors': errors,
                'version_id': version_id,
                'message': version.get('message', ''),
            }
        )

    except Exception as e:
        logger.exception(f'Error in restore_version endpoint: {e}')
        return jsonify(error='Internal server error'), 500


# ── New Endpoints ──────────────────────────────────────────────────


@inventory_bp.get('/now')
def get_now():
    try:
        db = get_client()
        result = db.rpc('get_current_period').execute()
        if result.data and len(result.data) > 0:
            row = result.data[0]
            return jsonify(
                {
                    'month': int(row['current_month']),
                    'year': int(row['current_year']),
                    'week': int(row['current_week']),
                    'month_name': row['month_name'].strip(),
                    'period_label': row['period_label'].strip(),
                    'is_live': True,
                }
            )
    except Exception:
        pass
    from datetime import datetime

    now = datetime.now()
    month = now.month - 1
    week = min(4, max(1, -(-now.day // 7)))
    names = [
        'January',
        'February',
        'March',
        'April',
        'May',
        'June',
        'July',
        'August',
        'September',
        'October',
        'November',
        'December',
    ]
    return jsonify(
        {
            'month': month,
            'year': now.year,
            'week': week,
            'month_name': names[month],
            'period_label': f'{names[month]} {now.year}',
            'is_live': True,
        }
    )


@inventory_bp.get('/current-month')
def current_month():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        resp = db.table('month_status').select('*').eq('status', 'open').limit(1).execute()
        if not resp.data:
            from datetime import datetime, timezone

            now = datetime.now(timezone.utc)
            return api_response({'month': now.month - 1, 'year': now.year, 'status': 'open'})
        return api_response(resp.data[0])
    except Exception as e:
        logger.exception(f'Error in current_month: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/current-week')
def current_week():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        from datetime import datetime, timezone

        now = datetime.now(timezone.utc)
        day = now.day
        if day <= 7:
            week = 1
        elif day <= 14:
            week = 2
        elif day <= 21:
            week = 3
        else:
            week = 4

        month = now.month - 1
        year = now.year

        return api_response(
            {
                'current_week': week,
                'month': month,
                'year': year,
                'weeks': list(range(1, 5)),
            }
        )
    except Exception as e:
        logger.exception(f'Error in current_week: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/months/<int:month>/<int:year>')
def month_inventory(month, year):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        if not (0 <= month <= 11 and 2020 <= year <= 2030):
            return error_response('month must be 0-11, year must be 2020-2030', status_code=400)

        db = get_client()
        resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
        return api_response(resp.data or [])
    except Exception as e:
        logger.exception(f'Error in month_inventory: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/months/<int:month>/<int:year>/weeks/<int:week>')
def week_inventory(month, year, week):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        if not (0 <= month <= 11 and 2020 <= year <= 2030):
            return error_response('month must be 0-11, year must be 2020-2030', status_code=400)
        if not (1 <= week <= 4):
            return error_response('week must be 1-4', status_code=400)

        db = get_client()
        field = f'w{week}'
        resp = (
            db.table('dashboard_summary')
            .select(f'*, {field}_received, {field}_issued')
            .eq('month', month)
            .eq('year', year)
            .execute()
        )
        return api_response(resp.data or [])
    except Exception as e:
        logger.exception(f'Error in week_inventory: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/items/<item_id>')
def get_item(item_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)

        db = get_client()

        item_resp = db.table('inventory_items').select('*').eq('id', item_id).limit(1).execute()
        if not item_resp.data:
            return error_response('Item not found', status_code=404)

        item = item_resp.data[0]

        if month is not None and year is not None:
            monthly_resp = (
                db.table('monthly_inventory')
                .select('*')
                .eq('item_id', item_id)
                .eq('month', month)
                .eq('year', year)
                .limit(1)
                .execute()
            )
            if monthly_resp.data:
                item.update(monthly_resp.data[0])

        return api_response(item)
    except Exception as e:
        logger.exception(f'Error in get_item: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/items')
def create_item():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        is_valid, validated_data_or_error, status_code = validate_json(ITEM_CREATE_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error

        db = get_client()

        item_record = {
            'sku': data['sku'],
            'description': data['description'],
            'unit_price': data['unit_price'],
            'category_id': data.get('category_id'),
            'par_level': data.get('par_level', 0),
            'unit': data.get('unit', ''),
            'active': True,
        }

        result = db.table('inventory_items').insert(item_record).execute()
        created_item = result.data[0] if result.data else item_record

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)
        if month is not None and year is not None:
            monthly = {
                'item_id': created_item['id'],
                'month': month,
                'year': year,
                'on_hand': 0,
                'w1_received': 0,
                'w2_received': 0,
                'w3_received': 0,
                'w4_received': 0,
                'w1_issued': 0,
                'w2_issued': 0,
                'w3_issued': 0,
                'w4_issued': 0,
            }
            db.table('monthly_inventory').insert(monthly).execute()

        return created_response(created_item)
    except Exception as e:
        logger.exception(f'Error in create_item: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.delete('/items/<item_id>')
def delete_item(item_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        db.table('inventory_items').update({'active': False}).eq('id', item_id).execute()
        return api_response({'deleted': True, 'item_id': item_id})
    except Exception as e:
        logger.exception(f'Error in delete_item: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/submit')
def submit_pending():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        is_valid, validated_data_or_error, status_code = validate_json(PENDING_SUBMIT_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        db = get_client()

        full_field = f'w{data["week_number"]}_{data["field"]}'
        monthly_resp = (
            db.table('monthly_inventory')
            .select(full_field)
            .eq('item_id', data['item_id'])
            .eq('month', data['month'])
            .eq('year', data['year'])
            .limit(1)
            .execute()
        )
        previous_value = float((monthly_resp.data or [{}])[0].get(full_field, 0) or 0)

        entry = {
            'item_id': data['item_id'],
            'month': data['month'],
            'year': data['year'],
            'week_number': data['week_number'],
            'field': full_field,
            'action': data['action'],
            'submitted_value': data['value'],
            'previous_value': previous_value,
            'status': 'pending',
            'submitted_by': user['id'],
        }

        if user['role'] == 'assistant':
            entry['status'] = 'merged'
            result = db.table('staging_entries').insert(entry).execute()
            created = result.data[0] if result.data else entry
            try:
                db.rpc(
                    'merge_single_staging',
                    {
                        'p_entry_id': created['entry_id'],
                        'p_reviewed_by': user['id'],
                        'p_review_note': 'Auto-merged by assistant',
                    },
                ).execute()
            except Exception as rpc_err:
                logger.warning(f'merge_single_staging RPC failed for assistant: {rpc_err}')
            return api_response({'entry_id': created.get('entry_id'), 'status': 'merged', 'auto_merged': True})
        else:
            result = db.table('staging_entries').insert(entry).execute()
            created = result.data[0] if result.data else entry
            return api_response({'entry_id': created.get('entry_id'), 'status': 'pending'})
    except Exception as e:
        logger.exception(f'Error in submit_pending: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/pending')
def list_pending():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if user['role'] not in ('admin', 'manager', 'assistant'):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        query = (
            db.table('staging_entries')
            .select('*, inventory_items!inner(sku, description)')
            .eq('status', 'pending')
            .order('created_at', desc=True)
        )
        resp = query.execute()

        entries = resp.data or []
        return api_response(entries)
    except Exception as e:
        logger.exception(f'Error in list_pending: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/pending/<entry_id>')
def get_pending(entry_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if user['role'] not in ('admin', 'manager', 'assistant'):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        resp = (
            db.table('staging_entries')
            .select('*, inventory_items!inner(sku, description)')
            .eq('entry_id', entry_id)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return error_response('Entry not found', status_code=404)
        return api_response(resp.data[0])
    except Exception as e:
        logger.exception(f'Error in get_pending: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.patch('/pending/<entry_id>')
def revise_pending(entry_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if user['role'] not in ('admin', 'manager', 'assistant'):
            return error_response('Insufficient role', status_code=403)

        data = request.get_json(silent=True) or {}
        allowed = {'submitted_value', 'field', 'action', 'week_number'}
        updates = {k: v for k, v in data.items() if k in allowed}

        if not updates:
            return error_response('No valid fields to update', status_code=400)

        db = get_client()
        resp = db.table('staging_entries').update(updates).eq('entry_id', entry_id).execute()
        if not resp.data:
            return error_response('Entry not found', status_code=404)
        return api_response(resp.data[0])
    except Exception as e:
        logger.exception(f'Error in revise_pending: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/pending/<entry_id>/approve')
def approve_pending(entry_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        data = request.get_json(silent=True) or {}
        review_note = data.get('review_note', '')

        db = get_client()
        try:
            result = db.rpc(
                'merge_single_staging',
                {
                    'p_entry_id': entry_id,
                    'p_reviewed_by': user['id'],
                    'p_review_note': review_note,
                },
            ).execute()
            return api_response({'entry_id': entry_id, 'status': 'merged', 'result': result.data})
        except Exception as rpc_err:
            logger.warning(f'merge_single_staging RPC failed, falling back: {rpc_err}')
            entry_resp = db.table('staging_entries').select('*').eq('entry_id', entry_id).limit(1).execute()
            if not entry_resp.data:
                return error_response('Entry not found', status_code=404)
            entry = entry_resp.data[0]

            monthly_resp = (
                db.table('monthly_inventory')
                .select('*')
                .eq('item_id', entry['item_id'])
                .eq('month', entry['month'])
                .eq('year', entry['year'])
                .limit(1)
                .execute()
            )
            if monthly_resp.data:
                db.table('monthly_inventory').update({entry['field']: entry['submitted_value']}).eq(
                    'item_id', entry['item_id']
                ).eq('month', entry['month']).eq('year', entry['year']).execute()
            else:
                db.table('monthly_inventory').insert(
                    {
                        'item_id': entry['item_id'],
                        'month': entry['month'],
                        'year': entry['year'],
                        entry['field']: entry['submitted_value'],
                    }
                ).execute()

            db.table('staging_entries').update(
                {
                    'status': 'merged',
                    'reviewed_by': user['id'],
                    'review_note': review_note,
                    'reviewed_at': 'now()',
                }
            ).eq('entry_id', entry_id).execute()

            return api_response({'entry_id': entry_id, 'status': 'merged'})
    except Exception as e:
        logger.exception(f'Error in approve_pending: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/pending/<entry_id>/reject')
def reject_pending(entry_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        data = request.get_json(silent=True) or {}
        review_note = data.get('review_note', '')

        db = get_client()
        resp = (
            db.table('staging_entries')
            .update(
                {
                    'status': 'rejected',
                    'reviewed_by': user['id'],
                    'review_note': review_note,
                    'reviewed_at': 'now()',
                }
            )
            .eq('entry_id', entry_id)
            .execute()
        )

        if not resp.data:
            return error_response('Entry not found', status_code=404)
        return api_response({'entry_id': entry_id, 'status': 'rejected'})
    except Exception as e:
        logger.exception(f'Error in reject_pending: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/publish')
def publish_month():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        is_valid, validated_data_or_error, status_code = validate_json(PUBLISH_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        month = data.get('month')
        year = data.get('year')

        db = get_client()
        try:
            result = db.rpc(
                'publish_month',
                {
                    'p_month': month,
                    'p_year': year,
                },
            ).execute()
            return api_response({'month': month, 'year': year, 'published': True, 'result': result.data})
        except Exception as rpc_err:
            logger.warning(f'publish_month RPC failed, falling back: {rpc_err}')
            db.table('month_status').upsert(
                {
                    'month': month,
                    'year': year,
                    'status': 'published',
                    'published_by': user['id'],
                    'published_at': 'now()',
                }
            ).execute()
            return api_response({'month': month, 'year': year, 'published': True})
    except Exception as e:
        logger.exception(f'Error in publish_month: {e}')
        return error_response('Internal server error', status_code=500)


# ── Source-Control Workflow ──────────────────────────────────────────


STAGING_SUBMIT_SCHEMA = {
    'item_id': {'type': 'str', 'required': True},
    'month': {'type': 'int', 'required': True, 'min': 0, 'max': 11},
    'year': {'type': 'int', 'required': True, 'min': 2020, 'max': 2030},
    'week_number': {'type': 'int', 'required': True, 'min': 1, 'max': 4},
    'field': {'type': 'str', 'required': True, 'enum': ['received', 'issued']},
    'action': {'type': 'str', 'required': True, 'enum': ['pull', 'enter']},
    'value': {'required': True},
}


@inventory_bp.post('/staging')
def submit_staging():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        is_valid, validated_data_or_error, status_code = validate_json(STAGING_SUBMIT_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        item_id = data['item_id']
        month = data['month']
        year = data['year']
        week_number = data['week_number']
        field = data['field']  # 'received' | 'issued'
        action = data['action']  # 'pull' | 'enter'
        value = data['value']

        # Derive full DB column name from short field + week
        full_field = f'w{week_number}_{field}'

        db = get_client()

        # Capture previous_value from live monthly_inventory (not from client)
        prev_resp = (
            db.table('monthly_inventory')
            .select(full_field)
            .eq('item_id', item_id)
            .eq('month', month)
            .eq('year', year)
            .limit(1)
            .execute()
        )
        previous_value = 0
        if prev_resp.data:
            previous_value = prev_resp.data[0].get(full_field) or 0

        insert_resp = (
            db.table('staging_entries')
            .insert(
                {
                    'item_id': item_id,
                    'month': month,
                    'year': year,
                    'week_number': week_number,
                    'field': full_field,
                    'action': action,
                    'submitted_value': value,
                    'previous_value': previous_value,
                    'status': 'pending',
                    'submitted_by': user['id'],
                }
            )
            .execute()
        )

        if not insert_resp.data:
            return error_response('Failed to create staging entry', status_code=500)

        return created_response(insert_resp.data[0])
    except Exception as e:
        logger.exception(f'Error in submit_staging: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/staging')
def list_staging():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 50, type=int)
        per_page = min(per_page, 200)
        offset = (page - 1) * per_page

        db = get_client()
        resp = (
            db.table('staging_entries_compat')
            .select('*, inventory_items!inner(sku, description)', count='exact')
            .eq('status', 'pending')
            .order('submitted_at', desc=True)
            .range(offset, offset + per_page - 1)
            .execute()
        )

        total = resp.count if resp.count is not None else len(resp.data or [])
        return api_response({'entries': resp.data or [], 'page': page, 'per_page': per_page, 'total': total})
    except Exception as e:
        logger.exception(f'Error in list_staging: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/staging/<entry_id>')
def get_staging_entry(entry_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        resp = (
            db.table('staging_entries')
            .select('*, inventory_items!inner(sku, description)')
            .eq('entry_id', entry_id)
            .limit(1)
            .execute()
        )
        if not resp.data:
            return error_response('Entry not found', status_code=404)
        return api_response(resp.data[0])
    except Exception as e:
        logger.exception(f'Error in get_staging_entry: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/staging/<entry_id>/merge')
def merge_staging_entry(entry_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        result = db.rpc(
            'merge_single_staging',
            {'p_entry_id': entry_id, 'p_reviewed_by': user['id']},
        ).execute()

        return api_response({'entry_id': entry_id, 'status': 'merged', 'result': result.data})
    except Exception as e:
        logger.exception(f'Error in merge_staging_entry: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/staging/<entry_id>/reject')
def reject_staging_entry(entry_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        body = request.get_json(silent=True) or {}
        note = body.get('note', '')

        db = get_client()
        result = db.rpc(
            'reject_staging',
            {'p_entry_id': entry_id, 'p_reviewed_by': user['id'], 'p_note': note},
        ).execute()

        return api_response({'entry_id': entry_id, 'status': 'rejected', 'result': result.data})
    except Exception as e:
        logger.exception(f'Error in reject_staging_entry: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/push-all')
def push_all_staging():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        body = request.get_json(silent=True) or {}
        message = body.get('message', '')

        db = get_client()
        result = db.rpc(
            'push_all_staging',
            {'p_reviewed_by': user['id'], 'p_message': message},
        ).execute()

        return api_response({'status': 'committed', 'result': result.data})
    except Exception as e:
        logger.exception(f'Error in push_all_staging: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/commits')
def list_commits():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        page = request.args.get('page', 1, type=int)
        per_page = request.args.get('per_page', 20, type=int)
        per_page = min(per_page, 100)
        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)
        offset = (page - 1) * per_page

        db = get_client()
        query = db.table('commits_compat').select('*', count='exact').order('created_at', desc=True)

        if month is not None:
            query = query.eq('month', month)
        if year is not None:
            query = query.eq('year', year)

        resp = query.range(offset, offset + per_page - 1).execute()

        total = resp.count if resp.count is not None else len(resp.data or [])
        return api_response({'commits': resp.data or [], 'page': page, 'per_page': per_page, 'total': total})
    except Exception as e:
        logger.exception(f'Error in list_commits: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/commits/<commit_id>')
def get_commit(commit_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        commit_resp = db.table('commits_compat').select('*').eq('id', commit_id).limit(1).execute()
        if not commit_resp.data:
            return error_response('Commit not found', status_code=404)

        changes_resp = db.table('commit_changes').select('*').eq('commit_id', commit_id).execute()

        return api_response({'commit': commit_resp.data[0], 'changes': changes_resp.data or []})
    except Exception as e:
        logger.exception(f'Error in get_commit: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/commits/<commit_id>/revert')
def revert_commit(commit_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        result = db.rpc(
            'revert_to_commit',
            {'p_commit_id': commit_id, 'p_reverted_by': user['id']},
        ).execute()

        return api_response({'commit_id': commit_id, 'status': 'reverted', 'result': result.data})
    except Exception as e:
        logger.exception(f'Error in revert_commit: {e}')
        return error_response('Internal server error', status_code=500)


# ── Barcode Routes ────────────────────────────────────────────────────


@inventory_bp.get('/barcodes')
def list_barcodes():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        resp = db.table('barcodes').select('*').eq('is_active', True).execute()
        return api_response(resp.data if resp.data else [])
    except Exception as e:
        logger.exception(f'Error in list_barcodes: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/items/<item_id>/barcode')
def get_item_barcode(item_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        item_resp = db.table('inventory_items').select('id, sku').eq('id', item_id).limit(1).execute()
        if not item_resp.data:
            return error_response('Item not found', status_code=404)

        sku = item_resp.data[0].get('sku')
        if sku:
            resp = db.table('barcodes').select('*').eq('sku', sku).limit(1).execute()
            if resp.data:
                return api_response(resp.data[0])

        return api_response({'item_id': item_id, 'sku': sku, 'barcode_id': None})
    except Exception as e:
        logger.exception(f'Error in get_item_barcode: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/items/<item_id>/barcode/regenerate')
def regenerate_barcode(item_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        item_resp = (
            db.table('inventory_items').select('id, sku, description, unit_price').eq('id', item_id).limit(1).execute()
        )
        if not item_resp.data:
            return error_response('Item not found', status_code=404)

        item = item_resp.data[0]
        sku = item.get('sku')

        import uuid

        new_barcode_id = str(uuid.uuid4())[:12].upper()

        if sku:
            existing = db.table('barcodes').select('*').eq('sku', sku).limit(1).execute()
            if existing.data:
                db.table('barcodes').update({'barcode_id': new_barcode_id, 'barcode_type': 'CODE128'}).eq(
                    'sku', sku
                ).execute()
            else:
                db.table('barcodes').insert(
                    {
                        'barcode_id': new_barcode_id,
                        'sku': sku,
                        'description': item.get('description', ''),
                        'category': 'Uncategorized',
                        'unit_price': item.get('unit_price', 0),
                        'is_active': True,
                        'barcode_type': 'CODE128',
                    }
                ).execute()
        else:
            db.table('barcodes').insert(
                {
                    'barcode_id': new_barcode_id,
                    'description': item.get('description', ''),
                    'category': 'Uncategorized',
                    'is_active': True,
                    'barcode_type': 'CODE128',
                }
            ).execute()

        return api_response({'barcode_id': new_barcode_id, 'barcode_type': 'CODE128'})
    except Exception as e:
        logger.exception(f'Error in regenerate_barcode: {e}')
        return error_response('Internal server error', status_code=500)
