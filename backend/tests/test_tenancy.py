import re
from types import SimpleNamespace
from pathlib import Path

import pytest

from backend.tenancy import (
    TenantContext,
    TenantContextError,
    TenantScopedClient,
    GLOBAL_TABLES,
    TENANT_TABLES,
    TENANT_VIEWS,
    TENANT_RPCS,
    current_tenant,
    resolve_user_tenant,
    tenant_scope,
)


class Query:
    def __init__(self, table, rows=None):
        self.table = table
        self.rows = rows or []
        self.calls = []

    def __getattr__(self, name):
        def call(*args, **kwargs):
            self.calls.append((name, args, kwargs))
            return self

        return call

    def execute(self):
        return SimpleNamespace(data=self.rows)


class Client:
    def __init__(self, rows=None):
        self.rows = rows or {}
        self.queries = []
        self.rpc_calls = []

    def table(self, name):
        query = Query(name, self.rows.get(name, []))
        self.queries.append(query)
        return query

    def rpc(self, name, params, *args, **kwargs):
        self.rpc_calls.append((name, params))
        return Query(name)


def _context(tenant_id="tenant-a"):
    return TenantContext(id=tenant_id, slug="acme", name="Acme")


def test_tenant_reads_and_writes_are_scoped(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "enforced")
    admin = Client()
    scoped = TenantScopedClient(admin)
    with tenant_scope(_context()):
        scoped.table("inventory_items").select("*").eq("active", True)
        scoped.table("inventory_items").insert({"sku": "A-1"})

    read, write = admin.queries
    assert ("eq", ("tenant_id", "tenant-a"), {}) in read.calls
    insert = next(call for call in write.calls if call[0] == "insert")
    assert insert[1][0]["tenant_id"] == "tenant-a"


def test_cross_tenant_write_and_rpc_are_rejected(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "enforced")
    scoped = TenantScopedClient(Client())
    with tenant_scope(_context()):
        with pytest.raises(TenantContextError, match="Cross-tenant write"):
            scoped.table("inventory_items").insert(
                {"tenant_id": "tenant-b", "sku": "B-1"}
            )
        with pytest.raises(TenantContextError, match="Cross-tenant RPC"):
            scoped.rpc("perform_rollover", {"p_tenant_id": "tenant-b"})


def test_enforced_mode_requires_context(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "enforced")
    with pytest.raises(TenantContextError, match="Tenant context required"):
        TenantScopedClient(Client()).table("inventory_items")


def test_tenant_rpc_receives_context_id(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "shadow")
    admin = Client()
    with tenant_scope(_context("tenant-uuid")):
        TenantScopedClient(admin).rpc("perform_rollover", {"p_month": 8})
    assert admin.rpc_calls == [
        ("perform_rollover", {"p_month": 8, "p_tenant_id": "tenant-uuid"})
    ]


def test_ledger_recompute_rpc_receives_context_id(monkeypatch):
    monkeypatch.setenv("KPNCOMPUTE_TENANCY_MODE", "enforced")
    admin = Client()
    params = {"p_item_id": "item-a", "p_month": 8, "p_year": 2026}
    with tenant_scope(_context("tenant-uuid")):
        TenantScopedClient(admin).rpc("recompute_week_totals", params)
    assert admin.rpc_calls == [
        (
            "recompute_week_totals",
            {**params, "p_tenant_id": "tenant-uuid"},
        )
    ]


def test_all_backend_rpc_calls_are_declared_tenant_scoped():
    backend_root = Path(__file__).resolve().parents[1]
    used_rpcs = set()
    for path in backend_root.rglob("*.py"):
        if "tests" in path.parts:
            continue
        used_rpcs.update(
            re.findall(r"\.rpc\(\s*[\"']([^\"']+)", path.read_text(encoding="utf-8"))
        )
    assert used_rpcs <= TENANT_RPCS


def test_all_backend_table_calls_have_an_explicit_scope_classification():
    backend_root = Path(__file__).resolve().parents[1]
    used_tables = set()
    for path in backend_root.rglob("*.py"):
        if "tests" in path.parts:
            continue
        used_tables.update(
            re.findall(r"\.table\(\s*[\"']([^\"']+)", path.read_text(encoding="utf-8"))
        )
    assert used_tables <= GLOBAL_TABLES | TENANT_TABLES | TENANT_VIEWS


def test_project_tree_tables_are_tenant_owned():
    assert {
        "workspace_projects",
        "tenant_tree_nodes",
        "project_artifacts",
        "project_source_documents",
        "project_generation_runs",
        "generation_run_sources",
        "project_blueprint_versions",
    } <= TENANT_TABLES


def test_user_can_only_select_an_active_membership():
    admin = Client(
        {
            "tenant_memberships": [
                {
                    "tenant_id": "tenant-a",
                    "role": "manager",
                    "status": "active",
                    "is_default": True,
                }
            ],
            "tenants": [
                {
                    "id": "tenant-a",
                    "slug": "acme",
                    "name": "Acme",
                    "status": "active",
                    "brand_config": {},
                }
            ],
        }
    )
    context, workspaces = resolve_user_tenant(admin, "user-a", "acme")
    assert context.id == "tenant-a"
    assert context.role == "manager"
    assert workspaces[0]["is_default"] is True
    with pytest.raises(TenantContextError, match="unavailable"):
        resolve_user_tenant(admin, "user-a", "other-company")


def test_tenant_scope_is_reset_after_request():
    assert current_tenant() is None
    with tenant_scope(_context()):
        assert current_tenant().id == "tenant-a"
    assert current_tenant() is None
