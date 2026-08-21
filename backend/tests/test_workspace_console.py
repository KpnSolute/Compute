import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from backend.routes import workspace_console
from backend.routes.workspace_console import RESERVED_SLUGS, _slug, _tenant


class ResolveQuery:
    def __init__(self, rows):
        self.rows = rows
        self.filters = []

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def limit(self, _value):
        return self

    def execute(self):
        rows = [
            row
            for row in self.rows
            if all(str(row.get(key)) == str(value) for key, value in self.filters)
        ]
        return type("Response", (), {"data": rows})()


class ResolveClient:
    def __init__(self, rows):
        self.rows = rows

    def table(self, name):
        assert name == "tenants"
        return ResolveQuery(self.rows)


def _resolve_client(monkeypatch, rows):
    monkeypatch.setattr(workspace_console, "supabase_admin", ResolveClient(rows))
    app = FastAPI()
    app.include_router(workspace_console.router)
    return TestClient(app)


def test_workspace_slug_rejects_reserved_product_routes():
    assert "api" in RESERVED_SLUGS
    with pytest.raises(HTTPException) as exc:
        _slug("Login", workspace=True)
    assert exc.value.status_code == 409


def test_workspace_slug_normalizes_customer_route():
    assert _slug("  North-Star  ", workspace=True) == "north-star"


def test_workspace_context_must_match_authenticated_tenant():
    auth_user = {"tenant": {"id": "tenant-a", "slug": "acme", "name": "Acme"}}
    assert _tenant(auth_user, "acme")["id"] == "tenant-a"
    with pytest.raises(HTTPException) as exc:
        _tenant(auth_user, "other")
    assert exc.value.status_code == 403


def test_public_workspace_entry_resolves_only_active_exact_tenant(monkeypatch):
    client = _resolve_client(
        monkeypatch,
        [
            {
                "id": "tenant-mjcc",
                "slug": "mjcc",
                "name": "Miami Job Corps Center",
                "status": "active",
                "brand_config": {"short_name": "MJCC"},
            },
            {
                "id": "tenant-old",
                "slug": "old",
                "name": "Old",
                "status": "archived",
                "brand_config": {},
            },
        ],
    )
    response = client.get("/api/v1/workspaces/resolve/mjcc")
    assert response.status_code == 200
    assert response.json() == {
        "workspace": {
            "slug": "mjcc",
            "name": "Miami Job Corps Center",
        }
    }
    assert client.get("/api/v1/workspaces/resolve/old").status_code == 404
    assert client.get("/api/v1/workspaces/resolve/unknown").status_code == 404


def test_public_workspace_entry_rejects_reserved_route(monkeypatch):
    client = _resolve_client(monkeypatch, [])
    response = client.get("/api/v1/workspaces/resolve/login")
    assert response.status_code == 409
