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
import logging
import re
import secrets
from datetime import datetime, timezone
from urllib import request
from urllib.error import HTTPError

from fastapi import APIRouter, HTTPException, Depends, File, UploadFile
from pydantic import BaseModel, ConfigDict, EmailStr, Field
from backend.routes import (
    SUPABASE_SERVICE_KEY,
    SUPABASE_URL,
    supabase_admin,
    supabase_service,
)
from backend.routes._deps import _get_auth_user
from backend.tenancy import current_tenant, tenancy_mode

log = logging.getLogger("mjcc.users")

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


class PinUpdateRequest(BaseModel):
    new_pin: str = Field(..., min_length=4, max_length=10)


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
    last_seen_changelog_version: str | None = None


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
    must_change_password: bool | None = None


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
# Provisioning defaults. must_change_password stays true while the account is on
# the known default password (hashes are unrecoverable, so this is the only window
# where sudo can "view" a password); PIN default state is derived from pin == '2222'.
DEFAULT_MANAGER_PASSWORD = "Manager@2026"
DEFAULT_STAFF_PIN = "2222"


def _pin_is_default(user: dict) -> bool:
    return user.get("role") == "staff" and user.get("pin") == DEFAULT_STAFF_PIN


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
    "lioncafe",
    "costmgr",
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
        "lioncafe",
        "costmgr",
        "ai-usage",
        "ai-tools",
        "ai-presets",
        "users",
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


def _sanitize_role_scopes(
    scopes: dict[str, list[str]], valid_scope_keys: set[str] | None = None
) -> dict[str, list[str]]:
    valid_scope_keys = valid_scope_keys or VALID_SCOPE_KEYS
    clean: dict[str, list[str]] = {}
    for role in ROLE_LEVEL:
        values = scopes.get(role, DEFAULT_ROLE_SCOPES.get(role, []))
        valid = sorted({scope for scope in values if scope in valid_scope_keys})
        if role == "sudo":
            valid = sorted(valid_scope_keys)
        clean[role] = valid
    return clean


def _can_view_user_credentials(target_user: dict, actor: dict) -> bool:
    if actor.get("role") == "sudo":
        return True
    return (
        ROLE_LEVEL.get(actor.get("role", ""), 0) >= 30
        and target_user.get("role") == "staff"
    )


def _load_role_scope_payload() -> dict:
    try:
        scope_result = (
            supabase_service.table("permission_scopes")
            .select("key,label,group_name,min_role,sort_order,active")
            .eq("active", True)
            .order("sort_order")
            .execute()
        )
        scope_rows = scope_result.data or []
        if not scope_rows:
            return {
                "scopes": _sanitize_role_scopes({}),
                "available": sorted(VALID_SCOPE_KEYS),
                "catalog": [],
            }

        valid_keys = {row["key"] for row in scope_rows}
        perm_result = (
            supabase_service.table("role_permissions")
            .select("role,scope_key,allowed")
            .eq("allowed", True)
            .execute()
        )
        grouped: dict[str, list[str]] = {role: [] for role in ROLE_LEVEL}
        for row in perm_result.data or []:
            role = row.get("role")
            scope_key = row.get("scope_key")
            if role in grouped and scope_key in valid_keys:
                grouped[role].append(scope_key)

        return {
            "scopes": _sanitize_role_scopes(grouped, valid_keys),
            "available": [row["key"] for row in scope_rows],
            "catalog": scope_rows,
        }
    except Exception:
        return {
            "scopes": _sanitize_role_scopes({}),
            "available": sorted(VALID_SCOPE_KEYS),
            "catalog": [],
        }


def _replace_role_scope_rows(scopes: dict[str, list[str]], actor_id: str) -> dict:
    payload = _load_role_scope_payload()
    valid_keys = set(payload["available"]) or VALID_SCOPE_KEYS
    clean = _sanitize_role_scopes(scopes, valid_keys)
    now = datetime.now(timezone.utc).isoformat()
    rows = [
        {
            "role": role,
            "scope_key": scope_key,
            "allowed": True,
            "updated_by": actor_id,
            "updated_at": now,
        }
        for role, scope_keys in clean.items()
        for scope_key in scope_keys
    ]

    supabase_service.table("role_permissions").delete().in_(
        "role", list(ROLE_LEVEL.keys())
    ).execute()
    if rows:
        supabase_service.table("role_permissions").insert(rows).execute()
    return _load_role_scope_payload()


def _log_credential_event(
    actor_id: str | None,
    target_user_id: str | None,
    action: str,
    metadata: dict | None = None,
) -> None:
    try:
        supabase_service.table("credential_access_audit").insert(
            {
                "actor_id": actor_id,
                "target_user_id": target_user_id,
                "action": action,
                "metadata": metadata or {},
            }
        ).execute()
    except Exception:
        return


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

        # GoTrue's admin user-update endpoint only accepts PUT; PATCH returns 405.
        resp = httpx.put(
            f"{SUPABASE_URL}/auth/v1/admin/users/{user_id}",
            headers={
                "apikey": SUPABASE_SERVICE_KEY,
                "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=10,
        )
        if resp.status_code == 404:
            log.warning(
                "Auth user %s not found in GoTrue — creating via admin API", user_id
            )
            # Re-create the auth user if missing (e.g. deleted from auth but profile remains)
            auth_resp = httpx.post(
                f"{SUPABASE_URL}/auth/v1/admin/users",
                headers={
                    "apikey": SUPABASE_SERVICE_KEY,
                    "Authorization": f"Bearer {SUPABASE_SERVICE_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "email": payload.get("email", f"{user_id[:8]}@mjc-cafeteria.com"),
                    "password": payload.get("password", "TempPass123!"),
                    "email_confirm": True,
                    "user_metadata": payload.get("user_metadata", {}),
                },
                timeout=10,
            )
            if auth_resp.status_code not in (200, 201):
                raise HTTPException(
                    status_code=502,
                    detail=f"Auth user re-creation failed ({auth_resp.status_code}): {auth_resp.text[:200]}",
                )
        elif resp.status_code not in (200, 201):
            raise HTTPException(
                status_code=502,
                detail=f"Auth credential update failed (HTTP {resp.status_code}): {resp.text[:200] or 'empty response'}",
            )
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=f"Auth service error: {e}")


# ── auth dependencies ─────────────────────────────────────────────────────────


async def _require_any_auth(user: dict = Depends(_get_auth_user)) -> dict:
    return user


async def _require_admin(user: dict = Depends(_get_auth_user)) -> dict:
    """Require admin OR sudo membership in the selected workspace."""
    if ROLE_LEVEL.get(user.get("role", ""), 0) < 40:
        raise HTTPException(
            status_code=403, detail="This endpoint requires admin or sudo role"
        )
    return user


async def _require_manager(user: dict = Depends(_get_auth_user)) -> dict:
    """Require manager, admin, or sudo membership in the selected workspace."""
    if ROLE_LEVEL.get(user.get("role", ""), 0) < 30:
        raise HTTPException(
            status_code=403, detail="This endpoint requires manager or higher role"
        )
    return user


async def _require_sudo(user: dict = Depends(_get_auth_user)) -> dict:
    """Require sudo membership in the selected workspace."""
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
    supabase_service.table("user_profiles").update(
        {
            "must_change_password": req.new_password == DEFAULT_MANAGER_PASSWORD,
            "updated_at": datetime.now(timezone.utc).isoformat(),
        }
    ).eq("id", current_user["id"]).execute()
    _log_credential_event(
        current_user.get("id"),
        current_user.get("id"),
        "password_reset",
        {"self_service": True},
    )
    return {"ok": True}


@router.put("/me/pin")
async def update_my_pin(
    req: PinUpdateRequest, current_user: dict = Depends(_require_any_auth)
):
    """Allow a user to change their own PIN (staff clear the default-PIN banner here)."""
    if not req.new_pin.isdigit():
        raise HTTPException(status_code=400, detail="PIN must be numeric")
    supabase_service.table("user_profiles").update(
        {"pin": req.new_pin, "updated_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", current_user["id"]).execute()
    _log_credential_event(
        current_user.get("id"),
        current_user.get("id"),
        "pin_update",
        {"self_service": True},
    )
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
    if req.last_seen_changelog_version is not None:
        prefs["last_seen_changelog_version"] = req.last_seen_changelog_version

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
async def get_role_scopes(current_user: dict = Depends(_get_auth_user)):
    """Return role/group permission scopes. Any authenticated user can view (the
    frontend needs its own role's scopes to build the nav); sudo manages them."""
    _ = current_user
    return _load_role_scope_payload()


def _selected_tenant_id() -> str | None:
    context = current_tenant()
    return context.id if context else None


def _workspace_membership(user_id: str) -> dict | None:
    tenant_id = _selected_tenant_id()
    if tenancy_mode() == "legacy" or not tenant_id:
        return None
    rows = (
        supabase_admin.table("tenant_memberships")
        .select("tenant_id,user_id,role,status,is_default")
        .eq("tenant_id", tenant_id)
        .eq("user_id", user_id)
        .limit(1)
        .execute()
    ).data or []
    return rows[0] if rows else None


def _require_workspace_member(user_id: str) -> dict | None:
    membership = _workspace_membership(user_id)
    if tenancy_mode() != "legacy" and not membership:
        raise HTTPException(status_code=404, detail="User not found in this workspace")
    return membership


def _workspace_user_ids(active_only: bool = False) -> tuple[list[str], dict[str, dict]]:
    tenant_id = _selected_tenant_id()
    if tenancy_mode() == "legacy" or not tenant_id:
        return [], {}
    query = (
        supabase_admin.table("tenant_memberships")
        .select("user_id,role,status,is_default")
        .eq("tenant_id", tenant_id)
        .neq("status", "removed")
    )
    if active_only:
        query = query.eq("status", "active")
    memberships = query.execute().data or []
    by_user = {str(row["user_id"]): row for row in memberships}
    return list(by_user), by_user


def _merge_membership(user: dict, membership: dict | None) -> dict:
    if not membership:
        return user
    return {
        **user,
        "role": membership["role"],
        "active": bool(user.get("active")) and membership["status"] == "active",
    }


@router.put("/role-scopes")
async def update_role_scopes(
    req: RoleScopesRequest, current_user: dict = Depends(_require_sudo)
):
    """Update role/group permission scopes. Requires sudo."""
    try:
        return _replace_role_scope_rows(req.scopes, current_user["id"])
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("", response_model=UsersListResponse)
async def list_users(
    active_only: bool = False, admin_user: dict = Depends(_require_manager)
):
    """List all users. Requires manager or higher role."""
    try:
        query = supabase_service.table("user_profiles").select("*")
        user_ids, memberships = _workspace_user_ids(active_only)
        if tenancy_mode() != "legacy":
            if not user_ids:
                return UsersListResponse(count=0, users=[])
            query = query.in_("id", user_ids)
        elif active_only:
            query = query.eq("active", True)
        result = query.order("created_at", desc=True).execute()
        users = [
            _merge_membership(row, memberships.get(str(row["id"])))
            for row in (result.data or [])
        ]
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

    if req.pin and (not req.pin.isdigit() or len(req.pin) < 4):
        raise HTTPException(status_code=400, detail="PIN must be at least 4 digits")

    now = datetime.now(timezone.utc).isoformat()

    try:
        if req.role == "staff":
            password = req.password or secrets.token_urlsafe(18)
        else:
            password = req.password or DEFAULT_MANAGER_PASSWORD
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
                    "pin": (req.pin or DEFAULT_STAFF_PIN)
                    if req.role == "staff"
                    else (req.pin or None),
                    "active": True,
                    "must_change_password": req.role != "staff"
                    and password == DEFAULT_MANAGER_PASSWORD,
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
        if tenancy_mode() != "legacy":
            tenant_id = _selected_tenant_id()
            if not tenant_id:
                raise HTTPException(
                    status_code=500, detail="Workspace context was lost"
                )
            membership = (
                supabase_admin.table("tenant_memberships")
                .insert(
                    {
                        "tenant_id": tenant_id,
                        "user_id": auth_user_id,
                        "role": req.role,
                        "status": "active",
                        "is_default": True,
                    }
                )
                .execute()
            ).data[0]
            user = _merge_membership(user, membership)
        return UserResponse(**user)

    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


# ── per-user routes ───────────────────────────────────────────────────────────


@router.get("/{user_id}", response_model=UserResponse)
async def get_user(user_id: str, admin_user: dict = Depends(_require_manager)):
    """Get a specific user's profile. Requires manager or higher role."""
    membership = _require_workspace_member(user_id)
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return UserResponse(**_merge_membership(user, membership))


@router.put("/{user_id}", response_model=UserResponse)
async def update_user(
    user_id: str, req: UserUpdateRequest, admin_user: dict = Depends(_require_manager)
):
    """Update a user's profile. Managers can update staff; sudo can update any user."""
    membership = _require_workspace_member(user_id)
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    user = _merge_membership(user, membership)
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
        if tenancy_mode() == "legacy":
            update_data["role"] = req.role
        else:
            supabase_admin.table("tenant_memberships").update(
                {"role": req.role, "updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("tenant_id", _selected_tenant_id()).eq("user_id", user_id).execute()
            user["role"] = req.role
    if req.pin is not None:
        if req.pin and (not req.pin.isdigit() or len(req.pin) < 4):
            raise HTTPException(status_code=400, detail="PIN must be at least 4 digits")
        update_data["pin"] = req.pin or None
    if req.active is not None:
        if tenancy_mode() == "legacy":
            update_data["active"] = req.active
        else:
            supabase_admin.table("tenant_memberships").update(
                {
                    "status": "active" if req.active else "suspended",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("tenant_id", _selected_tenant_id()).eq("user_id", user_id).execute()
            user["active"] = req.active
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
        update_data["must_change_password"] = (
            req.new_password == DEFAULT_MANAGER_PASSWORD
        )
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
        updated_user = result.data[0] if result.data else user
        if not updated_user:
            raise HTTPException(status_code=500, detail="Failed to update user")
        if req.new_password:
            _log_credential_event(
                admin_user.get("id"),
                user_id,
                "password_reset",
                {"self_service": admin_user.get("id") == user_id},
            )
        if req.pin is not None:
            _log_credential_event(admin_user.get("id"), user_id, "pin_update")
        if req.new_username:
            _log_credential_event(
                admin_user.get("id"),
                user_id,
                "username_update",
                {"username": update_data.get("username")},
            )
        return UserResponse(
            **_merge_membership(updated_user, _workspace_membership(user_id))
        )

    except Exception as e:
        if isinstance(e, HTTPException):
            raise
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/{user_id}/credentials", summary="Get user credential metadata")
async def get_user_credentials(
    user_id: str, admin_user: dict = Depends(_require_manager)
):
    """Return credential recovery metadata. Staff PIN is visible; passwords are reset-only."""
    membership = _require_workspace_member(user_id)
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    user = _merge_membership(user, membership)
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
        _log_credential_event(admin_user.get("id"), user_id, "view")
        # Supabase stores only password hashes. The password is viewable exactly while
        # the account is still on the provisioning default; after that it is reset-only.
        on_default_password = bool(user.get("must_change_password"))
        show_pin = admin_user.get("role") == "sudo" or user.get("role") == "staff"
        return {
            "user_id": user_id,
            "username": user.get("username")
            or data.get("user_metadata", {}).get("username"),
            "email": data.get("email"),
            "pin": user.get("pin") if show_pin else None,
            "pin_is_default": _pin_is_default(user),
            "password": DEFAULT_MANAGER_PASSWORD if on_default_password else None,
            "password_is_default": on_default_password,
            "last_sign_in_at": data.get("last_sign_in_at"),
            "password_note": (
                f"Account is on the default password ({DEFAULT_MANAGER_PASSWORD})."
                if on_default_password
                else "Password was changed by the user and is not recoverable. Use reset to set a new one."
            ),
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
    _require_workspace_member(user_id)
    user = await _get_user_by_id(user_id)
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if admin_user.get("id") == user_id:
        raise HTTPException(status_code=400, detail="Cannot disable your own account")

    try:
        if tenancy_mode() == "legacy":
            supabase_service.table("user_profiles").update(
                {"active": False, "updated_at": datetime.now(timezone.utc).isoformat()}
            ).eq("id", user_id).execute()
        else:
            supabase_admin.table("tenant_memberships").update(
                {
                    "status": "removed",
                    "updated_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("tenant_id", _selected_tenant_id()).eq("user_id", user_id).execute()
        return None
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
