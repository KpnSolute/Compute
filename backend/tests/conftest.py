import sys
from unittest.mock import MagicMock

# Stub the supabase package so dispatch/routes modules can be imported in tests
# without the real SDK installed. Tests that need real DB behaviour use SUPABASE_URL.
if 'supabase' not in sys.modules:
    mock_sb = MagicMock()
    sys.modules['supabase'] = mock_sb
    sys.modules['supabase.client'] = mock_sb
