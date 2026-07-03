"""Invoice-week period utilities shared across routes and dispatch."""

from datetime import datetime
from zoneinfo import ZoneInfo

MAX_WEEKS = 3

# MJCC operates in Miami. Every "what month/day is it right now" decision that
# drives rollover prompts, period bounds, or the closed-month write guard must
# use the cafeteria's local calendar day, not the server's UTC day -- UTC
# crosses into the next day/month several hours before Eastern does (4h during
# EDT, 5h during EST), which previously made the system think a new month had
# started while it was still the last evening of the old one.
BUSINESS_TZ = ZoneInfo("America/New_York")


def business_now() -> datetime:
    """Current time in the cafeteria's operating timezone (Eastern)."""
    return datetime.now(BUSINESS_TZ)


def to_db_month(ui_month: int) -> int:
    """1-indexed UI month → 0-indexed DB month."""
    return ui_month - 1


def to_ui_month(db_month: int) -> int:
    """0-indexed DB month → 1-indexed UI month."""
    return db_month + 1


def days_in_month(month: int, year: int) -> int:
    """Calendar days in the given month (month is 1-indexed)."""
    # Kept for callers that need calendar context, not for operational week count.
    import calendar

    return calendar.monthrange(year, month)[1]


def weeks_in_month(month: int, year: int) -> int:
    """MJCC uses three import weeks in the current monthly template schema."""
    return MAX_WEEKS if 1 <= month <= 12 else 0


def week_of_day(day: int) -> int:
    """Map calendar days to the active import week count."""
    if day <= 0:
        return 1
    return min(MAX_WEEKS, ((day - 1) // 7) + 1)
