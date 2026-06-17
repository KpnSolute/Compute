"""Shared FastAPI dependencies for MJCC routes — auth resolution and role guards."""

from fastapi import Header, HTTPException, Depends
from backend.routes import supabase_service, jwt_validator

ROLE_LEVEL = {'staff': 10, 'assistant': 20, 'manager': 30, 'admin': 40, 'sudo': 50}


def _get_auth_user(authorization: str = Header('')) -> dict:
    """Resolve caller from Bearer token (JWT or pin_). Raises 401 if missing or invalid."""
    token = (authorization or '').replace('Bearer ', '').strip()
    if not token:
        raise HTTPException(status_code=401, detail='Missing authorization token')
    if token.startswith('pin_'):
        user_id = token[4:]
        try:
            r = (
                supabase_service.table('user_profiles')
                .select('id,role,active')
                .eq('id', user_id)
                .eq('active', True)
                .limit(1)
                .execute()
            )
        except Exception:
            raise HTTPException(status_code=401, detail='Invalid session')
        if not r.data:
            raise HTTPException(status_code=401, detail='Invalid session')
        return r.data[0]
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail='Invalid or expired token')
    user_id = claims.get('sub')
    if not user_id:
        raise HTTPException(status_code=401, detail='Token missing user ID')
    try:
        r = (
            supabase_service.table('user_profiles')
            .select('id,role,active')
            .eq('id', user_id)
            .eq('active', True)
            .limit(1)
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=401, detail='User not found or inactive')
    if not r.data:
        raise HTTPException(status_code=401, detail='User not found or inactive')
    return r.data[0]


def _require_admin_or_manager(auth_user: dict = Depends(_get_auth_user)) -> dict:
    if auth_user.get('role') not in ('admin', 'manager', 'sudo'):
        raise HTTPException(status_code=403, detail='Admin or manager role required')
    return auth_user


# alias — same threshold (manager, admin, sudo all qualify)
_require_manager = _require_admin_or_manager
