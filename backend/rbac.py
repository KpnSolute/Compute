import time
from functools import wraps

import bcrypt
from flask import jsonify, request, session

from backend.supabase_client import get_client

ROLES = {
    'staff': 10,
    'assistant': 20,
    'manager': 30,
    'admin': 40,
}


def hash_pin(pin: str) -> str:
    return bcrypt.hashpw(pin.encode(), bcrypt.gensalt()).decode()


def verify_pin(plain: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(plain.encode(), hashed.encode())
    except Exception:
        return plain == hashed


_profile_cache = {}


def resolve_user() -> dict | None:
    user = session.get('user')
    if user:
        return user

    auth_header = request.headers.get('Authorization', '')
    if auth_header.startswith('Bearer '):
        token = auth_header[7:]
        try:
            client = get_client()
            resp = client.auth.get_user(token)
            if resp and resp.user and resp.user.email:
                email = resp.user.email.strip().lower()
                username = email.split('@')[0]
                now = time.time()
                if username in _profile_cache:
                    profile, expiry = _profile_cache[username]
                    if now < expiry and profile.get('active'):
                        return profile
                db = get_client()
                result = db.table('user_profiles').select('*').eq('username', username).single().execute()
                if result.data and result.data.get('active'):
                    prof = {
                        'id': result.data['id'],
                        'username': result.data['username'],
                        'display_name': result.data.get('display_name', ''),
                        'last_name': result.data.get('last_name', ''),
                        'role': result.data['role'],
                        'access_token': token,
                    }
                    _profile_cache[username] = (prof, now + 300)
                    return prof
        except Exception:
            return None
    return None


def require_user(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = resolve_user()
        if not user:
            return jsonify({'data': None, 'error': 'Not authenticated'}), 401
        request.current_user = user
        return f(*args, **kwargs)

    return wrapper


def require_role(min_level):
    def decorator(f):
        @wraps(f)
        def wrapper(*args, **kwargs):
            user = resolve_user()
            if not user:
                return jsonify({'data': None, 'error': 'Not authenticated'}), 401
            if ROLES.get(user.get('role', ''), 0) < min_level:
                return jsonify({'data': None, 'error': 'Insufficient role'}), 403
            request.current_user = user
            return f(*args, **kwargs)

        return wrapper

    return decorator


require_staff = require_role(10)
require_assistant = require_role(20)
require_manager = require_role(30)
require_admin = require_role(40)
