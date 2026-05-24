import logging
from functools import wraps

from flask import jsonify, request, session

from backend.supabase_client import get_client

logger = logging.getLogger(__name__)

profile_cache = {}


def _get_profile_by_email(email: str) -> dict | None:
    if email in profile_cache:
        return profile_cache[email]

    username = email.replace('@mjc-cafeteria.com', '').replace('@mjc.local', '')
    try:
        admin = get_client(admin=True)
        result = admin.table('user_profiles') \
            .select('id, username, display_name, role, active') \
            .eq('username', username) \
            .single() \
            .execute()
        if result.data:
            profile_cache[email] = result.data
            return result.data
    except Exception as e:
        logger.warning(f"Failed to get profile by username for email {email}: {e}")

    try:
        admin = get_client(admin=True)
        result = admin.table('user_profiles') \
            .select('id, username, display_name, role, active') \
            .eq('email', email) \
            .single() \
            .execute()
        if result.data:
            profile_cache[email] = result.data
            return result.data
    except Exception as e:
        logger.warning(f"Failed to get profile by email for email {email}: {e}")

    return None


def resolve_user() -> dict | None:
    user = session.get('user')
    if user:
        return user

    auth_header = request.headers.get('Authorization', '')
    if not auth_header.startswith('Bearer '):
        return None

    token = auth_header[7:]
    try:
        client = get_client()
        resp = client.auth.get_user(token)
        if not resp or not resp.user:
            logger.warning("Invalid or expired token")
            return None

        email = (resp.user.email or '').strip().lower()
        if not email:
            logger.warning("No email in token")
            return None

        profile = _get_profile_by_email(email)
        if not profile or not profile.get('active'):
            logger.warning(f"Inactive or non-existent profile for email {email}")
            return None

        return {
            'id': profile['id'],
            'username': profile['username'],
            'display_name': profile.get('display_name', ''),
            'role': profile['role'],
            'access_token': token,
        }
    except Exception as e:
        logger.exception(f"Error resolving user from token: {e}")
        return None


def require_user(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        request.current_user = user
        return f(*args, **kwargs)
    return wrapper


def require_admin(f):
    @wraps(f)
    def wrapper(*args, **kwargs):
        user = resolve_user()
        if not user:
            return jsonify(error='Not authenticated'), 401
        if user['role'] not in ('admin', 'manager'):
            return jsonify(error='Insufficient role'), 403
        request.current_user = user
        return f(*args, **kwargs)
    return wrapper
