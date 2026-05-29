import bcrypt as bcrypt_lib
from flask import Blueprint, jsonify, request, session

from backend.supabase_client import get_client

users_bp = Blueprint('users', __name__, url_prefix='/api/users')


def _require_admin():
    user = session.get('user')
    if not user or user['role'] not in ('admin', 'manager'):
        return None
    return user


def _require_superadmin():
    user = session.get('user')
    if not user or user['role'] != 'admin':
        return None
    return user


@users_bp.get('')
def list_users():
    user = _require_admin()
    if not user:
        return jsonify(error='Not authenticated or insufficient role'), 403

    db = get_client()
    resp = (
        db.table('user_profiles')
        .select('id, username, display_name, last_name, role, active, created_at')
        .order('created_at')
        .execute()
    )
    return jsonify(resp.data or [])


@users_bp.post('')
def create_user():
    user = _require_superadmin()
    if not user:
        return jsonify(error='Admin role required'), 403

    data = request.get_json(silent=True) or {}
    email = (data.get('email') or '').strip()
    password = data.get('password', '')
    username = (data.get('username') or '').strip()
    display_name = (data.get('display_name') or '').strip()
    last_name = (data.get('last_name') or '').strip()
    role = data.get('role', 'staff')
    pin = data.get('pin')

    if not email or not password or not username:
        return jsonify(error='email, password, and username are required'), 400
    if role not in ('admin', 'manager', 'assistant', 'staff'):
        return jsonify(error='role must be admin, manager, assistant, or staff'), 400

    db = get_client()

    try:
        auth_result = db.auth.admin.create_user(
            {
                'email': email,
                'password': password,
                'email_confirm': True,
            }
        )
        user_id = auth_result.user.id
    except Exception as e:
        return jsonify(error=f'Failed to create auth user: {str(e)}'), 400

    profile = {
        'id': user_id,
        'username': username,
        'display_name': display_name,
        'last_name': last_name if last_name else None,
        'role': role,
        'active': True,
    }

    if pin:
        profile['pin'] = bcrypt_lib.hashpw(str(pin).encode(), bcrypt_lib.gensalt()).decode()

    profile_resp = db.table('user_profiles').insert(profile).execute()
    return jsonify(profile_resp.data[0] if profile_resp.data else profile), 201


@users_bp.patch('/<user_id>')
def update_user(user_id):
    user = _require_superadmin()
    if not user:
        return jsonify(error='Admin role required'), 403

    data = request.get_json(silent=True) or {}
    allowed = {'display_name', 'last_name', 'role', 'active', 'pin', 'username'}
    updates = {k: v for k, v in data.items() if k in allowed}

    if 'role' in updates and updates['role'] not in ('admin', 'manager', 'assistant', 'staff'):
        return jsonify(error='role must be admin, manager, assistant, or staff'), 400

    if 'pin' in updates and updates['pin']:
        updates['pin'] = bcrypt_lib.hashpw(str(updates['pin']).encode(), bcrypt_lib.gensalt()).decode()

    if not updates:
        return jsonify(error='No valid fields to update'), 400

    db = get_client()

    password = data.get('password')
    if password:
        try:
            db.auth.admin.update_user_by_id(user_id, {'password': password})
        except Exception as e:
            return jsonify(error=f'Failed to update password: {str(e)}'), 400

    resp = db.table('user_profiles').update(updates).eq('id', user_id).execute()

    if not resp.data:
        return jsonify(error='User not found'), 404
    return jsonify(resp.data[0])


@users_bp.delete('/<user_id>')
def delete_user(user_id):
    user = _require_superadmin()
    if not user:
        return jsonify(error='Admin role required'), 403

    if user['id'] == user_id:
        return jsonify(error='Cannot delete your own account'), 400

    db = get_client()

    try:
        db.auth.admin.delete_user(user_id)
    except Exception as e:
        return jsonify(error=f'Failed to delete auth user: {str(e)}'), 400

    db.table('user_profiles').delete().eq('id', user_id).execute()

    return jsonify(success=True, message='User deleted'), 200


@users_bp.patch('/<user_id>/pin')
def reset_pin(user_id):
    user = _require_superadmin()
    if not user:
        return jsonify(error='Admin role required'), 403

    data = request.get_json(silent=True) or {}
    pin = data.get('pin')
    if not pin:
        return jsonify(error='PIN is required'), 400

    db = get_client()
    hashed = bcrypt_lib.hashpw(str(pin).encode(), bcrypt_lib.gensalt()).decode()
    resp = db.table('user_profiles').update({'pin': hashed}).eq('id', user_id).execute()

    if not resp.data:
        return jsonify(error='User not found'), 404
    return jsonify(success=True, message='PIN reset successfully')
