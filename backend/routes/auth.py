import datetime
import hashlib
import hmac
import os
import secrets
from urllib.parse import urlsplit

import jwt as pyjwt
from fastapi import APIRouter, Depends, HTTPException, Header, Response
from pydantic import BaseModel, ConfigDict
from backend.routes import supabase_service, jwt_validator, SUPABASE_JWT_SECRET
from backend.routes._deps import _get_auth_user

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginRequest(BaseModel):
    """Frontend login - expects Supabase Auth token or username+PIN for staff."""

    access_token: str = ""  # From Supabase Auth (frontend login)
    username: str = ""  # Fallback for PIN-based login (staff)
    pin: str = ""


class LoginResponse(BaseModel):
    """Response after successful login."""

    access_token: str
    user: dict


class UserInfo(BaseModel):
    """Current user info."""

    model_config = ConfigDict(extra="ignore")

    id: str
    username: str
    display_name: str
    last_name: str = ""
    role: str
    active: bool
    must_change_password: bool = False
    must_change_pin: bool = False


class LunchvoiceSsoStartResponse(BaseModel):
    redirect_url: str
    expires_in: int


class LunchvoiceSsoExchangeRequest(BaseModel):
    code: str


class LunchvoiceSsoIdentity(BaseModel):
    mjcc_user_id: str
    username: str
    email: str
    display_name: str
    mjcc_role: str
    tenant_slug: str


class SsoStartResponse(BaseModel):
    redirect_url: str
    expires_in: int


class SsoExchangeRequest(BaseModel):
    code: str


class SsoIdentity(BaseModel):
    mjcc_user_id: str
    username: str
    email: str
    display_name: str
    mjcc_role: str
    target_app: str


# Allowlist of external applications that may use the generic SSO handoff.
# Adding a new app means adding an entry here plus a matching permission_scopes
# row/migration and a callback env var — nothing here is client-controlled.
SSO_APPS: dict[str, dict[str, str]] = {
    "marquee": {
        "scope_key": "marquee",
        "secret_env": "MARQUEE_SSO_SECRET",
        "callback_env": "MARQUEE_SSO_URL",
        "hmac_context": "marquee-sso-bridge-v1",
    },
}


def _credential_flags(user: dict) -> dict:
    """Default-credential banner flags. PIN default is derived (PINs are plaintext)."""
    return {
        "must_change_password": bool(user.get("must_change_password")),
        "must_change_pin": user.get("role") == "staff" and user.get("pin") == "2222",
    }


def _has_lioncafe_scope(role: str) -> bool:
    """Fail closed unless the live MJCC role matrix grants LionCafe access."""
    try:
        scope = (
            supabase_service.table("permission_scopes")
            .select("key")
            .eq("key", "lioncafe")
            .eq("active", True)
            .limit(1)
            .execute()
        )
        if not scope.data:
            return False
        grant = (
            supabase_service.table("role_permissions")
            .select("scope_key")
            .eq("role", role)
            .eq("scope_key", "lioncafe")
            .eq("allowed", True)
            .limit(1)
            .execute()
        )
        return bool(grant.data)
    except Exception:
        return False


def _sso_secret() -> str:
    value = os.getenv("LUNCHVOICE_SSO_SECRET", "").strip()
    if len(value) >= 32:
        return value
    source = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if len(source) < 32:
        raise HTTPException(status_code=503, detail="Lunchvoice SSO is not configured")
    return hmac.new(
        source.encode("utf-8"),
        b"lunchvoice-sso-bridge-v1",
        hashlib.sha256,
    ).hexdigest()


def _sso_callback() -> str:
    value = os.getenv(
        "LUNCHVOICE_SSO_URL",
        "https://interact-3npi.onrender.com/LionCafe/sso",
    ).strip()
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise HTTPException(
            status_code=503, detail="Lunchvoice SSO callback is invalid"
        )
    return value.rstrip("/")


def _sso_app_config(app: str) -> dict[str, str]:
    """Fail closed: only apps in the SSO_APPS allowlist may use the generic handoff."""
    config = SSO_APPS.get(app)
    if not config:
        raise HTTPException(status_code=404, detail="Unknown SSO target application")
    return config


def _has_app_scope(role: str, scope_key: str) -> bool:
    """Fail closed unless the live MJCC role matrix grants this app's scope."""
    try:
        scope = (
            supabase_service.table("permission_scopes")
            .select("key")
            .eq("key", scope_key)
            .eq("active", True)
            .limit(1)
            .execute()
        )
        if not scope.data:
            return False
        grant = (
            supabase_service.table("role_permissions")
            .select("scope_key")
            .eq("role", role)
            .eq("scope_key", scope_key)
            .eq("allowed", True)
            .limit(1)
            .execute()
        )
        return bool(grant.data)
    except Exception:
        return False


def _generic_sso_secret(config: dict[str, str]) -> str:
    value = os.getenv(config["secret_env"], "").strip()
    if len(value) >= 32:
        return value
    source = os.getenv("SUPABASE_SERVICE_KEY", "").strip()
    if len(source) < 32:
        raise HTTPException(
            status_code=503, detail="SSO is not configured for this application"
        )
    return hmac.new(
        source.encode("utf-8"),
        config["hmac_context"].encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def _generic_sso_callback(config: dict[str, str]) -> str:
    value = os.getenv(config["callback_env"], "").strip()
    if not value:
        raise HTTPException(
            status_code=503,
            detail="SSO callback is not configured for this application",
        )
    parsed = urlsplit(value)
    if parsed.scheme != "https" or not parsed.netloc or parsed.query or parsed.fragment:
        raise HTTPException(status_code=503, detail="SSO callback is invalid")
    return value.rstrip("/")


@router.post("/lunchvoice-sso/start", response_model=LunchvoiceSsoStartResponse)
async def start_lunchvoice_sso(
    response: Response,
    current_user: dict = Depends(_get_auth_user),
) -> LunchvoiceSsoStartResponse:
    """Create a 60-second, one-time code for a LionCafe-authorized MJCC account."""
    response.headers["Cache-Control"] = "no-store"
    if not _has_lioncafe_scope(str(current_user.get("role") or "")):
        raise HTTPException(
            status_code=403, detail="LionCafe access is not enabled for your MJCC role"
        )

    # Validate shared configuration before creating a handoff that cannot be exchanged.
    _sso_secret()
    callback = _sso_callback()
    raw_code = secrets.token_urlsafe(32)
    code_hash = hashlib.sha256(raw_code.encode("utf-8")).hexdigest()
    now = datetime.datetime.now(datetime.timezone.utc)
    expires_in = 60
    expires_at = now + datetime.timedelta(seconds=expires_in)
    try:
        supabase_service.table("lunchvoice_sso_handoffs").delete().lt(
            "expires_at", now.isoformat()
        ).execute()
        supabase_service.table("lunchvoice_sso_handoffs").insert(
            {
                "code_hash": code_hash,
                "user_id": current_user["id"],
                "tenant_slug": "LionCafe",
                "expires_at": expires_at.isoformat(),
            }
        ).execute()
    except Exception:
        raise HTTPException(status_code=503, detail="Could not start Lunchvoice SSO")

    return LunchvoiceSsoStartResponse(
        redirect_url=f"{callback}#code={raw_code}",
        expires_in=expires_in,
    )


@router.post("/lunchvoice-sso/exchange", response_model=LunchvoiceSsoIdentity)
async def exchange_lunchvoice_sso(
    req: LunchvoiceSsoExchangeRequest,
    response: Response,
    x_lunchvoice_sso_secret: str = Header("", alias="X-Lunchvoice-Sso-Secret"),
) -> LunchvoiceSsoIdentity:
    """Atomically consume a handoff; this endpoint is only for Lunchvoice's server."""
    response.headers["Cache-Control"] = "no-store"
    if not secrets.compare_digest(x_lunchvoice_sso_secret, _sso_secret()):
        raise HTTPException(status_code=401, detail="Invalid SSO client")
    code = req.code.strip()
    if len(code) < 32 or len(code) > 200:
        raise HTTPException(status_code=401, detail="Invalid or expired SSO code")

    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        consumed = (
            supabase_service.table("lunchvoice_sso_handoffs")
            .update({"consumed_at": now})
            .eq("code_hash", code_hash)
            .is_("consumed_at", "null")
            .gt("expires_at", now)
            .select("user_id,tenant_slug")
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Could not exchange SSO code")
    if not consumed.data:
        raise HTTPException(status_code=401, detail="Invalid or expired SSO code")

    handoff = consumed.data[0]
    user = await _get_user_profile(str(handoff["user_id"]))
    if (
        not user
        or not user.get("active")
        or not _has_lioncafe_scope(str(user.get("role") or ""))
    ):
        raise HTTPException(status_code=403, detail="LionCafe access has been revoked")

    username = str(user.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=403, detail="MJCC profile is incomplete")
    display_name = (
        " ".join(
            value.strip()
            for value in [
                str(user.get("display_name") or ""),
                str(user.get("last_name") or ""),
            ]
            if value.strip()
        )
        or username
    )
    email = str(user.get("email") or "").strip() or f"{username}@mjc-cafeteria.com"
    return LunchvoiceSsoIdentity(
        mjcc_user_id=str(user["id"]),
        username=username,
        email=email,
        display_name=display_name,
        mjcc_role=str(user["role"]),
        tenant_slug=str(handoff["tenant_slug"]),
    )


@router.post("/sso/{app}/start", response_model=SsoStartResponse)
async def start_sso(
    app: str,
    response: Response,
    current_user: dict = Depends(_get_auth_user),
) -> SsoStartResponse:
    """Create a 60-second, one-time code for an app-authorized MJCC account.

    Generic, app-scoped counterpart to /lunchvoice-sso/start. `app` must be in
    the SSO_APPS allowlist (fail closed on unknown apps).
    """
    response.headers["Cache-Control"] = "no-store"
    config = _sso_app_config(app)
    if not _has_app_scope(str(current_user.get("role") or ""), config["scope_key"]):
        raise HTTPException(
            status_code=403, detail=f"{app} access is not enabled for your MJCC role"
        )

    # Validate shared configuration before creating a handoff that cannot be exchanged.
    _generic_sso_secret(config)
    callback = _generic_sso_callback(config)
    raw_code = secrets.token_urlsafe(32)
    code_hash = hashlib.sha256(raw_code.encode("utf-8")).hexdigest()
    now = datetime.datetime.now(datetime.timezone.utc)
    expires_in = 60
    expires_at = now + datetime.timedelta(seconds=expires_in)
    try:
        supabase_service.table("sso_handoffs").delete().lt(
            "expires_at", now.isoformat()
        ).execute()
        supabase_service.table("sso_handoffs").insert(
            {
                "code_hash": code_hash,
                "user_id": current_user["id"],
                "target_app": app,
                "expires_at": expires_at.isoformat(),
            }
        ).execute()
    except Exception:
        raise HTTPException(status_code=503, detail="Could not start SSO")

    return SsoStartResponse(
        redirect_url=f"{callback}#code={raw_code}",
        expires_in=expires_in,
    )


@router.post("/sso/{app}/exchange", response_model=SsoIdentity)
async def exchange_sso(
    app: str,
    req: SsoExchangeRequest,
    response: Response,
    x_sso_secret: str = Header("", alias="X-Sso-Secret"),
) -> SsoIdentity:
    """Atomically consume a handoff; this endpoint is only for the target app's server."""
    response.headers["Cache-Control"] = "no-store"
    config = _sso_app_config(app)
    if not secrets.compare_digest(x_sso_secret, _generic_sso_secret(config)):
        raise HTTPException(status_code=401, detail="Invalid SSO client")
    code = req.code.strip()
    if len(code) < 32 or len(code) > 200:
        raise HTTPException(status_code=401, detail="Invalid or expired SSO code")

    code_hash = hashlib.sha256(code.encode("utf-8")).hexdigest()
    now = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        consumed = (
            supabase_service.table("sso_handoffs")
            .update({"consumed_at": now})
            .eq("code_hash", code_hash)
            .eq("target_app", app)
            .is_("consumed_at", "null")
            .gt("expires_at", now)
            .select("user_id,target_app")
            .execute()
        )
    except Exception:
        raise HTTPException(status_code=503, detail="Could not exchange SSO code")
    if not consumed.data:
        raise HTTPException(status_code=401, detail="Invalid or expired SSO code")

    handoff = consumed.data[0]
    user = await _get_user_profile(str(handoff["user_id"]))
    if (
        not user
        or not user.get("active")
        or not _has_app_scope(str(user.get("role") or ""), config["scope_key"])
    ):
        raise HTTPException(status_code=403, detail=f"{app} access has been revoked")

    username = str(user.get("username") or "").strip()
    if not username:
        raise HTTPException(status_code=403, detail="MJCC profile is incomplete")
    display_name = (
        " ".join(
            value.strip()
            for value in [
                str(user.get("display_name") or ""),
                str(user.get("last_name") or ""),
            ]
            if value.strip()
        )
        or username
    )
    email = str(user.get("email") or "").strip() or f"{username}@mjc-cafeteria.com"
    return SsoIdentity(
        mjcc_user_id=str(user["id"]),
        username=username,
        email=email,
        display_name=display_name,
        mjcc_role=str(user["role"]),
        target_app=str(handoff["target_app"]),
    )


async def _get_user_profile(user_id: str) -> dict | None:
    """Fetch user profile from Supabase by id."""
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
        # User may not exist yet, return None
        return None


async def _get_user_by_username(username: str) -> dict | None:
    """Fetch user profile by username."""
    try:
        result = (
            supabase_service.table("user_profiles")
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
                status_code=401, detail="Invalid or expired access token"
            )

        user_id = claims.get("sub")
        email = claims.get("email")

        if not user_id:
            raise HTTPException(status_code=401, detail="Token missing user ID")

        # Fetch user profile to get role and other metadata
        user = await _get_user_profile(user_id)
        if not user:
            raise HTTPException(
                status_code=401, detail="User profile not found in database"
            )

        if not user.get("active"):
            raise HTTPException(status_code=401, detail="User account is inactive")

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
                **_credential_flags(user),
            },
        )

    # Mode 2: PIN-based login (staff)
    elif req.username and req.pin:
        user = await _get_user_by_username(req.username)
        if not user:
            raise HTTPException(status_code=401, detail="Invalid credentials")

        if user["role"] != "staff":
            raise HTTPException(
                status_code=401, detail="PIN login only available for staff"
            )

        if req.pin != user.get("pin", ""):
            raise HTTPException(status_code=401, detail="Invalid PIN")

        # Mint a signed HS256 JWT (12-hour expiry) so staff tokens are validated
        # by the same jwt_validator path as admin/manager tokens.
        # Falls back to the legacy pin_ pseudo-token if SUPABASE_JWT_SECRET is absent.
        if SUPABASE_JWT_SECRET:
            now = datetime.datetime.now(datetime.timezone.utc)
            payload = {
                "sub": user["id"],
                "role": user["role"],
                "iat": int(now.timestamp()),
                "exp": int((now + datetime.timedelta(hours=12)).timestamp()),
            }
            staff_token = pyjwt.encode(payload, SUPABASE_JWT_SECRET, algorithm="HS256")
        else:
            # Transition safety: legacy unsigned token accepted by _deps.py pin_ branch.
            staff_token = f"pin_{user['id']}"

        return LoginResponse(
            access_token=staff_token,
            user={
                "id": user.get("id"),
                "username": user.get("username"),
                "display_name": user.get("display_name"),
                "last_name": user.get("last_name"),
                "role": user.get("role"),
                "active": user.get("active"),
                **_credential_flags(user),
            },
        )

    else:
        raise HTTPException(
            status_code=400, detail="Provide either access_token or username+pin"
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
        return UserInfo(**{**user, **_credential_flags(user)})

    # Handle Supabase JWT tokens
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = claims.get("sub")
    user = await _get_user_profile(user_id)
    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return UserInfo(**{**user, **_credential_flags(user)})
