from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.routes import users


class PreferencesQuery:
    def __init__(
        self, store: dict, operation: str = "select", payload: dict | None = None
    ):
        self.store = store
        self.operation = operation
        self.payload = payload or {}
        self.key: str | None = None

    def select(self, *_args, **_kwargs):
        return self

    def eq(self, field: str, value: str):
        assert field == "setting_key"
        self.key = value
        return self

    def limit(self, _value: int):
        return self

    def update(self, payload: dict):
        return PreferencesQuery(self.store, "update", payload)

    def insert(self, payload: dict):
        return PreferencesQuery(self.store, "insert", payload)

    def execute(self):
        if self.operation == "select":
            data = (
                []
                if self.key not in self.store
                else [{"setting_value": self.store[self.key]}]
            )
        elif self.operation == "update":
            assert self.key is not None
            self.store[self.key] = self.payload["setting_value"]
            data = [{"setting_value": self.store[self.key]}]
        else:
            key = self.payload["setting_key"]
            self.store[key] = self.payload["setting_value"]
            data = [{"setting_value": self.store[key]}]
        return type("Response", (), {"data": data})()


class PreferencesClient:
    def __init__(self):
        self.store: dict = {}

    def table(self, name: str):
        assert name == "app_settings"
        return PreferencesQuery(self.store)


def _client(monkeypatch) -> TestClient:
    app = FastAPI()
    app.include_router(users.router)
    app.dependency_overrides[users._require_any_auth] = lambda: {"id": "user-1"}
    monkeypatch.setattr(users, "supabase_service", PreferencesClient())
    return TestClient(app)


def test_theme_auto_persists_and_get_returns_it_unchanged(monkeypatch):
    client = _client(monkeypatch)

    updated = client.put("/api/users/me/preferences", json={"theme": "auto"})
    fetched = client.get("/api/users/me/preferences")

    assert updated.status_code == 200
    assert updated.json() == {"theme": "auto"}
    assert fetched.status_code == 200
    assert fetched.json() == {"theme": "auto"}


def test_theme_accepts_only_supported_values(monkeypatch):
    client = _client(monkeypatch)

    for theme in ("auto", "light", "dark"):
        assert (
            client.put("/api/users/me/preferences", json={"theme": theme}).status_code
            == 200
        )

    response = client.put("/api/users/me/preferences", json={"theme": "system"})
    assert response.status_code == 422
