"""What's New popup: surfaces the latest CHANGELOG.md entry to the user on login.

No new tables -- reuses the existing `app_settings` key/value store: the
global on/off toggle lives at setting_key='whats_new_enabled', and each
user's last-seen version lives inside their existing `user_prefs_<id>` blob
(the same row Settings' theme preference already uses).

Role targeting is opt-in via an inline tag on the entry's title line in
CHANGELOG.md, e.g.:
    ## [v4.36.0] -- 2026-07-10 -- {roles:manager,admin,sudo} New cost report
An entry with no {roles:...} tag is shown to every role.
"""

import logging
import re
from datetime import datetime, timezone
from pathlib import Path

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from backend.routes import supabase_service
from backend.routes._deps import _get_auth_user

log = logging.getLogger("mjcc.changelog")

router = APIRouter(prefix="/api/changelog")

_CHANGELOG_PATH = Path(__file__).resolve().parents[2] / "CHANGELOG.md"
_ENTRY_RE = re.compile(
    r"^##\s*\[?(v[\w.\-]+)\]?\s*[—-]+\s*([\d]{4}-[\d]{2}-[\d]{2})\s*[—-]+\s*(.+)$"
)
_ROLE_TAG_RE = re.compile(r"\{roles:\s*([a-z,\s]+)\}\s*")
_TOGGLE_KEY = "whats_new_enabled"


def _parse_latest_entry() -> dict | None:
    try:
        text = _CHANGELOG_PATH.read_text(encoding="utf-8")
    except OSError as exc:
        log.warning("[CHANGELOG] could not read CHANGELOG.md: %s", exc)
        return None
    for line in text.splitlines():
        m = _ENTRY_RE.match(line.strip())
        if not m:
            continue
        version, date, title = m.groups()
        roles_m = _ROLE_TAG_RE.search(title)
        roles: set[str] | None = None
        if roles_m:
            roles = {
                r.strip() for r in roles_m.group(1).lower().split(",") if r.strip()
            }
            title = _ROLE_TAG_RE.sub("", title).strip()
        return {"version": version, "date": date, "title": title, "roles": roles}
    return None


def _whats_new_enabled() -> bool:
    try:
        r = (
            supabase_service.table("app_settings")
            .select("setting_value")
            .eq("setting_key", _TOGGLE_KEY)
            .limit(1)
            .execute()
        )
        if r.data:
            v = r.data[0]["setting_value"]
            return v is not False
        return True
    except Exception as exc:
        log.warning("[CHANGELOG] could not read toggle, defaulting on: %s", exc)
        return True


def _last_seen_version(user_id: str) -> str | None:
    try:
        r = (
            supabase_service.table("app_settings")
            .select("setting_value")
            .eq("setting_key", f"user_prefs_{user_id}")
            .limit(1)
            .execute()
        )
        if r.data:
            return (r.data[0]["setting_value"] or {}).get("last_seen_changelog_version")
    except Exception as exc:
        log.warning("[CHANGELOG] could not read last-seen version: %s", exc)
    return None


@router.get("/whats-new")
async def get_whats_new(auth_user: dict = Depends(_get_auth_user)):
    """Return the latest changelog entry if it's new to this user and role-visible."""
    if not _whats_new_enabled():
        return {"show": False}

    entry = _parse_latest_entry()
    if not entry:
        return {"show": False}

    role = (auth_user.get("role") or "").lower()
    if entry["roles"] and role not in entry["roles"]:
        return {"show": False}

    if _last_seen_version(auth_user["id"]) == entry["version"]:
        return {"show": False}

    return {
        "show": True,
        "version": entry["version"],
        "date": entry["date"],
        "title": entry["title"],
    }


class ToggleBody(BaseModel):
    enabled: bool


@router.get("/settings")
async def get_whats_new_settings(auth_user: dict = Depends(_get_auth_user)):
    _ = auth_user
    return {"enabled": _whats_new_enabled()}


@router.put("/settings")
async def update_whats_new_settings(
    body: ToggleBody, auth_user: dict = Depends(_get_auth_user)
):
    role = (auth_user.get("role") or "").lower()
    if role not in ("admin", "sudo"):
        raise HTTPException(status_code=403, detail="Admin or sudo required")

    now = datetime.now(timezone.utc).isoformat()
    existing = (
        supabase_service.table("app_settings")
        .select("setting_key")
        .eq("setting_key", _TOGGLE_KEY)
        .limit(1)
        .execute()
    )
    if existing.data:
        supabase_service.table("app_settings").update(
            {
                "setting_value": body.enabled,
                "updated_at": now,
                "updated_by": auth_user["id"],
            }
        ).eq("setting_key", _TOGGLE_KEY).execute()
    else:
        supabase_service.table("app_settings").insert(
            {
                "setting_key": _TOGGLE_KEY,
                "setting_value": body.enabled,
                "updated_by": auth_user["id"],
                "updated_at": now,
            }
        ).execute()
    return {"enabled": body.enabled}
