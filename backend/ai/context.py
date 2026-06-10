"""Schema context builder — pulls live lookup data for AI prompts."""

import os
from supabase import create_client

_svc = None


def _client():
    global _svc
    if _svc is None:
        url = os.getenv("SUPABASE_URL")
        key = os.getenv("SUPABASE_SERVICE_KEY")
        if not url or not key:
            raise RuntimeError("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.")
        _svc = create_client(url, key)
    return _svc


def get_categories() -> dict[str, int]:
    """Returns {name: id} for all inventory_categories."""
    r = _client().table("inventory_categories").select("id,name").execute()
    return {row["name"]: row["id"] for row in (r.data or [])}


def get_vendors() -> dict[str, int]:
    """Returns {name: id} for all vendors."""
    r = _client().table("vendors").select("id,name").execute()
    return {row["name"]: row["id"] for row in (r.data or [])}


def get_ai_config() -> dict:
    """Load AI config from app_settings. Falls back to env vars."""
    try:
        r = (
            _client()
            .table("app_settings")
            .select("setting_value")
            .eq("setting_key", "ai_config")
            .limit(1)
            .execute()
        )
        if r.data:
            val = r.data[0]["setting_value"]
            if isinstance(val, dict):
                return val
    except Exception:
        pass
    return {
        "provider": os.getenv("AI_PROVIDER", "groq"),
        "model": os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
    }


def save_ai_config(config: dict) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    _client().table("app_settings").upsert(
        {"setting_key": "ai_config", "setting_value": config, "updated_at": now},
        on_conflict="setting_key",
    ).execute()


def build_inventory_context(categories: dict, vendors: dict) -> str:
    cat_list = ", ".join(f"{n} (id={i})" for n, i in categories.items())
    ven_list = ", ".join(f"{n} (id={i})" for n, i in vendors.items()) or "none"
    return f"""INVENTORY SCHEMA CONTEXT:
inventory_items columns: sku (text, unique key), description (text), category (text — must match list), unit_price (float), par_level (int), on_hand (int), unit (text, e.g. 'each','case','lb','oz','gal')

VALID CATEGORIES (use exact name): {cat_list}
VALID VENDORS: {ven_list}

PAYLOAD FORMAT — inventory_save operation:
{{
  "month": <int 1-12>,
  "year": <int 4-digit>,
  "notes": "<source description>",
  "items": [
    {{
      "sku": "<string — generate 'CAT-NNN' if absent>",
      "desc": "<item description>",
      "category": "<exact category name from list>",
      "price": <float>,
      "par": <int — minimum stock level, 0 if unknown>,
      "onHand": <int — current quantity>,
      "w1r": 0, "w2r": 0, "w3r": 0, "w4r": 0,
      "w1i": 0, "w2i": 0, "w3i": 0, "w4i": 0
    }}
  ]
}}"""


def build_events_context() -> str:
    return """EVENTS SCHEMA CONTEXT:
events columns: title (text), date (text ISO YYYY-MM-DD), cat (text — category/type), theme (text), description (text), suggested_menu (text), status (text: 'upcoming'|'active'|'completed')

PAYLOAD FORMAT — event_create operation:
{
  "title": "<string>",
  "date": "<YYYY-MM-DD>",
  "cat": "<category string>",
  "theme": "<string or null>",
  "description": "<string or null>",
  "suggested_menu": "<string or null>",
  "status": "upcoming"
}"""


OPERATION_HINTS = {
    "inventory": "inventory_save",
    "menu": "menu_save",
    "event": "event_create",
    "events": "event_create",
    "haccp": "haccp_save",
    "compliance": "haccp_save",
    "log": "daily_log_save",
    "ops": "daily_log_save",
}
