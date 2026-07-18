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
            key = self.filters.get("key")
            active = key in self.db.active_scopes
            return SimpleNamespace(data=[{"key": key}] if active else [])
        if self.table == "role_permissions":
            role = self.filters.get("role")
            scope_key = self.filters.get("scope_key")
            granted = (role, scope_key) in self.db.allowed_grants
            return SimpleNamespace(data=[{"scope_key": scope_key}] if granted else [])
        if self.table != "sso_handoffs":
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
                    and row.get("target_app") == self.filters.get("target_app")
                    and row.get("consumed_at") is None
                    and row["expires_at"] > self.filters.get("expires_at__gt", "")
                ):
                    row.update(self.values)
                    return SimpleNamespace(
                        data=[
                            {
                                "user_id": row["user_id"],
                                "target_app": row["target_app"],
                            }
                        ]
                    )
            return SimpleNamespace(data=[])
        return SimpleNamespace(data=[])


class FakeDb:
    def __init__(self):
        self.active_scopes = {"marquee"}
        self.allowed_grants = {
            ("manager", "marquee"),
            ("admin", "marquee"),
            ("sudo", "marquee"),
        }
        self.handoffs = []

    def table(self, name):
        return FakeQuery(self, name)


def _set_env(monkeypatch):
    monkeypatch.setenv("MARQUEE_SSO_SECRET", "m" * 48)
    monkeypatch.setenv("MARQUEE_SSO_URL", "https://marquee.example.com/sso")


def test_unknown_app_is_rejected(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)
    user = {
        "id": "user-1",
        "username": "manager.one",
        "role": "manager",
        "active": True,
    }
    response = SimpleNamespace(headers={})
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.start_sso("not-an-app", response, user))
    assert exc.value.status_code == 404

    request = auth.SsoExchangeRequest(code="a" * 43)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            auth.exchange_sso(
                "not-an-app", request, SimpleNamespace(headers={}), "x" * 48
            )
        )
    assert exc.value.status_code == 404


def test_role_scope_is_live_and_fail_closed_per_app(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "supabase_service", db)
    assert auth._has_app_scope("manager", "marquee") is True
    assert auth._has_app_scope("staff", "marquee") is False
    db.active_scopes.discard("marquee")
    assert auth._has_app_scope("sudo", "marquee") is False


def test_start_stores_only_hash_and_fragment_code(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)

    user = {
        "id": "user-1",
        "username": "manager.one",
        "role": "manager",
        "active": True,
    }
    response = SimpleNamespace(headers={})
    result = asyncio.run(auth.start_sso("marquee", response, user))
    fragment = parse_qs(urlsplit(result.redirect_url).fragment)
    raw_code = fragment["code"][0]

    assert urlsplit(result.redirect_url).query == ""
    assert raw_code not in str(db.handoffs)
    assert db.handoffs[0]["code_hash"] == hashlib.sha256(raw_code.encode()).hexdigest()
    assert db.handoffs[0]["target_app"] == "marquee"
    assert result.expires_in == 60
    assert response.headers["Cache-Control"] == "no-store"


def test_start_rejects_role_without_marquee_scope(monkeypatch):
    db = FakeDb()
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)

    user = {"id": "user-1", "username": "staffer", "role": "staff", "active": True}
    with pytest.raises(HTTPException) as exc:
        asyncio.run(auth.start_sso("marquee", SimpleNamespace(headers={}), user))
    assert exc.value.status_code == 403


def _seed_handoff(
    db, raw_code, *, target_app="marquee", expires_at="2999-01-01T00:00:00+00:00"
):
    db.handoffs.append(
        {
            "code_hash": hashlib.sha256(raw_code.encode()).hexdigest(),
            "user_id": "user-1",
            "target_app": target_app,
            "expires_at": expires_at,
            "consumed_at": None,
        }
    )


def _profile(**overrides):
    async def profile(_user_id):
        return {
            "id": "user-1",
            "username": "manager.one",
            "display_name": "Manager",
            "last_name": "One",
            "email": "manager.one@example.com",
            "role": "manager",
            "active": True,
            **overrides,
        }

    return profile


def test_exchange_is_one_time_use(monkeypatch):
    db = FakeDb()
    raw_code = "a" * 43
    _seed_handoff(db, raw_code)
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)
    monkeypatch.setattr(auth, "_get_user_profile", _profile())

    request = auth.SsoExchangeRequest(code=raw_code)
    identity = asyncio.run(
        auth.exchange_sso("marquee", request, SimpleNamespace(headers={}), "m" * 48)
    )
    assert identity.username == "manager.one"
    assert identity.target_app == "marquee"

    with pytest.raises(HTTPException) as replay:
        asyncio.run(
            auth.exchange_sso("marquee", request, SimpleNamespace(headers={}), "m" * 48)
        )
    assert replay.value.status_code == 401


def test_exchange_rejects_expired_code(monkeypatch):
    db = FakeDb()
    raw_code = "b" * 43
    _seed_handoff(db, raw_code, expires_at="2000-01-01T00:00:00+00:00")
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)
    monkeypatch.setattr(auth, "_get_user_profile", _profile())

    request = auth.SsoExchangeRequest(code=raw_code)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            auth.exchange_sso("marquee", request, SimpleNamespace(headers={}), "m" * 48)
        )
    assert exc.value.status_code == 401


def test_exchange_rejects_target_app_mismatch(monkeypatch):
    db = FakeDb()
    raw_code = "c" * 43
    # Handoff was minted for a different target app than the one being exchanged.
    _seed_handoff(db, raw_code, target_app="other-app")
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)
    monkeypatch.setattr(auth, "_get_user_profile", _profile())

    request = auth.SsoExchangeRequest(code=raw_code)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            auth.exchange_sso("marquee", request, SimpleNamespace(headers={}), "m" * 48)
        )
    assert exc.value.status_code == 401


def test_exchange_rejects_invalid_secret(monkeypatch):
    db = FakeDb()
    raw_code = "d" * 43
    _seed_handoff(db, raw_code)
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)

    request = auth.SsoExchangeRequest(code=raw_code)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            auth.exchange_sso(
                "marquee", request, SimpleNamespace(headers={}), "wrong-secret" * 4
            )
        )
    assert exc.value.status_code == 401


def test_exchange_rejects_revoked_access(monkeypatch):
    db = FakeDb()
    raw_code = "e" * 43
    _seed_handoff(db, raw_code)
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)
    # Role was granted marquee access when the handoff started, but has since
    # been revoked from the live role matrix before the exchange happens.
    db.allowed_grants.discard(("manager", "marquee"))
    monkeypatch.setattr(auth, "_get_user_profile", _profile())

    request = auth.SsoExchangeRequest(code=raw_code)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            auth.exchange_sso("marquee", request, SimpleNamespace(headers={}), "m" * 48)
        )
    assert exc.value.status_code == 403


def test_exchange_rejects_inactive_account(monkeypatch):
    db = FakeDb()
    raw_code = "f" * 43
    _seed_handoff(db, raw_code)
    monkeypatch.setattr(auth, "supabase_service", db)
    _set_env(monkeypatch)
    monkeypatch.setattr(auth, "_get_user_profile", _profile(active=False))

    request = auth.SsoExchangeRequest(code=raw_code)
    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            auth.exchange_sso("marquee", request, SimpleNamespace(headers={}), "m" * 48)
        )
    assert exc.value.status_code == 403
