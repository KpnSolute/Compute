import asyncio
import hashlib
from types import SimpleNamespace
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import HTTPException

from backend.routes import auth


class FakeQuery:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.operation = "select"
        self.values = {}
        self.filters = {}

    def select(self, *_args):
        return self

    def insert(self, values):
        self.operation = "insert"
        self.values = values
        return self

    def update(self, values):
        self.operation = "update"
        self.values = values
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def is_(self, key, value):
        self.filters[key] = None if value == "null" else value
        return self

    def gt(self, key, value):
        self.filters[f"{key}__gt"] = value
        return self

    def lt(self, key, value):
        self.filters[f"{key}__lt"] = value
        return self

    def limit(self, _value):
        return self

    def execute(self):
        if self.table == "permission_scopes":
            active = self.db.scope_active and self.filters.get("key") == "lioncafe"
            return SimpleNamespace(data=[{"key": "lioncafe"}] if active else [])
        if self.table == "role_permissions":
            role = self.filters.get("role")
            granted = (
                role in self.db.allowed_roles
                and self.filters.get("scope_key") == "lioncafe"
            )
            return SimpleNamespace(data=[{"scope_key": "lioncafe"}] if granted else [])
        if self.table != "lunchvoice_sso_handoffs":
            return SimpleNamespace(data=[])

        if self.operation == "delete":
            return SimpleNamespace(data=[])
        if self.operation == "insert":
            self.db.handoffs.append(dict(self.values))
            return SimpleNamespace(data=[self.values])
        if self.operation == "update":
            for row in self.db.handoffs:
                if (
                    row["code_hash"] == self.filters.get("code_hash")
                    and row.get("consumed_at") is None
                    and row["expires_at"] > self.filters.get("expires_at__gt", "")
                ):
                    row.update(self.values)
                    return SimpleNamespace(
                        data=[
                            {
                                "user_id": row["user_id"],
                                "tenant_slug": row["tenant_slug"],
                            }
                        ]
                    )
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=[])


class FakeDb:
    def __init__(self):
        self.scope_active = True
        self.allowed_roles = {"manager", "admin", "sudo"}
        self.handoffs = []

    def table(self, name):
        return FakeQuery(self, name)


def test_role_scope_is_live_and_fail_closed(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "supabase_service", db)
    assert auth._has_lioncafe_scope("manager") is True
    assert auth._has_lioncafe_scope("staff") is False
    db.scope_active = False
    assert auth._has_lioncafe_scope("sudo") is False


def test_start_stores_only_hash_and_fragment_code(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "supabase_service", db)
    monkeypatch.setenv("LUNCHVOICE_SSO_SECRET", "x" * 48)
    monkeypatch.setenv(
        "LUNCHVOICE_SSO_URL", "https://interact-3npi.onrender.com/LionCafe/sso"
    )

    user = {
        "id": "user-1",
        "username": "manager.one",
        "role": "manager",
        "active": True,
    }
    response = SimpleNamespace(headers={})
    result = asyncio.run(auth.start_lunchvoice_sso(response, user))
    fragment = parse_qs(urlsplit(result.redirect_url).fragment)
    raw_code = fragment["code"][0]

    assert urlsplit(result.redirect_url).query == ""
    assert raw_code not in str(db.handoffs)
    assert db.handoffs[0]["code_hash"] == hashlib.sha256(raw_code.encode()).hexdigest()
    assert result.expires_in == 60
    assert response.headers["Cache-Control"] == "no-store"


def test_exchange_is_one_time_and_rechecks_permission(monkeypatch):
    db = FakeDb()
    raw_code = "a" * 43
    db.handoffs.append(
        {
            "code_hash": hashlib.sha256(raw_code.encode()).hexdigest(),
            "user_id": "user-1",
            "tenant_slug": "LionCafe",
            "expires_at": "2999-01-01T00:00:00+00:00",
            "consumed_at": None,
        }
    )
    monkeypatch.setattr(auth, "supabase_service", db)
    monkeypatch.setenv("LUNCHVOICE_SSO_SECRET", "x" * 48)

    async def profile(_user_id):
        return {
            "id": "user-1",
            "username": "manager.one",
            "display_name": "Manager",
            "last_name": "One",
            "email": "manager.one@example.com",
            "role": "manager",
            "active": True,
        }

    monkeypatch.setattr(auth, "_get_user_profile", profile)
    request = auth.LunchvoiceSsoExchangeRequest(code=raw_code)
    response = SimpleNamespace(headers={})
    identity = asyncio.run(auth.exchange_lunchvoice_sso(request, response, "x" * 48))
    assert identity.username == "manager.one"
    assert identity.tenant_slug == "LionCafe"
    assert response.headers["Cache-Control"] == "no-store"

    with pytest.raises(HTTPException) as replay:
        asyncio.run(
            auth.exchange_lunchvoice_sso(request, SimpleNamespace(headers={}), "x" * 48)
        )
    assert replay.value.status_code == 401
