"""
Deterministic column mapper + AI fallback extractor.
Maps parsed file rows → dispatch payload shapes.
"""

import re
import hashlib
from typing import Any
from backend.ai import engine, context
from backend.inventory_identity import canonical_sku

# ── fuzzy column key normaliser ───────────────────────────────────────────────


def _norm(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", str(s).lower())


# Column aliases → canonical key
_INV_ALIASES: dict[str, str] = {
    # sku
    "sku": "sku",
    "itemno": "sku",
    "itemnum": "sku",
    "itemnumber": "sku",
    "item": "sku",
    "code": "sku",
    "productcode": "sku",
    "productnumber": "sku",
    "vendoritem": "sku",
    "vendorsku": "sku",
    "barcode": "sku",
    "id": "sku",
    # description
    "description": "desc",
    "desc": "desc",
    "name": "desc",
    "itemname": "desc",
    "productname": "desc",
    "product": "desc",
    "itemdescription": "desc",
    "productdescription": "desc",
    # category
    "category": "category",
    "cat": "category",
    "dept": "category",
    "department": "category",
    "type": "category",
    # price
    "price": "price",
    "unitprice": "price",
    "cost": "price",
    "unitcost": "price",
    "purchaseprice": "price",
    "rate": "price",
    # par
    "par": "par",
    "parlevel": "par",
    "minstock": "par",
    "minimum": "par",
    "minqty": "par",
    "reorderpoint": "par",
    # on hand = the OPENING balance. on_hand is the opening figure; ending is
    # computed (opening + received - issued). Map the STARTING balance; NEVER map
    # "Ending OH" — importing the closing figure as the opening double-states
    # stock and hides weekly activity.
    "startoh": "onHand",
    "startingoh": "onHand",
    "startonhand": "onHand",
    "startingbalance": "onHand",
    "openingoh": "onHand",
    "onhand": "onHand",
    "qty": "onHand",
    "quantity": "onHand",
    # invoice/receipt spreadsheets: the RECEIVED quantity is "Shipped Qty" (NOT
    # "Ordered Qty" — ordered-but-not-shipped goods never arrived).
    "shippedqty": "onHand",
    "qtyshipped": "onHand",
    "stock": "onHand",
    "currentstock": "onHand",
    "available": "onHand",
    "balance": "onHand",
    # unit
    "unit": "unit",
    "uom": "unit",
    "unitofmeasure": "unit",
    "measure": "unit",
    # weekly received/issued
    "w1r": "w1r",
    "week1received": "w1r",
    "week1receive": "w1r",
    "week1receivable": "w1r",
    "w1received": "w1r",
    "w1receive": "w1r",
    "w1receivable": "w1r",
    "receivedweek1": "w1r",
    "receiveweek1": "w1r",
    "w2r": "w2r",
    "week2received": "w2r",
    "week2receive": "w2r",
    "week2receivable": "w2r",
    "w2received": "w2r",
    "w2receive": "w2r",
    "w2receivable": "w2r",
    "receivedweek2": "w2r",
    "receiveweek2": "w2r",
    "w3r": "w3r",
    "week3received": "w3r",
    "week3receive": "w3r",
    "week3receivable": "w3r",
    "w3received": "w3r",
    "w3receive": "w3r",
    "w3receivable": "w3r",
    "receivedweek3": "w3r",
    "receiveweek3": "w3r",
    "w1i": "w1p",
    "w1p": "w1p",
    "week1issued": "w1p",
    "week1issue": "w1p",
    "week1pulled": "w1p",
    "week1pull": "w1p",
    "w1issued": "w1p",
    "w1issue": "w1p",
    "w1pulled": "w1p",
    "w1pull": "w1p",
    "issuedweek1": "w1p",
    "pullweek1": "w1p",
    # Monthly Inventory Template: "Received Wk1" / "Pulled Wk1" headers (3 weeks)
    "receivedwk1": "w1r",
    "receivedwk2": "w2r",
    "receivedwk3": "w3r",
    "pulledwk1": "w1p",
    "pulledwk2": "w2p",
    "pulledwk3": "w3p",
    "w2i": "w2p",
    "w2p": "w2p",
    "week2issued": "w2p",
    "week2issue": "w2p",
    "week2pulled": "w2p",
    "week2pull": "w2p",
    "w2issued": "w2p",
    "w2issue": "w2p",
    "w2pulled": "w2p",
    "w2pull": "w2p",
    "issuedweek2": "w2p",
    "pullweek2": "w2p",
    "w3i": "w3p",
    "w3p": "w3p",
    "week3issued": "w3p",
    "week3issue": "w3p",
    "week3pulled": "w3p",
    "week3pull": "w3p",
    "w3issued": "w3p",
    "w3issue": "w3p",
    "w3pulled": "w3p",
    "w3pull": "w3p",
    "issuedweek3": "w3p",
    "pullweek3": "w3p",
}

_EVENT_ALIASES: dict[str, str] = {
    "title": "title",
    "name": "title",
    "event": "title",
    "date": "date",
    "eventdate": "date",
    "cat": "cat",
    "category": "cat",
    "type": "cat",
    "theme": "theme",
    "description": "description",
    "desc": "description",
    "notes": "description",
    "suggestedmenu": "suggested_menu",
    "menu": "suggested_menu",
    "status": "status",
}


def _map_headers(raw_headers: list[str], alias_map: dict[str, str]) -> dict[str, str]:
    """Returns {raw_header: canonical_key} for recognized headers."""
    return {h: alias_map[_norm(h)] for h in raw_headers if _norm(h) in alias_map}


def _safe_float(v: Any, default: float = 0.0) -> float:
    try:
        return float(str(v).replace("$", "").replace(",", "").strip())
    except (ValueError, TypeError):
        return default


def _safe_int(v: Any, default: int = 0) -> int:
    try:
        return int(float(str(v).replace(",", "").strip()))
    except (ValueError, TypeError):
        return default


# ── inventory mapper ──────────────────────────────────────────────────────────


def _closest_category(raw: str, categories: dict[str, int]) -> str:
    """Return the closest known category name, or empty string."""
    raw_n = _norm(raw)
    for name in categories:
        if _norm(name) in raw_n or raw_n in _norm(name):
            return name
    return ""


def _gen_sku(category: str, counters: dict[str, int]) -> str:
    prefix = re.sub(r"[^A-Z]", "", category.upper())[:3] or "GEN"
    counters[prefix] = counters.get(prefix, 0) + 1
    return f"{prefix}-{counters[prefix]:03d}"


def _gen_review_sku(category: str, desc: str, row_number: int) -> str:
    """Stable temporary SKU for spreadsheet rows missing a real item code."""
    key = f"{category.strip().lower()}|{desc.strip().lower()}|{row_number}"
    row_part = f"{min(max(row_number, 1), 9999):04d}"
    hash_part = hashlib.sha1(key.encode("utf-8")).hexdigest()[:6].upper()
    return f"MJC-{row_part}{hash_part}"


def map_rows_to_inventory(
    rows: list[dict],
    categories: dict[str, int],
    month: int,
    year: int,
    notes: str = "",
) -> dict | None:
    """
    Deterministically map structured rows to inventory_save payload.
    Returns None if too few recognized columns (caller should fall back to AI).
    """
    if not rows:
        return None

    headers = list(rows[0].keys())
    mapping = _map_headers(headers, _INV_ALIASES)

    # require at least description or sku to proceed deterministically
    canonical_values = set(mapping.values())
    if "desc" not in canonical_values and "sku" not in canonical_values:
        return None  # not enough signal — needs AI

    items = []
    for row_number, row in enumerate(rows, start=1):
        mapped = {mapping[h]: row[h] for h in headers if h in mapping}
        if not mapped:
            continue

        raw_cat = str(mapped.get("category") or "")
        category = _closest_category(raw_cat, categories) or raw_cat or "Dry Goods"
        raw_sku = canonical_sku(str(mapped.get("sku") or ""))
        desc = str(mapped.get("desc") or raw_sku).strip()
        sku = raw_sku or _gen_review_sku(category, desc, row_number)

        # Dispatch rejects negative quantities/prices outright (which would abort
        # the whole commit). Inventory counts and prices can't be physically
        # negative, so floor them to 0 here at data entry — an audit artifact in
        # one row must not block importing the rest.
        item: dict = {
            "sku": sku,
            "desc": desc,
            "category": category,
            "price": max(0.0, _safe_float(mapped.get("price"))),
            # Only carry par when the sheet actually has a par column; else
            # None so dispatch preserves any existing par (never zeroes it).
            "par": (
                max(0, _safe_int(mapped.get("par")))
                if "par" in canonical_values
                else None
            ),
            "onHand": max(0, _safe_int(mapped.get("onHand"))),
            "unit": str(mapped.get("unit") or "each").strip(),
            "w1r": max(0, _safe_int(mapped.get("w1r"))),
            "w2r": max(0, _safe_int(mapped.get("w2r"))),
            "w3r": max(0, _safe_int(mapped.get("w3r"))),
            "w1p": max(0, _safe_int(mapped.get("w1p"))),
            "w2p": max(0, _safe_int(mapped.get("w2p"))),
            "w3p": max(0, _safe_int(mapped.get("w3p"))),
        }
        # May case: monthly Total Pulled present but weekly pulls were blank.
        # Pass through so dispatch can apply without inventing weekly distribution.
        if row.get("total_pulled_raw") is not None:
            item["total_pulled_raw"] = max(0, _safe_int(row.get("total_pulled_raw")))
        items.append(item)

    if not items:
        return None

    return {"month": month, "year": year, "notes": notes, "items": items}


def map_rows_to_events(rows: list[dict]) -> list[dict]:
    """Deterministically map structured rows to event_create payloads."""
    headers = list(rows[0].keys()) if rows else []
    mapping = _map_headers(headers, _EVENT_ALIASES)
    if "title" not in mapping.values():
        return []

    events = []
    for row in rows:
        mapped = {mapping[h]: row[h] for h in headers if h in mapping}
        if not mapped.get("title"):
            continue
        events.append(
            {
                "title": str(mapped.get("title", "")).strip(),
                "date": str(mapped.get("date", "")).strip(),
                "cat": str(mapped.get("cat", "Event")).strip(),
                "theme": str(mapped.get("theme") or "").strip() or None,
                "description": str(mapped.get("description") or "").strip() or None,
                "suggested_menu": str(mapped.get("suggested_menu") or "").strip()
                or None,
                "status": str(mapped.get("status") or "upcoming").strip(),
            }
        )
    return events


# ── AI extractor fallback ─────────────────────────────────────────────────────


def ai_extract_inventory(
    text_or_rows: str | list[dict],
    categories: dict[str, int],
    vendors: dict[str, int],
    month: int,
    year: int,
    ai_config: dict | None = None,
    called_by: str | None = None,
) -> dict:
    """Use AI to extract inventory_save payload from ambiguous text/rows."""
    schema_ctx = context.build_inventory_context(categories, vendors)
    if isinstance(text_or_rows, list):
        from backend.ai.parser import rows_to_text

        file_text = rows_to_text(text_or_rows)
    else:
        file_text = text_or_rows

    messages = [
        {
            "role": "system",
            "content": (
                f"{schema_ctx}\n\n"
                f"Current date context: month={month}, year={year}.\n"
                "Extract all inventory items from the file. "
                "Return ONLY valid JSON — no explanation, no markdown, no extra text. "
                "Use the vendor's product/item number (typically a 5-7 digit code, "
                "e.g. a US Foods product number) as the SKU whenever one is present "
                "on the row — NEVER invent a SKU for an item that already has a "
                "product number, as that breaks matching against the existing catalog. "
                "Only when no identifier exists at all, generate one as CATEGORY_PREFIX-NNN. "
                "Map every category to the closest valid category name from the list."
            ),
        },
        {
            "role": "user",
            "content": f"FILE CONTENT:\n{file_text[:8000]}",
        },
    ]

    raw = engine.complete(
        messages, ai_config, operation="inventory_save", called_by=called_by
    )
    result = engine.extract_json(raw)
    if isinstance(result, list):
        result = {
            "month": month,
            "year": year,
            "notes": "AI extracted",
            "items": result,
        }
    return result


def ai_extract_events(
    text_or_rows: str | list[dict],
    ai_config: dict | None = None,
) -> list[dict]:
    """Use AI to extract event_create payloads."""
    schema_ctx = context.build_events_context()
    if isinstance(text_or_rows, list):
        from backend.ai.parser import rows_to_text

        file_text = rows_to_text(text_or_rows)
    else:
        file_text = text_or_rows

    messages = [
        {
            "role": "system",
            "content": (
                f"{schema_ctx}\n\n"
                "Extract all events from the file. "
                "Return ONLY a JSON array of event objects — no explanation."
            ),
        },
        {"role": "user", "content": f"FILE CONTENT:\n{file_text[:8000]}"},
    ]

    raw = engine.complete(messages, ai_config)
    result = engine.extract_json(raw)
    return result if isinstance(result, list) else result.get("events", [])


def classify_operation(
    filename: str,
    hint: str | None,
    rows: list[dict] | None,
    ai_config: dict | None = None,
) -> str:
    """
    Determine which operation type a file targets.
    Uses hint first, then header analysis, then AI classification.
    """
    if hint and hint in context.OPERATION_HINTS:
        return context.OPERATION_HINTS[hint]

    # header-based heuristic
    if rows:
        headers_norm = {_norm(h) for h in rows[0].keys()}
        inv_score = len(
            headers_norm
            & {"sku", "description", "desc", "onhand", "qty", "price", "category"}
        )
        event_score = len(headers_norm & {"title", "date", "event", "theme"})
        haccp_score = len(
            headers_norm & {"temperature", "location", "checkedby", "temp"}
        )
        best = max(
            ("inventory_save", inv_score),
            ("event_create", event_score),
            ("haccp_save", haccp_score),
            key=lambda x: x[1],
        )
        if best[1] >= 2:
            return best[0]

    # filename heuristic
    fn = filename.lower()
    for kw, op in [
        ("invent", "inventory_save"),
        ("stock", "inventory_save"),
        ("event", "event_create"),
        ("calend", "event_create"),
        ("haccp", "haccp_save"),
        ("temp", "haccp_save"),
        ("menu", "menu_save"),
        ("log", "daily_log_save"),
    ]:
        if kw in fn:
            return op

    return "inventory_save"  # safest default for cafeteria context
