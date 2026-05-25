from flask import Blueprint, jsonify, request, session

from backend.supabase_client import get_client

users_bp = Blueprint('users', __name__, url_prefix='/api/users')


def _require_admin():
    """Returns the session user if they are manager or admin, else None."""
    user = session.get('user')
    if not user or user['role'] not in ('admin', 'manager'):
        return None
    return user


def _require_superadmin():
    """Returns the session user if they are admin only, else None."""
    user = session.get('user')
    if not user or user['role'] != 'admin':
        return None
    return user


@users_bp.get('')
def list_users():
    user = _require_admin()
    if not user:
        return jsonify(error='Not authenticated or insufficient role'), 403

    db = get_client(admin=True)
    query = db.table('user_profiles').select('id, username, display_name, role, active, created_at').order('created_at')

    # Managers only see staff — they cannot view other managers or admins
    if user['role'] == 'manager':
        query = query.eq('role', 'staff')

    resp = query.execute()
    return jsonify(resp.data or [])


@users_bp.post('')
def create_user():
    """
    Create a user account.

    Admin: can create staff, manager, or admin accounts.
    Manager: can create staff accounts only (PIN-based, no Supabase Auth account needed).

    Staff accounts use PIN login only — no email or password is required.
    Admin/Manager accounts require email + password for Supabase Auth.
    """
    caller = _require_admin()
    if not caller:
        return jsonify(error='Not authenticated or insufficient role'), 403

    data = request.get_json(silent=True) or {}
    username = (data.get('username') or '').strip().lower()
    display_name = (data.get('display_name') or '').strip()
    role = (data.get('role') or 'staff').strip()
    pin = data.get('pin')

    if not username:
        return jsonify(error='username is required'), 400

    if caller['role'] == 'manager':
        # Managers can only create staff accounts
        if role != 'staff':
            return jsonify(error='Managers can only create staff accounts'), 403
        if not pin:
            return jsonify(error='pin is required for staff accounts'), 400

        db = get_client(admin=True)
        profile = {
            'username': username,
            'display_name': display_name,
            'role': 'staff',
            'pin': str(pin),
            'active': True,
        }
        try:
            resp = db.table('user_profiles').insert(profile).execute()
            return jsonify(resp.data[0] if resp.data else profile), 201
        except Exception as e:
            return jsonify(error=f'Failed to create staff account: {str(e)}'), 400

    # Admin path — can create any role
    if role not in ('admin', 'manager', 'staff'):
        return jsonify(error='role must be admin, manager, or staff'), 400

    if role == 'staff':
        # Staff: PIN only, no Supabase Auth account
        if not pin:
            return jsonify(error='pin is required for staff accounts'), 400

        db = get_client(admin=True)
        profile = {
            'username': username,
            'display_name': display_name,
            'role': 'staff',
            'pin': str(pin),
            'active': True,
        }
        try:
            resp = db.table('user_profiles').insert(profile).execute()
            return jsonify(resp.data[0] if resp.data else profile), 201
        except Exception as e:
            return jsonify(error=f'Failed to create staff account: {str(e)}'), 400

    # Admin/Manager accounts require Supabase Auth
    email = (data.get('email') or '').strip()
    password = data.get('password', '')
    if not email or not password:
        return jsonify(error='email and password are required for admin/manager accounts'), 400

    db = get_client(admin=True)
    try:
        auth_result = db.auth.admin.create_user({
            'email': email,
            'password': password,
            'email_confirm': True,
        })
        user_id = auth_result.user.id
    except Exception as e:
        return jsonify(error=f'Failed to create auth user: {str(e)}'), 400

    profile = {
        'id': user_id,
        'username': username,
        'display_name': display_name,
        'role': role,
        'pin': str(pin) if pin else None,
        'active': True,
    }
    resp = db.table('user_profiles').insert(profile).execute()
    return jsonify(resp.data[0] if resp.data else profile), 201


@users_bp.patch('/<user_id>')
def update_user(user_id):
    """
    Update a user.

    Admin: can update any user, any field (display_name, role, active, pin).
    Manager: can update staff only, and only display_name, active, pin.
             Cannot change a staff member's role.
    """
    caller = _require_admin()
    if not caller:
        return jsonify(error='Not authenticated or insufficient role'), 403

    data = request.get_json(silent=True) or {}
    db = get_client(admin=True)

    # Fetch the target user to check their role
    target_resp = db.table('user_profiles').select('role').eq('id', user_id).limit(1).execute()
    if not target_resp.data:
        return jsonify(error='User not found'), 404
    target_role = target_resp.data[0]['role']

    if caller['role'] == 'manager':
        # Managers can only touch staff accounts
        if target_role != 'staff':
            return jsonify(error='Managers can only modify staff accounts'), 403
        allowed = {'display_name', 'active', 'pin'}
        updates = {k: v for k, v in data.items() if k in allowed}
    else:
        # Admin can update any field
        allowed = {'display_name', 'role', 'active', 'pin'}
        updates = {k: v for k, v in data.items() if k in allowed}
        if 'role' in updates and updates['role'] not in ('admin', 'manager', 'staff'):
            return jsonify(error='role must be admin, manager, or staff'), 400

    if not updates:
        return jsonify(error='No valid fields to update'), 400

    if 'pin' in updates and updates['pin'] is not None:
        updates['pin'] = str(updates['pin'])

    resp = db.table('user_profiles').update(updates).eq('id', user_id).execute()
    if not resp.data:
        return jsonify(error='User not found'), 404
    return jsonify(resp.data[0])
