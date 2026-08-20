"""Request-scoped tenant resolution and fail-closed Supabase access.

The backend uses a privileged Supabase client, so database RLS is defense in
depth rather than the primary API authorization boundary. This module makes the
tenant predicate part of every tenant-owned query and stamps every write.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from typing import Any, Iterator

from backend.config_flags import (
    KPNCOMPUTE_TENANCY_MODES,
    kpncompute_tenancy_mode,
)


TENANCY_MODES = set(KPNCOMPUTE_TENANCY_MODES)
GLOBAL_TABLES = {
    "ai_providers",
    "permission_scopes",
    "tenants",
    "tenant_memberships",
    "user_profiles",
    "workspace_creation_requests",
}
TENANT_TABLES = {
    "agent_conversations",
    "agent_usage",
    "ai_provider_keys",
    "ai_stack_config",
    "ai_usage_logs",
    "api_keys",
    "app_settings",
    "archived_files",
    "audit_events",
    "budget_line_actuals",
    "budget_line_items",
    "centers",
    "commit_changes",
    "commits",
    "cost_budgets",
    "credential_access_audit",
    "daily_operations_logs",
    "error_logs",
    "events",
    "flow_assignments",
    "github_sync_queue",
    "haccp_logs",
    "import_batches",
    "incident_logs",
    "inventory_audit_log",
    "inventory_categories",
    "inventory_items",
    "inventory_transactions",
    "invoice_items",
    "invoices",
    "item_barcodes",
    "july_invoice_import",
    "july_reimport_backup_invoice_items",
    "july_reimport_backup_invoices",
    "july_reimport_backup_items",
    "july_reimport_backup_minv",
    "lunchvoice_sso_handoffs",
    "meal_periods",
    "menu_cycle_days",
    "menu_cycle_slots",
    "menu_feedback_summary",
    "menu_items",
    "menu_suggestions",
    "month_periods",
    "month_status",
    "monthly_inventory",
    "monthly_snapshots",
    "opening_checklist_items",
    "pull_requests",
    "generation_run_sources",
    "project_artifacts",
    "project_blueprint_versions",
    "project_generation_runs",
    "project_source_documents",
    "role_permissions",
    "servsafe_certifications",
    "sku_review_queue",
    "snack_bar_entity_rates",
    "snack_bar_products",
    "snack_bar_sales",
    "snack_bar_transaction_items",
    "snack_bar_transactions",
    "sso_handoffs",
    "staging_entries",
    "vendors",
    "tenant_tree_nodes",
    "week_gross",
    "week_status",
    "workspace_projects",
    "workspace_sites",
}
TENANT_VIEWS = {
    "category_spending",
    "dashboard_summary",
    "invoice_spending_summary",
    "item_price_history",
    "live_inventory",
    "monthly_comparison",
}
TENANT_RPCS = {
    "admin_merge_items",
    "audit_inventory_period",
    "link_invoice_items_by_id",
    "perform_rollover",
    "recompute_week_totals",
    "sc_close_pull_request",
    "sc_finalize_merge",
    "set_week_status",
    "sku_add_alias",
    "sku_review_resolve",
}
GLOBAL_RPCS = {"create_workspace_with_owner"}


class TenantContextError(RuntimeError):
    """Raised when tenant-owned data is accessed without a safe context."""


@dataclass(frozen=True)
class TenantContext:
    id: str
    slug: str
    name: str
    user_id: str | None = None
    role: str | None = None
    public: bool = False


_current_tenant: ContextVar[TenantContext | None] = ContextVar(
    "kpncompute_current_tenant", default=None
)


def tenancy_mode() -> str:
    """The validated tenancy mode.

    This used to substitute ``legacy`` for anything it could not read, so a typo
    such as ``enfroced`` silently turned tenant enforcement back off. It is now a
    closed enum that raises, which is the only safe direction for a flag that
    decides whether a tenant boundary is enforced.
    """
    return kpncompute_tenancy_mode()


def default_tenant_slug() -> str:
    return os.getenv("KPNCOMPUTE_DEFAULT_TENANT_SLUG", "mjcc").strip().lower()


def current_tenant() -> TenantContext | None:
    return _current_tenant.get()


@contextmanager
def tenant_scope(context: TenantContext) -> Iterator[TenantContext]:
    token = _current_tenant.set(context)
    try:
        yield context
    finally:
        _current_tenant.reset(token)


def list_user_tenants(admin_client: Any, user_id: str) -> list[dict]:
    memberships = (
        admin_client.table("tenant_memberships")
        .select("tenant_id,role,status,is_default")
        .eq("user_id", user_id)
        .eq("status", "active")
        .execute()
    ).data or []
    if not memberships:
        return []
    tenants = (
        admin_client.table("tenants")
        .select("id,slug,name,status,brand_config")
        .in_("id", [row["tenant_id"] for row in memberships])
        .eq("status", "active")
        .execute()
    ).data or []
    by_id = {str(row["id"]): row for row in tenants}
    result = []
    for membership in memberships:
        tenant = by_id.get(str(membership["tenant_id"]))
        if not tenant:
            continue
        result.append(
            {
                "id": str(tenant["id"]),
                "slug": str(tenant["slug"]),
                "name": str(tenant["name"]),
                "role": str(membership["role"]),
                "is_default": bool(membership.get("is_default")),
                "brand_config": tenant.get("brand_config") or {},
            }
        )
    return sorted(result, key=lambda row: (not row["is_default"], row["name"].lower()))


def resolve_user_tenant(
    admin_client: Any, user_id: str, requested_slug: str | None
) -> tuple[TenantContext, list[dict]]:
    workspaces = list_user_tenants(admin_client, user_id)
    requested = (requested_slug or "").strip().lower()
    selected = next(
        (row for row in workspaces if row["slug"].lower() == requested), None
    )
    if requested and selected is None:
        raise TenantContextError("Workspace is unavailable for this account")
    if selected is None:
        selected = next((row for row in workspaces if row["is_default"]), None)
    if selected is None and workspaces:
        selected = workspaces[0]
    if selected is None:
        raise TenantContextError("Account has no active workspace membership")
    return TenantContext(
        id=selected["id"],
        slug=selected["slug"],
        name=selected["name"],
        user_id=user_id,
        role=selected["role"],
    ), workspaces


def resolve_public_tenant(
    admin_client: Any, requested_slug: str | None
) -> TenantContext:
    slug = (requested_slug or default_tenant_slug()).strip().lower()
    rows = (
        admin_client.table("tenants")
        .select("id,slug,name,status")
        .eq("slug", slug)
        .eq("status", "active")
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise TenantContextError("Workspace was not found")
    tenant = rows[0]
    return TenantContext(
        id=str(tenant["id"]),
        slug=str(tenant["slug"]),
        name=str(tenant["name"]),
        public=True,
    )


# Brand fields an unauthenticated caller may read. Anything not listed here stays
# server-side: `brand_config` is an operator-editable JSON blob, and returning it
# whole would publish whatever a workspace admin happened to store in it.
PUBLIC_BRAND_FIELDS = ("display_name", "logo_url", "accent_color", "support_url")


def public_brand_view(brand_config: Any) -> dict:
    """The allowlisted subset of a tenant's brand configuration."""
    if not isinstance(brand_config, dict):
        return {}
    view: dict = {}
    for field in PUBLIC_BRAND_FIELDS:
        value = brand_config.get(field)
        if isinstance(value, str) and value.strip():
            view[field] = value.strip()[:300]
    return view


def public_tenant_view(context: TenantContext) -> dict:
    """The minimum an unauthenticated caller needs: how to address and name it.

    Deliberately omits the immutable tenant id. The id is the join key for every
    tenant-owned row in the database; an anonymous visitor needs the slug to
    navigate and the name to read, and nothing else.
    """
    return {"slug": context.slug, "name": context.name}


def _stamp(values: dict, tenant_id: str) -> dict:
    existing = values.get("tenant_id")
    if existing is not None and str(existing) != tenant_id:
        raise TenantContextError("Cross-tenant write rejected")
    return {**values, "tenant_id": tenant_id}


def _stamp_many(values: dict | list[dict], tenant_id: str) -> dict | list[dict]:
    return (
        [_stamp(row, tenant_id) for row in values]
        if isinstance(values, list)
        else _stamp(values, tenant_id)
    )


class _TenantTable:
    def __init__(self, table: Any, tenant_id: str):
        self._table = table
        self._tenant_id = tenant_id

    def select(self, *args: Any, **kwargs: Any) -> Any:
        return self._table.select(*args, **kwargs).eq("tenant_id", self._tenant_id)

    def update(self, values: dict, *args: Any, **kwargs: Any) -> Any:
        return self._table.update(_stamp(values, self._tenant_id), *args, **kwargs).eq(
            "tenant_id", self._tenant_id
        )

    def delete(self, *args: Any, **kwargs: Any) -> Any:
        return self._table.delete(*args, **kwargs).eq("tenant_id", self._tenant_id)

    def insert(self, values: dict | list[dict], *args: Any, **kwargs: Any) -> Any:
        return self._table.insert(_stamp_many(values, self._tenant_id), *args, **kwargs)

    def upsert(self, values: dict | list[dict], *args: Any, **kwargs: Any) -> Any:
        conflict = kwargs.get("on_conflict")
        if conflict and "tenant_id" not in {
            column.strip() for column in str(conflict).split(",")
        }:
            kwargs["on_conflict"] = f"tenant_id,{conflict}"
        return self._table.upsert(_stamp_many(values, self._tenant_id), *args, **kwargs)


class TenantScopedClient:
    """Subset-compatible Supabase client that scopes privileged data access."""

    def __init__(self, admin_client: Any):
        self.admin = admin_client

    def _required_context(self, resource: str) -> TenantContext | None:
        context = current_tenant()
        if tenancy_mode() == "legacy":
            return context
        if context is None:
            raise TenantContextError(
                f"Tenant context required before accessing {resource}"
            )
        return context

    def table(self, name: str) -> Any:
        table = self.admin.table(name)
        if name not in TENANT_TABLES and name not in TENANT_VIEWS:
            return table
        context = self._required_context(name)
        return table if context is None else _TenantTable(table, context.id)

    def rpc(
        self, name: str, params: dict | None = None, *args: Any, **kwargs: Any
    ) -> Any:
        payload = dict(params or {})
        if name in TENANT_RPCS:
            context = self._required_context(name)
            if context is not None:
                existing = payload.get("p_tenant_id")
                if existing is not None and str(existing) != context.id:
                    raise TenantContextError("Cross-tenant RPC rejected")
                payload["p_tenant_id"] = context.id
        return self.admin.rpc(name, payload, *args, **kwargs)

    @property
    def storage(self) -> Any:
        return self.admin.storage

    @property
    def auth(self) -> Any:
        return self.admin.auth
