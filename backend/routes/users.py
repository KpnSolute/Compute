"""
User Management API Endpoints

Provides endpoints for managing user profiles, roles, and permissions.
All endpoints require admin role authentication.

Endpoints:
- GET /api/users - List all users
- POST /api/users - Create new user
- PUT /api/users/{user_id} - Update user profile
- DELETE /api/users/{user_id} - Disable user
- GET /api/users/{user_id} - Get user details
"""

from datetime import datetime
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel, EmailStr, Field
from backend.routes import supabase, jwt_validator

router = APIRouter(prefix='/api/users', tags=['users'])


class UserCreateRequest(BaseModel):
    """Request model for creating a new user."""
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    display_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(default='', max_length=100)
    role: str = Field('staff', pattern='^(admin|manager|staff)$')
    pin: str = Field(default='', max_length=10)


class UserUpdateRequest(BaseModel):
    """Request model for updating user profile."""
    display_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    role: str | None = Field(None, pattern='^(admin|manager|staff)$')
    pin: str | None = Field(None, max_length=10)
    active: bool | None = None


class UserResponse(BaseModel):
    """Response model for user data."""
    id: str
    username: str
    email: str
    display_name: str
    last_name: str
    role: str
    active: bool
    created_at: str
    updated_at: str


class UsersListResponse(BaseModel):
    """Response model for users list."""
    count: int
    users: list[UserResponse]


async def _require_admin(authorization: str = Header('')) -> dict:
    """
    Dependency injection for admin role verification.

    Args:
        authorization: Bearer token from Authorization header

    Returns:
        User profile dict if admin

    Raises:
        HTTPException: 401 if missing/invalid token, 403 if not admin
    """
    token = authorization.replace('Bearer ', '') if authorization else ''
    if not token:
        raise HTTPException(status_code=401, detail='Missing authorization token')

    # Handle PIN-based tokens
    if token.startswith('pin_'):
        raise HTTPException(
            status_code=403,
            detail='Admin endpoints require Supabase Auth token, not PIN'
        )

    # Validate JWT token
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail='Invalid or expired token')

    user_id = claims.get('sub')
    if not user_id:
        raise HTTPException(status_code=401, detail='Token missing user ID')

    # Fetch user profile
    try:
        result = (
            supabase.table('user_profiles')
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

    if user.get('role') != 'admin':
        raise HTTPException(
            status_code=403,
            detail='This endpoint requires admin role'
        )

    return user


async def _get_user_by_id(user_id: str) -> dict | None:
    """Fetch user profile by ID."""
    try:
        result = (
            supabase.table('user_profiles')
            .select('*')
            .eq('id', user_id)
            .single()
            .execute()
        )
        return result.data if result.data else None
    except Exception:
        return None


async def _user_exists(username: str, exclude_id: str | None = None) -> bool:
    """Check if username already exists."""
    try:
        query = supabase.table('user_profiles').select('id').eq('username', username)
        if exclude_id:
            query = query.neq('id', exclude_id)
        result = query.single().execute()
        return result.data is not None
    except Exception:
        return False


@router.get('', response_model=UsersListResponse)
async def list_users(
    active_only: bool = False,
    admin_user: dict = Depends(_require_admin)
):
    """
    List all users with their roles and status.

    Requires: Admin role

    Query Parameters:
    - active_only: If true, only return active users (default: false)

    Returns:
        List of user profiles with count

    Raises:
        401: Missing or invalid auth token
        403: User is not admin
        500: Database error
    """
    try:
        query = supabase.table('user_profiles').select('*')
        if active_only:
            query = query.eq('active', True)
        result = query.order('created_at', desc=True).execute()

        users = result.data if result.data else []
        return UsersListResponse(
            count=len(users),
            users=[UserResponse(**u) for u in users]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')


@router.get('/{user_id}', response_model=UserResponse)
async def get_user(
    user_id: str,
    admin_user: dict = Depends(_require_admin)
):
    """
    Get details for a specific user.

    Requires: Admin role

    Path Parameters:
    - user_id: UUID of the user

    Returns:
        User profile details

    Raises:
        401: Missing or invalid auth token
        403: User is not admin
        404: User not found
        500: Database error
    """
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    return UserResponse(**user)


@router.post('', response_model=UserResponse, status_code=201)
async def create_user(
    req: UserCreateRequest,
    admin_user: dict = Depends(_require_admin)
):
    """
    Create a new user account.

    Requires: Admin role

    Request Body:
    - username: Unique username (3-50 chars)
    - email: Valid email address
    - display_name: Display name (required)
    - last_name: Last name (optional)
    - role: One of admin, manager, staff (default: staff)
    - pin: Staff PIN for PIN-based login (optional)

    Returns:
        Created user profile

    Raises:
        400: Invalid input or username exists
        401: Missing or invalid auth token
        403: User is not admin
        500: Database error
    """
    # Validate username is unique
    exists = await _user_exists(req.username)
    if exists:
        raise HTTPException(status_code=400, detail='Username already exists')

    # Validate email is unique
    try:
        email_check = (
            supabase.table('user_profiles')
            .select('id')
            .eq('email', req.email)
            .single()
            .execute()
        )
        if email_check.data:
            raise HTTPException(status_code=400, detail='Email already registered')
    except Exception as e:
        if 'single()' not in str(e):  # Expected error when no results
            raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')

    # Validate PIN if provided (should be numeric)
    if req.pin and not req.pin.isdigit():
        raise HTTPException(status_code=400, detail='PIN must be numeric')

    now = datetime.utcnow().isoformat()

    try:
        # Note: In production, user_id should come from Supabase Auth
        # For now, we'll let Supabase generate it via auto-increment or UUID
        result = (
            supabase.table('user_profiles')
            .insert({
                'username': req.username,
                'email': req.email,
                'display_name': req.display_name,
                'last_name': req.last_name,
                'role': req.role,
                'pin': req.pin or None,
                'active': True,
                'created_at': now,
                'updated_at': now,
            })
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


@router.put('/{user_id}', response_model=UserResponse)
async def update_user(
    user_id: str,
    req: UserUpdateRequest,
    admin_user: dict = Depends(_require_admin)
):
    """
    Update user profile information.

    Requires: Admin role

    Path Parameters:
    - user_id: UUID of the user to update

    Request Body (all optional):
    - display_name: New display name
    - last_name: New last name
    - role: New role (admin, manager, staff)
    - pin: New PIN for staff login
    - active: Enable/disable user account

    Returns:
        Updated user profile

    Raises:
        400: Invalid input
        401: Missing or invalid auth token
        403: User is not admin
        404: User not found
        500: Database error
    """
    # Check user exists
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    # Build update dict with only provided fields
    update_data = {}
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

    if not update_data:
        # No fields to update, return current user
        return UserResponse(**user)

    update_data['updated_at'] = datetime.utcnow().isoformat()

    try:
        result = (
            supabase.table('user_profiles')
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
async def disable_user(
    user_id: str,
    admin_user: dict = Depends(_require_admin)
):
    """
    Disable (soft delete) a user account.

    Requires: Admin role

    Sets the user's active flag to false. Does not delete the record.

    Path Parameters:
    - user_id: UUID of the user to disable

    Raises:
        401: Missing or invalid auth token
        403: User is not admin
        404: User not found
        500: Database error
    """
    # Check user exists
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail='User not found')

    # Prevent disabling self
    current_user_id = admin_user.get('id')
    if current_user_id == user_id:
        raise HTTPException(status_code=400, detail='Cannot disable your own account')

    try:
        supabase.table('user_profiles').update({
            'active': False,
            'updated_at': datetime.utcnow().isoformat(),
        }).eq('id', user_id).execute()

        return None

    except Exception as e:
        raise HTTPException(status_code=500, detail=f'Database error: {str(e)}')
