import logging

from flask import Blueprint, jsonify, request

from backend.auth_middleware import resolve_user
from backend.supabase_client import get_client

scanner_bp = Blueprint('scanner', __name__, url_prefix='/scanner')
logger = logging.getLogger(__name__)

DEFAULT_CENTER = '00000000-0000-0000-0000-000000000001'


@scanner_bp.post('/scan')
def scan():
    """
    Record a single barcode scan directly to inventory_master and transaction_history.
    Designed for keyboard-wedge and handheld scanners. Must respond in < 200ms.
    No AI, no XLSX, no external HTTP calls in this handler.
    """
    user = resolve_user()
    if not user:
        return jsonify(error='Not authenticated'), 401

    data = request.get_json(silent=True) or {}
    barcode = (data.get('barcode') or '').strip()
    action = (data.get('action') or '').strip()
    center_id = (data.get('center_id') or DEFAULT_CENTER).strip()

    if not barcode:
        return jsonify(error='barcode is required'), 400
    if action not in ('in', 'out'):
        return jsonify(error="action must be 'in' or 'out'"), 400

    try:
        quantity = float(data.get('quantity') or 1)
        if quantity <= 0:
            raise ValueError()
    except (TypeError, ValueError):
        return jsonify(error='quantity must be a positive number'), 400

    delta = quantity if action == 'in' else -quantity
    txn_action = 'scan_in' if action == 'in' else 'scan_out'

    try:
        db = get_client(admin=True)

        item_resp = (
            db.table('inventory_master')
            .select('id, item_name, quantity')
            .eq('center_id', center_id)
            .eq('barcode', barcode)
            .limit(1)
            .execute()
        )
        if not item_resp.data:
            return jsonify(error=f'Barcode {barcode} not found in inventory'), 404

        item = item_resp.data[0]
        current_qty = float(item['quantity'])
        new_qty = current_qty + delta

        if new_qty < 0:
            return jsonify(
                error=f'Cannot issue {quantity} units of {barcode} — only {int(current_qty)} in stock'
            ), 400

        db.table('inventory_master').update({
            'quantity': new_qty,
        }).eq('id', item['id']).execute()

        txn_resp = db.table('transaction_history').insert({
            'center_id': center_id,
            'barcode': barcode,
            'item_name': item['item_name'],
            'action': txn_action,
            'quantity_change': delta,
            'quantity_after': new_qty,
            'performed_by': user['id'],
        }).execute()

        txn = txn_resp.data[0] if txn_resp.data else {}

        return jsonify({
            'barcode': barcode,
            'item_name': item['item_name'],
            'action': action,
            'quantity_change': delta,
            'quantity_before': current_qty,
            'quantity_after': new_qty,
            'transaction_id': txn.get('id'),
            'timestamp': txn.get('created_at'),
        })

    except Exception as e:
        logger.exception(f'Error in scan endpoint: {e}')
        return jsonify(error='Internal server error'), 500
