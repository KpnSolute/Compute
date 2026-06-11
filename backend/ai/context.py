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
    """Load AI config. Priority: active api_keys row → app_settings → env vars."""
    # 1. Check api_keys table for active provider
    try:
        r = _client().table('api_keys').select('provider,api_key,base_url').eq('is_active', True).limit(1).execute()
        if r.data:
            row = r.data[0]
            active_provider = row['provider']
            # Pull model from app_settings ai_config if available
            model = None
            try:
                s = (
                    _client()
                    .table('app_settings')
                    .select('setting_value')
                    .eq('setting_key', 'ai_config')
                    .limit(1)
                    .execute()
                )
                if s.data:
                    val = s.data[0]['setting_value']
                    if isinstance(val, dict):
                        model = val.get('model')
            except Exception:
                pass
            result: dict = {'provider': active_provider}
            if row.get('api_key'):
                result['api_key'] = row['api_key']
            if row.get('base_url'):
                result['ollama_url'] = row['base_url']
            if model:
                result['model'] = model
            return result
    except Exception:
        pass

    # 2. Fall back to app_settings ai_config
    try:
        r = (
            _client()
            .table('app_settings')
            .select('setting_value')
            .eq('setting_key', 'ai_config')
            .limit(1)
            .execute()
        )
        if r.data:
            val = r.data[0]['setting_value']
            if isinstance(val, dict):
                return val
    except Exception:
        pass

    return {
        'provider': os.getenv('AI_PROVIDER', 'groq'),
        'model': os.getenv('GROQ_MODEL', 'llama-3.3-70b-versatile'),
    }


def save_ai_config(config: dict) -> None:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    _client().table('app_settings').upsert(
        {'setting_key': 'ai_config', 'setting_value': config, 'updated_at': now},
        on_conflict='setting_key',
    ).execute()


# ── AI tools config ───────────────────────────────────────────────────────────

DEFAULT_TOOLS: dict[str, bool] = {
    'inventory':    True,
    'events':       True,
    'menu':         True,
    'haccp':        True,
    'daily_ops':    True,
    'source_ctrl':  False,   # future capability
    'reports':      False,   # future capability
    'suggestions':  False,   # future capability
}

# Map operation strings → tool key
OPERATION_TO_TOOL: dict[str, str] = {
    'inventory_save':        'inventory',
    'inventory_week_update': 'inventory',
    'event_create':          'events',
    'menu_save':             'menu',
    'haccp_save':            'haccp',
    'daily_log_save':        'daily_ops',
}


def get_ai_tools_config() -> dict[str, bool]:
    """Load AI tool toggles from app_settings. Missing keys fall back to DEFAULT_TOOLS."""
    try:
        r = (
            _client()
            .table('app_settings')
            .select('setting_value')
            .eq('setting_key', 'ai_tools_config')
            .limit(1)
            .execute()
        )
        if r.data:
            stored = r.data[0]['setting_value']
            if isinstance(stored, dict):
                # Merge: stored values override defaults; new default keys appear as-is
                return {**DEFAULT_TOOLS, **{k: bool(v) for k, v in stored.items()}}
    except Exception:
        pass
    return dict(DEFAULT_TOOLS)


def save_ai_tools_config(tools: dict[str, bool]) -> None:
    from datetime import datetime, timezone
    now = datetime.now(timezone.utc).isoformat()
    _client().table('app_settings').upsert(
        {'setting_key': 'ai_tools_config', 'setting_value': tools, 'updated_at': now},
        on_conflict='setting_key',
    ).execute()


def build_inventory_context(categories: dict, vendors: dict) -> str:
    cat_list = ", ".join(f"{n} (id={i})" for n, i in categories.items())
    ven_list = ", ".join(f"{n} (id={i})" for n, i in vendors.items()) or "none"
    return f"""INVENTORY SCHEMA CONTEXT:
inventory_items columns: sku (text, unique key), description (text), category (text — must match list), unit_price (float), par_level (int), unit (text, e.g. 'each','case','lb','oz','gal')
monthly_inventory columns: item_id (fk), month (0-indexed int), year (int), on_hand (int — REAL source of current quantity, NOT inventory_items)

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
