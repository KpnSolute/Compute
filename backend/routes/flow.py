"""
Flow Assignments API Endpoints

Provides CRUD endpoints for flow_assignments — task/assignment management
for the Flow feature (staff task list, manager assignment creation).

Endpoints:
- GET /api/flow/assignments - List assignments (scoped by role)
- POST /api/flow/assignments - Create a new assignment
- PATCH /api/flow/assignments/{id} - Update an assignment
- DELETE /api/flow/assignments/{id} - Delete an assignment
"""

from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, ConfigDict, Field

from backend.routes import supabase_service
from backend.routes._deps import ROLE_LEVEL, _get_auth_user, _require_assistant

VALID_ROLES = {"staff", "assistant", "manager", "admin", "sudo"}
VALID_STATUSES = {"open", "in_progress", "done", "cancelled"}
VALID_PRIORITIES = {"low", "normal", "high", "urgent"}

router = APIRouter(prefix="/api/flow", tags=["flow"])


class FlowAssignmentCreate(BaseModel):
    """Create flow assignment request."""

    title: str = Field(..., min_length=1, max_length=500)
    description: str = ""
    assigned_to: str | None = None
    assigned_to_role: str | None = None
    priority: str = "normal"
    due_date: str | None = None
    link_type: str | None = None
    link_key: str | None = None
    link_params: dict[str, Any] = {}


class FlowAssignmentUpdate(BaseModel):
    """Update flow assignment request — all fields optional."""

    title: str | None = None
    description: str | None = None
    priority: str | None = None
    due_date: str | None = None
    assigned_to: str | None = None
    assigned_to_role: str | None = None
    status: str | None = None


class FlowAssignmentResponse(BaseModel):
    """Flow assignment response."""

    model_config = ConfigDict(extra="ignore")

    id: str
    title: str
    description: str = ""
    assigned_to: str | None = None
    assigned_to_role: str | None = None
    created_by: str
    status: str = "open"
    priority: str = "normal"
    due_date: str | None = None
    link_type: str | None = None
    link_key: str | None = None
    link_params: dict[str, Any] = {}
    completed_at: str | None = None
    completed_by: str | None = None
    created_at: str
    updated_at: str


@router.post("/assignments", response_model=FlowAssignmentResponse, status_code=201)
async def create_assignment(
    entry: FlowAssignmentCreate, auth_user: dict = Depends(_require_assistant)
):
    """
    Create a new flow assignment.

    Requires: Assistant role or higher

    Request Body:
    - title: Assignment title (required)
    - description: Detailed description (default '')
    - assigned_to: Specific staff UUID (optional, mutually exclusive with assigned_to_role)
    - assigned_to_role: Target role group (optional, mutually exclusive with assigned_to)
    - priority: Priority level (low/normal/high/urgent, default normal)
    - due_date: Optional ISO date string (YYYY-MM-DD)
    - link_type: Deep-link type (optional)
    - link_key: Deep-link key (optional)
    - link_params: Deep-link params object (optional, default {})

    Returns:
        Created flow assignment

    Raises:
        400: Invalid input (mutual exclusivity, bad role/priority)
        401: Missing or invalid auth
        403: Insufficient role
        500: Database error
    """
    if entry.assigned_to and entry.assigned_to_role:
        raise HTTPException(
            status_code=400,
            detail="Assign only one of assigned_to or assigned_to_role",
        )
    if not entry.assigned_to and not entry.assigned_to_role:
        raise HTTPException(
            status_code=400,
            detail="Must provide one of assigned_to or assigned_to_role",
        )

    if entry.assigned_to_role and entry.assigned_to_role not in VALID_ROLES:
        raise HTTPException(
            status_code=400,
            detail=f"assigned_to_role must be one of {', '.join(sorted(VALID_ROLES))}",
        )

    if entry.priority not in VALID_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail=f"priority must be one of {', '.join(sorted(VALID_PRIORITIES))}",
        )

    try:
        now = datetime.now(timezone.utc).isoformat()
        record = {
            "title": entry.title,
            "description": entry.description,
            "assigned_to": entry.assigned_to,
            "assigned_to_role": entry.assigned_to_role,
            "created_by": auth_user["id"],
            "status": "open",
            "priority": entry.priority,
            "due_date": entry.due_date,
            "link_type": entry.link_type,
            "link_key": entry.link_key,
            "link_params": entry.link_params,
            "created_at": now,
            "updated_at": now,
        }
        record = {k: v for k, v in record.items() if v is not None}

        result = supabase_service.table("flow_assignments").insert(record).execute()

        row = result.data[0] if result.data else None
        if not row:
            raise HTTPException(status_code=500, detail="Failed to create assignment")

        return FlowAssignmentResponse(**row)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/assignments", response_model=list[FlowAssignmentResponse])
async def list_assignments(
    status: str = Query(None),
    all: bool = Query(False),
    auth_user: dict = Depends(_get_auth_user),
):
    """
    List flow assignments, scoped by caller role.

    Requires: Valid authentication token

    Query Parameters:
    - status: Filter by status (open/in_progress/done/cancelled, optional)
    - all: When true and caller is assistant+, returns all assignments (default false)

    Scoping behavior:
    - Staff (level < 20): always scoped to own assignments, ignores ?all
    - Assistant+ (level >= 20): scoped to own by default; ?all=true returns everything

    Returns:
        List of flow assignments ordered by created_at descending

    Raises:
        401: Missing or invalid auth
        500: Database error
    """
    try:
        query = supabase_service.table("flow_assignments").select("*")

        role_level = ROLE_LEVEL.get(auth_user.get("role"), 0)
        if role_level < 20:
            query = query.or_(
                f"assigned_to.eq.{auth_user['id']},"
                f"assigned_to_role.eq.{auth_user.get('role')}"
            )
        elif not all:
            query = query.or_(
                f"assigned_to.eq.{auth_user['id']},"
                f"assigned_to_role.eq.{auth_user.get('role')}"
            )

        if status:
            query = query.eq("status", status)

        result = query.order("created_at", desc=True).execute()

        rows = result.data if result.data else []
        return [FlowAssignmentResponse(**row) for row in rows]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.patch("/assignments/{assignment_id}", response_model=FlowAssignmentResponse)
async def update_assignment(
    assignment_id: str,
    entry: FlowAssignmentUpdate,
    auth_user: dict = Depends(_get_auth_user),
):
    """
    Update a flow assignment.

    Requires: Valid authentication token

    Authorization rules:
    - The original created_by or any assistant+ may edit any field.
    - An assignee (assigned_to matches caller.id or assigned_to_role matches
      caller.role) may only change status, and only to in_progress or done.
    - Others receive 403.

    Server-side behavior:
    - When status transitions to 'done': sets completed_at and completed_by.
    - Always sets updated_at = now().
    - Client-sent completed_at / completed_by values are ignored.

    Path Parameters:
    - assignment_id: UUID of the assignment to update

    Request Body:
    - Any subset of: status, title, description, priority, due_date,
      assigned_to, assigned_to_role

    Returns:
        Updated flow assignment

    Raises:
        400: Invalid field values
        401: Missing or invalid auth
        403: Not authorized for the requested change
        404: Assignment not found
        500: Database error
    """
    try:
        existing = (
            supabase_service.table("flow_assignments")
            .select("*")
            .eq("id", assignment_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    if not existing.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    existing_row = existing.data[0]
    role_level = ROLE_LEVEL.get(auth_user.get("role"), 0)
    is_creator = auth_user.get("id") == existing_row.get("created_by")
    is_assistant_or_above = role_level >= 20
    is_assignee = auth_user.get("id") == existing_row.get(
        "assigned_to"
    ) or auth_user.get("role") == existing_row.get("assigned_to_role")

    update_dict = {}
    for field in (
        "title",
        "description",
        "priority",
        "due_date",
        "assigned_to",
        "assigned_to_role",
        "status",
    ):
        val = getattr(entry, field, None)
        if val is not None:
            update_dict[field] = val

    if not update_dict:
        raise HTTPException(status_code=400, detail="No fields to update")

    if is_creator or is_assistant_or_above:
        pass
    elif is_assignee:
        if set(update_dict.keys()) != {"status"}:
            raise HTTPException(
                status_code=403,
                detail="Assignees may only update the status field",
            )
        if update_dict.get("status") not in ("in_progress", "done"):
            raise HTTPException(
                status_code=403,
                detail="Assignees may only set status to in_progress or done",
            )
    else:
        raise HTTPException(
            status_code=403,
            detail="Not authorized to update this assignment",
        )

    if "status" in update_dict and update_dict["status"] not in VALID_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"status must be one of {', '.join(sorted(VALID_STATUSES))}",
        )

    if "priority" in update_dict and update_dict["priority"] not in VALID_PRIORITIES:
        raise HTTPException(
            status_code=400,
            detail=f"priority must be one of {', '.join(sorted(VALID_PRIORITIES))}",
        )

    if (
        "assigned_to_role" in update_dict
        and update_dict["assigned_to_role"] is not None
    ):
        if update_dict["assigned_to_role"] not in VALID_ROLES:
            raise HTTPException(
                status_code=400,
                detail=f"assigned_to_role must be one of {', '.join(sorted(VALID_ROLES))}",
            )

    now = datetime.now(timezone.utc).isoformat()
    update_dict["updated_at"] = now

    if update_dict.get("status") == "done":
        update_dict["completed_at"] = now
        update_dict["completed_by"] = auth_user["id"]

    try:
        result = (
            supabase_service.table("flow_assignments")
            .update(update_dict)
            .eq("id", assignment_id)
            .execute()
        )

        row = result.data[0] if result.data else None
        if not row:
            raise HTTPException(status_code=500, detail="Failed to update assignment")

        return FlowAssignmentResponse(**row)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.delete("/assignments/{assignment_id}", status_code=204)
async def delete_assignment(
    assignment_id: str,
    auth_user: dict = Depends(_require_assistant),
):
    """
    Delete a flow assignment.

    Requires: Assistant role or higher

    Path Parameters:
    - assignment_id: UUID of the assignment to delete

    Raises:
        401: Missing or invalid auth
        403: Insufficient role
        404: Assignment not found
        500: Database error
    """
    try:
        existing = (
            supabase_service.table("flow_assignments")
            .select("id")
            .eq("id", assignment_id)
            .limit(1)
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    if not existing.data:
        raise HTTPException(status_code=404, detail="Assignment not found")

    try:
        supabase_service.table("flow_assignments").delete().eq(
            "id", assignment_id
        ).execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")
