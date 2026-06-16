"""Invoice-week period utilities shared across routes and dispatch."""

import calendar
import math

MAX_WEEKS = 5


def to_db_month(ui_month: int) -> int:
    """1-indexed UI month → 0-indexed DB month."""
    return ui_month - 1


def to_ui_month(db_month: int) -> int:
    """0-indexed DB month → 1-indexed UI month."""
    return db_month + 1


def days_in_month(month: int, year: int) -> int:
    """Calendar days in the given month (month is 1-indexed)."""
    return calendar.monthrange(year, month)[1]


def weeks_in_month(month: int, year: int) -> int:
    """Invoice weeks in a month: min(5, ceil(days/7)).

    A 28-day February has exactly 4 invoice weeks; every other month has 5.
    """
    return min(MAX_WEEKS, math.ceil(days_in_month(month, year) / 7))


def week_of_day(day: int) -> int:
    """Invoice week a calendar day falls in: min(5, ceil(day/7))."""
    return min(MAX_WEEKS, math.ceil(day / 7))
