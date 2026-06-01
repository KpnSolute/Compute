from flask import Blueprint, request

from backend.rbac import require_admin
from backend.response import api_response, error_response
from backend.supabase_client import get_client

settings_bp = Blueprint('settings', __name__, url_prefix='/api/settings')

_DEFAULTS = [
    {'setting_key': 'AI_PROVIDER', 'setting_value': 'ollama'},
    {'setting_key': 'AI_MODEL', 'setting_value': 'llama3.2:3b'},
    {'setting_key': 'AI_API_KEY', 'setting_value': ''},
]


@settings_bp.route('', methods=['GET'])
@require_admin
def get_settings():
    db = get_client()
    resp = db.table('app_settings').select('*').execute()
    # setting_value is jsonb — unwrap strings from JSON if needed
    settings = {}
    for row in (resp.data or []):
        v = row['setting_value']
        # jsonb strings come back as Python str already; dicts/lists stay as-is
        settings[row['setting_key']] = v
    if not settings:
        db.table('app_settings').insert(_DEFAULTS).execute()
        settings = {d['setting_key']: d['setting_value'] for d in _DEFAULTS}
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
