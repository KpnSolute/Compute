from flask import Blueprint, request

from backend.rbac import require_admin
from backend.response import api_response, error_response
from backend.supabase_client import get_client

settings_bp = Blueprint('settings', __name__, url_prefix='/api/settings')


@settings_bp.route('', methods=['GET'])
@require_admin
def get_settings():
    db = get_client()
    resp = db.table('app_settings').select('*').execute()
    settings = {row['setting_key']: row['setting_value'] for row in (resp.data or [])}
    if not settings:
        defaults = [
            {'setting_key': 'AI_PROVIDER', 'setting_value': 'ollama'},
            {'setting_key': 'AI_MODEL', 'setting_value': 'llama3.2:3b'},
            {'setting_key': 'AI_API_KEY', 'setting_value': ''},
        ]
        db.table('app_settings').insert(defaults).execute()
        settings = {d['setting_key']: d['setting_value'] for d in defaults}
    return api_response(settings)


@settings_bp.route('', methods=['PATCH'])
@require_admin
def update_settings():
    data = request.get_json(silent=True) or {}
    key = data.get('key')
    value = data.get('value')
    if not key:
        return error_response('key is required', status_code=400)
    db = get_client()
    db.table('app_settings').upsert(
        {
            'setting_key': key,
            'setting_value': value,
            'updated_by': request.current_user['id'],
            'updated_at': 'now()',
        }
    ).execute()
    return api_response({'key': key, 'value': value})
