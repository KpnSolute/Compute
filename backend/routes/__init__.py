import os
from uuid import uuid4
from datetime import datetime
from supabase import create_client
from dotenv import load_dotenv

load_dotenv()

SUPABASE_URL = os.getenv("SUPABASE_URL")
SUPABASE_ANON_KEY = os.getenv("SUPABASE_ANON_KEY")

if not SUPABASE_URL or not SUPABASE_ANON_KEY:
    raise RuntimeError('SUPABASE_URL and SUPABASE_ANON_KEY must be set in .env before starting the server.')

supabase = create_client(SUPABASE_URL, SUPABASE_ANON_KEY)


class SessionStore:
    def __init__(self):
        self._sessions = {}

    def create(self, user_data):
        token = str(uuid4())
        self._sessions[token] = {
            "user": user_data,
            "created_at": datetime.utcnow().isoformat(),
        }
        return token

    def get(self, token):
        session = self._sessions.get(token)
        return session["user"] if session else None

    def delete(self, token):
        self._sessions.pop(token, None)


sessions = SessionStore()
