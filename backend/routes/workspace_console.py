"""Tenant-safe KpnCompute workspace, venue, and project console APIs."""

from __future__ import annotations

import os
import re
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.audit_events import record_audit_event
from backend.routes import supabase_admin, supabase_service
from backend.routes._deps import _get_auth_user, _require_admin_or_manager
from backend.tenancy import list_user_tenants, tenancy_mode

router = APIRouter(prefix="/api/v1", tags=["workspace console"])

SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
RESERVED_SLUGS = {
    "api",
    "app",
    "auth",
    "login",
    "logout",
    "signup",
    "account",
    "admin",
    "docs",
    "pricing",
    "templates",
    "health",
    "status",
    "workspaces",
}
MAX_WORKSPACES_PER_USER = int(os.getenv("KPNCOMPUTE_MAX_WORKSPACES_PER_USER", "3"))
MAX_PROJECTS_PER_WORKSPACE = int(
    os.getenv("KPNCOMPUTE_MAX_PROJECTS_PER_WORKSPACE", "10")
)


class WorkspaceCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(min_length=2, max_length=63)
    name: str = Field(min_length=2, max_length=120)


class ProjectCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    slug: str = Field(min_length=2, max_length=63)
    name: str = Field(min_length=2, max_length=120)
    description: str | None = Field(default=None, max_length=2000)


class SiteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    site_type: Literal["venue", "location"] = "venue"
    parent_id: str | None = None
    slug: str = Field(min_length=2, max_length=63)
    name: str = Field(min_length=2, max_length=120)
    timezone: str = Field(default="America/New_York", min_length=3, max_length=80)
    address: dict = Field(default_factory=dict)


def _idempotency_key(value: str) -> str:
    clean = (value or "").strip()
    if len(clean) < 8 or len(clean) > 200:
        raise HTTPException(
            status_code=400, detail="A valid Idempotency-Key header is required"
        )
    return clean


def _slug(value: str, *, workspace: bool = False) -> str:
    clean = (value or "").strip().lower()
    if not SLUG_PATTERN.fullmatch(clean):
        raise HTTPException(status_code=400, detail="Invalid slug")
    if workspace and clean in RESERVED_SLUGS:
        raise HTTPException(
            status_code=409, detail="That workspace address is reserved"
        )
    return clean


def _tenant(auth_user: dict, requested_slug: str) -> dict:
    tenant = auth_user.get("tenant") or {}
    if not tenant.get("id") or not tenant.get("slug"):
        raise HTTPException(status_code=403, detail="Active workspace is required")
    if _slug(requested_slug, workspace=True) != str(tenant["slug"]).lower():
        raise HTTPException(status_code=403, detail="Workspace context mismatch")
    return tenant


@router.get("/workspaces")
async def list_workspaces(auth_user: dict = Depends(_get_auth_user)):
    return {"workspaces": list_user_tenants(supabase_admin, str(auth_user["id"]))}


@router.post("/workspaces", status_code=201)
async def create_workspace(
    body: WorkspaceCreate,
    idempotency_key: str = Header("", alias="Idempotency-Key"),
    auth_user: dict = Depends(_require_admin_or_manager),
):
    if tenancy_mode() == "legacy":
        raise HTTPException(
            status_code=503, detail="Workspace creation is not enabled yet"
        )
    key = _idempotency_key(idempotency_key)
    slug = _slug(body.slug, workspace=True)
    existing = list_user_tenants(supabase_admin, str(auth_user["id"]))
    if len(existing) >= MAX_WORKSPACES_PER_USER:
        raise HTTPException(status_code=409, detail="Workspace quota reached")
    try:
        response = supabase_admin.rpc(
            "create_workspace_with_owner",
            {
                "p_user_id": str(auth_user["id"]),
                "p_slug": slug,
                "p_name": body.name.strip(),
                "p_idempotency_key": key,
            },
        ).execute()
    except Exception as exc:
        raise HTTPException(
            status_code=409, detail="Workspace could not be created"
        ) from exc
    result = response.data
    record_audit_event(
        action="workspace.create",
        result="accepted",
        actor=auth_user,
        target_type="tenant",
        target_id=result.get("tenant_id") if isinstance(result, dict) else None,
        detail=f"workspace={slug}",
    )
    return result


@router.get("/workspaces/{workspace_slug}/summary")
async def workspace_summary(
    workspace_slug: str, auth_user: dict = Depends(_get_auth_user)
):
    tenant = _tenant(auth_user, workspace_slug)
    projects = (
        supabase_service.table("workspace_projects")
        .select("id", count="exact")
        .execute()
    )
    sites = (
        supabase_service.table("workspace_sites")
        .select("id,site_type,status")
        .execute()
    )
    rows = sites.data or []
    memberships = (
        supabase_admin.table("tenant_memberships")
        .select("id", count="exact")
        .eq("tenant_id", tenant["id"])
        .eq("status", "active")
        .execute()
    )
    return {
        "workspace": tenant,
        "counts": {
            "projects": projects.count or 0,
            "venues": sum(
                row["site_type"] == "venue" and row["status"] == "active"
                for row in rows
            ),
            "locations": sum(
                row["site_type"] == "location" and row["status"] == "active"
                for row in rows
            ),
            "members": memberships.count or 0,
        },
    }


@router.get("/workspaces/{workspace_slug}/sites")
async def list_sites(workspace_slug: str, auth_user: dict = Depends(_get_auth_user)):
    _tenant(auth_user, workspace_slug)
    rows = (
        supabase_service.table("workspace_sites")
        .select("*")
        .neq("status", "archived")
        .order("site_type")
        .order("name")
        .execute()
    ).data or []
    return {"sites": rows}


@router.post("/workspaces/{workspace_slug}/sites", status_code=201)
async def create_site(
    workspace_slug: str,
    body: SiteCreate,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    _tenant(auth_user, workspace_slug)
    if body.site_type == "venue" and body.parent_id:
        raise HTTPException(status_code=400, detail="A venue cannot have a parent")
    if body.site_type == "location" and not body.parent_id:
        raise HTTPException(status_code=400, detail="A location requires a venue")
    if body.parent_id:
        parents = (
            supabase_service.table("workspace_sites")
            .select("id,site_type")
            .eq("id", body.parent_id)
            .eq("site_type", "venue")
            .limit(1)
            .execute()
        ).data or []
        if not parents:
            raise HTTPException(status_code=404, detail="Parent venue was not found")
    try:
        created = (
            supabase_service.table("workspace_sites")
            .insert(
                {
                    "parent_id": body.parent_id,
                    "site_type": body.site_type,
                    "slug": _slug(body.slug),
                    "name": body.name.strip(),
                    "timezone": body.timezone.strip(),
                    "address": body.address,
                    "created_by": str(auth_user["id"]),
                }
            )
            .execute()
        ).data[0]
    except Exception as exc:
        raise HTTPException(
            status_code=409, detail="Venue or location could not be created"
        ) from exc
    record_audit_event(
        action="workspace.site.create",
        result="accepted",
        actor=auth_user,
        target_type="workspace_site",
        target_id=created["id"],
        detail=f"type={body.site_type} slug={created['slug']}",
    )
    return created


@router.get("/workspaces/{workspace_slug}/projects")
async def list_projects(workspace_slug: str, auth_user: dict = Depends(_get_auth_user)):
    _tenant(auth_user, workspace_slug)
    rows = (
        supabase_service.table("workspace_projects")
        .select("*")
        .neq("status", "archived")
        .order("updated_at", desc=True)
        .execute()
    ).data or []
    return {"projects": rows}


@router.post("/workspaces/{workspace_slug}/projects", status_code=201)
async def create_project(
    workspace_slug: str,
    body: ProjectCreate,
    idempotency_key: str = Header("", alias="Idempotency-Key"),
    auth_user: dict = Depends(_require_admin_or_manager),
):
    tenant = _tenant(auth_user, workspace_slug)
    key = _idempotency_key(idempotency_key)
    slug = _slug(body.slug)
    replay = (
        supabase_service.table("workspace_projects")
        .select("*")
        .eq("idempotency_key", key)
        .limit(1)
        .execute()
    ).data or []
    if replay:
        if replay[0]["slug"] != slug or replay[0]["name"] != body.name.strip():
            raise HTTPException(
                status_code=409, detail="Idempotency key payload mismatch"
            )
        return {**replay[0], "replayed": True}
    count = (
        supabase_service.table("workspace_projects")
        .select("id", count="exact")
        .execute()
        .count
        or 0
    )
    if count >= MAX_PROJECTS_PER_WORKSPACE:
        raise HTTPException(status_code=409, detail="Project quota reached")
    try:
        created = (
            supabase_service.table("workspace_projects")
            .insert(
                {
                    "slug": slug,
                    "name": body.name.strip(),
                    "description": body.description,
                    "project_kind": "managed_workspace",
                    "status": "draft",
                    "idempotency_key": key,
                    "created_by": str(auth_user["id"]),
                }
            )
            .execute()
        ).data[0]
    except Exception as exc:
        raise HTTPException(
            status_code=409, detail="Project could not be created"
        ) from exc
    record_audit_event(
        action="project.create",
        result="accepted",
        actor=auth_user,
        target_type="workspace_project",
        target_id=created["id"],
        detail=f"workspace={tenant['slug']} project={slug}",
    )
    return {**created, "replayed": False}
