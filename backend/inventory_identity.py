"""
Inventory item identity — the single source of truth for "find or create the
inventory_items row for this payload".

Post the 2026-06-09 SKU migration (`inventory_items.sku` is NOT NULL + UNIQUE,
see CHANGELOG v1.9.0), SKU is the item's primary business identity. This module
unifies the previously triplicated + divergent resolution logic that lived in
`backend/staging/dispatch.py`, `backend/routes/inventory.py` and
`backend/ai/diff.py`.

Rules:
- Match an existing item by SKU ONLY. The old `description + category` fuzzy
  fallback silently merged distinct items and made the preview (SKU-only) and
  the commit (SKU-or-desc) disagree — removed.
- A blank/missing SKU is generated server-side (`MJC-<10 hex>`), so a NOT NULL
  insert can never 500.
- A NEW item (no SKU match) is filed under the caller's category when it is a
  known category; otherwise it lands in the "New Items" review category so the
  manager sees exactly what data-entry introduced (governance requirement).
- On UPDATE we do NOT overwrite `category_id` — that preserves a manager's
  manual reassignment against a later weekly `inventory_save` that still carries
  the item's old category.
"""

import uuid
from datetime import datetime, timezone

NEW_ITEMS_CATEGORY = "New Items"

# Spreadsheet placeholder SKUs that are not unique identifiers — all rows with
# one of these should be resolved by description instead of SKU so 20 distinct
# items with SKU="TEMP_000" don't all collapse onto the same inventory_items row.
_PLACEHOLDER_SKUS = frozenset({"TEMP_000", "TEMP", "TEMP0", "TEMP_0"})


def gen_sku() -> str:
    """Generate a collision-free synthetic SKU (matches the migration format)."""
    return "MJC-" + uuid.uuid4().hex[:10].upper()


def canonical_sku(sku: str | None) -> str:
    """Normalize SKU identity without destroying vendor numbering.

    Preserve leading zeros and punctuation, but trim accidental whitespace and
    uppercase letters so `abc-001` and `ABC-001` do not fork the item catalog.
    """
    return (sku or "").strip().upper()


def get_new_items_category_id(sup) -> str | None:
    """Resolve the id of the "New Items" review category (cached-friendly)."""
    r = (
        sup.table("inventory_categories")
        .select("id")
        .eq("name", NEW_ITEMS_CATEGORY)
        .limit(1)
        .execute()
    )
    return (r.data or [{}])[0].get("id")


def resolve_and_write_item(
    sup,
    *,
    sku: str | None,
    desc: str | None,
    category_id: str | None,
    fallback_category_id: str | None,
    price=None,
    par=None,
    unit: str | None = None,
    force_review_category: bool = False,
    existing_items: dict | None = None,
    pending_updates: dict | None = None,
) -> tuple[str | None, str, bool]:
    """Find an inventory_items row by SKU (or create it). Returns
    (item_id, effective_sku, created).

    `category_id` is the caller's chosen/known category (may be None). New items
    without a known category fall back to `fallback_category_id` (New Items).
    When `force_review_category` is set (data-entry path), a NEW item ALWAYS
    lands in the New Items bucket even if a category was guessed — so the manager
    reviews everything ingestion introduces. In that case the guessed
    `category_id` is retained as `suggested_category_id` (advisory) so the review
    UI can pre-fill it for one-click confirmation instead of discarding the guess.
    """
    raw_sku = canonical_sku(sku)
    now_iso = datetime.now(timezone.utc).isoformat()

    if raw_sku in _PLACEHOLDER_SKUS:
        # Multi-collision placeholder: look up by description so distinct items
        # with the same placeholder SKU (e.g. 20 rows all saying "TEMP_000") each
        # resolve to their own row across re-uploads. Exact, case-insensitive match.
        norm_desc = (desc or "").strip() or "No description"
        desc_r = (
            sup.table("inventory_items")
            .select("id,sku")
            .ilike("description", norm_desc)
            .limit(1)
            .execute()
        )
        desc_row = (desc_r.data or [None])[0]
        if desc_row:
            sku = desc_row["sku"]
            row = {"id": desc_row["id"]}
        else:
            sku = gen_sku()
            row = None
    else:
        sku = raw_sku or gen_sku()
        if existing_items is not None:
            row = existing_items.get(sku)
        else:
            existing = (
                sup.table("inventory_items")
                .select("id")
                .eq("sku", sku)
                .limit(1)
                .execute()
            )
            row = (existing.data or [None])[0]

    # Shared fields written on both insert and update. Only write par/price/unit
    # when the payload actually carries them — a missing value must not zero the
    # shared inventory_items row across every period.
    fields = {
        "sku": sku,
        "description": (desc or "").strip() or "No description",
        "updated_at": now_iso,
    }
    if price is not None:
        fields["unit_price"] = price
    if par is not None:
        fields["par_level"] = par
    if unit:
        fields["unit"] = unit

    if row:
        item_id = row["id"]
        # Batch preparation already wrote this first occurrence's fields. The
        # transient flag is consumed once and never sent back to the database.
        if row.pop("_batch_created", False):
            return item_id, sku, True
        # NOTE: category_id intentionally omitted on update (preserve reassign).
        if pending_updates is not None and raw_sku not in _PLACEHOLDER_SKUS:
            if any(
                row.get(key) != value
                for key, value in fields.items()
                if key != "updated_at"
            ):
                pending_updates[item_id] = {
                    **pending_updates.get(item_id, {}),
                    "id": item_id,
                    **fields,
                }
            row.update(fields)
        else:
            sup.table("inventory_items").update(fields).eq("id", item_id).execute()
        return item_id, sku, False

    # New item: data-entry review mode routes every parsed item into New Items
    # even if the parser guessed a known category — but keep that guess as an
    # advisory suggestion (unless it IS the New Items bucket) so review can
    # pre-fill it. Outside review mode the guess is applied directly.
    if force_review_category:
        fields["category_id"] = fallback_category_id
        if category_id and category_id != fallback_category_id:
            fields["suggested_category_id"] = category_id
    else:
        fields["category_id"] = category_id or fallback_category_id
    fields["active"] = True
    fields["created_at"] = now_iso
    # No source-proven unit → store NULL explicitly (the column's 'CS' default
    # would otherwise fabricate a unit the source never stated). NULL renders
    # as blank/unconfirmed in the UI and the manager sets it during review.
    if "unit" not in fields:
        fields["unit"] = None
    ins = sup.table("inventory_items").insert(fields).execute()
    new_id = ins.data[0]["id"] if ins.data else None
    if existing_items is not None and new_id:
        existing_items[sku] = {**fields, "id": new_id}
    return new_id, sku, True


def load_items_for_batch(sup, items: list[dict]) -> dict:
    skus = sorted(
        {canonical_sku(item.get("sku")) for item in items} - _PLACEHOLDER_SKUS - {""}
    )
    result = {}
    for start in range(0, len(skus), 100):
        rows = (
            sup.table("inventory_items")
            .select("*")
            .in_("sku", skus[start : start + 100])
            .execute()
            .data
            or []
        )
        result.update({row["sku"]: row for row in rows})
    return result


def prepare_items_for_batch(
    sup,
    items: list[dict],
    cat_map: dict,
    fallback_category_id: str | None,
    *,
    force_review_category: bool = False,
    direction: str | None = None,
    existing_items: dict | None = None,
) -> dict:
    """Load catalog rows and bulk-create missing canonical SKUs.

    Return the SKU-keyed cache accepted by resolve_and_write_item. Replace
    load_items_for_batch with this call before resolving the SAME items in the
    SAME order under the shared inventory-write lock. direction=None denotes
    whole-month payloads (price + par); received keeps price but omits par;
    issued omits both. Blank/placeholder SKUs retain the existing resolver path.

    This helper writes catalog rows; call only after applicable rejection gates.
    It does not validate quantities, mutate input items, or acquire the lock.
    The first resolver call for each inserted SKU consumes a cache-only marker
    and returns created=True without another write. Later duplicates resolve
    normally, preserving first-occurrence category and later sparse updates.
    """
    if direction not in (None, "received", "issued"):
        raise ValueError("direction must be None, received, or issued")
    cache = (
        load_items_for_batch(sup, items) if existing_items is None else existing_items
    )
    missing = {}
    now_iso = datetime.now(timezone.utc).isoformat()
    for item in items:
        sku = canonical_sku(item.get("sku"))
        if not sku or sku in _PLACEHOLDER_SKUS or sku in cache or sku in missing:
            continue
        category_id = cat_map.get(item.get("category", ""))
        fields = {
            "sku": sku,
            "description": (item.get("desc") or "").strip() or "No description",
            "updated_at": now_iso,
            "created_at": now_iso,
            "active": True,
            "unit": item.get("unit") or None,
            "category_id": fallback_category_id
            if force_review_category
            else category_id or fallback_category_id,
        }
        if (
            force_review_category
            and category_id
            and category_id != fallback_category_id
        ):
            fields["suggested_category_id"] = category_id
        if direction != "issued" and item.get("price") is not None:
            fields["unit_price"] = item["price"]
        if direction is None and item.get("par") is not None:
            fields["par_level"] = item["par"]
        missing[sku] = fields

    # Preserve omitted columns/defaults: every PostgREST insert array has the
    # same keys, rather than filling sparse price/par fields with fabricated NULL.
    groups = {}
    for fields in missing.values():
        groups.setdefault(tuple(sorted(fields)), []).append(fields)
    for rows in groups.values():
        for start in range(0, len(rows), 100):
            chunk = rows[start : start + 100]
            inserted = sup.table("inventory_items").insert(chunk).execute().data or []
            returned = {
                canonical_sku(row.get("sku")): row for row in inserted if row.get("id")
            }
            for fields in chunk:
                sku = fields["sku"]
                if sku not in returned:
                    raise RuntimeError(
                        f"Batch catalog insert returned no item id for SKU {sku}"
                    )
                cache[sku] = {**fields, **returned[sku], "_batch_created": True}
    return cache


def flush_item_updates(sup, updates: dict) -> None:
    # Exact column signatures preserve omitted price/par/unit/category fields.
    groups = {}
    for row in updates.values():
        groups.setdefault(tuple(sorted(row)), []).append(row)
    for rows in groups.values():
        for start in range(0, len(rows), 100):
            sup.table("inventory_items").upsert(
                rows[start : start + 100], on_conflict="id"
            ).execute()
