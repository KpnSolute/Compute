import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

from flask import Blueprint, jsonify, request

from backend.calculators import calc_summary
from backend.rbac import resolve_user
from backend.response import api_response, created_response, error_response
from backend.supabase_client import get_client
from backend.validation import (
    BARCODE_EXPORT_SCHEMA,
    CREATE_VERSION_SCHEMA,
    INVENTORY_ITEM_UPDATE_SCHEMA,
    INVOICE_APPLY_SCHEMA,
    ITEM_CREATE_SCHEMA,
    PENDING_SUBMIT_SCHEMA,
    PUBLISH_SCHEMA,
    ROLLOVER_SCHEMA,
    SAVE_SNAPSHOT_SCHEMA,
    validate_json,
)

logger = logging.getLogger(__name__)

inventory_bp = Blueprint('inventory', __name__, url_prefix='/api/inventory')


# ── Role helpers ──────────────────────────────────────────────────────

def _is_manager(user: dict) -> bool:
    return user.get('role') in ('admin', 'manager')


def _is_assistant_or_above(user: dict) -> bool:
    return user.get('role') in ('admin', 'manager', 'assistant')


# ── Health / Utility ──────────────────────────────────────────────────

@inventory_bp.get('/ping')
def ping():
    return jsonify(ok=True, ts=datetime.now(timezone.utc).isoformat())


@inventory_bp.get('/now')
def get_now():
    try:
        db = get_client()
        result = db.rpc('get_current_period').execute()
        if result.data and len(result.data) > 0:
            row = result.data[0]
            return jsonify({
                'month': int(row['current_month']),
                'year': int(row['current_year']),
                'week': int(row['current_week']),
                'month_name': row['month_name'].strip(),
                'period_label': row['period_label'].strip(),
                'is_live': True,
            })
    except Exception:
        pass
    now = datetime.now(timezone.utc)
    month = now.month - 1
    week = min(4, max(1, -(-now.day // 7)))
    names = ['January', 'February', 'March', 'April', 'May', 'June',
             'July', 'August', 'September', 'October', 'November', 'December']
    return jsonify({
        'month': month,
        'year': now.year,
        'week': week,
        'month_name': names[month],
        'period_label': f'{names[month]} {now.year}',
        'is_live': False,
    })


@inventory_bp.get('/current-week')
def current_week():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        now = datetime.now(timezone.utc)
        day = now.day
        week = 1 if day <= 7 else 2 if day <= 14 else 3 if day <= 21 else 4
        return api_response({'current_week': week, 'month': now.month - 1, 'year': now.year})
    except Exception as e:
        logger.exception(f'Error in current_week: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/current-month')
def current_month():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        resp = db.table('month_status').select('*').eq('status', 'open').order('year', desc=True).order('month', desc=True).limit(1).execute()
        if resp.data:
            return api_response(resp.data[0])

        now = datetime.now(timezone.utc)
        return api_response({'month': now.month - 1, 'year': now.year, 'status': 'open'})
    except Exception as e:
        logger.exception(f'Error in current_month: {e}')
        return error_response('Internal server error', status_code=500)


# ── Summary ───────────────────────────────────────────────────────────

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

        def fetch_items():
            return db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()

        def fetch_status():
            return db.table('month_status').select('*').eq('month', month).eq('year', year).limit(1).execute()

        with ThreadPoolExecutor(max_workers=2) as executor:
            items_future = executor.submit(fetch_items)
            status_future = executor.submit(fetch_status)
            try:
                items_resp = items_future.result(timeout=10)
                status_resp = status_future.result(timeout=10)
            except Exception:
                items_resp = fetch_items()
                status_resp = fetch_status()

        items = items_resp.data or []
        result = calc_summary(items)
        result['month'] = month
        result['year'] = year
        result['status'] = (status_resp.data[0].get('status') if status_resp.data else 'open')
        result['data_source'] = 'LIVE_SUPABASE'
        return jsonify(result)
    except Exception as e:
        logger.exception(f'Error in summary endpoint: {e}')
        return jsonify(error='Internal server error'), 500


# ── Items ─────────────────────────────────────────────────────────────

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

        return jsonify({
            'items': resp.data or [],
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total_count': total_count,
                'total_pages': (total_count + per_page - 1) // per_page,
                'has_next': page < ((total_count + per_page - 1) // per_page),
                'has_prev': page > 1,
            },
        })
    except Exception as e:
        logger.exception(f'Error in items endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@inventory_bp.get('/items/<item_id>')
def get_item(item_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)

        db = get_client()
        resp = db.table('inventory_items').select('*').eq('id', item_id).limit(1).execute()
        if not resp.data:
            return error_response('Item not found', status_code=404)

        item = resp.data[0]
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
                'w1_received': 0, 'w2_received': 0, 'w3_received': 0, 'w4_received': 0,
                'w1_issued': 0, 'w2_issued': 0, 'w3_issued': 0, 'w4_issued': 0,
            }
            db.table('monthly_inventory').insert(monthly).execute()

        return created_response(created_item)
    except Exception as e:
        logger.exception(f'Error in create_item: {e}')
        return error_response('Internal server error', status_code=500)


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
        field = data['field']
        value = data['value']
        month = data['month']
        year = data['year']

        # Normalise field aliases
        field_map = {
            'onHand': 'on_hand', 'price': 'unit_price', 'par': 'par_level',
            'w1i': 'w1_issued', 'w2i': 'w2_issued', 'w3i': 'w3_issued', 'w4i': 'w4_issued',
            'w1r': 'w1_received', 'w2r': 'w2_received', 'w3r': 'w3_received', 'w4r': 'w4_received',
        }
        db_field = field_map.get(field, field)

        db = get_client()

        # par_level only lives on inventory_items (catalog-level setting)
        # unit_price and all monthly fields live on monthly_inventory
        # Rationale: invoice prices vary month-to-month; par_level is a catalog setting
        catalog_only_fields = {'par_level'}

        if db_field in catalog_only_fields:
            db.table('inventory_items').update({db_field: value}).eq('id', item_id).execute()
        else:
            # unit_price, on_hand, and all weekly fields go to monthly_inventory
            existing = (
                db.table('monthly_inventory')
                .select('id')
                .eq('item_id', item_id)
                .eq('month', month)
                .eq('year', year)
                .limit(1)
                .execute()
            )
            if existing.data:
                db.table('monthly_inventory').update({db_field: value}).eq('item_id', item_id).eq('month', month).eq('year', year).execute()
            else:
                row = {'item_id': item_id, 'month': month, 'year': year, db_field: value}
                db.table('monthly_inventory').insert(row).execute()

        return jsonify(ok=True, field=db_field, value=value)
    except Exception as e:
        logger.exception(f'Error in update_item: {e}')
        return jsonify(error='Internal server error'), 500


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


# ── Categories ────────────────────────────────────────────────────────

@inventory_bp.get('/categories')
def categories():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401

        db = get_client()
        resp = db.table('inventory_categories').select('*').execute()
        return jsonify(resp.data or [])
    except Exception as e:
        logger.exception(f'Error in categories endpoint: {e}')
        return jsonify(error='Internal server error'), 500


# ── Staging / Commit pipeline ─────────────────────────────────────────

@inventory_bp.post('/submit')
@inventory_bp.post('/commits/stage')  # canonical name per implementation plan
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

        # Auto-commit roles (assistant, manager, admin — level >= 20)
        AUTO_COMMIT_ROLES = {'assistant', 'manager', 'admin'}
        if user['role'] in AUTO_COMMIT_ROLES:
            entry['status'] = 'merged'
            result  = db.table('staging_entries').insert(entry).execute()
            created = result.data[0] if result.data else entry
            commit_id = None
            try:
                rpc_result = db.rpc('merge_single_staging', {
                    'p_entry_id':   created['entry_id'],
                    'p_reviewed_by': user['id'],
                    'p_review_note': f'Auto-committed by {user["role"]}',
                }).execute()
                commit_id = rpc_result.data if isinstance(rpc_result.data, str) else None
            except Exception as rpc_err:
                logger.warning(f'merge_single_staging RPC failed for {user["role"]}: {rpc_err}')

            # Trigger async GitHub sync
            if commit_id:
                try:
                    from backend.github_sync import sync_inventory_after_commit
                    month = data['month']
                    year  = data['year']
                    inv_resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
                    inv_raw  = inv_resp.data or []
                    inv_data: dict = {}
                    for item in inv_raw:
                        cat = item.get('category', 'Uncategorized')
                        if cat not in inv_data:
                            inv_data[cat] = []
                        inv_data[cat].append({
                            'sku':  item.get('sku', ''),
                            'desc': item.get('description', ''),
                            'price': float(item.get('unit_price') or 0),
                            'onHand': float(item.get('on_hand') or 0),
                            'par':   float(item.get('par_level') or 0),
                            'w1r': float(item.get('w1_received') or 0),
                            'w2r': float(item.get('w2_received') or 0),
                            'w3r': float(item.get('w3_received') or 0),
                            'w4r': float(item.get('w4_received') or 0),
                            'w1i': float(item.get('w1_issued') or 0),
                            'w2i': float(item.get('w2_issued') or 0),
                            'w3i': float(item.get('w3_issued') or 0),
                            'w4i': float(item.get('w4_issued') or 0),
                        })
                    author = user.get('display_name') or user.get('username', 'MJCC')
                    msg    = f'auto: {full_field} updated by {author}'
                    sync_inventory_after_commit(month, year, inv_data, commit_id, author, msg)
                except Exception as sync_err:
                    logger.warning(f'GitHub sync setup failed: {sync_err}')

            return api_response({
                'entry_id':     created.get('entry_id'),
                'commit_id':    commit_id,
                'status':       'merged',
                'auto_committed': True,
            })
        else:
            result  = db.table('staging_entries').insert(entry).execute()
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
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        resp = db.table('staging_entries').select('*, inventory_items!inner(sku, description)').eq('status', 'pending').order('submitted_at', desc=True).execute()
        return api_response(resp.data or [])
    except Exception as e:
        logger.exception(f'Error in list_pending: {e}')
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
        per_page = min(request.args.get('per_page', 50, type=int), 200)
        offset = (page - 1) * per_page

        db = get_client()
        resp = (
            db.table('staging_entries')
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
        resp = db.table('staging_entries').select('*, inventory_items!inner(sku, description)').eq('entry_id', entry_id).limit(1).execute()
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
        result = db.rpc('merge_single_staging', {'p_entry_id': entry_id, 'p_reviewed_by': user['id']}).execute()
        return api_response({'entry_id': entry_id, 'status': 'merged', 'result': result.data})
    except Exception as e:
        logger.exception(f'Error in merge_staging_entry: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/pending/<entry_id>/approve')
def approve_pending(entry_id):
    """Legacy alias for merge_staging_entry."""
    return merge_staging_entry(entry_id)


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
            .update({'status': 'rejected', 'reviewed_by': user['id'], 'review_note': review_note, 'reviewed_at': 'now()'})
            .eq('entry_id', entry_id)
            .execute()
        )
        if not resp.data:
            return error_response('Entry not found', status_code=404)
        return api_response({'entry_id': entry_id, 'status': 'rejected'})
    except Exception as e:
        logger.exception(f'Error in reject_pending: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/commits/push')
def push_commits():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        data = request.get_json(silent=True) or {}
        message = data.get('message', 'Manual push')
        branch  = data.get('branch', 'main')
        month   = data.get('month')
        year    = data.get('year')

        db = get_client()
        commit_id = None
        try:
            result    = db.rpc('push_all_staging', {'p_reviewed_by': user['id'], 'p_message': message, 'p_branch': branch}).execute()
            commit_id = result.data if isinstance(result.data, str) else None
        except Exception as rpc_err:
            logger.warning(f'push_all_staging RPC failed: {rpc_err}')

        # Trigger async GitHub sync if we have month/year context
        if commit_id and month is not None and year is not None:
            try:
                from backend.github_sync import sync_inventory_after_commit
                # Fetch live inventory for snapshot
                inv_resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
                inv_raw  = inv_resp.data or []
                # Group by category for INV format
                inv_data: dict = {}
                for item in inv_raw:
                    cat = item.get('category', 'Uncategorized')
                    if cat not in inv_data:
                        inv_data[cat] = []
                    inv_data[cat].append({
                        'sku':   item.get('sku', ''),
                        'desc':  item.get('description', ''),
                        'price': float(item.get('unit_price') or 0),
                        'onHand': float(item.get('on_hand') or 0),
                        'par':   float(item.get('par_level') or 0),
                        'w1r': float(item.get('w1_received') or 0),
                        'w2r': float(item.get('w2_received') or 0),
                        'w3r': float(item.get('w3_received') or 0),
                        'w4r': float(item.get('w4_received') or 0),
                        'w1i': float(item.get('w1_issued') or 0),
                        'w2i': float(item.get('w2_issued') or 0),
                        'w3i': float(item.get('w3_issued') or 0),
                        'w4i': float(item.get('w4_issued') or 0),
                    })
                author = user.get('display_name') or user.get('username', 'MJCC')
                sync_inventory_after_commit(month, year, inv_data, commit_id, author, message)
            except Exception as sync_err:
                logger.warning(f'GitHub sync setup failed: {sync_err}')

        github_pending = commit_id is not None and (month is None or year is None)
        return api_response({
            'status':         'pushed',
            'message':        message,
            'branch':         branch,
            'commit_id':      commit_id,
            'github_pending': github_pending,
        })
    except Exception as e:
        logger.exception(f'Error in push_commits: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/commits')
def list_commits():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        page = request.args.get('page', 1, type=int)
        per_page = min(request.args.get('per_page', 20, type=int), 100)
        offset = (page - 1) * per_page

        db = get_client()
        try:
            # Use commits_compat view which exposes 'id' alias for commit_id
            resp = (
                db.table('commits_compat')
                .select('*', count='exact')
                .order('created_at', desc=True)
                .range(offset, offset + per_page - 1)
                .execute()
            )
            total = resp.count if resp.count is not None else len(resp.data or [])
            return api_response({'commits': resp.data or [], 'page': page, 'per_page': per_page, 'total': total})
        except Exception:
            return api_response({'commits': [], 'page': page, 'per_page': per_page, 'total': 0})
    except Exception as e:
        logger.exception(f'Error in list_commits: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/commits/tree')
def get_commit_tree():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        try:
            resp = (
                db.table('commits_compat')
                .select('id, commit_id, parent_ids, message, branch, created_at, author_id')
                .order('created_at', desc=True)
                .limit(100)
                .execute()
            )
            return api_response(resp.data or [])
        except Exception:
            return api_response([])
    except Exception as e:
        logger.exception(f'Error in get_commit_tree: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/commits/<commit_id>')
def get_commit(commit_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        # commits_compat has both 'id' and 'commit_id'
        commit_resp = db.table('commits_compat').select('*').eq('commit_id', commit_id).limit(1).execute()
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
        # Live RPC signature: revert_to_commit(p_target_commit_id, p_reverted_by)
        result = db.rpc('revert_to_commit', {'p_target_commit_id': commit_id, 'p_reverted_by': user['id']}).execute()
        return api_response({'commit_id': commit_id, 'status': 'reverted', 'result': result.data})
    except Exception as e:
        logger.exception(f'Error in revert_commit: {e}')
        return error_response('Internal server error', status_code=500)


# ── Barcodes ──────────────────────────────────────────────────────────

@inventory_bp.get('/barcodes')
def list_barcodes():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        try:
            resp = db.table('item_barcodes').select('*, inventory_items!inner(sku, description)').eq('is_primary', True).execute()
            return api_response(resp.data or [])
        except Exception:
            resp = db.table('inventory_items').select('id, sku, description').eq('active', True).execute()
            return api_response(resp.data or [])
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

        item = item_resp.data[0]
        barcode_val = item.get('sku') or str(item['id'])[:12]
        return api_response({'item_id': item_id, 'barcode': barcode_val, 'format': 'CODE128'})
    except Exception as e:
        logger.exception(f'Error in get_item_barcode: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/barcodes/export')
def export_barcodes():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        is_valid, validated_data_or_error, status_code = validate_json(BARCODE_EXPORT_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        return api_response({'message': 'Export handled client-side', 'item_ids': data.get('item_ids'), 'format': data.get('format')})
    except Exception as e:
        logger.exception(f'Error in export_barcodes: {e}')
        return error_response('Internal server error', status_code=500)


# ── Invoice parsing ───────────────────────────────────────────────────

@inventory_bp.post('/parse-invoice')
def parse_invoice():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if not _is_manager(user):
            return jsonify(error='Insufficient role'), 403

        body  = request.get_json(silent=True) or {}
        month = body.get('month')
        year  = body.get('year')
        invoice_text  = (body.get('text') or '').strip()
        image_b64_raw = (body.get('image') or '').strip()

        if month is None or year is None:
            return jsonify(error='month and year are required'), 400
        if not invoice_text and not image_b64_raw:
            return jsonify(error='text or image is required'), 400

        db = get_client()
        cat_resp = db.table('dashboard_summary').select(
            'item_id, sku, description, unit_price'
        ).eq('month', month).eq('year', year).execute()
        catalog_items = cat_resp.data or []

        if not catalog_items:
            return jsonify(error=f'No items found for month={month} year={year}'), 400

        try:
            if image_b64_raw:
                from backend.ai_parser import parse_invoice_image, validate_image
                image_b64, mime = validate_image(image_b64_raw)
                result = parse_invoice_image(catalog_items, image_b64, mime)
            else:
                from backend.ai_parser import parse_invoice_text
                result = parse_invoice_text(catalog_items, invoice_text)
        except ValueError as ve:
            return jsonify(error=str(ve)), 400
        except RuntimeError as re_err:
            return jsonify(error=str(re_err)), 503
        except Exception as e:
            logger.exception(f'AI parsing failed: {e}')
            return jsonify(error=f'AI parsing failed: {str(e)}'), 500

        return jsonify(result)
    except Exception as e:
        logger.exception(f'Error in parse_invoice: {e}')
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
        matches = data.get('matches') or []
        week_field_alias = data.get('week_field', 'w1r')
        month = data.get('month')
        year = data.get('year')

        wf_map = {'w1r': 'w1_received', 'w2r': 'w2_received', 'w3r': 'w3_received', 'w4r': 'w4_received'}
        db_field = wf_map.get(week_field_alias, 'w1_received')

        db = get_client()
        applied = 0
        for match in matches:
            if not match.get('matched'):
                continue
            item_id = match.get('catalog_item_id')
            qty = match.get('quantity')
            if not item_id or qty is None:
                continue
            try:
                existing = db.table('monthly_inventory').select('id').eq('item_id', item_id).eq('month', month).eq('year', year).limit(1).execute()
                if existing.data:
                    db.table('monthly_inventory').update({db_field: qty}).eq('item_id', item_id).eq('month', month).eq('year', year).execute()
                else:
                    db.table('monthly_inventory').insert({'item_id': item_id, 'month': month, 'year': year, db_field: qty}).execute()
                applied += 1
            except Exception as row_err:
                logger.warning(f'Failed to apply match for item {item_id}: {row_err}')

        return jsonify({'applied': applied, 'total': len(matches)})
    except Exception as e:
        logger.exception(f'Error in apply_invoice: {e}')
        return jsonify(error='Internal server error'), 500


# ── Snapshots & Versioning ────────────────────────────────────────────

@inventory_bp.post('/snapshot')
def save_snapshot():
    try:
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if not _is_manager(user):
            return jsonify(error='Insufficient role'), 403

        is_valid, validated_data_or_error, status_code = validate_json(SAVE_SNAPSHOT_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        month = data['month']
        year = data['year']

        db = get_client()
        items_resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
        items = items_resp.data or []

        import json as _json
        snapshot = {
            'month': month,
            'year': year,
            'snapshot_data': _json.dumps(items),
            'created_by': user['id'],
            'item_count': len(items),
        }
        result = db.table('monthly_snapshots').insert(snapshot).execute()
        return jsonify(result.data[0] if result.data else snapshot)
    except Exception as e:
        logger.exception(f'Error in save_snapshot: {e}')
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
        from_month = data['from_month']
        from_year = data['from_year']

        next_month = (from_month + 1) % 12
        next_year = from_year + 1 if from_month == 11 else from_year

        db = get_client()
        items_resp = db.table('dashboard_summary').select('*').eq('month', from_month).eq('year', from_year).execute()
        items = items_resp.data or []

        result = calc_summary(items)

        for item in items:
            new_row = {
                'item_id': item['item_id'],
                'month': next_month,
                'year': next_year,
                'on_hand': item.get('on_hand', 0),
                'w1_received': 0, 'w2_received': 0, 'w3_received': 0, 'w4_received': 0,
                'w1_issued': 0, 'w2_issued': 0, 'w3_issued': 0, 'w4_issued': 0,
            }
            existing = db.table('monthly_inventory').select('id').eq('item_id', item['item_id']).eq('month', next_month).eq('year', next_year).limit(1).execute()
            if existing.data:
                db.table('monthly_inventory').update({'on_hand': item.get('on_hand', 0)}).eq('item_id', item['item_id']).eq('month', next_month).eq('year', next_year).execute()
            else:
                db.table('monthly_inventory').insert(new_row).execute()

        # Archive the closing month to GitHub (immutable snapshot)
        try:
            from backend.github_sync import sync_archive_after_rollover
            inv_data: dict = {}
            for item in items:
                cat = item.get('category', 'Uncategorized')
                if cat not in inv_data:
                    inv_data[cat] = []
                inv_data[cat].append({
                    'sku': item.get('sku', ''), 'desc': item.get('description', ''),
                    'price': float(item.get('unit_price') or 0),
                    'onHand': float(item.get('on_hand') or 0),
                    'par':   float(item.get('par_level') or 0),
                    'w1r': float(item.get('w1_received') or 0), 'w2r': float(item.get('w2_received') or 0),
                    'w3r': float(item.get('w3_received') or 0), 'w4r': float(item.get('w4_received') or 0),
                    'w1i': float(item.get('w1_issued') or 0),   'w2i': float(item.get('w2_issued') or 0),
                    'w3i': float(item.get('w3_issued') or 0),   'w4i': float(item.get('w4_issued') or 0),
                })
            author = user.get('display_name') or user.get('username', 'MJCC')
            sync_archive_after_rollover(from_month, from_year, inv_data, author)
        except Exception as arch_err:
            logger.warning(f'Archive sync setup failed: {arch_err}')

        return jsonify({'next_month': next_month, 'next_year': next_year, 'starting_total': round(result['grand_total'], 2)})
    except Exception as e:
        logger.exception(f'Error in rollover endpoint: {e}')
        return jsonify(error='Internal server error'), 500


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
            result = db.rpc('publish_month', {'p_month': month, 'p_year': year}).execute()
            return api_response({'month': month, 'year': year, 'published': True, 'result': result.data})
        except Exception as rpc_err:
            logger.warning(f'publish_month RPC failed, falling back: {rpc_err}')
            db.table('month_status').upsert({'month': month, 'year': year, 'status': 'published', 'published_by': user['id'], 'published_at': 'now()'}).execute()
            return api_response({'month': month, 'year': year, 'published': True})
    except Exception as e:
        logger.exception(f'Error in publish_month: {e}')
        return error_response('Internal server error', status_code=500)


# ── Versions ──────────────────────────────────────────────────────────

@inventory_bp.get('/versions')
def get_versions():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)
        db = get_client()
        query = db.table('inventory_versions').select('*').order('created_at', desc=True)
        if month is not None:
            query = query.eq('month', month)
        if year is not None:
            query = query.eq('year', year)
        resp = query.execute()
        return api_response(resp.data or [])
    except Exception as e:
        logger.exception(f'Error in get_versions: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/versions')
def create_version():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        is_valid, validated_data_or_error, status_code = validate_json(CREATE_VERSION_SCHEMA)
        if not is_valid:
            return validated_data_or_error, status_code

        data = validated_data_or_error
        month = data['month']
        year = data['year']
        label = data.get('label') or f'Version {datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M")}'

        db = get_client()
        items_resp = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year).execute()
        import json as _json
        version = {
            'month': month,
            'year': year,
            'label': label,
            'snapshot': _json.dumps(items_resp.data or []),
            'created_by': user['id'],
        }
        result = db.table('inventory_versions').insert(version).execute()
        return created_response(result.data[0] if result.data else version)
    except Exception as e:
        logger.exception(f'Error in create_version: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.post('/versions/<version_id>/restore')
def restore_version(version_id):
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)
        if not _is_manager(user):
            return error_response('Insufficient role', status_code=403)

        db = get_client()
        resp = db.table('inventory_versions').select('*').eq('id', version_id).limit(1).execute()
        if not resp.data:
            return error_response('Version not found', status_code=404)
        return api_response({'restored': True, 'version_id': version_id})
    except Exception as e:
        logger.exception(f'Error in restore_version: {e}')
        return error_response('Internal server error', status_code=500)


# ── Activity ──────────────────────────────────────────────────────────

@inventory_bp.get('/activity')
def get_activity():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        db = get_client()
        try:
            resp = db.table('audit_log').select('*').order('created_at', desc=True).limit(100).execute()
            return api_response(resp.data or [])
        except Exception:
            return api_response([])
    except Exception as e:
        logger.exception(f'Error in get_activity: {e}')
        return error_response('Internal server error', status_code=500)


@inventory_bp.get('/activity/stats')
def get_activity_stats():
    try:
        user = resolve_user()
        if not user:
            return error_response('Not authenticated', status_code=401)

        month = request.args.get('month', type=int)
        year = request.args.get('year', type=int)

        db = get_client()
        try:
            query = db.table('commit_changes').select('action, count').group_by('action')
            if month is not None:
                query = query.eq('month', month)
            if year is not None:
                query = query.eq('year', year)
            resp = query.execute()
            return api_response(resp.data or [])
        except Exception:
            return api_response([])
    except Exception as e:
        logger.exception(f'Error in get_activity_stats: {e}')
        return error_response('Internal server error', status_code=500)
