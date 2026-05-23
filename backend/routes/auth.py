from flask import Blueprint, request, session, jsonify
from backend.supabase_client import get_client

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')


@auth_bp.post('/login')
def login():
    data = request.get_json(silent=True) or {}
    email    = (data.get('email') or '').strip()
    password = (data.get('password') or '').strip()

    if not email or not password:
        return jsonify(error='Email and password are required.'), 400

    try:
        client = get_client()
        result = client.auth.sign_in_with_password({
            'email': email,
            'password': password
        })
        user_id = result.user.id

        profile = client.table('user_profiles') \
            .select('username, display_name, role, active') \
            .eq('id', user_id) \
            .single() \
            .execute()

        if not profile.data:
            return jsonify(error='User profile not found.'), 403

        if not profile.data.get('active', True):
            return jsonify(error='Account is disabled.'), 403

        session['user'] = {
            'id':           user_id,
            'email':        email,
            'username':     profile.data['username'],
            'display_name': profile.data.get('display_name', ''),
            'role':         profile.data['role'],
            'access_token': result.session.access_token,
        }

        return jsonify(
            ok=True,
            user={
                'username':     profile.data['username'],
                'display_name': profile.data.get('display_name', ''),
                'role':         profile.data['role'],
            }
        )

    except Exception as e:
        return jsonify(error=str(e)), 401


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
