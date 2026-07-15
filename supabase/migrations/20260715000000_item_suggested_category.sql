-- Mirror of backend/migrations/038_item_suggested_category.sql
-- Preserve the parser's category guess for New Items review (advisory only).

ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS suggested_category_id uuid
    REFERENCES public.inventory_categories (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.inventory_items.suggested_category_id IS
    'Advisory category the parser inferred for a New-Items row (storage location + '
    'description). Pre-fills the review UI; not authoritative. NULL once confirmed.';

CREATE INDEX IF NOT EXISTS idx_inventory_items_suggested_category
    ON public.inventory_items (suggested_category_id)
    WHERE suggested_category_id IS NOT NULL;
