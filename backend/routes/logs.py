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

from datetime import datetime
from fastapi import APIRouter, HTTPException, Query, Header, Depends
from pydantic import BaseModel, ConfigDict, Field
from backend.routes import supabase_service, jwt_validator

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


async def _get_auth_user(authorization: str = Header("")) -> dict:
    """Extract authenticated user from Bearer token."""
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="Missing authorization token")

    # Handle PIN-based tokens
    if token.startswith("pin_"):
        user_id = token.replace("pin_", "")
        try:
            result = (
                supabase_service.table("user_profiles")
                .select("*")
                .eq("id", user_id)
                .single()
                .execute()
            )
            user = result.data if result.data else None
        except Exception:
            user = None

        if not user or not user.get("active"):
            raise HTTPException(status_code=401, detail="Invalid session")
        return user

    # Handle Supabase JWT tokens
    claims = jwt_validator.verify_token(token)
    if not claims:
        raise HTTPException(status_code=401, detail="Invalid or expired token")

    user_id = claims.get("sub")
    if not user_id:
        raise HTTPException(status_code=401, detail="Token missing user ID")

    try:
        result = (
            supabase_service.table("user_profiles")
            .select("*")
            .eq("id", user_id)
            .single()
            .execute()
        )
        user = result.data if result.data else None
    except Exception:
        user = None

    if not user or not user.get("active"):
        raise HTTPException(status_code=401, detail="User not found or inactive")

    return user


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
    entry: HACCPLogEntry, auth_user: dict = Depends(_get_auth_user)
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
        now = datetime.utcnow().isoformat()
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


@router.post("/daily", response_model=DailyLogResponse, status_code=201)
async def record_daily_log(
    entry: DailyLogEntry, auth_user: dict = Depends(_get_auth_user)
):
    """
    Record a new daily operations log entry.

    Requires: Valid authentication token

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
        500: Database error
    """
    try:
        now = datetime.utcnow().isoformat()
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
