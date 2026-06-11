"""
User Management API Endpoints

Provides endpoints for managing user profiles, roles, and permissions.

Role hierarchy: staff(10) < assistant(20) < manager(30) < admin(40) < sudo(50)

Endpoints:
- GET  /api/users             - List all users (admin+)
- POST /api/users             - Create user (sudo only)
- GET  /api/users/me          - Get own profile (any auth)
- PUT  /api/users/me          - Update own profile (any auth, no role/username change)
- GET  /api/users/me/preferences - Get own preferences (any auth)
- PUT  /api/users/me/preferences - Update own preferences (any auth)
- GET  /api/users/{id}        - Get user (admin+)
- PUT  /api/users/{id}        - Update user (sudo only)
- DELETE /api/users/{id}      - Disable user (sudo only)
"""

import json
import secrets
from datetime import datetime, timezone
from urllib import request
from urllib.error import HTTPError

from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from backend.routes import (
    SUPABASE_SERVICE_KEY,
    SUPABASE_URL,
    jwt_validator,
    supabase_service,
)

router = APIRouter(prefix='/api/users', tags=['users'])

ROLE_LEVEL = {'staff': 10, 'assistant': 20, 'manager': 30, 'admin': 40, 'sudo': 50}


# ── request / response models ─────────────────────────────────────────────────

class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    display_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(default='', max_length=100)
    role: str = Field('staff', pattern='^(admin|manager|assistant|staff|sudo)$')
    pin: str = Field(default='', max_length=10)
    password: str | None = Field(None, min_length=8, max_length=128)


class UserUpdateRequest(BaseModel):
    display_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    role: str | None = Field(None, pattern='^(admin|manager|assistant|staff|sudo)$')
    pin: str | None = Field(None, max_length=10)
    active: bool | None = None
    phone: str | None = Field(None, max_length=20)
    job_title: str | None = Field(None, max_length=100)
    bio: str | None = Field(None, max_length=500)
    avatar_url: str | None = Field(None, max_length=500)


class UserSelfUpdateRequest(BaseModel):
    """Self-service profile update — cannot change role, username, email, or active."""
    display_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    phone: str | None = Field(None, max_length=20)
    job_title: str | None = Field(None, max_length=100)
    bio: str | None = Field(None, max_length=500)
    avatar_url: str | None = Field(None, max_length=500)


class UserPrefsRequest(BaseModel):
    theme: str | None = None


class UserResponse(BaseModel):
    model_config = ConfigDict(extra='ignore')

    id: str
    username: str
    email: str | None = None
    display_name: str
    last_name: str | None = None
    role: str
    active: bool
    created_at: str | None = None
    updated_at: str | None = None
    phone: str | None = None
    job_title: str | None = None
    avatar_url: str | None = None
    bio: str | None = None


class UsersListResponse(BaseModel):
    count: int
    users: list[UserResponse]


# ── helpers ───────────────────────────────────────────────────────────────────

async def _get_user_by_id(user_id: str) -> dict | None:
    try:
        result = (
            supabase_service.table('user_profiles')
            .select('*')
            .eq('id', user_id)
            .single()
            .execute()
        )
        return result.data if result.data else None
    except Exception:
        return None


async def _user_exists(username: str, exclude_id: str | None = None) -> bool:
    try:
        query = supabase_service.table('user_profiles').select('id').eq('username', username)
        if exclude_id:
            query = query.neq('id', exclude_id)
        result = query.limit(1).execute()
        return bool(result.data)
    except Exception:
        return False


def _create_auth_user(email: str, password: str, metadata: dict) -> str:
    payload = json.dumps(
        {
            'email': email,
            'password': password,
            'email_confirm': True,
            'user_metadata': metadata,
        }
    ).encode('utf-8')
    req = request.Request(
        f'{SUPABASE_URL}/auth/v1/admin/users',
        data=payload,
        method='POST',
        headers={
            'Authorization': f'Bearer {SUPABASE_SERVICE_KEY}',
            'Content-Type': 'application/json',
        },
    )
    try:
        with request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except HTTPError as e:
        body = e.read().decode('utf-8', errors='replace')
        raise HTTPException(status_code=400, detail=f'Auth user create failed: {body}')
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Auth user create failed: {str(e)}')

    user_id = data.get('id')
    if not user_id:
        raise HTTPException(status_code=500, detail='Auth user create failed: missing id')
    return user_id


# ── auth dependencies ─────────────────────────────────────────────────────────

async def _resolve_jwt_user(authorization: str) -> dict:
    """Validate a JWT Bearer token and return the user profile."""
    token = authorization.replace('Bearer ', '') if authorization else ''
    if not token:
        raise HTTPException(status_code=401, detail='Missing authorization token')
    if token.startswith('pin_'):
        raise HTTPException(status_code=403, detail='This endpoint requires Supabase Auth token, not PIN')
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail='Invalid or expired token')
    user_id = claims.get('sub')
    if not user_id:
        raise HTTPException(status_code=401, detail='Token missing user ID')
    try:
        result = (
            supabase_service.table('user_profiles')
            .select('*')
            .eq('id', user_id)
            .single()
            .execute()
        )
        user = result.data if result.data else None
    except Exception:
        raise HTTPException(status_code=500, detail='Database error fetching user')
    if not user:
        raise HTTPException(status_code=401, detail='User profile not found')
    if not user.get('active'):
        raise HTTPException(status_code=401, detail='User account is inactive')
    return user


async def _require_any_auth(authorization: str = Header('')) -> dict:
    """Accept any valid token — JWT (admin/manager/sudo) or pin_ (staff)."""
    token = authorization.replace('Bearer ', '') if authorization else ''
    if not token:
        raise HTTPException(status_code=401, detail='Missing authorization token')

    if token.startswith('pin_'):
        user_id = token[4:]
        user = await _get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=401, detail='Invalid session')
        if not user.get('active'):
            raise HTTPException(status_code=401, detail='User account is inactive')
        return user

    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail='Invalid or expired token')
    user_id = claims.get('sub')
    if not user_id:
        raise HTTPException(status_code=401, detail='Token missing user ID')
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail='User profile not found')
    if not user.get('active'):
        raise HTTPException(status_code=401, detail='User account is inactive')
    return user


async def _require_admin(authorization: str = Header('')) -> dict:
    """Require admin OR sudo role — read access to user management."""
    user = await _resolve_jwt_user(authorization)
    if ROLE_LEVEL.get(user.get('role', ''), 0) < 40:
        raise HTTPException(status_code=403, detail='This endpoint requires admin or sudo role')
    return user


async def _require_sudo(authorization: str = Header('')) -> dict:
    """Require sudo role — write access to user management."""
    user = await _resolve_jwt_user(authorization)
    if user.get('role') != 'sudo':
        raise HTTPException(status_code=403, detail='This endpoint requires sudo role')
    return user


# ── /me routes (must appear before /{user_id} to avoid path collision) ────────

@router.get('/me', response_model=UserResponse)
async def get_my_profile(current_user: dict = Depends(_require_any_auth)):
    """Return the calling user's full profile."""
    return UserResponse(**current_user)


@router.put('/me', response_model=UserResponse)
async def update_my_profile(req: UserSelfUpdateRequest, current_user: dict = Depends(_require_any_auth)):
    """Self-service profile update — cannot change role, username, email, or active status."""
    update_data: dict = {}
    if req.display_name is not None:
        update_data['display_name'] = req.display_name
    if req.last_name is not None:
        update_data['last_name'] = req.last_name
    if req.phone is not None:
        update_data['phone'] = req.phone
    if req.job_title is not None:
        update_data['job_title'] = req.job_title
    if req.bio is not None:
        update_data['bio'] = req.bio
    if req.avatar_url is not None:
        update_data['avatar_url'] = req.avatar_url

    if not update_data:
        return UserResponse(**current_user)

    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()
    try:
        result = (
            supabase_service.table('user_profiles')
            .update(update_data)
            .eq('id', current_user['id'])
            .execute()
        )
        updated = result.data[0] if result.data else None
        if not updated:
            raise HTTPException(status_code=500, detail='Failed to update profile')
        return UserResponse(**updated)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')


@router.get('/me/preferences')
async def get_user_preferences(current_user: dict = Depends(_require_any_auth)):
    """Return the calling user's saved preferences from app_settings."""
    key = f"user_prefs_{current_user['id']}"
    try:
        result = (
            supabase_service.table('app_settings')
            .select('setting_value')
            .eq('setting_key', key)
            .limit(1)
            .execute()
        )
        if result.data:
            raw = result.data[0]['setting_value']
            return raw if isinstance(raw, dict) else {}
        return {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')


@router.put('/me/preferences')
async def update_user_preferences(req: UserPrefsRequest, current_user: dict = Depends(_require_any_auth)):
    """Upsert the calling user's preferences into app_settings."""
    key = f"user_prefs_{current_user['id']}"
    prefs: dict = {}
    if req.theme is not None:
        prefs['theme'] = req.theme

    try:
        existing = (
            supabase_service.table('app_settings')
            .select('setting_value')
            .eq('setting_key', key)
            .limit(1)
            .execute()
        )
        now = datetime.now(timezone.utc).isoformat()
        if existing.data:
            current_prefs = existing.data[0]['setting_value'] or {}
            current_prefs.update(prefs)
            supabase_service.table('app_settings').update(
                {'setting_value': current_prefs, 'updated_at': now}
            ).eq('setting_key', key).execute()
            return current_prefs
        else:
            supabase_service.table('app_settings').insert(
                {
                    'setting_key': key,
                    'setting_value': prefs,
                    'updated_by': current_user['id'],
                    'updated_at': now,
                }
            ).execute()
            return prefs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')


# ── collection routes ─────────────────────────────────────────────────────────

@router.get('', response_model=UsersListResponse)
async def list_users(active_only: bool = False, admin_user: dict = Depends(_require_admin)):
    """List all users. Requires admin or sudo role."""
    try:
        query = supabase_service.table('user_profiles').select('*')
        if active_only:
            query = query.eq('active', True)
        result = query.order('created_at', desc=True).execute()
        users = result.data if result.data else []
        return UsersListResponse(count=len(users), users=[UserResponse(**u) for u in users])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')


@router.post('', response_model=UserResponse, status_code=201)
async def create_user(req: UserCreateRequest, admin_user: dict = Depends(_require_sudo)):
    """Create a new user account. Requires sudo role."""
    exists = await _user_exists(req.username)
    if exists:
        raise HTTPException(status_code=400, detail='Username already exists')

    try:
        email_check = (
            supabase_service.table('user_profiles')
            .select('id')
            .eq('email', req.email)
            .limit(1)
            .execute()
        )
        if email_check.data:
            raise HTTPException(status_code=400, detail='Email already registered')
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')

    if req.pin and not req.pin.isdigit():
        raise HTTPException(status_code=400, detail='PIN must be numeric')

    now = datetime.now(timezone.utc).isoformat()

    try:
        password = req.password or secrets.token_urlsafe(18)
        auth_user_id = _create_auth_user(
            str(req.email),
            password,
            {
                'username': req.username,
                'display_name': req.display_name,
                'last_name': req.last_name,
                'role': req.role,
            },
        )
        result = (
            supabase_service.table('user_profiles')
            .insert(
                {
                    'id': auth_user_id,
                    'username': req.username,
                    'email': str(req.email),
                    'display_name': req.display_name,
                    'last_name': req.last_name,
                    'role': req.role,
                    'pin': req.pin or None,
                    'active': True,
                    'created_at': now,
                    'updated_at': now,
                }
            )
            .execute()
        )
        user = result.data[0] if result.data else None
        if not user:
            raise HTTPException(status_code=500, detail='Failed to create user')
        return UserResponse(**user)

    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')


# ── per-user routes ───────────────────────────────────────────────────────────

@router.get('/{user_id}', response_model=UserResponse)
async def get_user(user_id: str, admin_user: dict = Depends(_require_admin)):
    """Get a specific user's profile. Requires admin or sudo role."""
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    return UserResponse(**user)


@router.put('/{user_id}', response_model=UserResponse)
async def update_user(user_id: str, req: UserUpdateRequest, admin_user: dict = Depends(_require_sudo)):
    """Update a user's profile. Requires sudo role."""
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    if req.role == 'sudo' and admin_user.get('role') != 'sudo':
        raise HTTPException(status_code=403, detail='Only a sudo user can grant the sudo role')

    update_data: dict = {}
    if req.display_name is not None:
        update_data['display_name'] = req.display_name
    if req.last_name is not None:
        update_data['last_name'] = req.last_name
    if req.role is not None:
        update_data['role'] = req.role
    if req.pin is not None:
        if req.pin and not req.pin.isdigit():
            raise HTTPException(status_code=400, detail='PIN must be numeric')
        update_data['pin'] = req.pin or None
    if req.active is not None:
        update_data['active'] = req.active
    if req.phone is not None:
        update_data['phone'] = req.phone
    if req.job_title is not None:
        update_data['job_title'] = req.job_title
    if req.bio is not None:
        update_data['bio'] = req.bio
    if req.avatar_url is not None:
        update_data['avatar_url'] = req.avatar_url

    if not update_data:
        return UserResponse(**user)

    update_data['updated_at'] = datetime.now(timezone.utc).isoformat()

    try:
        result = (
            supabase_service.table('user_profiles')
            .update(update_data)
            .eq('id', user_id)
            .execute()
        )
        updated_user = result.data[0] if result.data else None
        if not updated_user:
            raise HTTPException(status_code=500, detail='Failed to update user')
        return UserResponse(**updated_user)

    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')


@router.delete('/{user_id}', status_code=204)
async def disable_user(user_id: str, admin_user: dict = Depends(_require_sudo)):
    """Disable (soft-delete) a user account. Requires sudo role."""
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    if admin_user.get('id') == user_id:
        raise HTTPException(status_code=400, detail='Cannot disable your own account')

    try:
        supabase_service.table('user_profiles').update(
            {'active': False, 'updated_at': datetime.now(timezone.utc).isoformat()}
        ).eq('id', user_id).execute()
        return None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')
