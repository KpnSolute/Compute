"""Tenant-safe workspace, project, SOP, blueprint, and export workflow."""

from __future__ import annotations

import hashlib
import json
import os
import re
import uuid
from pathlib import Path
from typing import Literal

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel, ConfigDict, Field

from backend.audit_events import record_audit_event
from backend.routes import supabase_admin, supabase_service
from backend.routes._deps import _get_auth_user, _require_admin_or_manager
from backend.tenancy import list_user_tenants, tenancy_mode

router = APIRouter(prefix="/api", tags=["workspace provisioning"])

SLUG_PATTERN = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")
SHA256_PATTERN = re.compile(r"^[a-f0-9]{64}$")
SAFE_TEXT_TYPES = {"text/plain", "text/markdown"}
QUARANTINED_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}
ALLOWED_CONTENT_TYPES = SAFE_TEXT_TYPES | QUARANTINED_TYPES
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
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
    project_kind: Literal["managed_workspace", "template_instance"] = (
        "managed_workspace"
    )


class ArtifactPrepare(BaseModel):
    model_config = ConfigDict(extra="forbid")
    filename: str = Field(min_length=1, max_length=180)
    content_type: str
    size_bytes: int = Field(ge=1, le=MAX_UPLOAD_BYTES)
    sha256: str
    artifact_kind: Literal["sop", "supporting_document"] = "sop"


class ArtifactFinalize(BaseModel):
    model_config = ConfigDict(extra="forbid")
    artifact_id: str
    logical_name: str = Field(min_length=1, max_length=180)
    document_kind: Literal[
        "sop", "policy", "procedure", "requirements", "reference"
    ] = "sop"


class GenerationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_document_ids: list[str] = Field(min_length=1, max_length=50)
    requirements_summary: str = Field(default="", max_length=4000)


class BlueprintReview(BaseModel):
    model_config = ConfigDict(extra="forbid")
    decision: Literal["approved", "rejected"]
    note: str = Field(min_length=3, max_length=2000)


def _require_provisioning_mode() -> None:
    if tenancy_mode() == "legacy":
        raise HTTPException(
            status_code=503,
            detail="Workspace provisioning is unavailable during legacy rollout mode",
        )


def _idempotency_key(value: str) -> str:
    clean = (value or "").strip()
    if len(clean) < 8 or len(clean) > 200:
        raise HTTPException(
            status_code=400, detail="A valid Idempotency-Key header is required"
        )
    return clean


def _slug(value: str, label: str = "slug") -> str:
    clean = (value or "").strip().lower()
    if not SLUG_PATTERN.fullmatch(clean):
        raise HTTPException(status_code=400, detail=f"Invalid {label}")
    return clean


def _tenant(auth_user: dict) -> dict:
    tenant = auth_user.get("tenant") or {}
    if not tenant.get("id") or not tenant.get("slug"):
        raise HTTPException(status_code=403, detail="Active workspace is required")
    return tenant


def _require_path_workspace(workspace_slug: str, auth_user: dict) -> dict:
    tenant = _tenant(auth_user)
    if _slug(workspace_slug, "workspace slug") != str(tenant["slug"]).lower():
        raise HTTPException(status_code=403, detail="Workspace context mismatch")
    return tenant


def _project(project_id: str) -> dict:
    try:
        project_uuid = str(uuid.UUID(project_id))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid project ID") from exc
    rows = (
        supabase_service.table("workspace_projects")
        .select("*")
        .eq("id", project_uuid)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Project not found")
    return rows[0]


def _safe_filename(filename: str) -> str:
    clean = Path(filename).name.strip()
    clean = re.sub(r"[^A-Za-z0-9._-]+", "-", clean).strip(".-")
    return clean[:180] or "document"


def _next_blueprint_version(project_id: str) -> int:
    rows = (
        supabase_service.table("project_blueprint_versions")
        .select("version")
        .eq("project_id", project_id)
        .order("version", desc=True)
        .limit(1)
        .execute()
    ).data or []
    return int(rows[0]["version"]) + 1 if rows else 1


def _next_document_version(project_id: str, logical_name: str) -> int:
    rows = (
        supabase_service.table("project_source_documents")
        .select("version")
        .eq("project_id", project_id)
        .eq("logical_name", logical_name)
        .order("version", desc=True)
        .limit(1)
        .execute()
    ).data or []
    return int(rows[0]["version"]) + 1 if rows else 1


@router.get("/workspaces")
async def list_workspaces(auth_user: dict = Depends(_get_auth_user)):
    return {"workspaces": list_user_tenants(supabase_admin, str(auth_user["id"]))}


@router.post("/workspaces", status_code=201)
async def create_workspace(
    body: WorkspaceCreate,
    idempotency_key: str = Header("", alias="Idempotency-Key"),
    auth_user: dict = Depends(_require_admin_or_manager),
):
    _require_provisioning_mode()
    key = _idempotency_key(idempotency_key)
    slug = _slug(body.slug, "workspace slug")
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
        message = str(exc)
        status = (
            409
            if "duplicate" in message.lower() or "idempotency" in message.lower()
            else 400
        )
        raise HTTPException(
            status_code=status, detail="Workspace request was rejected"
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


@router.get("/workspaces/{workspace_slug}/projects")
async def list_projects(workspace_slug: str, auth_user: dict = Depends(_get_auth_user)):
    _require_path_workspace(workspace_slug, auth_user)
    rows = (
        supabase_service.table("workspace_projects")
        .select("*")
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
    tenant = _require_path_workspace(workspace_slug, auth_user)
    key = _idempotency_key(idempotency_key)
    slug = _slug(body.slug, "project slug")
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
        .limit(1)
        .execute()
    ).count or 0
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
                    "project_kind": body.project_kind,
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


@router.get("/projects/{project_id}")
async def get_project(project_id: str, auth_user: dict = Depends(_get_auth_user)):
    _tenant(auth_user)
    project = _project(project_id)
    tree = (
        supabase_service.table("tenant_tree_nodes")
        .select("*")
        .eq("project_id", project["id"])
        .order("logical_path")
        .execute()
    ).data or []
    return {"project": project, "tree": tree}


@router.post("/projects/{project_id}/documents:prepare-upload", status_code=201)
async def prepare_document_upload(
    project_id: str,
    body: ArtifactPrepare,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    tenant = _tenant(auth_user)
    project = _project(project_id)
    content_type = body.content_type.strip().lower()
    if content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail="Unsupported SOP file type")
    sha256 = body.sha256.strip().lower()
    if not SHA256_PATTERN.fullmatch(sha256):
        raise HTTPException(status_code=400, detail="Invalid SHA-256 digest")
    target_path = "/documents/sops" if body.artifact_kind == "sop" else "/documents"
    nodes = (
        supabase_service.table("tenant_tree_nodes")
        .select("id")
        .eq("project_id", project["id"])
        .eq("logical_path", target_path)
        .limit(1)
        .execute()
    ).data or []
    if not nodes:
        raise HTTPException(
            status_code=409, detail="Project document tree is incomplete"
        )
    artifact_id = str(uuid.uuid4())
    filename = _safe_filename(body.filename)
    object_key = (
        f"tenants/{tenant['id']}/projects/{project['id']}/documents/"
        f"{artifact_id}/{filename}"
    )
    inserted = (
        supabase_service.table("project_artifacts")
        .insert(
            {
                "id": artifact_id,
                "project_id": project["id"],
                "tree_node_id": nodes[0]["id"],
                "artifact_kind": body.artifact_kind,
                "object_key": object_key,
                "original_filename": filename,
                "content_type": content_type,
                "size_bytes": body.size_bytes,
                "sha256": sha256,
                "lifecycle_status": "pending_upload",
                "provenance": {"source": "workspace-portal-v1"},
                "uploaded_by": str(auth_user["id"]),
            }
        )
        .execute()
    ).data[0]
    try:
        signed = supabase_admin.storage.from_(
            "kpncompute-artifacts"
        ).create_signed_upload_url(object_key)
    except Exception as exc:
        supabase_service.table("project_artifacts").delete().eq(
            "id", artifact_id
        ).execute()
        raise HTTPException(
            status_code=502, detail="Upload target could not be prepared"
        ) from exc
    record_audit_event(
        action="project.document.prepare",
        result="accepted",
        actor=auth_user,
        target_type="project_artifact",
        target_id=artifact_id,
        detail=f"project={project['id']} type={content_type} size={body.size_bytes}",
    )
    return {"artifact": inserted, "upload": signed}


@router.post("/projects/{project_id}/documents:finalize", status_code=201)
async def finalize_document_upload(
    project_id: str,
    body: ArtifactFinalize,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    _tenant(auth_user)
    project = _project(project_id)
    rows = (
        supabase_service.table("project_artifacts")
        .select("*")
        .eq("project_id", project["id"])
        .eq("id", body.artifact_id)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Prepared artifact not found")
    artifact = rows[0]
    if artifact["lifecycle_status"] != "pending_upload":
        raise HTTPException(status_code=409, detail="Artifact was already finalized")
    try:
        exists = supabase_admin.storage.from_(artifact["storage_bucket"]).exists(
            artifact["object_key"]
        )
    except Exception as exc:
        raise HTTPException(
            status_code=502, detail="Uploaded object could not be verified"
        ) from exc
    if not exists:
        raise HTTPException(status_code=409, detail="Upload has not completed")
    safe_text = artifact["content_type"] in SAFE_TEXT_TYPES
    lifecycle = "ready" if safe_text else "quarantined"
    artifact = (
        supabase_service.table("project_artifacts")
        .update({"lifecycle_status": lifecycle})
        .eq("id", artifact["id"])
        .execute()
    ).data[0]
    document = None
    if safe_text:
        version = _next_document_version(project["id"], body.logical_name.strip())
        document = (
            supabase_service.table("project_source_documents")
            .insert(
                {
                    "project_id": project["id"],
                    "artifact_id": artifact["id"],
                    "logical_name": body.logical_name.strip(),
                    "version": version,
                    "document_kind": body.document_kind,
                    "ingestion_status": "ready",
                    "extraction_metadata": {
                        "processor": "safe-text-metadata-v1",
                        "content_execution": False,
                    },
                    "created_by": str(auth_user["id"]),
                }
            )
            .execute()
        ).data[0]
    record_audit_event(
        action="project.document.finalize",
        result="accepted",
        actor=auth_user,
        target_type="project_artifact",
        target_id=artifact["id"],
        detail=f"lifecycle={lifecycle}",
    )
    return {
        "artifact": artifact,
        "document": document,
        "requires_malware_scan": not safe_text,
    }


@router.get("/projects/{project_id}/documents")
async def list_documents(project_id: str, auth_user: dict = Depends(_get_auth_user)):
    _tenant(auth_user)
    project = _project(project_id)
    documents = (
        supabase_service.table("project_source_documents")
        .select("*")
        .eq("project_id", project["id"])
        .order("created_at", desc=True)
        .execute()
    ).data or []
    artifacts = (
        supabase_service.table("project_artifacts")
        .select("*")
        .eq("project_id", project["id"])
        .order("created_at", desc=True)
        .execute()
    ).data or []
    return {"documents": documents, "artifacts": artifacts}


@router.post("/projects/{project_id}/generation-runs", status_code=201)
async def create_generation_run(
    project_id: str,
    body: GenerationCreate,
    idempotency_key: str = Header("", alias="Idempotency-Key"),
    auth_user: dict = Depends(_require_admin_or_manager),
):
    _tenant(auth_user)
    project = _project(project_id)
    key = _idempotency_key(idempotency_key)
    jobs = (
        supabase_service.table("provisioning_jobs")
        .select("*")
        .eq("project_id", project["id"])
        .eq("idempotency_key", key)
        .limit(1)
        .execute()
    ).data or []
    if jobs:
        return {"job": jobs[0], "replayed": True}
    document_ids = sorted(set(body.source_document_ids))
    documents = (
        supabase_service.table("project_source_documents")
        .select("id,logical_name,version,artifact_id,ingestion_status")
        .eq("project_id", project["id"])
        .in_("id", document_ids)
        .execute()
    ).data or []
    if len(documents) != len(document_ids) or any(
        row["ingestion_status"] != "ready" for row in documents
    ):
        raise HTTPException(status_code=409, detail="Every selected SOP must be ready")
    artifact_ids = [row["artifact_id"] for row in documents]
    artifacts = (
        supabase_service.table("project_artifacts")
        .select("id,sha256,original_filename,lifecycle_status")
        .eq("project_id", project["id"])
        .in_("id", artifact_ids)
        .execute()
    ).data or []
    by_id = {row["id"]: row for row in artifacts}
    if len(by_id) != len(artifact_ids) or any(
        row["lifecycle_status"] != "ready" for row in artifacts
    ):
        raise HTTPException(
            status_code=409, detail="Every selected artifact must be ready"
        )
    manifest = [
        {
            "document_id": row["id"],
            "logical_name": row["logical_name"],
            "version": row["version"],
            "sha256": by_id[row["artifact_id"]]["sha256"],
        }
        for row in sorted(documents, key=lambda item: item["id"])
    ]
    manifest_hash = hashlib.sha256(
        json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    job = (
        supabase_service.table("provisioning_jobs")
        .insert(
            {
                "project_id": project["id"],
                "idempotency_key": key,
                "job_kind": "blueprint_generation",
                "status": "review_required",
                "input_manifest": {
                    "sources": manifest,
                    "requirements_summary": body.requirements_summary,
                },
                "output_manifest": {"processor": "deterministic-blueprint-v1"},
                "requested_by": str(auth_user["id"]),
                "started_at": "now()",
                "completed_at": "now()",
            }
        )
        .execute()
    ).data[0]
    run = (
        supabase_service.table("project_generation_runs")
        .insert(
            {
                "project_id": project["id"],
                "status": "review_required",
                "prompt_policy_version": "deterministic-blueprint-v1",
                "model_provider": None,
                "model_name": None,
                "source_manifest_hash": manifest_hash,
                "requested_by": str(auth_user["id"]),
                "started_at": "now()",
                "completed_at": "now()",
                "usage_metadata": {"ai_executed": False, "job_id": job["id"]},
            }
        )
        .execute()
    ).data[0]
    for source in manifest:
        supabase_service.table("generation_run_sources").insert(
            {
                "project_id": project["id"],
                "generation_run_id": run["id"],
                "source_document_id": source["document_id"],
                "source_sha256": source["sha256"],
            }
        ).execute()
    blueprint = {
        "schema_version": "kpncompute.workspace-blueprint.v1",
        "project": {
            "id": project["id"],
            "slug": project["slug"],
            "name": project["name"],
        },
        "sources": manifest,
        "requirements_summary": body.requirements_summary,
        "proposed_resources": [],
        "proposed_integrations": [],
        "policy": {
            "human_approval_required": True,
            "arbitrary_code_execution": False,
            "customer_content_reuse": False,
        },
    }
    content_hash = hashlib.sha256(
        json.dumps(blueprint, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()
    version = _next_blueprint_version(project["id"])
    blueprint_row = (
        supabase_service.table("project_blueprint_versions")
        .insert(
            {
                "project_id": project["id"],
                "generation_run_id": run["id"],
                "version": version,
                "schema_version": "kpncompute.workspace-blueprint.v1",
                "status": "review_required",
                "blueprint": blueprint,
                "validation_findings": [],
                "content_sha256": content_hash,
                "created_by": str(auth_user["id"]),
            }
        )
        .execute()
    ).data[0]
    record_audit_event(
        action="blueprint.generate",
        result="accepted",
        actor=auth_user,
        target_type="project_blueprint_version",
        target_id=blueprint_row["id"],
        detail="processor=deterministic-blueprint-v1 ai_executed=false",
    )
    return {
        "job": job,
        "generation_run": run,
        "blueprint": blueprint_row,
        "replayed": False,
    }


@router.get("/generation-runs/{run_id}")
async def get_generation_run(run_id: str, auth_user: dict = Depends(_get_auth_user)):
    _tenant(auth_user)
    rows = (
        supabase_service.table("project_generation_runs")
        .select("*")
        .eq("id", run_id)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Generation run not found")
    blueprints = (
        supabase_service.table("project_blueprint_versions")
        .select("*")
        .eq("generation_run_id", run_id)
        .order("version", desc=True)
        .execute()
    ).data or []
    return {"generation_run": rows[0], "blueprints": blueprints}


@router.post("/blueprints/{blueprint_id}:review")
async def review_blueprint(
    blueprint_id: str,
    body: BlueprintReview,
    auth_user: dict = Depends(_require_admin_or_manager),
):
    _tenant(auth_user)
    rows = (
        supabase_service.table("project_blueprint_versions")
        .select("*")
        .eq("id", blueprint_id)
        .limit(1)
        .execute()
    ).data or []
    if not rows:
        raise HTTPException(status_code=404, detail="Blueprint not found")
    if rows[0]["status"] not in {"proposed", "review_required"}:
        raise HTTPException(status_code=409, detail="Blueprint is not reviewable")
    updated = (
        supabase_service.table("project_blueprint_versions")
        .update(
            {
                "status": body.decision,
                "reviewed_by": str(auth_user["id"]),
                "reviewed_at": "now()",
                "review_note": body.note.strip(),
            }
        )
        .eq("id", blueprint_id)
        .execute()
    ).data[0]
    record_audit_event(
        action="blueprint.review",
        result="accepted" if body.decision == "approved" else "rejected",
        actor=auth_user,
        target_type="project_blueprint_version",
        target_id=blueprint_id,
        detail=f"decision={body.decision}",
    )
    return updated


@router.post("/projects/{project_id}:export")
async def export_project(
    project_id: str,
    idempotency_key: str = Header("", alias="Idempotency-Key"),
    auth_user: dict = Depends(_require_admin_or_manager),
):
    tenant = _tenant(auth_user)
    project = _project(project_id)
    key = _idempotency_key(idempotency_key)
    existing = (
        supabase_service.table("provisioning_jobs")
        .select("*")
        .eq("project_id", project["id"])
        .eq("idempotency_key", key)
        .limit(1)
        .execute()
    ).data or []
    if existing:
        return {
            "job": existing[0],
            "manifest": existing[0]["output_manifest"],
            "replayed": True,
        }
    manifest = {
        "schema_version": "kpncompute.project-export.v1",
        "workspace": {
            "id": tenant["id"],
            "slug": tenant["slug"],
            "name": tenant["name"],
        },
        "project": project,
        "tree": (
            supabase_service.table("tenant_tree_nodes")
            .select(
                "id,parent_id,node_kind,slug,name,logical_path,metadata,created_at,updated_at"
            )
            .eq("project_id", project["id"])
            .order("logical_path")
            .execute()
        ).data
        or [],
        "artifacts": (
            supabase_service.table("project_artifacts")
            .select(
                "id,artifact_kind,original_filename,content_type,size_bytes,sha256,lifecycle_status,created_at"
            )
            .eq("project_id", project["id"])
            .execute()
        ).data
        or [],
        "source_documents": (
            supabase_service.table("project_source_documents")
            .select(
                "id,artifact_id,logical_name,version,document_kind,ingestion_status,created_at"
            )
            .eq("project_id", project["id"])
            .execute()
        ).data
        or [],
        "blueprints": (
            supabase_service.table("project_blueprint_versions")
            .select(
                "id,version,schema_version,status,content_sha256,created_at,reviewed_at,review_note"
            )
            .eq("project_id", project["id"])
            .order("version")
            .execute()
        ).data
        or [],
        "includes_private_object_bytes": False,
    }
    job = (
        supabase_service.table("provisioning_jobs")
        .insert(
            {
                "project_id": project["id"],
                "idempotency_key": key,
                "job_kind": "project_export",
                "status": "completed",
                "input_manifest": {"format": "kpncompute.project-export.v1"},
                "output_manifest": manifest,
                "requested_by": str(auth_user["id"]),
                "started_at": "now()",
                "completed_at": "now()",
            }
        )
        .execute()
    ).data[0]
    record_audit_event(
        action="project.export",
        result="accepted",
        actor=auth_user,
        target_type="workspace_project",
        target_id=project["id"],
    )
    return {"job": job, "manifest": manifest, "replayed": False}
