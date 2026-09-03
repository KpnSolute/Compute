import asyncio
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.routes import data as data_routes


class FakeQuery:
    def __init__(self, db, table):
        self.db = db
        self.table = table
        self.operation = "select"
        self.payload = None
        self.filters = {}

    def select(self, *_args, **_kwargs):
        self.operation = "select"
        return self

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def eq(self, key, value):
        self.filters[key] = value
        return self

    def limit(self, _value):
        return self

    def execute(self):
        if self.table == "user_profiles":
            rows = [
                row
                for row in self.db.users
                if all(row.get(key) == value for key, value in self.filters.items())
            ]
            return SimpleNamespace(data=rows)
        if self.table == "servsafe_certifications" and self.operation == "select":
            rows = [
                row
                for row in self.db.certifications
                if all(row.get(key) == value for key, value in self.filters.items())
            ]
            return SimpleNamespace(data=rows)
        if self.table == "servsafe_certifications" and self.operation == "insert":
            row = {"id": "cert-1", **self.payload}
            self.db.certifications.append(row)
            return SimpleNamespace(data=[row])
        raise AssertionError(f"Unexpected query: {self.table} {self.operation}")


class FakeSupabase:
    def __init__(self):
        self.users = [
            {
                "id": "manager-1",
                "display_name": "Othniel",
                "last_name": "McDowell",
                "username": "othniel",
                "role": "manager",
                "active": True,
            }
        ]
        self.certifications = []

    def table(self, name):
        return FakeQuery(self, name)


def test_servsafe_defaults_follow_account_role():
    assert data_routes._default_servsafe_certification("staff") == (
        "ServSafe Food Handler"
    )
    assert data_routes._default_servsafe_certification("assistant") == (
        "ServSafe Food Handler"
    )
    assert data_routes._default_servsafe_certification("manager") == (
        "ServSafe Manager"
    )
    assert data_routes._default_servsafe_certification("sudo") == "ServSafe Manager"


def test_create_servsafe_links_real_account_and_uses_role_default(monkeypatch):
    fake = FakeSupabase()
    monkeypatch.setattr(data_routes, "supabase_service", fake)
    monkeypatch.setattr(data_routes, "tenancy_mode", lambda: "legacy")

    created = asyncio.run(
        data_routes.create_servsafe(
            data_routes.ServSafeCreate(user_id="manager-1"),
            {"id": "actor-1", "role": "manager"},
        )
    )

    assert created["user_id"] == "manager-1"
    assert created["staff_name"] == "Othniel McDowell"
    assert created["certification"] == "ServSafe Manager"
    assert created["expiry_date"] is None


def test_create_servsafe_rejects_duplicate_account_certification(monkeypatch):
    fake = FakeSupabase()
    fake.certifications.append(
        {
            "id": "existing",
            "user_id": "manager-1",
            "certification": "ServSafe Manager",
        }
    )
    monkeypatch.setattr(data_routes, "supabase_service", fake)
    monkeypatch.setattr(data_routes, "tenancy_mode", lambda: "legacy")

    with pytest.raises(HTTPException) as exc:
        asyncio.run(
            data_routes.create_servsafe(
                data_routes.ServSafeCreate(user_id="manager-1"),
                {"id": "actor-1", "role": "manager"},
            )
        )

    assert exc.value.status_code == 409


def test_account_linked_migration_keeps_legacy_rows_unassigned():
    migration = (
        Path(data_routes.__file__).parents[1]
        / "migrations"
        / "053_account_linked_servsafe_and_organization.sql"
    )
    sql = migration.read_text(encoding="utf-8").lower()

    assert "add column if not exists user_id uuid" in sql
    assert "foreign key (tenant_id, user_id)" in sql
    assert "where user_id is not null" in sql
    assert "update public.servsafe_certifications" not in sql
