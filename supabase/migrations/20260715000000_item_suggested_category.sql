-- Mirror of backend/migrations/038_item_suggested_category.sql
-- Preserve the parser's category guess for New Items review (advisory only).
-- PLAIN column, NO foreign key: a second FK to inventory_categories would make
-- existing PostgREST embeds ambiguous (PGRST201). Name resolved in app code.

ALTER TABLE public.inventory_items
    ADD COLUMN IF NOT EXISTS suggested_category_id uuid;

COMMENT ON COLUMN public.inventory_items.suggested_category_id IS
    'Advisory category id the parser inferred for a New-Items row (storage location + '
    'description). Plain column, NO fk (avoids embed ambiguity). Advisory only; NULL once confirmed.';

CREATE INDEX IF NOT EXISTS idx_inventory_items_suggested_category
    ON public.inventory_items (suggested_category_id)
    WHERE suggested_category_id IS NOT NULL;
