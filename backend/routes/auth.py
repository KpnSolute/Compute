from flask import Blueprint, request, session, jsonify
from backend.supabase_client import get_client

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')


def _get_profile(username: str) -> dict | None:
    try:
        admin = get_client(admin=True)
        result = admin.table('user_profiles') \
            .select('id, username, display_name, role, pin, active') \
            .eq('username', username) \
            .single() \
            .execute()
        return result.data
    except Exception:
        return None


def _build_email(username: str) -> str:
    if username == 'sudo':
        return 'sudo@mjc.local'
    return f'{username}@mjc-cafeteria.com'


@auth_bp.post('/login')
def login():
    data = request.get_json(silent=True) or {}
    username   = (data.get('username') or '').strip().lower()
    login_type = (data.get('type') or '').strip()

    if not username:
        return jsonify(error='Username is required.'), 400

    profile = _get_profile(username)

    if not profile:
        return jsonify(error='Username not recognised.'), 401
    if not profile.get('active'):
        return jsonify(error='Account is disabled.'), 403

    # ── STAFF PIN FLOW ────────────────────────────────────────
    if login_type == 'staff':
        if profile['role'] != 'staff':
            return jsonify(
                error='Admin and manager accounts must use the Admin / Manager login.'
            ), 401
        pin = str(data.get('pin') or '').strip()
        if not pin:
            return jsonify(error='PIN is required.'), 400
        if pin != str(profile.get('pin') or ''):
            return jsonify(error='Incorrect PIN. Please try again.'), 401

        session['user'] = {
            'id':           profile['id'],
            'username':     profile['username'],
            'display_name': profile.get('display_name', ''),
            'role':         profile['role'],
        }
        return jsonify(
            ok=True,
            user={
                'username':     profile['username'],
                'display_name': profile.get('display_name', ''),
                'role':         profile['role'],
            }
        )

    # ── ADMIN / MANAGER PASSWORD FLOW ────────────────────────
    elif login_type == 'admin':
        if profile['role'] not in ('admin', 'manager'):
            return jsonify(
                error='Staff accounts must use the Staff login.'
            ), 401
        password = str(data.get('password') or '').strip()
        if not password:
            return jsonify(error='Password is required.'), 400

        try:
            client = get_client()
            email  = _build_email(username)
            result = client.auth.sign_in_with_password({
                'email':    email,
                'password': password,
            })
            access_token = result.session.access_token
            session['user'] = {
                'id':           profile['id'],
                'username':     profile['username'],
                'display_name': profile.get('display_name', ''),
                'role':         profile['role'],
                'access_token': access_token,
            }
            return jsonify(
                ok=True,
                access_token=access_token,
                user={
                    'username':     profile['username'],
                    'display_name': profile.get('display_name', ''),
                    'role':         profile['role'],
                }
            )
        except Exception:
            return jsonify(error='Incorrect password. Please try again.'), 401

    else:
        return jsonify(error='Invalid login type.'), 400


@auth_bp.get('/me')
def me():
    user = session.get('user')
    if not user:
        return jsonify(authenticated=False), 401
    return jsonify(
        authenticated=True,
        user={
            'username':     user.get('username'),
            'display_name': user.get('display_name'),
            'role':         user.get('role'),
        }
    )


@auth_bp.post('/logout')
def logout():
    session.clear()
    return jsonify(ok=True)
