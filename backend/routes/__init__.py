import os
import jwt
from pathlib import Path
from supabase import create_client
from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parents[2] / '.env')

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")
SUPABASE_JWT_SECRET = os.getenv("SUPABASE_JWT_SECRET")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env before starting the server."
    )

if not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_KEY must be set in .env for service-role data access.")

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
    """Validate Supabase Auth JWT tokens."""

    @staticmethod
    def verify_token(token: str) -> dict | None:
        """
        Verify a Supabase JWT token and extract user claims.

        Returns:
            User claims dict with 'sub' (user_id), 'email', 'role' if valid.
            None if token is invalid, expired, or JWT secret is not configured.
        """
        if not SUPABASE_JWT_SECRET:
            return None
        try:
            decoded = jwt.decode(
                token,
                SUPABASE_JWT_SECRET,
                algorithms=["HS256"],
                options={"verify_aud": False},  # Supabase uses 'authenticated' as aud
            )
            return decoded
        except Exception:
            return None

    @staticmethod
    def extract_user_id(token: str) -> str | None:
        """Extract user_id (sub claim) from token."""
        claims = JWTValidator.verify_token(token)
        return claims.get("sub") if claims else None

    @staticmethod
    def extract_email(token: str) -> str | None:
        """Extract email from token."""
        claims = JWTValidator.verify_token(token)
        return claims.get("email") if claims else None


jwt_validator = JWTValidator()
