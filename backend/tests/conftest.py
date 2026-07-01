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

if "jwt" not in sys.modules:
    mock_jwt = MagicMock()
    mock_jwt.PyJWKClient = MagicMock()
    sys.modules["jwt"] = mock_jwt

if "dotenv" not in sys.modules:
    mock_dotenv = MagicMock()
    mock_dotenv.load_dotenv = MagicMock(return_value=True)
    sys.modules["dotenv"] = mock_dotenv

if "fastapi" not in sys.modules:
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

if "pydantic" not in sys.modules:
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
