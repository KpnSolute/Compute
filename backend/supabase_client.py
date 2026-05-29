import os

from dotenv import load_dotenv

from supabase import create_client

load_dotenv()

SUPABASE_URL = os.getenv('SUPABASE_URL', '')
SUPABASE_SERVICE_KEY = os.getenv('SUPABASE_SERVICE_KEY', '')

_client = None


def get_client():
    global _client
    if _client is None:
        if not SUPABASE_URL or not SUPABASE_SERVICE_KEY:
            raise RuntimeError('Supabase not configured. Check .env for SUPABASE_URL and SUPABASE_SERVICE_KEY.')
        _client = create_client(SUPABASE_URL, SUPABASE_SERVICE_KEY)
    return _client
