import datetime
import hashlib
import logging
import hmac
import os
import secrets
from urllib.parse import urlsplit

from fastapi import APIRouter, Depends, HTTPException, Header, Response
from pydantic import BaseModel, ConfigDict, Field
from backend.routes import (
    jwt_validator,
    supabase_admin,
    supabase_service,
)
from backend.routes._deps import _get_auth_user, _profile_for_token
from backend.staff_credentials import verify_staff_pin
from backend.staff_login_throttle import (
    ThrottleBackendError,
    current_state,
    register_failure,
    register_success,
)
from backend.staff_pin_admin import StaffPinBackendError, set_staff_pin
from backend.staff_sessions import StaffSessionConfigurationError, mint_staff_session
from backend.tenancy import list_user_tenants, tenancy_mode
from backend.audit_events import record_audit_event

router = APIRouter(prefix="/api/auth", tags=["auth"])

log = logging.getLogger("mjcc.routes.auth")


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
    tenant: dict | None = None
    workspaces: list[dict] = Field(default_factory=list)


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


def _handoff_client():
    """Use explicit admin predicates after cutover; preserve legacy rollout safety."""
    return supabase_admin if tenancy_mode() != "legacy" else supabase_service


def _with_workspace(user: dict, requested_slug: str | None = None) -> dict:
    """Return the login identity with its default workspace in tenant modes."""
    enriched = {**user, **_credential_flags(user)}
    if tenancy_mode() == "legacy":
        return enriched
    workspaces = list_user_tenants(supabase_admin, str(user["id"]))
    requested = (requested_slug or "").strip().lower()
    selected = next(
        (row for row in workspaces if row["slug"].lower() == requested), None
    )
    if requested and selected is None:
        raise HTTPException(
            status_code=403, detail="Workspace is unavailable for this account"
        )
    selected = selected or next((row for row in workspaces if row["is_default"]), None)
    selected = selected or (workspaces[0] if workspaces else None)
    if not selected:
        raise HTTPException(
            status_code=403, detail="Account has no active workspace membership"
        )
    return {
        **enriched,
        "role": selected["role"],
        "tenant": selected,
        "workspaces": workspaces,
    }


def _require_resolved_tenant_id(identity: dict, requested_tenant_id: str) -> None:
    """Reject a client tenant id that differs from the resolved membership."""
    claimed = (requested_tenant_id or "").strip()
    if not claimed:
        return
    resolved = str((identity.get("tenant") or {}).get("id") or "")
    if not resolved or resolved != claimed:
        raise HTTPException(status_code=403, detail="Immutable tenant context mismatch")


def _has_lioncafe_scope(role: str, tenant_id: str | None = None) -> bool:
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
        grants = (
            supabase_admin.table("role_permissions")
            if tenant_id
            else supabase_service.table("role_permissions")
        )
        grant = (
            grants.select("scope_key")
            .eq("role", role)
            .eq("scope_key", "lioncafe")
            .eq("allowed", True)
        )
        if tenant_id:
            grant = grant.eq("tenant_id", tenant_id)
        grant = grant.limit(1).execute()
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


def _has_app_scope(role: str, scope_key: str, tenant_id: str | None = None) -> bool:
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
        grants = (
            supabase_admin.table("role_permissions")
            if tenant_id
            else supabase_service.table("role_permissions")
        )
        grant = (
            grants.select("scope_key")
            .eq("role", role)
            .eq("scope_key", scope_key)
            .eq("allowed", True)
        )
        if tenant_id:
            grant = grant.eq("tenant_id", tenant_id)
        grant = grant.limit(1).execute()
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
            _handoff_client()
            .table("lunchvoice_sso_handoffs")
            .update({"consumed_at": now})
            .eq("code_hash", code_hash)
            .is_("consumed_at", "null")
            .gt("expires_at", now)
            .select(
                "user_id,tenant_slug,tenant_id"
                if tenancy_mode() != "legacy"
                else "user_id,tenant_slug"
            )
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
        or not _has_lioncafe_scope(
            str(user.get("role") or ""),
            str(handoff["tenant_id"]) if tenancy_mode() != "legacy" else None,
        )
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
            _handoff_client()
            .table("sso_handoffs")
            .update({"consumed_at": now})
            .eq("code_hash", code_hash)
            .eq("target_app", app)
            .is_("consumed_at", "null")
            .gt("expires_at", now)
            .select(
                "user_id,target_app,tenant_id"
                if tenancy_mode() != "legacy"
                else "user_id,target_app"
            )
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
        or not _has_app_scope(
            str(user.get("role") or ""),
            config["scope_key"],
            str(handoff["tenant_id"]) if tenancy_mode() != "legacy" else None,
        )
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
            supabase_admin.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        return result.data if result.data else None
    except Exception:
        # User may not exist yet, return None
        return None


class StaffUsernameLookupError(RuntimeError):
    """The tenant membership or user profile store is unreachable.

    Callers must fail closed (503) instead of returning a 401 that would
    leak whether the username exists.
    """


async def _get_user_by_username(
    username: str, tenant_id: str | None = None
) -> dict | None:
    """Fetch user profile by username, tenant-first.

    When ``tenant_id`` is provided, the set of active membership user IDs is
    resolved BEFORE the username lookup, so the same physical username can
    exist in different tenants.  A database failure at any point raises
    :class:`StaffUsernameLookupError` so the caller can fail closed (503)
    instead of masking the error as 401.
    """
    if not tenant_id:
        # Legacy or unscoped path — no membership filter available.
        try:
            result = (
                supabase_admin.table("user_profiles")
                .select("*")
                .eq("username", username)
                .eq("active", True)
                .limit(2)
                .execute()
            )
        except Exception as exc:
            raise StaffUsernameLookupError(
                "User profile store is unavailable."
            ) from exc
        rows = result.data or []
        return rows[0] if len(rows) == 1 else None

    # Tenant-first: resolve the set of active member user IDs, then
    # look up the username scoped to that set.
    try:
        memberships = (
            supabase_admin.table("tenant_memberships")
            .select("user_id")
            .eq("tenant_id", tenant_id)
            .eq("status", "active")
            .execute()
        )
    except Exception as exc:
        raise StaffUsernameLookupError(
            "Tenant membership store is unavailable."
        ) from exc

    try:
        member_ids = [str(row["user_id"]) for row in (memberships.data or [])]
    except (KeyError, TypeError) as exc:
        raise StaffUsernameLookupError(
            "Tenant membership store returned invalid data."
        ) from exc
    if not member_ids:
        return None

    try:
        result = (
            supabase_admin.table("user_profiles")
            .select("*")
            .eq("username", username)
            .eq("active", True)
            .in_("id", member_ids)
            .limit(2)
            .execute()
        )
    except Exception as exc:
        raise StaffUsernameLookupError("User profile store is unavailable.") from exc

    rows = result.data or []
    return rows[0] if len(rows) == 1 else None


def _record_throttle_failure(tenant_id: str | None, username: str) -> None:
    """Record a failed login attempt.  If the throttle store is unreachable,
    fail closed with 503 instead of silently swallowing the error."""
    try:
        register_failure(
            supabase_admin,
            tenant_id=tenant_id,
            username=username,
        )
    except ThrottleBackendError as exc:
        raise HTTPException(
            status_code=503,
            detail="Sign-in service temporarily unavailable",
        ) from exc


@router.post("/login", response_model=LoginResponse)
async def login(
    req: LoginRequest,
    x_kpn_workspace: str = Header("", alias="X-Kpn-Workspace"),
    x_kpn_tenant_id: str = Header("", alias="X-Kpn-Tenant-Id"),
):
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
        identity = _with_workspace(user, x_kpn_workspace or None)
        _require_resolved_tenant_id(identity, x_kpn_tenant_id)
        return LoginResponse(
            access_token=req.access_token,
            user={
                "id": identity.get("id"),
                "username": identity.get("username"),
                "display_name": identity.get("display_name"),
                "last_name": identity.get("last_name"),
                "role": identity.get("role"),
                "active": identity.get("active"),
                "email": email,  # From JWT
                "tenant": identity.get("tenant"),
                "workspaces": identity.get("workspaces", []),
                **_credential_flags(identity),
            },
        )

    # Mode 2: PIN-based login (staff)
    elif req.username and req.pin:
        # Tenant staff PIN login is ALWAYS tenant-bound. Every PIN login must
        # carry X-Kpn-Workspace, resolve an active tenant, and prove active
        # membership. There is no legacy global-username fallback.
        workspace_slug = (x_kpn_workspace or "").strip().lower()
        # Usernames are stored normalised to lowercase (users._normalize_username)
        # and the throttle key is lowercased (staff_login_throttle.subject_key),
        # but the profile lookup used to compare the raw input. A tablet that
        # autocapitalises "Jeremiah" therefore never matched a row while still
        # recording a failure against the real account — five attempts locked out
        # a working staff member. Normalise once, here, and use it everywhere in
        # this branch so lookup and throttle always agree on the subject.
        login_username = (req.username or "").strip().lower()
        if not workspace_slug:
            raise HTTPException(
                status_code=400,
                detail="X-Kpn-Workspace is required for staff PIN login",
            )

        # Resolve tenant for throttle and membership checks BEFORE any
        # credential verification — the throttle is tenant-scoped.
        resolved_tenant_id: str | None = None
        resolved_tenant_slug: str = ""
        try:
            tenant_row = (
                supabase_admin.table("tenants")
                .select("id,slug")
                .eq("slug", workspace_slug)
                .eq("status", "active")
                .limit(1)
                .execute()
            )
            if tenant_row.data:
                resolved_tenant_id = str(tenant_row.data[0]["id"])
                resolved_tenant_slug = str(tenant_row.data[0]["slug"])
        except Exception as exc:
            raise HTTPException(
                status_code=503,
                detail="Sign-in service temporarily unavailable",
            ) from exc

        if not resolved_tenant_id:
            raise HTTPException(
                status_code=404,
                detail="Workspace not found or inactive",
            )

        # Throttle gate — fail closed on backend errors.
        try:
            throttle = current_state(
                supabase_admin,
                tenant_id=resolved_tenant_id,
                username=login_username,
            )
            if throttle.get("locked"):
                retry_after = int(throttle.get("retry_after_seconds") or 900)
                raise HTTPException(
                    status_code=429,
                    detail="Too many failed attempts",
                    headers={"Retry-After": str(retry_after)},
                )
        except HTTPException:
            raise
        except ThrottleBackendError:
            raise HTTPException(
                status_code=503,
                detail="Sign-in service temporarily unavailable",
            )

        # Uniform error message for all credential failures — no account
        # enumeration via differing 401 text.
        INVALID_CREDENTIALS_MSG = "Invalid credentials"

        try:
            user = await _get_user_by_username(login_username, resolved_tenant_id)
            if not user:
                _record_throttle_failure(resolved_tenant_id, login_username)
                raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS_MSG)
        except HTTPException:
            raise
        except StaffUsernameLookupError as exc:
            raise HTTPException(
                status_code=503,
                detail="Sign-in service temporarily unavailable",
            ) from exc

        try:
            if user["role"] != "staff":
                _record_throttle_failure(resolved_tenant_id, login_username)
                raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS_MSG)

            pin_ok, upgrade_hash = verify_staff_pin(req.pin, user)
            if not pin_ok:
                _record_throttle_failure(resolved_tenant_id, login_username)
                raise HTTPException(status_code=401, detail=INVALID_CREDENTIALS_MSG)

            # Atomic credential upgrade: replace legacy plaintext with a hash
            # via the credential manager RPC so pin_version is bumped and old-
            # generation sessions are revoked.  Fail closed on backend errors.
            credential_version = int(user.get("pin_version") or 0)
            if upgrade_hash:
                try:
                    pin_result = set_staff_pin(
                        supabase_admin,
                        user_id=str(user["id"]),
                        tenant_id=resolved_tenant_id,
                        pin=req.pin,
                        actor_id=str(user["id"]),
                    )
                    credential_version = int(
                        pin_result.get("pin_version") or credential_version
                    )
                except StaffPinBackendError as exc:
                    raise HTTPException(
                        status_code=503,
                        detail="Sign-in service temporarily unavailable",
                    ) from exc

            # Mint a signed, tenant-bound staff session.
            tenant_id_for_session = resolved_tenant_id or ""
            tenant_slug_for_session = resolved_tenant_slug or ""
            staff_token, _claims = mint_staff_session(
                user_id=str(user["id"]),
                tenant_id=tenant_id_for_session,
                tenant_slug=tenant_slug_for_session,
                role=str(user["role"]),
                credential_version=credential_version,
            )

            try:
                register_success(
                    supabase_admin,
                    tenant_id=resolved_tenant_id,
                    username=login_username,
                )
            except ThrottleBackendError as exc:
                raise HTTPException(
                    status_code=503,
                    detail="Sign-in service temporarily unavailable",
                ) from exc

            identity = _with_workspace(user, x_kpn_workspace or None)
            _require_resolved_tenant_id(identity, x_kpn_tenant_id)
            return LoginResponse(
                access_token=staff_token,
                user={
                    "id": identity.get("id"),
                    "username": identity.get("username"),
                    "display_name": identity.get("display_name"),
                    "last_name": identity.get("last_name"),
                    "role": identity.get("role"),
                    "active": identity.get("active"),
                    "tenant": identity.get("tenant"),
                    "workspaces": identity.get("workspaces", []),
                    **_credential_flags(identity),
                },
            )

        except HTTPException:
            raise
        except StaffSessionConfigurationError as exc:
            # The staff signing key is missing or too short. Without this the
            # session cannot be minted, so fail closed with an explicit 503
            # rather than letting a RuntimeError surface as an unhandled 500 —
            # an unhandled 500 also loses its CORS headers, which makes a
            # configuration problem look like a browser CORS failure.
            log.error("staff_session_not_configured: %s", exc)
            raise HTTPException(
                status_code=503,
                detail="Sign-in service temporarily unavailable",
            ) from exc
        except ThrottleBackendError:
            raise HTTPException(
                status_code=503,
                detail="Sign-in service temporarily unavailable",
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


class SessionEventBody(BaseModel):
    """A client-side session lifecycle event.

    Deliberately carries NO credentials — only the reason a session ended and
    safe diagnostic context. The frontend posts one of these on every teardown
    so "a logout event lacks a reason" (a release gate) is answerable from the
    durable log rather than from guesswork.
    """

    reason: str
    detail: str = ""
    path: str = ""


_SESSION_REASONS = {
    "idle",
    "unauthorized",
    "logout",
    "refresh_failed",
    "refresh_recovered",
    "cross_tab_logout",
    "token_expired",
}


@router.post("/session-event", status_code=202)
async def session_event(
    body: SessionEventBody,
    authorization: str = Header(""),
    x_kpn_workspace: str = Header("", alias="X-Kpn-Workspace"),
):
    """Record why a session ended (or recovered). Unauthenticated by design.

    A session that has already been torn down has no usable token, so requiring
    auth here would drop exactly the events worth keeping. The actor is
    therefore best-effort: resolved from the token when one is still attached,
    otherwise the event stands on its reason alone.
    """
    reason = (body.reason or "").strip().lower()
    if reason not in _SESSION_REASONS:
        raise HTTPException(
            status_code=422,
            detail=f"reason must be one of {sorted(_SESSION_REASONS)}",
        )

    actor: dict = {}
    token = authorization.replace("Bearer ", "") if authorization else ""
    if token:
        try:
            actor = _with_workspace(
                _profile_for_token(authorization), x_kpn_workspace or None
            )
        except Exception:
            # Expected for an expired/rejected token — that IS the event.
            actor = {}

    record_audit_event(
        action="session.teardown",
        # Recovery is a normal observed transition, not a terminal failure.
        result="observed" if reason == "refresh_recovered" else "expired",
        actor=actor,
        method="POST",
        path="/api/auth/session-event",
        target_type="session",
        session_reason=reason,
        status_code=202,
        detail=f"{body.detail} (origin path: {body.path})".strip(),
    )
    return {"recorded": True, "reason": reason}


@router.get("/me", response_model=UserInfo)
async def me(current_user: dict = Depends(_get_auth_user)):
    """Return the authenticated identity and active workspace."""
    return UserInfo(**{**current_user, **_credential_flags(current_user)})
