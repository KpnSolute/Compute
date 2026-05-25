import logging

from flask import Blueprint, jsonify, request

from backend.auth_middleware import resolve_user
from backend.supabase_client import get_client

inventory_bp = Blueprint('v1_inventory', __name__, url_prefix='/inventory')
logger = logging.getLogger(__name__)

DEFAULT_CENTER = '00000000-0000-0000-0000-000000000001'


@inventory_bp.get('')
def list_inventory():
    """
    Read-only view of inventory_master. Used by the staff portal.
    Returns current quantities — not monthly tracking data.
    """
    user = resolve_user()
    if not user:
        return jsonify(error='Not authenticated'), 401

    center_id = (request.args.get('center_id') or DEFAULT_CENTER).strip()
    category = request.args.get('category', '').strip() or None
    active_only = request.args.get('active_only', 'true').lower() != 'false'
    low_stock = request.args.get('low_stock', 'false').lower() == 'true'
    search = request.args.get('search', '').strip().lower()

    try:
        page = max(1, int(request.args.get('page') or 1))
        per_page = min(500, max(1, int(request.args.get('per_page') or 50)))
    except (TypeError, ValueError):
        page, per_page = 1, 50

    try:
        db = get_client()
        query = (
            db.table('inventory_master')
            .select('*')
            .eq('center_id', center_id)
            .order('item_name')
        )
        if active_only:
            query = query.eq('active', True)
        if category:
            query = query.eq('category', category)

        resp = query.execute()
        items = resp.data or []

        if search:
            items = [
                i for i in items
                if search in (i.get('item_name') or '').lower()
                or search in (i.get('barcode') or '').lower()
                or search in (i.get('sku') or '').lower()
            ]

        if low_stock:
            items = [
                i for i in items
                if float(i.get('par_level') or 0) > 0
                and float(i.get('quantity') or 0) < float(i.get('par_level') or 0)
            ]

        total_count = len(items)
        offset = (page - 1) * per_page
        page_items = items[offset: offset + per_page]

        return jsonify({
            'items': page_items,
            'pagination': {
                'page': page,
                'per_page': per_page,
                'total_count': total_count,
                'total_pages': max(1, (total_count + per_page - 1) // per_page),
                'has_next': offset + per_page < total_count,
                'has_prev': page > 1,
            },
        })

    except Exception as e:
        logger.exception(f'Error in v1 inventory endpoint: {e}')
        return jsonify(error='Internal server error'), 500
