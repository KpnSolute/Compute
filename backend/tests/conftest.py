import importlib.util
import sys
import os
from unittest.mock import MagicMock

os.environ.setdefault("SUPABASE_URL", "https://example.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret")

# Stub the supabase package so dispatch/routes modules can be imported in tests
# without the real SDK installed. Tests that need real DB behaviour use SUPABASE_URL.
if "supabase" not in sys.modules:
    mock_sb = MagicMock()
    sys.modules["supabase"] = mock_sb
    sys.modules["supabase.client"] = mock_sb

# Only stub pyjwt when it is genuinely unavailable. It IS installed here, and
# stubbing it made every staff-session security control untestable: mint/verify
# round-trips, signature tampering, expiry, audience, issuer, and
# credential-version revocation all silently degraded to MagicMock comparisons.
# PyJWKClient is still stubbed on the real module because it performs network
# JWKS fetches that tests must never make.
if importlib.util.find_spec("jwt") is None and "jwt" not in sys.modules:
    mock_jwt = MagicMock()
    mock_jwt.PyJWKClient = MagicMock()
    sys.modules["jwt"] = mock_jwt
else:
    import jwt as _real_jwt

    _real_jwt.PyJWKClient = MagicMock()

if "dotenv" not in sys.modules:
    mock_dotenv = MagicMock()
    mock_dotenv.load_dotenv = MagicMock(return_value=True)
    sys.modules["dotenv"] = mock_dotenv

# Use the real FastAPI package whenever the development environment provides it.
# The old unconditional stub polluted sys.modules during collection, so the
# separate root-level health test later saw a MagicMock instead of the package
# and failed with: "fastapi.testclient; 'fastapi' is not a package".
if importlib.util.find_spec("fastapi") is None and "fastapi" not in sys.modules:
    mock_fastapi = MagicMock()
    mock_fastapi_responses = MagicMock()

    class HTTPException(Exception):
        def __init__(self, status_code: int = 500, detail: str | None = None):
            self.status_code = status_code
            self.detail = detail
            super().__init__(detail)

    class APIRouter:
        def __init__(self, *args, **kwargs):
            pass

        def _decorator(self, *args, **kwargs):
            def wrap(fn):
                return fn

            return wrap

        get = post = put = patch = delete = _decorator

    def _identity_default(default=None, *args, **kwargs):
        return default

    mock_fastapi.APIRouter = APIRouter
    mock_fastapi.HTTPException = HTTPException
    mock_fastapi.Query = _identity_default
    mock_fastapi.Header = _identity_default
    mock_fastapi.Depends = _identity_default
    mock_fastapi.File = _identity_default
    mock_fastapi.UploadFile = MagicMock
    mock_fastapi_responses.StreamingResponse = MagicMock
    sys.modules["fastapi"] = mock_fastapi
    sys.modules["fastapi.responses"] = mock_fastapi_responses

# Keep the installed Pydantic package intact when available.  FastAPI imports
# its submodules during collection; replacing it with a MagicMock breaks both
# FastAPI itself and fastapi.testclient.
if importlib.util.find_spec("pydantic") is None and "pydantic" not in sys.modules:
    mock_pydantic = MagicMock()

    class BaseModel:
        def __init__(self, **kwargs):
            for key, value in kwargs.items():
                setattr(self, key, value)

    def Field(default=None, *args, default_factory=None, **kwargs):
        if default_factory is not None:
            return default_factory()
        return default

    mock_pydantic.BaseModel = BaseModel
    mock_pydantic.Field = Field
    mock_pydantic.ConfigDict = dict
    mock_pydantic.EmailStr = str
    sys.modules["pydantic"] = mock_pydantic
