import os

import jwt
from pathlib import Path

import httpx
from supabase import ClientOptions, create_client
from dotenv import load_dotenv
from backend.tenancy import TenantScopedClient

load_dotenv(Path(__file__).resolve().parents[2] / ".env")

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env before starting the server."
    )

if not SUPABASE_SERVICE_KEY:
    raise RuntimeError(
        "SUPABASE_SERVICE_KEY must be set in .env for service-role data access."
    )

if not SUPABASE_JWT_SECRET:
    import warnings

    warnings.warn(
        "SUPABASE_JWT_SECRET is not set — admin/manager JWT login will be rejected. "
        "Get it from Supabase dashboard → Settings → API → JWT Secret.",
        RuntimeWarning,
        stacklevel=2,
    )


def _supabase_options() -> ClientOptions:
    """Client options whose pool recycles connections before Supabase drops them.

    postgrest otherwise builds its own httpx client with `http2=True` and no
    keepalive expiry, and these clients are process-lifetime singletons. Supabase
    closes idle connections; reusing one afterwards fails on read, which showed up
    as a burst of 500s across /api/inventory, /api/commits, /api/staging and
    /api/auth/me every time traffic went quiet (ReadError EAGAIN, plus h2 stream
    corruption). A short keepalive_expiry drops idle sockets locally first, and
    HTTP/1.1 removes the h2 state-machine failures entirely.

    Builds a fresh httpx client per call: supabase sets headers on the client it
    is handed, so the anon and service-role clients must not share one.
    """
    return ClientOptions(httpx_client=pooled_httpx_client())


def pooled_httpx_client() -> httpx.Client:
    """The httpx client the Supabase clients are built on. See _supabase_options."""
    return httpx.Client(
        transport=httpx.HTTPTransport(
            retries=2,
            http2=False,
            limits=httpx.Limits(
                max_connections=50,
                max_keepalive_connections=10,
                keepalive_expiry=15.0,
            ),
        ),
        # Matches postgrest's own default so request budgets are unchanged.
        timeout=httpx.Timeout(120.0),
    )


supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY, options=_supabase_options())
supabase_admin = create_client(
    SUPABASE_URL, SUPABASE_SERVICE_KEY, options=_supabase_options()
)
supabase_service = TenantScopedClient(supabase_admin)


class JWTValidator:
    """Validate Supabase Auth JWT tokens (supports ES256 + HS256)."""

    def __init__(self):
        self._jwks_client = None

    def _get_jwks_client(self):
        if self._jwks_client is None:
            from jwt import PyJWKClient

            jwks_url = f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json"
            self._jwks_client = PyJWKClient(jwks_url, cache_keys=True)
        return self._jwks_client

    def verify_token(self, token: str) -> dict | None:
        """
        Verify a Supabase JWT token and extract user claims.

        Supports ES256 (via JWKS) and HS256 (via JWT secret).
        Returns claims dict or None.
        """
        # Try ES256 via JWKS first (modern Supabase Auth)
        try:
            jwks = self._get_jwks_client()
            signing_key = jwks.get_signing_key_from_jwt(token)
            decoded = jwt.decode(
                token,
                signing_key.key,
                algorithms=["ES256"],
                audience="authenticated",
                options={"verify_exp": True},
            )
            return decoded
        except Exception:
            pass

        # Fallback: HS256 with JWT secret (legacy or custom config)
        if SUPABASE_JWT_SECRET:
            try:
                decoded = jwt.decode(
                    token,
                    SUPABASE_JWT_SECRET,
                    algorithms=["HS256"],
                    options={"verify_aud": False},
                )
                return decoded
            except Exception:
                pass

        return None

    def extract_user_id(self, token: str) -> str | None:
        claims = self.verify_token(token)
        return claims.get("sub") if claims else None

    def extract_email(self, token: str) -> str | None:
        claims = self.verify_token(token)
        return claims.get("email") if claims else None


jwt_validator = JWTValidator()
