"""
Logs & Compliance API Endpoints

Provides endpoints for HACCP temperature logs and daily operations logs.

Endpoints:
- GET /api/logs/haccp - Get HACCP temperature logs
- POST /api/logs/haccp - Record temperature check
- GET /api/logs/daily - Get daily operations logs
- POST /api/logs/daily - Record daily operation
- GET /api/logs/compliance - Get compliance status
"""

from datetime import datetime, timezone
from fastapi import APIRouter, HTTPException, Query, Depends
from pydantic import BaseModel, ConfigDict, Field
from backend.routes import supabase_service
from backend.routes._deps import ROLE_LEVEL, _get_auth_user, _require_assistant

router = APIRouter(prefix="/api/logs", tags=["logs"])


class HACCPLogEntry(BaseModel):
    """HACCP temperature log entry."""

    location: str = Field(..., min_length=1, max_length=100)
    temperature: float = Field(..., ge=-50, le=150)
    unit: str = Field("F", pattern="^(F|C)$")
    timestamp: str
    checked_by: str
    notes: str = ""


class HACCPLogResponse(BaseModel):
    """HACCP log response."""

    model_config = ConfigDict(extra="ignore")

    id: str
    location: str
    temperature: float
    unit: str = ""
    timestamp: str
    checked_by: str
    notes: str = ""
    created_at: str


class DailyLogEntry(BaseModel):
    """Daily operations log entry."""

    entry_type: str = Field(..., min_length=1, max_length=50)
    title: str = Field(..., min_length=1, max_length=200)
    description: str = ""
    severity: str = Field("info", pattern="^(debug|info|warning|error)$")
    data: str = ""


class DailyLogResponse(BaseModel):
    """Daily log response."""

    model_config = ConfigDict(extra="ignore")

    id: str
    entry_type: str
    title: str
    description: str = ""
    severity: str = "info"
    created_by: str = ""
    created_at: str
    data: str = ""


# _get_auth_user imported from backend.routes._deps (single source of truth).


@router.get("/haccp", response_model=list[HACCPLogResponse])
async def get_haccp_logs(
    limit: int = Query(50, ge=1, le=500),
    location: str = Query(None),
    auth_user: dict = Depends(_get_auth_user),
):
    """
    Get HACCP temperature logs.

    Requires: Valid authentication token

    Query Parameters:
    - limit: Maximum logs to return (1-500, default 50)
    - location: Filter by location (optional)

    Returns:
        List of HACCP log entries ordered by timestamp descending

    Raises:
        401: Missing or invalid auth
        500: Database error
    """
    try:
        query = supabase_service.table("haccp_logs").select("*")

        if location:
            query = query.eq("location", location)

        result = query.order("timestamp", desc=True).limit(limit).execute()

        logs = result.data if result.data else []
        return [HACCPLogResponse(**log) for log in logs]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.post("/haccp", response_model=HACCPLogResponse, status_code=201)
async def record_haccp_log(
    entry: HACCPLogEntry, auth_user: dict = Depends(_require_assistant)
):
    """
    Record a new HACCP temperature check.

    Requires: Valid authentication token

    Request Body:
    - location: Location being checked (e.g., "Walk-in Cooler", "Hot Hold")
    - temperature: Temperature reading
    - unit: Temperature unit (F or C)
    - timestamp: ISO 8601 timestamp of check
    - checked_by: Name or ID of person performing check
    - notes: Optional notes

    Returns:
        Created HACCP log entry

    Raises:
        400: Invalid input
        401: Missing or invalid auth
        500: Database error
    """
    # Validate timestamp
    try:
        datetime.fromisoformat(entry.timestamp.replace("Z", "+00:00"))
    except ValueError:
        raise HTTPException(
            status_code=400, detail="Timestamp must be valid ISO 8601 format"
        )

    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            supabase_service.table("haccp_logs")
            .insert(
                {
                    "location": entry.location,
                    "temperature": entry.temperature,
                    "unit": entry.unit,
                    "timestamp": entry.timestamp,
                    "checked_by": entry.checked_by,
                    "notes": entry.notes,
                    "created_at": now,
                }
            )
            .execute()
        )

        log = result.data[0] if result.data else None
        if not log:
            raise HTTPException(status_code=500, detail="Failed to create log")

        return HACCPLogResponse(**log)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/daily", response_model=list[DailyLogResponse])
async def get_daily_logs(
    limit: int = Query(50, ge=1, le=500),
    entry_type: str = Query(None),
    severity: str = Query(None),
    auth_user: dict = Depends(_get_auth_user),
):
    """
    Get daily operations logs.

    Requires: Valid authentication token

    Query Parameters:
    - limit: Maximum logs to return (1-500, default 50)
    - entry_type: Filter by type: inventory, prep, issue, other (optional)
    - severity: Filter by severity: debug, info, warning, error (optional)

    Returns:
        List of daily log entries ordered by date descending

    Raises:
        401: Missing or invalid auth
        500: Database error
    """
    try:
        query = supabase_service.table("daily_operations_logs").select("*")

        if entry_type:
            query = query.eq("entry_type", entry_type)

        if severity:
            query = query.eq("severity", severity)

        result = query.order("created_at", desc=True).limit(limit).execute()

        logs = result.data if result.data else []
        return [DailyLogResponse(**log) for log in logs]

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


#: entry_types below assistant-only (dailyops/inspection) NAV pages — meal_log and
#: food_request are staff-accessible (NAV min 10) and share this endpoint.
ASSISTANT_ONLY_ENTRY_TYPES = {
    "inspection",
    "checklist_state",
    "meal_schedule",
    "incident",
}


@router.post("/daily", response_model=DailyLogResponse, status_code=201)
async def record_daily_log(
    entry: DailyLogEntry, auth_user: dict = Depends(_get_auth_user)
):
    """
    Record a new daily operations log entry.

    Requires: Valid authentication token (assistant role or higher for
    inspection/checklist/schedule/incident entry types — see
    ASSISTANT_ONLY_ENTRY_TYPES; meal_log and food_request stay staff-accessible)

    Request Body:
    - entry_type: Type of entry (inventory, prep, issue, other)
    - title: Short title/summary
    - description: Detailed description (optional)
    - severity: Severity level (debug, info, warning, error)

    Returns:
        Created daily log entry

    Raises:
        400: Invalid input
        401: Missing or invalid auth
        403: Entry type requires assistant role or higher
        500: Database error
    """
    if (
        entry.entry_type in ASSISTANT_ONLY_ENTRY_TYPES
        and ROLE_LEVEL.get(auth_user.get("role"), 0) < 20
    ):
        raise HTTPException(status_code=403, detail="Assistant role or higher required")
    try:
        now = datetime.now(timezone.utc).isoformat()
        result = (
            supabase_service.table("daily_operations_logs")
            .insert(
                {
                    "entry_type": entry.entry_type,
                    "title": entry.title,
                    "description": entry.description,
                    "severity": entry.severity,
                    "data": entry.data,
                    "created_by": auth_user.get("id"),
                    "created_at": now,
                }
            )
            .execute()
        )

        log = result.data[0] if result.data else None
        if not log:
            raise HTTPException(status_code=500, detail="Failed to create log")

        return DailyLogResponse(**log)

    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.get("/compliance")
async def get_compliance_status(auth_user: dict = Depends(_get_auth_user)):
    """
    Get compliance status summary.

    Requires: Valid authentication token (manager or admin recommended)

    Returns:
        Summary of recent logs and compliance status

    Raises:
        401: Missing or invalid auth
        500: Database error
    """
    try:
        # Get recent HACCP logs
        haccp_result = (
            supabase_service.table("haccp_logs")
            .select("*")
            .order("timestamp", desc=True)
            .limit(10)
            .execute()
        )

        # Get error-level daily logs
        daily_result = (
            supabase_service.table("daily_operations_logs")
            .select("*")
            .eq("severity", "error")
            .order("created_at", desc=True)
            .limit(10)
            .execute()
        )

        haccp_logs = haccp_result.data if haccp_result.data else []
        error_logs = daily_result.data if daily_result.data else []

        return {
            "status": "ok" if not error_logs else "warning",
            "haccp_logs_count": len(haccp_logs),
            "recent_errors": len(error_logs),
            "last_haccp_check": (
                haccp_logs[0].get("timestamp") if haccp_logs else None
            ),
            "recent_haccp_logs": haccp_logs[:5],
            "recent_error_logs": error_logs[:5],
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


class SnackBarSaleIn(BaseModel):
    """Daily snack bar cash reconciliation entry."""

    business_date: str
    opening_cash: float = Field(..., ge=0)
    register_sales: float = Field(..., ge=0)
    closing_cash: float = Field(..., ge=0)


class SnackBarSaleResponse(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str
    business_date: str
    opening_cash: float
    register_sales: float
    closing_cash: float
    recorded_by: str | None = None
    created_at: str
    updated_at: str


@router.get("/snack-bar-sales", response_model=list[SnackBarSaleResponse])
async def get_snack_bar_sales(
    start: str = Query(None),
    end: str = Query(None),
    limit: int = Query(60, ge=1, le=200),
    auth_user: dict = Depends(_get_auth_user),
):
    """List snack bar daily reconciliation entries, optionally within a date range."""
    try:
        q = supabase_service.table("snack_bar_sales").select("*")
        if start:
            q = q.gte("business_date", start)
        if end:
            q = q.lte("business_date", end)
        result = q.order("business_date", desc=True).limit(limit).execute()
        return result.data or []
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")


@router.post("/snack-bar-sales", response_model=SnackBarSaleResponse, status_code=201)
async def save_snack_bar_sale(
    body: SnackBarSaleIn,
    auth_user: dict = Depends(_get_auth_user),
):
    """Upsert a day's snack bar reconciliation (one row per business_date). Any authenticated staff may record."""
    record = {
        "business_date": body.business_date,
        "opening_cash": body.opening_cash,
        "register_sales": body.register_sales,
        "closing_cash": body.closing_cash,
        "recorded_by": auth_user["id"],
    }
    try:
        result = (
            supabase_service.table("snack_bar_sales")
            .upsert(record, on_conflict="business_date")
            .execute()
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Database error: {str(e)}")

    row = result.data[0] if result.data else None
    if not row:
        raise HTTPException(status_code=500, detail="Failed to save snack bar sale")
    return row
