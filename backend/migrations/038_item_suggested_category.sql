-- 038: Preserve the parser's category guess for New Items review.
--
-- Data-entry ingestion force-routes every brand-new SKU into the "New Items"
-- review bucket (inventory_identity.resolve_and_write_item, force_review_category),
-- which discarded the category the AI/parser had already inferred. Operators then
-- re-derived an obvious category by hand (e.g. "MUFFIN ... FZN" -> Frozen Food).
--
-- This column keeps that guess as a non-authoritative SUGGESTION so the review UI
-- can pre-fill it for one-click confirmation. category_id stays the source of
-- truth; suggested_category_id is advisory and cleared once a human confirms.

ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS suggested_category_id uuid
    REFERENCES public.inventory_categories (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_items.suggested_category_id IS
    'Advisory category the parser inferred for a New-Items row (storage location + '
    'description). Pre-fills the review UI; not authoritative. NULL once confirmed.';

-- Index the small set of rows actively awaiting review.
CREATE INDEX IF NOT EXISTS idx_inventory_items_suggested_category
    ON public.inventory_items (suggested_category_id)
    WHERE suggested_category_id IS NOT NULL;
