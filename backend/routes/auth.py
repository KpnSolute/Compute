from fastapi import APIRouter, HTTPException, Header
from pydantic import BaseModel
from backend.routes import supabase, jwt_validator

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    """Frontend login - expects Supabase Auth token or username+PIN for staff."""
    access_token: str = ""  # From Supabase Auth (frontend login)
    username: str = ""      # Fallback for PIN-based login (staff)
    pin: str = ""


class LoginResponse(BaseModel):
    """Response after successful login."""
    access_token: str
    user: dict


class UserInfo(BaseModel):
    """Current user info."""
    id: str
    username: str
    display_name: str
    last_name: str
    role: str
    active: bool


async def _get_user_profile(user_id: str) -> dict | None:
    """Fetch user profile from Supabase by id."""
    try:
        result = (
            supabase.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return result.data if result.data else None
    except Exception as e:
        # User may not exist yet, return None
        return None


async def _get_user_by_username(username: str) -> dict | None:
    """Fetch user profile by username."""
    try:
        result = (
            supabase.table("user_profiles")
            .select("*")
            .eq("username", username)
            .eq("active", True)
            .single()
            .execute()
        )
        return result.data if result.data else None
    except Exception:
        return None


@router.post("/login", response_model=LoginResponse)
async def login(req: LoginRequest):
    """
    Login endpoint supporting two modes:

    1. JWT Token Mode (Recommended - Production):
       - Frontend sends Supabase Auth access_token
       - Backend validates token and fetches user profile
       - Returns user data for session tracking

    2. PIN Mode (Staff):
       - Username + PIN from staff member
       - Check PIN against user_profiles table
       - Return user data

    IMPORTANT: Frontend must:
    - For admin/manager: Use Supabase Auth (sends access_token)
    - For staff: Use username + PIN (legacy support)
    """

    # Mode 1: JWT Token validation (admin/manager - Supabase Auth)
    if req.access_token:
        # Validate the JWT token from Supabase Auth
        claims = jwt_validator.verify_token(req.access_token)
        if not claims:
            raise HTTPException(
                status_code=401,
                detail="Invalid or expired access token"
            )

        user_id = claims.get("sub")
        email = claims.get("email")

        if not user_id:
            raise HTTPException(
                status_code=401,
                detail="Token missing user ID"
            )

        # Fetch user profile to get role and other metadata
        user = await _get_user_profile(user_id)
        if not user:
            raise HTTPException(
                status_code=401,
                detail="User profile not found in database"
            )

        if not user.get("active"):
            raise HTTPException(
                status_code=401,
                detail="User account is inactive"
            )

        # Return the Supabase token as-is for session management
        return LoginResponse(
            access_token=req.access_token,
            user={
                "id": user.get("id"),
                "username": user.get("username"),
                "display_name": user.get("display_name"),
                "last_name": user.get("last_name"),
                "role": user.get("role"),
                "active": user.get("active"),
                "email": email,  # From JWT
            }
        )

    # Mode 2: PIN-based login (staff)
    elif req.username and req.pin:
        user = await _get_user_by_username(req.username)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if user["role"] != "staff":
            raise HTTPException(
                status_code=401,
                detail="PIN login only available for staff"
            )

        if req.pin != user.get("pin", ""):
            raise HTTPException(status_code=401, detail="Invalid PIN")

        # For PIN-based login, generate a simple token for session tracking
        # In production, this should be a properly signed JWT
        # For now, we'll use the user ID as a pseudo-token
        pseudo_token = f"pin_{user['id']}"

        return LoginResponse(
            access_token=pseudo_token,
            user={
                "id": user.get("id"),
                "username": user.get("username"),
                "display_name": user.get("display_name"),
                "last_name": user.get("last_name"),
                "role": user.get("role"),
                "active": user.get("active"),
            }
        )

    else:
        raise HTTPException(
            status_code=400,
            detail="Provide either access_token or username+pin"
        )


@router.post("/logout")
async def logout(authorization: str = Header("")):
    """
    Logout endpoint. For Supabase tokens, frontend should discard the token.
    This endpoint is here for symmetry and could be extended for session tracking.
    """
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=400, detail="No token provided")

    return {"message": "Successfully logged out"}


@router.get("/me", response_model=UserInfo)
async def me(authorization: str = Header("")):
    """
    Get current user info by validating Authorization header.

    Expects: Authorization: Bearer <supabase_jwt_or_pin_token>
    """
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    # Handle PIN-based tokens (legacy staff login)
    if token.startswith("pin_"):
        user_id = token.replace("pin_", "")
        user = await _get_user_profile(user_id)
        if not user or not user.get("active"):
            raise HTTPException(status_code=401, detail="Invalid session")
        return UserInfo(**user)

    # Handle Supabase JWT tokens
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = claims.get("sub")
    user = await _get_user_profile(user_id)
    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return UserInfo(**user)

