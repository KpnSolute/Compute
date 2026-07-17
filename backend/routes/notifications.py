"""Authenticated notification feeds for the main portal tray.

The route deliberately keeps feed failures isolated.  A stale or unavailable
inventory view must not hide source-control or application-update notices.
Read keys live in the existing per-user app_settings preference blob so this
does not introduce a second notification schema or a new table.
"""

import logging
import os
import re
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user

log = logging.getLogger("mjcc.notifications")
router = APIRouter(prefix="/api/notifications", tags=["notifications"])

ROOT = Path(__file__).resolve().parents[2]
PREFS_PREFIX = "user_prefs_"
try:
    VERSION = (ROOT / "VERSION").read_text(encoding="utf-8").strip()
except (OSError, UnicodeError) as exc:
    VERSION = "0.0.0"
    log.warning("Could not read application version from %s: %s", ROOT / "VERSION", exc)


class ReadBody(BaseModel):
    keys: list[str] = Field(default_factory=list, max_length=1000)


def _prefs_key(user_id: str) -> str:
    return f"{PREFS_PREFIX}{user_id}"


def _read_prefs(user_id: str) -> dict:
    result = (
        supabase_service.table("app_settings")
        .select("setting_value")
        .eq("setting_key", _prefs_key(user_id))
        .limit(1)
        .execute()
    )
    value = result.data[0].get("setting_value") if result.data else {}
    return value if isinstance(value, dict) else {}


def _write_prefs(user_id: str, prefs: dict) -> None:
    now = datetime.now(timezone.utc).isoformat()
    existing = (
        supabase_service.table("app_settings")
        .select("setting_key")
        .eq("setting_key", _prefs_key(user_id))
        .limit(1)
        .execute()
    )
    if existing.data:
        supabase_service.table("app_settings").update(
            {"setting_value": prefs, "updated_at": now}
        ).eq("setting_key", _prefs_key(user_id)).execute()
    else:
        supabase_service.table("app_settings").insert(
            {
                "setting_key": _prefs_key(user_id),
                "setting_value": prefs,
                "updated_at": now,
            }
        ).execute()


def _key(kind: str, value: str) -> str:
    return f"{kind}:{value}"


def _latest_update() -> dict:
    """Build release notes from the current version and the forum's latest section."""
    title = "MJCC application update"
    key_updates: list[str] = []
    try:
        text = (ROOT / "CHANGELOG.md").read_text(encoding="utf-8")
        section: list[str] = []
        for line in text.splitlines():
            if line.startswith("## ") and section:
                break
            if line.startswith("## "):
                section = []
                continue
            if section is not None:
                section.append(line.strip())
        for line in section:
            if line.startswith("**") and not line.startswith("**Push:"):
                cleaned = re.sub(r"^\*\*[^:]+:\s*", "", line).strip()
                if cleaned:
                    key_updates.append(cleaned)
            if len(key_updates) == 3:
                break
    except OSError as exc:
        log.warning("Could not read release notes: %s", exc)
    if key_updates:
        title = key_updates[0]
    commit = os.getenv("RENDER_GIT_COMMIT", "")[:12] or os.getenv("GIT_COMMIT", "")[:12]
    return {
        "key": _key("app-update", VERSION),
        "version": f"v{VERSION}",
        "title": title,
        "key_updates": key_updates,
        "commit": commit or None,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


def _inventory_items() -> list[dict]:
    result = (
        supabase_service.table("inventory_items")
        .select(
            "id, sku, description, category_id, sku_pending, needs_attention, "
            "inventory_categories(name)"
        )
        .eq("needs_attention", True)
        .limit(2000)
        .execute()
    )
    items = []
    for row in result.data or []:
        joined = row.get("inventory_categories") or {}
        if isinstance(joined, list):
            joined = joined[0] if joined else {}
        if (joined.get("name") or "").lower() != "new items":
            continue
        item_id = str(row.get("id") or row.get("sku") or "")
        items.append(
            {
                "key": _key("new-item", item_id),
                "kind": "new_item",
                "title": row.get("description") or row.get("sku") or "New item",
                "body": row.get("sku") or "Awaiting category review",
                "target": "inventory",
                "item": {
                    "id": row.get("id"),
                    "sku": row.get("sku"),
                    "description": row.get("description"),
                    "category": "New Items",
                },
            }
        )
    return items


def _reorders() -> list[dict]:
    result = (
        supabase_service.table("live_inventory")
        .select("sku, description, category, on_hand, par_level")
        .execute()
    )
    rows = []
    for row in result.data or []:
        try:
            on_hand = max(0, int(float(row.get("on_hand") or 0)))
            par = max(0, int(float(row.get("par_level") or 0)))
        except (TypeError, ValueError):
            continue
        if par <= 0 or on_hand >= par:
            continue
        short = par - on_hand
        sku = str(row.get("sku") or "")
        rows.append(
            {
                "key": _key("reorder", f"{sku}:{short}"),
                "kind": "reorder",
                "title": row.get("description") or sku or "Reorder item",
                "body": f"{short} below par",
                "target": "inventory",
                "item": {"sku": sku, "short": short, "onHand": on_hand, "par": par},
            }
        )
    return sorted(rows, key=lambda row: row["item"]["short"], reverse=True)


def _commits() -> list[dict]:
    result = (
        supabase_service.table("commits")
        .select("commit_id, message, branch, created_at, author_id")
        .order("created_at", desc=True)
        .limit(5)
        .execute()
    )
    rows = result.data or []
    author_ids = list({row.get("author_id") for row in rows if row.get("author_id")})
    profiles = {}
    if author_ids:
        profiles_result = (
            supabase_service.table("user_profiles")
            .select("id, username, display_name")
            .in_("id", author_ids)
            .execute()
        )
        profiles = {row["id"]: row for row in (profiles_result.data or [])}
    return [
        {
            "key": _key(
                "push", str(row.get("commit_id") or row.get("created_at") or "")
            ),
            "kind": "push",
            "title": row.get("message") or "Source Control push",
            "body": f"{row.get('branch') or 'main'} · {profiles.get(row.get('author_id'), {}).get('display_name') or profiles.get(row.get('author_id'), {}).get('username') or 'team'}",
            "target": "sourcectrl",
            "item": row,
        }
        for row in rows
    ]


def _temp_alerts() -> list[dict]:
    cutoff = (datetime.now(timezone.utc) - timedelta(days=7)).isoformat()
    result = (
        supabase_service.table("haccp_logs")
        .select("*")
        .gte("timestamp", cutoff)
        .order("timestamp", desc=True)
        .limit(500)
        .execute()
    )
    alerts = []
    for row in result.data or []:
        try:
            temperature = float(row.get("temperature"))
        except (TypeError, ValueError):
            continue
        location = str(row.get("location") or "Unknown location")
        threshold = 0 if "freezer" in location.lower() else 41
        if temperature <= threshold:
            continue
        timestamp = str(row.get("timestamp") or "unknown time")
        alerts.append(
            {
                "key": _key(
                    "temp-alert", str(row.get("id") or f"{location}:{timestamp}")
                ),
                "kind": "temp_alert",
                "title": location,
                "body": f"{temperature:g}°F recorded above the {threshold:g}°F limit at {timestamp}",
                "target": "haccp",
                "item": row,
            }
        )
    return alerts


@router.get("")
async def get_notifications(auth_user: dict = Depends(_get_auth_user)):
    prefs = _read_prefs(auth_user["id"])
    seen = set(prefs.get("notification_read_keys") or [])
    feeds: list[dict] = []
    errors: list[str] = []
    for name, loader in (
        ("reorders", _reorders),
        ("new_items", _inventory_items),
        ("pushes", _commits),
        ("temp_alerts", _temp_alerts),
    ):
        try:
            feeds.extend(loader())
        except Exception:
            log.exception("Notification feed failed: %s", name)
            errors.append(name)
    update = _latest_update()
    feeds.append(
        {
            "key": update["key"],
            "kind": "app_update",
            "title": update["title"],
            "body": f"{update['version']} · key updates",
            "target": "sourcectrl",
            "item": update,
        }
    )
    unread = [
        item["key"]
        for item in feeds
        if item["key"] not in seen
        and not (
            item["kind"] == "app_update"
            and not prefs.get("last_seen_changelog_version")
        )
    ]
    return {
        "version": f"v{VERSION}",
        "items": feeds,
        "unread_keys": unread,
        "feed_errors": errors,
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/read")
async def mark_notifications_read(
    body: ReadBody, auth_user: dict = Depends(_get_auth_user)
):
    prefs = _read_prefs(auth_user["id"])
    existing = [str(value) for value in (prefs.get("notification_read_keys") or [])]
    merged = list(
        dict.fromkeys(existing + [str(value) for value in body.keys if value])
    )[-1000:]
    prefs["notification_read_keys"] = merged
    _write_prefs(auth_user["id"], prefs)
    return {"read": len(body.keys), "stored": len(merged)}
