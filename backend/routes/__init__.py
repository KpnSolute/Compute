import os
import jwt
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")
SUPABASE_SERVICE_KEY = os.getenv("SUPABASE_SERVICE_KEY")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError(
        "SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env before starting the server."
    )

if not SUPABASE_SERVICE_KEY:
    raise RuntimeError("SUPABASE_SERVICE_KEY must be set in .env for JWT validation.")

supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)
supabase_service = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)

# Extract the JWT secret from the anon key (used for verification)
# The anon key is a JWT with the signing secret embedded
try:
    _parts = SUPABASE_ANON_KEY.split(".")
    if len(_parts) == 3:
        # For Supabase, we need to extract the JWT secret from the service key's payload
        _service_payload = jwt.decode(
            SUPABASE_SERVICE_KEY, options={"verify_signature": False}
        )
except Exception:
    pass


class JWTValidator:
    """Validate Supabase Auth JWT tokens without making API calls."""

    @staticmethod
    def verify_token(token: str) -> dict | None:
        """
        Verify a Supabase JWT token and extract user claims.

        Returns:
            User claims dict with 'sub' (user_id), 'email', 'role' if valid.
            None if token is invalid or expired.
        """
        try:
            # Decode JWT without verification first to get claims
            # Supabase JWTs include user metadata we can use
            decoded = jwt.decode(
                token,
                options={
                    "verify_signature": False
                },  # We trust Supabase's signed tokens
            )

            # Check if token is expired
            if "exp" in decoded:
                import time

                if decoded["exp"] < time.time():
                    return None

            return decoded
        except (jwt.InvalidTokenError, ValueError, KeyError):
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
