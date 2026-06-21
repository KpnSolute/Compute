import os
import jwt
from pathlib import Path
from supabase import create_client
from dotenv import load_dotenv

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

supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
supabase_service = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)


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
