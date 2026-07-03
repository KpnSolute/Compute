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
import re
import secrets
from datetime import datetime, timezone
from urllib import request
from urllib.error import HTTPError

from fastapi import APIRouter, HTTPException, Header, Depends, File, UploadFile
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from backend.routes import (
    SUPABASE_SERVICE_KEY,
    SUPABASE_URL,
    jwt_validator,
    supabase_service,
)

router = APIRouter(prefix="/api/users", tags=["users"])

ROLE_LEVEL = {"staff": 10, "assistant": 20, "manager": 30, "admin": 40, "sudo": 50}
AVATAR_BUCKET = "profile-avatars"
AVATAR_MAX_BYTES = 2 * 1024 * 1024
AVATAR_EXT_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/gif": ".gif",
}


# ── request / response models ─────────────────────────────────────────────────


class UserCreateRequest(BaseModel):
    username: str = Field(..., min_length=3, max_length=50)
    email: EmailStr
    display_name: str = Field(..., min_length=1, max_length=100)
    last_name: str = Field(default="", max_length=100)
    role: str = Field("staff", pattern="^(admin|manager|assistant|staff|sudo)$")
    pin: str = Field(default="", max_length=10)
    password: str | None = Field(None, min_length=8, max_length=128)
    phone: str | None = Field(None, max_length=20)
    job_title: str | None = Field(None, max_length=100)
    bio: str | None = Field(None, max_length=500)
    avatar_url: str | None = Field(None, max_length=500)


class UserUpdateRequest(BaseModel):
    display_name: str | None = Field(None, max_length=100)
    last_name: str | None = Field(None, max_length=100)
    role: str | None = Field(None, pattern="^(admin|manager|assistant|staff|sudo)$")
    pin: str | None = Field(None, max_length=10)
    active: bool | None = None
    phone: str | None = Field(None, max_length=20)
    job_title: str | None = Field(None, max_length=100)
    bio: str | None = Field(None, max_length=500)
    avatar_url: str | None = Field(None, max_length=500)
    new_username: str | None = Field(None, min_length=3, max_length=50)
    new_password: str | None = Field(None, min_length=8, max_length=128)


class PasswordUpdateRequest(BaseModel):
    new_password: str = Field(..., min_length=8, max_length=128)


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


class RoleScopesRequest(BaseModel):
    scopes: dict[str, list[str]] = Field(default_factory=dict)


class UserResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

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
    pin: str | None = None


class UsersListResponse(BaseModel):
    count: int
    users: list[UserResponse]


SELF_PROFILE_FIELDS = {
    "display_name",
    "last_name",
    "phone",
    "job_title",
    "bio",
    "avatar_url",
}
STAFF_SELF_PROFILE_FIELDS = {"phone"}
USERNAME_RE = re.compile(r"^[a-z0-9]+(?:[._-][a-z0-9]+)*$")
ROLE_SCOPES_KEY = "auth_role_scopes"
VALID_SCOPE_KEYS = {
    "dashboard",
    "inventory",
    "moninv",
    "pullsheet",
    "mballot",
    "foodreq",
    "dataentry",
    "barcodes",
    "haccp",
    "dailyops",
    "inspection",
    "snackbar",
    "events",
    "menu",
    "sourcectrl",
    "reports",
    "archives",
    "ai-usage",
    "ai-tools",
    "ai-presets",
    "users",
    "settings",
}
DEFAULT_ROLE_SCOPES = {
    "staff": [
        "dashboard",
        "inventory",
        "mballot",
        "foodreq",
        "barcodes",
        "events",
        "sourcectrl",
        "reports",
    ],
    "assistant": [
        "dashboard",
        "inventory",
        "moninv",
        "mballot",
        "foodreq",
        "dataentry",
        "barcodes",
        "haccp",
        "dailyops",
        "inspection",
        "snackbar",
        "events",
        "menu",
        "sourcectrl",
        "reports",
        "archives",
    ],
    "manager": [
        "dashboard",
        "inventory",
        "moninv",
        "pullsheet",
        "mballot",
        "foodreq",
        "dataentry",
        "barcodes",
        "haccp",
        "dailyops",
        "inspection",
        "snackbar",
        "events",
        "menu",
        "sourcectrl",
        "reports",
        "archives",
        "ai-usage",
        "ai-tools",
        "ai-presets",
        "users",
        "settings",
    ],
    "admin": list(VALID_SCOPE_KEYS),
    "sudo": list(VALID_SCOPE_KEYS),
}


def _provided_request_fields(req: BaseModel) -> set[str]:
    fields = getattr(req, "model_fields_set", None)
    if fields is None:
        fields = getattr(req, "__fields_set__", set())
    return set(fields or set())


def _username_part(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "", (value or "").strip().lower())


def _standard_username(last_name: str | None, first_name: str | None) -> str:
    last = _username_part(last_name)
    first = _username_part(first_name)
    return f"{last}.{first}" if last and first else ""


def _normalize_username(username: str) -> str:
    normalized = re.sub(r"\s+", ".", (username or "").strip().lower())
    normalized = re.sub(r"\.+", ".", normalized).strip(".")
    if not normalized or not USERNAME_RE.fullmatch(normalized):
        raise HTTPException(
            status_code=400,
            detail="Username must use lowercase letters, numbers, dots, underscores, or hyphens",
        )
    return normalized


def _require_staff_username_standard(
    username: str, last_name: str | None, first_name: str | None
) -> None:
    expected = _standard_username(last_name, first_name)
    if expected and username != expected:
        raise HTTPException(
            status_code=400,
            detail=f"Staff username must use lastname.firstname format: {expected}",
        )


def _sanitize_role_scopes(scopes: dict[str, list[str]]) -> dict[str, list[str]]:
    clean: dict[str, list[str]] = {}
    for role in ROLE_LEVEL:
        values = scopes.get(role, DEFAULT_ROLE_SCOPES.get(role, []))
        valid = sorted({scope for scope in values if scope in VALID_SCOPE_KEYS})
        if role == "sudo":
            valid = sorted(VALID_SCOPE_KEYS)
        clean[role] = valid
    return clean


def _role_scopes_from_setting(value: object) -> dict[str, list[str]]:
    if not isinstance(value, dict):
        return _sanitize_role_scopes({})
    return _sanitize_role_scopes(
        {
            role: [str(scope) for scope in scopes] if isinstance(scopes, list) else []
            for role, scopes in value.items()
        }
    )


def _can_view_user_credentials(target_user: dict, actor: dict) -> bool:
    if actor.get("role") == "sudo":
        return True
    return (
        ROLE_LEVEL.get(actor.get("role", ""), 0) >= 30
        and target_user.get("role") == "staff"
    )


def _self_profile_update_data(req: UserSelfUpdateRequest, current_user: dict) -> dict:
    provided_fields = _provided_request_fields(req)
    allowed_fields = SELF_PROFILE_FIELDS
    if current_user.get("role") == "staff":
        disallowed = sorted(provided_fields - STAFF_SELF_PROFILE_FIELDS)
        if disallowed:
            raise HTTPException(
                status_code=403,
                detail=("Staff self-service profile updates are limited to phone"),
            )
        allowed_fields = STAFF_SELF_PROFILE_FIELDS

    update_data: dict = {}
    for field in allowed_fields:
        value = getattr(req, field, None)
        if value is not None:
            update_data[field] = value
    return update_data


def _enforce_user_update_scope(
    req: UserUpdateRequest, target_user: dict, actor: dict
) -> bool:
    actor_is_sudo = actor.get("role") == "sudo"
    actor_level = ROLE_LEVEL.get(actor.get("role", ""), 0)
    target_role = target_user.get("role", "")
    is_self = actor.get("id") == target_user.get("id")

    if actor_is_sudo:
        return True

    if is_self:
        provided = _provided_request_fields(req)
        disallowed = sorted(provided - {"new_password"})
        if disallowed:
            raise HTTPException(
                status_code=403,
                detail="Managers can change their own password, not username or profile fields here",
            )
        return False

    if actor_level < 30:
        raise HTTPException(
            status_code=403,
            detail="This endpoint requires manager or higher role",
        )

    if target_role != "staff":
        raise HTTPException(
            status_code=403,
            detail="Managers can only update staff accounts",
        )

    return False


# ── helpers ───────────────────────────────────────────────────────────────────


async def _get_user_by_id(user_id: str) -> dict | None:
    try:
        result = (
            supabase_service.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return result.data if result.data else None
    except Exception:
        return None


async def _user_exists(username: str, exclude_id: str | None = None) -> bool:
    try:
        query = (
            supabase_service.table("user_profiles")
            .select("id")
            .eq("username", username)
        )
        if exclude_id:
            query = query.neq("id", exclude_id)
        result = query.limit(1).execute()
        return bool(result.data)
    except Exception:
        return False


def _create_auth_user(email: str, password: str, metadata: dict) -> str:
    payload = json.dumps(
        {
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": metadata,
        }
    ).encode("utf-8")
    req = request.Request(
        f"{SUPABASE_URL}/auth/v1/admin/users",
        data=payload,
        method="POST",
        headers={
            "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            "Content-Type": "application/json",
        },
    )
    try:
        with request.urlopen(req, timeout=15) as resp:
            data = json.loads(resp.read().decode("utf-8"))
    except HTTPError as e:
        body = e.read().decode("utf-8", errors="replace")
        raise HTTPException(status_code=400, detail=f"Auth user create failed: {body}")
    except Exception as e:
        raise HTTPException(
            status_code=500, detail=f"Auth user create failed: {str(e)}"
        )

    user_id = data.get("id")
    if not user_id:
        raise HTTPException(
            status_code=500, detail="Auth user create failed: missing id"
        )
    return user_id


def _auth_email_for_username(username: str) -> str:
    username = (username or "").strip().lower()
    if username == "sudo":
        return "sudo@mjc.local"
    return f"{username}@mjc-cafeteria.com"


def _patch_auth_user(user_id: str, payload: dict) -> None:
    if not payload:
        return
    try:
        import httpx

        resp = httpx.patch(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=502, detail=f"Auth credential update failed: {resp.text}"
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Auth service error: {e}")


# ── auth dependencies ─────────────────────────────────────────────────────────


async def _resolve_jwt_user(authorization: str) -> dict:
    """Validate a JWT Bearer token and return the user profile."""
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")
    if token.startswith("pin_"):
        raise HTTPException(
            status_code=403,
            detail="This endpoint requires Supabase Auth token, not PIN",
        )
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")
    try:
        result = (
            supabase_service.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        user = result.data if result.data else None
    except Exception:
        raise HTTPException(status_code=500, detail="Database error fetching user")
    if not user:
        raise HTTPException(status_code=401, detail="User profile not found")
    if not user.get("active"):
        raise HTTPException(status_code=401, detail="User account is inactive")
    return user


async def _require_any_auth(authorization: str = Header("")) -> dict:
    """Accept any valid token — JWT (admin/manager/sudo) or pin_ (staff)."""
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    if token.startswith("pin_"):
        user_id = token[4:]
        user = await _get_user_by_id(user_id)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid session")
        if not user.get("active"):
            raise HTTPException(status_code=401, detail="User account is inactive")
        return user

    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")
    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=401, detail="User profile not found")
    if not user.get("active"):
        raise HTTPException(status_code=401, detail="User account is inactive")
    return user


async def _require_admin(authorization: str = Header("")) -> dict:
    """Require admin OR sudo role — read access to user management."""
    user = await _resolve_jwt_user(authorization)
    if ROLE_LEVEL.get(user.get("role", ""), 0) < 40:
        raise HTTPException(
            status_code=403, detail="This endpoint requires admin or sudo role"
        )
    return user


async def _require_manager(authorization: str = Header("")) -> dict:
    """Require manager, admin, or sudo role."""
    user = await _resolve_jwt_user(authorization)
    if ROLE_LEVEL.get(user.get("role", ""), 0) < 30:
        raise HTTPException(
            status_code=403, detail="This endpoint requires manager or higher role"
        )
    return user


async def _require_sudo(authorization: str = Header("")) -> dict:
    """Require sudo role — write access to user management."""
    user = await _resolve_jwt_user(authorization)
    if user.get("role") != "sudo":
        raise HTTPException(status_code=403, detail="This endpoint requires sudo role")
    return user


# ── /me routes (must appear before /{user_id} to avoid path collision) ────────


@router.get("/me", response_model=UserResponse)
async def get_my_profile(current_user: dict = Depends(_require_any_auth)):
    """Return the calling user's full profile."""
    return UserResponse(**current_user)


@router.put("/me", response_model=UserResponse)
async def update_my_profile(
    req: UserSelfUpdateRequest, current_user: dict = Depends(_require_any_auth)
):
    """Self-service profile update — staff can only change contact/photo fields."""
    update_data = _self_profile_update_data(req, current_user)

    if not update_data:
        return UserResponse(**current_user)

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()
    try:
        result = (
            supabase_service.table("user_profiles")
            .update(update_data)
            .eq("id", current_user["id"])
            .execute()
        )
        updated = result.data[0] if result.data else None
        if not updated:
            raise HTTPException(status_code=500, detail="Failed to update profile")
        return UserResponse(**updated)
    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.put("/me/password")
async def update_my_password(
    req: PasswordUpdateRequest, current_user: dict = Depends(_require_manager)
):
    """Allow manager/admin/sudo users to change their own Supabase Auth password."""
    _patch_auth_user(current_user["id"], {"password": req.new_password})
    return {"ok": True}


@router.post("/me/avatar", response_model=UserResponse)
async def upload_my_avatar(
    file: UploadFile = File(...), current_user: dict = Depends(_require_any_auth)
):
    """Upload the caller's profile image to Supabase Storage and save its public URL."""
    content_type = (file.content_type or "").lower()
    ext = AVATAR_EXT_BY_MIME.get(content_type)
    if not ext:
        raise HTTPException(
            status_code=400,
            detail="Avatar must be a JPEG, PNG, WebP, or GIF image",
        )

    data = await file.read()
    if not data:
        raise HTTPException(status_code=400, detail="Avatar file is empty")
    if len(data) > AVATAR_MAX_BYTES:
        raise HTTPException(status_code=413, detail="Avatar must be 2 MB or smaller")

    stamp = int(datetime.now(timezone.utc).timestamp())
    object_path = f"{current_user['id']}/avatar-{stamp}{ext}"
    upload_url = f"{SUPABASE_URL}/storage/v1/object/{AVATAR_BUCKET}/{object_path}"
    public_url = (
        f"{SUPABASE_URL}/storage/v1/object/public/{AVATAR_BUCKET}/{object_path}"
    )

    try:
        import httpx

        resp = httpx.put(
            upload_url,
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": content_type,
                "x-upsert": "true",
            },
            content=data,
            timeout=20,
        )
        if resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=502, detail=f"Avatar upload failed: {resp.text}"
            )

        updated = (
            supabase_service.table("user_profiles")
            .update(
                {
                    "avatar_url": public_url,
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            )
            .eq("id", current_user["id"])
            .execute()
        )
        user = updated.data[0] if updated.data else None
        if not user:
            raise HTTPException(status_code=500, detail="Failed to update avatar")
        return UserResponse(**user)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Avatar service error: {e}")


@router.get("/me/preferences")
async def get_user_preferences(current_user: dict = Depends(_require_any_auth)):
    """Return the calling user's saved preferences from app_settings."""
    key = f"user_prefs_{current_user['id']}"
    try:
        result = (
            supabase_service.table("app_settings")
            .select("setting_value")
            .eq("setting_key", key)
            .limit(1)
            .execute()
        )
        if result.data:
            raw = result.data[0]["setting_value"]
            return raw if isinstance(raw, dict) else {}
        return {}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.put("/me/preferences")
async def update_user_preferences(
    req: UserPrefsRequest, current_user: dict = Depends(_require_any_auth)
):
    """Upsert the calling user's preferences into app_settings."""
    key = f"user_prefs_{current_user['id']}"
    prefs: dict = {}
    if req.theme is not None:
        prefs["theme"] = req.theme

    try:
        existing = (
            supabase_service.table("app_settings")
            .select("setting_value")
            .eq("setting_key", key)
            .limit(1)
            .execute()
        )
        now = datetime.now(timezone.utc).isoformat()
        if existing.data:
            current_prefs = existing.data[0]["setting_value"] or {}
            current_prefs.update(prefs)
            supabase_service.table("app_settings").update(
                {"setting_value": current_prefs, "updated_at": now}
            ).eq("setting_key", key).execute()
            return current_prefs
        else:
            supabase_service.table("app_settings").insert(
                {
                    "setting_key": key,
                    "setting_value": prefs,
                    "updated_by": current_user["id"],
                    "updated_at": now,
                }
            ).execute()
            return prefs
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ── collection routes ─────────────────────────────────────────────────────────


@router.get("/role-scopes")
async def get_role_scopes(current_user: dict = Depends(_require_manager)):
    """Return role/group permission scopes. Sudo manages them; manager+ can view."""
    try:
        result = (
            supabase_service.table("app_settings")
            .select("setting_value")
            .eq("setting_key", ROLE_SCOPES_KEY)
            .limit(1)
            .execute()
        )
        value = result.data[0]["setting_value"] if result.data else {}
        return {
            "scopes": _role_scopes_from_setting(value),
            "available": sorted(VALID_SCOPE_KEYS),
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.put("/role-scopes")
async def update_role_scopes(
    req: RoleScopesRequest, current_user: dict = Depends(_require_sudo)
):
    """Update role/group permission scopes. Requires sudo."""
    scopes = _sanitize_role_scopes(req.scopes)
    now = datetime.now(timezone.utc).isoformat()
    try:
        supabase_service.table("app_settings").upsert(
            {
                "setting_key": ROLE_SCOPES_KEY,
                "setting_value": scopes,
                "updated_by": current_user["id"],
                "updated_at": now,
            },
            on_conflict="setting_key",
        ).execute()
        return {"scopes": scopes, "available": sorted(VALID_SCOPE_KEYS)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("", response_model=UsersListResponse)
async def list_users(
    active_only: bool = False, admin_user: dict = Depends(_require_manager)
):
    """List all users. Requires manager or higher role."""
    try:
        query = supabase_service.table("user_profiles").select("*")
        if active_only:
            query = query.eq("active", True)
        result = query.order("created_at", desc=True).execute()
        users = result.data if result.data else []
        return UsersListResponse(
            count=len(users), users=[UserResponse(**u) for u in users]
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.post("", response_model=UserResponse, status_code=201)
async def create_user(
    req: UserCreateRequest, admin_user: dict = Depends(_require_sudo)
):
    """Create a new user account. Requires sudo role."""
    username = _normalize_username(req.username)
    if req.role == "staff":
        _require_staff_username_standard(username, req.last_name, req.display_name)
    auth_email = _auth_email_for_username(username)

    exists = await _user_exists(username)
    if exists:
        raise HTTPException(status_code=400, detail="Username already exists")

    try:
        email_check = (
            supabase_service.table("user_profiles")
            .select("id")
            .eq("email", auth_email)
            .limit(1)
            .execute()
        )
        if email_check.data:
            raise HTTPException(status_code=400, detail="Email already registered")
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    if req.pin and not req.pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be numeric")

    now = datetime.now(timezone.utc).isoformat()

    try:
        password = req.password or secrets.token_urlsafe(18)
        auth_user_id = _create_auth_user(
            auth_email,
            password,
            {
                "username": username,
                "display_name": req.display_name,
                "last_name": req.last_name,
                "role": req.role,
            },
        )
        result = (
            supabase_service.table("user_profiles")
            .insert(
                {
                    "id": auth_user_id,
                    "username": username,
                    "email": auth_email,
                    "display_name": req.display_name,
                    "last_name": req.last_name,
                    "role": req.role,
                    "pin": req.pin or None,
                    "active": True,
                    "phone": req.phone,
                    "job_title": req.job_title,
                    "bio": req.bio,
                    "avatar_url": req.avatar_url,
                    "created_at": now,
                    "updated_at": now,
                }
            )
            .execute()
        )
        user = result.data[0] if result.data else None
        if not user:
            raise HTTPException(status_code=500, detail="Failed to create user")
        return UserResponse(**user)

    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ── per-user routes ───────────────────────────────────────────────────────────


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, admin_user: dict = Depends(_require_manager)):
    """Get a specific user's profile. Requires manager or higher role."""
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**user)


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str, req: UserUpdateRequest, admin_user: dict = Depends(_require_manager)
):
    """Update a user's profile. Managers can update staff; sudo can update any user."""
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    actor_is_sudo = _enforce_user_update_scope(req, user, admin_user)

    if req.role == "sudo" and admin_user.get("role") != "sudo":
        raise HTTPException(
            status_code=403, detail="Only a sudo user can grant the sudo role"
        )

    update_data: dict = {}
    if req.display_name is not None:
        update_data["display_name"] = req.display_name
    if req.last_name is not None:
        update_data["last_name"] = req.last_name
    if req.role is not None:
        if not actor_is_sudo and req.role != user.get("role"):
            raise HTTPException(
                status_code=403,
                detail="Only sudo can change user roles",
            )
        update_data["role"] = req.role
    if req.pin is not None:
        if req.pin and not req.pin.isdigit():
            raise HTTPException(status_code=400, detail="PIN must be numeric")
        update_data["pin"] = req.pin or None
    if req.active is not None:
        update_data["active"] = req.active
    if req.phone is not None:
        update_data["phone"] = req.phone
    if req.job_title is not None:
        update_data["job_title"] = req.job_title
    if req.bio is not None:
        update_data["bio"] = req.bio
    if req.avatar_url is not None:
        update_data["avatar_url"] = req.avatar_url

    # Username change (sudo only — update user_profiles + supabase auth metadata)
    if req.new_username:
        new_username = _normalize_username(req.new_username)
        effective_role = update_data.get("role", user.get("role"))
        if effective_role == "staff":
            _require_staff_username_standard(
                new_username,
                update_data.get("last_name", user.get("last_name")),
                update_data.get("display_name", user.get("display_name")),
            )
        if await _user_exists(new_username, exclude_id=user_id):
            raise HTTPException(
                status_code=409, detail=f"Username already taken: {new_username}"
            )
        update_data["username"] = new_username
        update_data["email"] = _auth_email_for_username(new_username)

    if not update_data and not req.new_password:
        return UserResponse(**user)

    update_data["updated_at"] = datetime.now(timezone.utc).isoformat()

    # Username/password changes via Supabase Admin API
    auth_payload: dict = {}
    if req.new_password:
        auth_payload["password"] = req.new_password
    if req.new_username:
        auth_payload["email"] = update_data["email"]
        auth_payload["email_confirm"] = True
    if auth_payload:
        auth_payload["user_metadata"] = {
            "username": update_data.get("username", user.get("username")),
            "display_name": update_data.get("display_name", user.get("display_name")),
            "last_name": update_data.get("last_name", user.get("last_name")),
            "role": update_data.get("role", user.get("role")),
        }
        _patch_auth_user(user_id, auth_payload)

    try:
        result = (
            supabase_service.table("user_profiles")
            .update(update_data)
            .eq("id", user_id)
            .execute()
        )
        updated_user = result.data[0] if result.data else None
        if not updated_user:
            raise HTTPException(status_code=500, detail="Failed to update user")
        return UserResponse(**updated_user)

    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{user_id}/credentials", summary="Get user credential metadata")
async def get_user_credentials(
    user_id: str, admin_user: dict = Depends(_require_manager)
):
    """Return credential recovery metadata. Staff PIN is visible; passwords are reset-only."""
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not _can_view_user_credentials(user, admin_user):
        raise HTTPException(
            status_code=403,
            detail="Managers can view staff credentials only",
        )
    try:
        import httpx

        resp = httpx.get(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
            },
            timeout=10,
        )
        if resp.status_code != 200:
            raise HTTPException(
                status_code=502, detail="Could not retrieve user from auth service"
            )
        data = resp.json()
        # Supabase does not expose plaintext passwords — return masked indicator + last sign in
        return {
            "user_id": user_id,
            "username": user.get("username")
            or data.get("user_metadata", {}).get("username"),
            "email": data.get("email"),
            "pin": user.get("pin") if user.get("role") == "staff" else None,
            "last_sign_in_at": data.get("last_sign_in_at"),
            "password_note": "Supabase does not store plaintext passwords. Use reset to set a new one.",
            "can_reset": True,
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Auth service error: {e}")


@router.get("/{user_id}/password", summary="Get user credential metadata")
async def get_user_password(user_id: str, admin_user: dict = Depends(_require_manager)):
    """Backward-compatible alias for credential recovery metadata."""
    return await get_user_credentials(user_id, admin_user)


@router.delete("/{user_id}", status_code=204)
async def disable_user(user_id: str, admin_user: dict = Depends(_require_sudo)):
    """Disable (soft-delete) a user account. Requires sudo role."""
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if admin_user.get("id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot disable your own account")

    try:
        supabase_service.table("user_profiles").update(
            {"active": False, "updated_at": datetime.now(timezone.utc).isoformat()}
        ).eq("id", user_id).execute()
        return None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
