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
) -> tuple[str | None, str, bool]:
    """Find an inventory_items row by SKU (or create it). Returns
    (item_id, effective_sku, created).

    `category_id` is the caller's chosen/known category (may be None). New items
    without a known category fall back to `fallback_category_id` (New Items).
    When `force_review_category` is set (data-entry path), a NEW item ALWAYS
    lands in the New Items bucket even if a category was guessed — so the manager
    reviews everything ingestion introduces.
    """
    sku = canonical_sku(sku) or gen_sku()
    now_iso = datetime.now(timezone.utc).isoformat()

    existing = (
        sup.table("inventory_items").select("id").eq("sku", sku).limit(1).execute()
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
        # NOTE: category_id intentionally omitted on update (preserve reassign).
        sup.table("inventory_items").update(fields).eq("id", item_id).execute()
        return item_id, sku, False

    # New item: when force_review_category is set (data-entry path), ALWAYS route
    # to fallback_category_id (New Items) so the manager reviews everything ingestion
    # introduces — even items whose category was guessed by the parser.
    # Without force_review_category, honor the known category; fall back to New Items
    # only when category is None.
    if force_review_category:
        fields["category_id"] = fallback_category_id
    else:
        fields["category_id"] = category_id or fallback_category_id
    fields["active"] = True
    fields["created_at"] = now_iso
    ins = sup.table("inventory_items").insert(fields).execute()
    new_id = ins.data[0]["id"] if ins.data else None
    return new_id, sku, True
