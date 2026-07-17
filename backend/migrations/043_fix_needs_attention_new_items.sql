-- 043_fix_needs_attention_new_items.sql
--
-- Fixes a real bug in the needs_attention generated column: it only flagged
-- items with a placeholder SKU (MJC-%) or a NULL/Uncategorized category_id.
-- dispatch_item_create (backend/staging/dispatch.py) bridges unrecognized
-- vendor SKUs from invoice parsing into a real "New Items" category (a real,
-- non-null category_id, distinct from "Uncategorized") -- so those items,
-- which have a genuine vendor SKU (not MJC-%) and a real category_id, never
-- satisfied any branch of the old expression and needs_attention silently
-- stayed false. The entire "New Items" review/notification pipeline
-- (GET /api/inventory/items?needs_attention=true, the notifications.py
-- New Items feed) was therefore never seeing real invoice-parsed new items,
-- only the rarer placeholder-SKU/no-category case.
--
-- Postgres does not support altering a generated column's expression in
-- place; drop and re-add it (STORED, so all existing rows are recomputed
-- immediately) with the corrected expression, then recreate the dependent
-- partial index.

DROP INDEX IF EXISTS public.idx_items_needs_attention;

ALTER TABLE public.inventory_items DROP COLUMN needs_attention;

ALTER TABLE public.inventory_items
  ADD COLUMN needs_attention boolean GENERATED ALWAYS AS (
    (sku ~~ 'MJC-%'::text)
    OR (category_id IS NULL)
    OR (category_id = '448c13cf-e5c0-404f-bf32-f299d411c944'::uuid)  -- Uncategorized
    OR (category_id = 'd440a51d-1793-4fbf-9c46-a94f04f554e7'::uuid)  -- New Items
  ) STORED;

CREATE INDEX idx_items_needs_attention
  ON public.inventory_items USING btree (needs_attention)
  WHERE needs_attention;
