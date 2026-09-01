"""Schema context builder — pulls live lookup data for AI prompts."""

import time
from backend.routes import supabase_service

_cache: dict[str, tuple[float, dict]] = {}
_CACHE_TTL = 60.0


def _cached(key: str, fetch):
    now = time.monotonic()
    if key in _cache and now - _cache[key][0] < _CACHE_TTL:
        return _cache[key][1]
    data = fetch()
    _cache[key] = (now, data)
    return data


def get_categories() -> dict[str, int]:
    """Returns {name: id} for all inventory_categories."""
    return _cached(
        "categories",
        lambda: {
            row["name"]: row["id"]
            for row in (
                supabase_service.table("inventory_categories")
                .select("id,name")
                .execute()
                .data
                or []
            )
        },
    )


def get_vendors() -> dict[str, int]:
    """Returns {name: id} for all vendors."""
    return _cached(
        "vendors",
        lambda: {
            row["name"]: row["id"]
            for row in (
                supabase_service.table("vendors").select("id,name").execute().data or []
            )
        },
    )


def get_ai_config() -> dict:
    """Load AI config and its provider key without relying on an ambiguous FK join."""
    try:
        r = (
            supabase_service.table("ai_stack_config")
            .select(
                "provider, model, is_vision, ollama_url, vision_capable, key_id, tenant_id"
            )
            .eq("name", "default")
            .limit(1)
            .execute()
        )
        if r.data:
            row = r.data[0]
            key_row = {}
            if row.get("key_id"):
                key_query = (
                    supabase_service.table("ai_provider_keys")
                    .select("api_key, base_url, model_override")
                    .eq("id", row["key_id"])
                )
                if row.get("tenant_id"):
                    key_query = key_query.eq("tenant_id", row["tenant_id"])
                key_result = key_query.limit(1).execute()
                key_row = (key_result.data or [{}])[0]
            model = key_row.get("model_override") or row.get("model") or ""
            return {
                "provider": row["provider"],
                "model": model,
                "api_key": key_row.get("api_key"),
                "ollama_url": row.get("ollama_url") or key_row.get("base_url"),
                "is_vision": row.get("vision_capable") or row.get("is_vision") or False,
            }
    except Exception:
        pass
    return {"provider": "groq", "model": "llama-3.3-70b-versatile"}


def save_ai_config(config: dict) -> None:
    """Upsert ai_stack_config where name='default'."""
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    row: dict = {
        "name": "default",
        "provider": config.get("provider", "groq"),
        "model": config.get("model", ""),
        "updated_at": now,
    }
    if "key_id" in config:
        row["key_id"] = config["key_id"]
    if "vision_capable" in config:
        row["vision_capable"] = config["vision_capable"]
    if "ollama_url" in config:
        row["ollama_url"] = config["ollama_url"]
    supabase_service.table("ai_stack_config").upsert(row, on_conflict="name").execute()


# ── AI tools config ───────────────────────────────────────────────────────────

DEFAULT_TOOLS: dict[str, bool] = {
    "inventory": True,
    "events": True,
    "menu": True,
    "haccp": True,
    "daily_ops": True,
}

# Map operation strings → tool key
OPERATION_TO_TOOL: dict[str, str] = {
    "inventory_save": "inventory",
    "inventory_week_update": "inventory",
    "event_create": "events",
    "menu_save": "menu",
    "haccp_save": "haccp",
    "daily_log_save": "daily_ops",
}


def get_ai_tools_config() -> dict[str, bool]:
    """Load AI tool toggles from app_settings. Missing keys fall back to DEFAULT_TOOLS."""
    try:
        r = (
            supabase_service.table("app_settings")
            .select("setting_value")
            .eq("setting_key", "ai_tools_config")
            .limit(1)
            .execute()
        )
        if r.data:
            stored = r.data[0]["setting_value"]
            if isinstance(stored, dict):
                # Merge: stored values override defaults; new default keys appear as-is
                return {**DEFAULT_TOOLS, **{k: bool(v) for k, v in stored.items()}}
    except Exception:
        pass
    return dict(DEFAULT_TOOLS)


def save_ai_tools_config(tools: dict[str, bool]) -> None:
    from datetime import datetime, timezone

    now = datetime.now(timezone.utc).isoformat()
    supabase_service.table("app_settings").upsert(
        {"setting_key": "ai_tools_config", "setting_value": tools, "updated_at": now},
        on_conflict="setting_key",
    ).execute()


def build_inventory_context(categories: dict, vendors: dict) -> str:
    cat_list = ", ".join(f"{n} (id={i})" for n, i in categories.items())
    ven_list = ", ".join(f"{n} (id={i})" for n, i in vendors.items()) or "none"
    return f"""INVENTORY SCHEMA CONTEXT:
inventory_items columns: sku (text, unique key), description (text), category (text - must match list), unit_price (float), par_level (int), unit (text, e.g. 'each','case','lb','oz','gal')
monthly_inventory columns: item_id (fk), month (0-indexed int), year (int), opening_oh (int - prior month ending, the period's starting quantity), w1-w3 received, w1-w3 pulled, opening_unit_cost/opening_value/received_value/pulled_value/ending_value (audited financial controls from workbook Review sheets when present), status

STANDARD INVENTORY COMPUTE CONTRACT:
- Monthly unit_price is the approved valuation price for every row in that month.
- Opening quantity = prior month ending quantity (or an explicitly counted opening quantity).
- Total received = w1_received + w2_received + w3_received.
- Total pulled = w1_pulled + w2_pulled + w3_pulled.
- Ending quantity = max(0, opening quantity + total received - total pulled).
- Opening value = opening quantity x monthly unit_price.
- Received value = total received x monthly unit_price.
- Pulled value = total pulled x monthly unit_price.
- Ending value = ending quantity x monthly unit_price.
- Monthly totals are sums of the row-level values. The control identity is
  Opening value + Received value - Pulled value = Ending value.
- Invoice register net_total is payable accounting data and must never replace
  inventory received value. Preserve invoice goods totals separately for reconciliation.
- The current template has exactly 3 operational import weeks. Do not emit W4/W5 fields. Dates after the active template weeks are handled by period rollover/calendar logic, not by adding a fourth weekly column.

VALID CATEGORIES (use exact name): {cat_list}
VALID VENDORS: {ven_list}

PAYLOAD FORMAT - inventory_save operation (Monthly Inventory Template, 3 weeks):
{{
  "month": <int 1-12>,
  "year": <int 4-digit>,
  "notes": "<source description>",
  "items": [
    {{
      "sku": "<string — generate 'CAT-NNN' if absent>",
      "desc": "<item description>",
      "category": "<exact category name from list>",
      "price": <float — Unit Price>,
      "par": <int — minimum stock level, 0 if unknown>,
      "onHand": <int — Opening OH (prior month ending)>,
      "w1r": 0, "w2r": 0, "w3r": 0,
      "w1p": 0, "w2p": 0, "w3p": 0,
      "opening_unit_cost": <float optional — Review sheet Opening Unit Cost>,
      "opening_value": <float optional — Review sheet Opening Value>,
      "received_value": <float optional — Review sheet Received Value>,
      "pulled_value": <float optional — Review sheet Inventory Flow/Pulled Value>,
      "ending_value": <float optional — Review sheet Ending Value>
    }}
  ]
}}

Weekly cell rules:
- Received Wk1/Wk2/Wk3 (invoice receipts) map to w1r/w2r/w3r.
- Pulled Wk1/Wk2/Wk3 (pull sheet quantities) map to w1p/w2p/w3p.
- Opening OH maps to onHand. Total Received, Total Pulled, and Ending OH are DERIVED - never import Ending OH as onHand.
- When per-week pulls are blank but a verified monthly Total Pulled exists, emit "total_pulled_raw" instead of guessing a weekly split.
- For full-month MJCC workbooks, read the Inventory sheet for quantities and use the Review sheet only as an audit comparison. Do not preserve imported financial controls when they conflict with the standard quantity x monthly price contract.
- Use "issued" only as user-facing/vendor language. The stored monthly fields are pulled: w1p/w2p/w3p and pulled_value.
- Preserve SKU exactly except trimming spaces and uppercasing letters; do not merge two different SKUs by description alone.
"""


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
    "budget": "budget_save",
}
