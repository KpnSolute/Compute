import logging

from flask import Blueprint, jsonify, request

from backend import calculators
from backend.auth_middleware import resolve_user
from backend.supabase_client import get_client

analytics_bp = Blueprint('analytics', __name__, url_prefix='/analytics')
logger = logging.getLogger(__name__)

_ALLOWED_ROLES = ('admin', 'manager', 'corporate')


def _auth(f):
    from functools import wraps

    @wraps(f)
    def wrapper(*args, **kwargs):
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if user['role'] not in _ALLOWED_ROLES:
            return jsonify(error='Insufficient role'), 403
        request.current_user = user
        return f(*args, **kwargs)

    return wrapper


def _parse_month_year():
    month = request.args.get('month', type=int)
    year = request.args.get('year', type=int)
    if month is None or year is None:
        return None, None, (jsonify(error='month and year are required'), 400)
    if not (0 <= month <= 11 and 2020 <= year <= 2030):
        return None, None, (jsonify(error='month must be 0-11, year must be 2020-2030'), 400)
    return month, year, None


@analytics_bp.get('/screening')
@_auth
def screening():
    """
    Adaptive Screening report. Compares current month against prior month and
    returns a ranked list of items that need manager or corporate attention.

    Triggers: below_par, demand_spike, demand_drop, price_change, low_supply.
    Items with multiple triggers appear first.
    """
    month, year, err = _parse_month_year()
    if err:
        return err

    demand_threshold = request.args.get('demand_threshold', type=float, default=25.0)
    low_supply_weeks = request.args.get('low_supply_weeks', type=float, default=2.0)
    category = request.args.get('category')

    prior_month = month - 1 if month > 0 else 11
    prior_year = year if month > 0 else year - 1

    try:
        db = get_client()

        cur_q = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year)
        pri_q = db.table('dashboard_summary').select('*').eq('month', prior_month).eq('year', prior_year)
        if category:
            cur_q = cur_q.eq('category', category)
            pri_q = pri_q.eq('category', category)

        current = cur_q.execute().data or []
        prior = pri_q.execute().data or []

        result = calculators.adaptive_screening(current, prior, demand_threshold, low_supply_weeks)
        result['period'] = {'month': month, 'year': year}
        result['prior_period'] = {'month': prior_month, 'year': prior_year}
        result['parameters'] = {
            'demand_threshold_pct': demand_threshold,
            'low_supply_weeks': low_supply_weeks,
        }
        return jsonify(result)
    except Exception as e:
        logger.exception(f'Error in screening endpoint: {e}')
        return jsonify(error='Internal server error'), 500


@analytics_bp.get('/demand')
@_auth
def demand():
    """
    Per-item demand and cost metrics for a given month.
    Returns issued_rate, received_rate, weeks_of_supply, consumption_cost,
    receive_cost, suggested_par, and full row-level metrics for every item.
    Sorted by consumption_cost descending (highest-cost items first).
    """
    month, year, err = _parse_month_year()
    if err:
        return err

    category = request.args.get('category')

    try:
        db = get_client()
        query = db.table('dashboard_summary').select('*').eq('month', month).eq('year', year)
        if category:
            query = query.eq('category', category)
        items = query.execute().data or []

        rows = []
        for item in items:
            m = calculators.item_metrics(item)
            rows.append({
                'item_id': item.get('item_id'),
                'description': item.get('description'),
                'category': item.get('category'),
                'barcode': item.get('barcode_id'),
                **m,
            })

        rows.sort(key=lambda x: x['consumption_cost'], reverse=True)

        totals = {
            'total_items': len(rows),
            'total_consumption_cost': round(sum(r['consumption_cost'] for r in rows), 2),
            'total_receive_cost': round(sum(r['receive_cost'] for r in rows), 2),
            'items_below_par': sum(
                1 for r in rows if r['par_level'] > 0 and r['ending_qty'] < r['par_level']
            ),
            'items_with_demand': sum(1 for r in rows if r['issued_rate'] > 0),
        }

        return jsonify({'period': {'month': month, 'year': year}, 'totals': totals, 'items': rows})
    except Exception as e:
        logger.exception(f'Error in demand endpoint: {e}')
        return jsonify(error='Internal server error'), 500
