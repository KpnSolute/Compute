"""MJCC Agent tool registry — real Supabase queries for the ReAct agent loop."""

import uuid
from calendar import month_name
from datetime import datetime, timedelta, timezone

from backend.routes import supabase_service
from backend import inventory_formulas as fi
from backend.periods import business_now

ROLE_LEVEL: dict[str, int] = {
    "staff": 10,
    "assistant": 20,
    "manager": 30,
    "admin": 40,
    "sudo": 50,
}

TOOL_MIN_ROLE: dict[str, str] = {
    "get_dashboard_stats": "staff",
    "get_inventory": "staff",
    "get_events": "staff",
    "get_menu": "staff",
    "get_reorders": "staff",
    "get_period_status": "staff",
    "get_users": "manager",
    "get_haccp_logs": "manager",
    "get_daily_logs": "manager",
    "create_event": "manager",
    "stage_inventory_save": "manager",
    "stage_inventory_week_update": "manager",
    "get_source_control_status": "manager",
    "get_ai_usage": "admin",
}

def _role_ok(user_role: str, min_role: str) -> bool:
    return ROLE_LEVEL.get(user_role, 0) >= ROLE_LEVEL.get(min_role, 99)


def _expires() -> str:
    return (datetime.now(timezone.utc) + timedelta(days=15)).isoformat()


def _require_user_id(args: dict) -> str:
    user_id = args.get("_user_id")
    if not user_id:
        raise RuntimeError("Missing authenticated user context")
    return str(user_id)


def _period_from_args(args: dict) -> tuple[int, int, int]:
    now = business_now()  # cafeteria's local day, not UTC's
    display_month = int(args.get("month", now.month))
    year = int(args.get("year", now.year))
    db_month = display_month - 1 if 1 <= display_month <= 12 else display_month
    return display_month, db_month, year


def _period_label(db_month: int, year: int) -> str:
    display_month = db_month + 1 if 0 <= db_month <= 11 else db_month
    label = (
        month_name[display_month] if 1 <= display_month <= 12 else f"Month {db_month}"
    )
    return f"{label} {year}"


def _ending_qty(row: dict | None) -> float:
    if not row:
        return 0.0
    received = fi.total_received(
        row.get("w1_received"), row.get("w2_received"), row.get("w3_received")
    )
    pulled = fi.total_pulled(
        row.get("w1_pulled"), row.get("w2_pulled"), row.get("w3_pulled")
    )
    return fi.ending_qty(row.get("opening_oh"), received, pulled)


def _ending_value(
    row: dict | None, fallback_unit_price: float | int | None = 0
) -> float:
    if not row:
        return 0.0
    if row.get("ending_value") is not None:
        return fi.num(row.get("ending_value"))
    if any(
        row.get(key) is not None
        for key in ("opening_value", "received_value", "pulled_value")
    ):
        return fi.ending_value(
            row.get("opening_value"),
            row.get("received_value"),
            row.get("pulled_value"),
        )
    unit_price = row.get("unit_price")
    return _ending_qty(row) * fi.num(
        unit_price if unit_price is not None else fallback_unit_price
    )


def _wrap_in_pr(
    entry_ids: list[str], user_id: str, title: str, description: str = ""
) -> dict | None:
    try:
        from backend.routes._deps import ensure_pr_for_entries

        return ensure_pr_for_entries(entry_ids, user_id, title, description=description)
    except Exception:
        return None


# ── tool implementations ──────────────────────────────────────────────────────


def get_dashboard_stats(args: dict, user_role: str) -> dict:
    try:
        svc = supabase_service
        users_r = (
            svc.table("user_profiles")
            .select("id", count="exact")
            .eq("active", True)
            .execute()
        )
        events_r = (
            svc.table("events")
            .select("id", count="exact")
            .eq("status", "upcoming")
            .execute()
        )
        live_r = (
            svc.table("live_inventory")
            .select("id,on_hand,par_level,sub_total")
            .execute()
        )
        live_rows = live_r.data or []
        total_val = sum(float(row.get("sub_total") or 0) for row in live_rows)
        reorder_n = sum(
            1
            for row in live_rows
            if float(row.get("on_hand") or 0) < float(row.get("par_level") or 0)
        )
        status_r = (
            svc.table("month_status")
            .select("month,year")
            .eq("status", "open")
            .order("year", desc=True)
            .order("month", desc=True)
            .limit(1)
            .execute()
        )
        status = (status_r.data or [{}])[0]
        db_month = int(status.get("month", business_now().month - 1))
        year = int(status.get("year", business_now().year))
        return {
            "active_users": users_r.count or 0,
            "upcoming_events": events_r.count or 0,
            "inventory_items": len(live_rows),
            "items_below_par": reorder_n,
            "estimated_inventory_value": round(total_val, 2),
            "period": _period_label(db_month, year),
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_inventory(args: dict, user_role: str) -> dict:
    display_month, db_month, year = _period_from_args(args)
    try:
        svc = supabase_service
        items = (
            svc.table("inventory_items")
            .select(
                "id,sku,description,category_id,unit_price,par_level,unit,inventory_categories(name)"
            )
            .execute()
        )
        inv = (
            svc.table("monthly_inventory")
            .select(
                "item_id,opening_oh,w1_received,w2_received,w3_received,"
                "w1_pulled,w2_pulled,w3_pulled,unit_price,"
                "opening_value,received_value,pulled_value,ending_value"
            )
            .eq("month", db_month)
            .eq("year", year)
            .execute()
        )
        inv_map = {r["item_id"]: r for r in (inv.data or [])}
        result = []
        new_items = []
        total_val = 0.0
        for item in items.data or []:
            sku = (item.get("sku") or "").strip()
            is_new = not sku
            cat_name = (
                ((item.get("inventory_categories") or {}).get("name") or "")
                if not is_new
                else "New Items"
            )
            row_data = inv_map.get(item["id"], {})
            oh = _ending_qty(row_data)
            par = item.get("par_level") or 0
            val = _ending_value(row_data, item.get("unit_price"))
            total_val += val
            row = {
                "sku": sku or f"(new:{item['id'][:8]})",
                "description": item["description"],
                "category": cat_name,
                "on_hand": oh,
                "par_level": par,
                "below_par": oh < par,
                "unit": item.get("unit", ""),
                "value": round(val, 2),
                "opening_value": round(float(row_data.get("opening_value") or 0), 2),
                "received_value": round(float(row_data.get("received_value") or 0), 2),
                "pulled_value": round(float(row_data.get("pulled_value") or 0), 2),
                "ending_value": round(val, 2),
                "is_new_item": is_new,
            }
            if is_new:
                new_items.append(row)
            else:
                result.append(row)
        all_items = result + new_items
        below = [r for r in all_items if r["below_par"]]
        cats = sorted(set(r["category"] for r in result if r["category"]))
        return {
            "month": display_month,
            "year": year,
            "total_items": len(all_items),
            "new_items_count": len(new_items),
            "total_value": round(total_val, 2),
            "below_par_count": len(below),
            "below_par_items": below[:15],
            "categories": cats,
            "new_items": new_items[:10],
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_events(args: dict, user_role: str) -> dict:
    try:
        svc = supabase_service
        r = (
            svc.table("events")
            .select("title,date,cat,status,description")
            .order("date")
            .limit(30)
            .execute()
        )
        rows = r.data or []
        upcoming = [e for e in rows if e.get("status") in ("upcoming", "active")]
        completed = [e for e in rows if e.get("status") == "completed"]
        return {
            "total": len(rows),
            "upcoming": upcoming[:10],
            "recently_completed": completed[-3:],
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_menu(args: dict, user_role: str) -> dict:
    from backend.routes.menu import LEGACY_DAY_INDEX, legacy_day_menu

    day = args.get("day", "Mon")
    if day not in LEGACY_DAY_INDEX:
        return {"error": f'Invalid day "{day}". Use: Mon Tue Wed Thu Fri Sat Sun'}
    try:
        return {"day": day, "menu": legacy_day_menu(day)}
    except Exception as exc:
        return {"error": str(exc)}


def get_reorders(args: dict, user_role: str) -> dict:
    try:
        svc = supabase_service
        live = (
            svc.table("live_inventory")
            .select("sku,description,on_hand,par_level,order_qty,unit_price")
            .execute()
        )
        reorders = []
        for item in live.data or []:
            oh = float(item.get("on_hand") or 0)
            par = item.get("par_level") or 0
            if oh < par:
                reorders.append(
                    {
                        "sku": item["sku"],
                        "description": item["description"],
                        "on_hand": oh,
                        "par_level": par,
                        "shortage": float(item.get("order_qty") or (par - oh)),
                        "unit": "",
                    }
                )
        reorders.sort(key=lambda x: x["shortage"], reverse=True)
        status = (
            svc.table("month_status")
            .select("month,year")
            .eq("status", "open")
            .order("year", desc=True)
            .order("month", desc=True)
            .limit(1)
            .execute()
        )
        period = (status.data or [{}])[0]
        db_month = int(period.get("month", business_now().month - 1))
        year = int(period.get("year", business_now().year))
        return {
            "period": _period_label(db_month, year),
            "reorder_count": len(reorders),
            "items": reorders[:20],
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_period_status(args: dict, user_role: str) -> dict:
    try:
        svc = supabase_service
        status = (
            svc.table("month_status")
            .select("month,year,status")
            .eq("status", "open")
            .order("year", desc=True)
            .order("month", desc=True)
            .limit(1)
            .execute()
        )
        current = (status.data or [{}])[0]
        db_month = int(current.get("month", business_now().month - 1))
        year = int(current.get("year", business_now().year))
        r = (
            svc.table("monthly_inventory")
            .select("month,year", count="exact")
            .eq("month", db_month)
            .eq("year", year)
            .execute()
        )
        has_current = (r.count or 0) > 0
        return {
            "current_month": db_month + 1 if 0 <= db_month <= 11 else db_month,
            "current_year": year,
            "has_inventory_for_current_period": has_current,
            "period_label": _period_label(db_month, year),
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_users(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, "manager"):
        return {"error": "Requires manager role or above"}
    try:
        svc = supabase_service
        r = (
            svc.table("user_profiles")
            .select("username,display_name,role,active,job_title")
            .execute()
        )
        rows = r.data or []
        active = [u for u in rows if u.get("active")]
        by_role: dict[str, list] = {}
        for u in active:
            by_role.setdefault(u["role"], []).append(
                u.get("display_name") or u["username"]
            )
        return {
            "total_active": len(active),
            "total_inactive": len(rows) - len(active),
            "by_role": by_role,
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_haccp_logs(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, "manager"):
        return {"error": "Requires manager role or above"}
    limit = min(int(args.get("limit", 10)), 50)
    try:
        svc = supabase_service
        r = (
            svc.table("haccp_logs")
            .select("timestamp,location,temperature,unit,checked_by,notes")
            .order("timestamp", desc=True)
            .limit(limit)
            .execute()
        )
        rows = r.data or []
        return {
            "count": len(rows),
            "recent": rows,
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_daily_logs(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, "manager"):
        return {"error": "Requires manager role or above"}
    limit = min(int(args.get("limit", 10)), 50)
    try:
        svc = supabase_service
        r = (
            svc.table("daily_operations_logs")
            .select("entry_type,title,description,severity,created_by,created_at")
            .order("created_at", desc=True)
            .limit(limit)
            .execute()
        )
        return {"count": len(r.data or []), "logs": r.data or []}
    except Exception as exc:
        return {"error": str(exc)}


def create_event(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, "manager"):
        return {"error": "Requires manager role or above"}
    for f in ("title", "date"):
        if not args.get(f):
            return {"error": f"Missing required field: {f}"}
    try:
        svc = supabase_service
        payload = {
            "title": args["title"],
            "date": args["date"],
            "cat": args.get("cat", "General"),
            "description": args.get("description", ""),
            "status": "upcoming",
            "theme": args.get("theme"),
            "suggested_menu": args.get("suggested_menu"),
        }
        r = svc.table("events").insert(payload).execute()
        return {"created": True, "event": r.data[0] if r.data else payload}
    except Exception as exc:
        return {"error": str(exc)}


def get_ai_usage(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, "admin"):
        return {"error": "Requires admin role or above"}
    days = min(int(args.get("days", 7)), 90)
    try:
        since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
        svc = supabase_service
        r = (
            svc.table("ai_usage_logs")
            .select("provider,tokens_in,tokens_out,cost_usd,success,duration_ms")
            .gte("created_at", since)
            .execute()
        )
        rows = r.data or []
        return {
            "period_days": days,
            "total_calls": len(rows),
            "successful": sum(1 for x in rows if x.get("success")),
            "total_tokens": sum(
                (x.get("tokens_in", 0) + x.get("tokens_out", 0)) for x in rows
            ),
            "total_cost": round(sum(x.get("cost_usd", 0) for x in rows), 4),
            "avg_latency_ms": int(
                sum(x.get("duration_ms", 0) for x in rows) / len(rows)
            )
            if rows
            else 0,
        }
    except Exception as exc:
        return {"error": str(exc)}


def stage_inventory_save(args: dict, user_role: str) -> dict:
    """Stage a month-level inventory payload for Source Control review."""
    if not _role_ok(user_role, "manager"):
        return {"error": "Requires manager role or above"}
    month = int(args.get("month") or 0)
    year = int(args.get("year") or 0)
    items = args.get("items") or []
    if month < 1 or month > 12:
        return {"error": "month must be 1-12"}
    if year < 2020 or year > 2040:
        return {"error": "year must be 2020-2040"}
    if not isinstance(items, list) or not items:
        return {"error": "items must be a non-empty list"}

    user_id = _require_user_id(args)
    batch_id = str(uuid.uuid4())
    payload = {
        "month": month,
        "year": year,
        "notes": args.get("notes") or "AI-staged inventory update",
        "review_new": True,
        "items": items,
    }
    note = str(payload.get("notes") or "").strip()
    row = {
        "entity_type": "inventory",
        "entity_id": batch_id,
        "field_name": "ai_inventory_save",
        "old_value_text": None,
        "new_value_text": f"{len(items)} item(s)",
        "change_type": "ai_stage",
        "metadata": {
            "summary": f"AI-staged {len(items)} inventory item(s) for {month}/{year}",
            "description": note,
            "source": "agent",
        },
        "review_note": note or None,
        "status": "pending",
        "submitted_by": user_id,
        "source": "ai_agent",
        "operation": "inventory_save",
        "full_payload": payload,
        "batch_id": batch_id,
        "expires_at": _expires(),
    }
    try:
        r = supabase_service.table("staging_entries").insert(row).execute()
        staged = r.data or []
        entry_ids = [x["entry_id"] for x in staged if x.get("entry_id")]
        pr = _wrap_in_pr(
            entry_ids, user_id, f"AI inventory update {month}/{year}", note
        )
        return {
            "staged": len(entry_ids),
            "entry_ids": entry_ids,
            "pull_request": {
                "pr_id": pr.get("pr_id"),
                "pr_number": pr.get("pr_number"),
                "status": pr.get("status"),
            }
            if pr
            else None,
        }
    except Exception as exc:
        return {"error": str(exc)}


def stage_inventory_week_update(args: dict, user_role: str) -> dict:
    """Stage a weekly received/issued inventory update for Source Control review."""
    if not _role_ok(user_role, "manager"):
        return {"error": "Requires manager role or above"}
    month = int(args.get("month") or 0)
    year = int(args.get("year") or 0)
    week = int(args.get("week") or 0)
    direction = (args.get("direction") or "received").lower()
    items = args.get("items") or []
    if month < 1 or month > 12:
        return {"error": "month must be 1-12"}
    if year < 2020 or year > 2040:
        return {"error": "year must be 2020-2040"}
    if week not in (1, 2, 3):
        return {"error": "week must be 1-3"}
    if direction not in ("received", "issued"):
        return {"error": "direction must be received or issued"}
    if not isinstance(items, list) or not items:
        return {"error": "items must be a non-empty list"}

    user_id = _require_user_id(args)
    batch_id = str(uuid.uuid4())
    payload = {
        "month": month,
        "year": year,
        "week": week,
        "direction": direction,
        "notes": args.get("notes") or "AI-staged weekly inventory update",
        "review_new": True,
        "items": items,
    }
    note = str(payload.get("notes") or "").strip()
    row = {
        "entity_type": "inventory",
        "entity_id": batch_id,
        "field_name": "ai_weekly_inventory",
        "old_value_text": None,
        "new_value_text": f"W{week} {direction}",
        "change_type": "ai_stage",
        "metadata": {
            "summary": f"AI-staged {len(items)} item(s) for W{week} {direction} {month}/{year}",
            "description": note,
            "source": "agent",
        },
        "review_note": note or None,
        "status": "pending",
        "submitted_by": user_id,
        "source": "ai_agent",
        "operation": "inventory_week_update",
        "full_payload": payload,
        "batch_id": batch_id,
        "expires_at": _expires(),
    }
    try:
        r = supabase_service.table("staging_entries").insert(row).execute()
        staged = r.data or []
        entry_ids = [x["entry_id"] for x in staged if x.get("entry_id")]
        pr = _wrap_in_pr(
            entry_ids,
            user_id,
            f"AI W{week} {direction} update {month}/{year}",
            note,
        )
        return {
            "staged": len(entry_ids),
            "entry_ids": entry_ids,
            "pull_request": {
                "pr_id": pr.get("pr_id"),
                "pr_number": pr.get("pr_number"),
                "status": pr.get("status"),
            }
            if pr
            else None,
        }
    except Exception as exc:
        return {"error": str(exc)}


def get_source_control_status(args: dict, user_role: str) -> dict:
    if not _role_ok(user_role, "manager"):
        return {"error": "Requires manager role or above"}
    try:
        user_id = _require_user_id(args)
        svc = supabase_service
        pending = (
            svc.table("staging_entries")
            .select("entry_id", count="exact")
            .eq("status", "pending")
            .execute()
        )
        mine = (
            svc.table("staging_entries")
            .select("entry_id", count="exact")
            .eq("status", "pending")
            .eq("submitted_by", user_id)
            .execute()
        )
        prs = (
            svc.table("pull_requests")
            .select("pr_id", count="exact")
            .eq("status", "open")
            .execute()
        )
        return {
            "pending_entries": pending.count or 0,
            "my_pending_entries": mine.count or 0,
            "open_pull_requests": prs.count or 0,
        }
    except Exception as exc:
        return {"error": str(exc)}


# ── registry ──────────────────────────────────────────────────────────────────

TOOL_REGISTRY: dict[str, object] = {
    "get_dashboard_stats": get_dashboard_stats,
    "get_inventory": get_inventory,
    "get_events": get_events,
    "get_menu": get_menu,
    "get_reorders": get_reorders,
    "get_period_status": get_period_status,
    "get_users": get_users,
    "get_haccp_logs": get_haccp_logs,
    "get_daily_logs": get_daily_logs,
    "create_event": create_event,
    "stage_inventory_save": stage_inventory_save,
    "stage_inventory_week_update": stage_inventory_week_update,
    "get_source_control_status": get_source_control_status,
    "get_ai_usage": get_ai_usage,
}

TOOL_DESCRIPTIONS = """
Available tools (call with <tool_call>{"name":"...","args":{...}}</tool_call>):
- get_dashboard_stats: Active users, upcoming events, inventory items count, items below par, estimated value, current period
- get_inventory(month:int, year:int): Full inventory for a period — items, on-hand, below-par list, total value
- get_events(): Upcoming and recent events/programs
- get_menu(day:str): Menu for a day of the week (Mon/Tue/Wed/Thu/Fri/Sat/Sun) — meal periods and items
- get_reorders(): Items currently below par level sorted by shortage severity
- get_period_status(): Current inventory period and whether it has data
- get_users(): Active staff by role [manager+ only]
- get_haccp_logs(limit:int): Recent temperature/compliance logs and failures [manager+ only]
- get_daily_logs(limit:int): Recent daily operations entries [manager+ only]
- create_event(title:str, date:str YYYY-MM-DD, cat:str, description:str): Create a new event [manager+ only]
- stage_inventory_save(month:int, year:int, items:list, notes:str): Stage month-level inventory edits into Source Control and open/link a PR [manager+ only]
- stage_inventory_week_update(month:int, year:int, week:int, direction:str, items:list, notes:str): Stage W1-W3 received or pulled/issued quantities into Source Control and open/link a PR [manager+ only]
- get_source_control_status(): Pending staging and open PR counts [manager+ only]
- get_ai_usage(days:int): AI token/cost usage statistics [admin+ only]

You may call multiple tools in a single response by including multiple <tool_call> blocks.
When you have a complete answer, respond normally without any <tool_call> tags.
"""
