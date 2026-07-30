DROP INDEX IF EXISTS public.idx_items_needs_attention;

ALTER TABLE public.inventory_items DROP COLUMN needs_attention;

ALTER TABLE public.inventory_items
  ADD COLUMN needs_attention boolean GENERATED ALWAYS AS (
    (sku ~~ 'MJC-%'::text)
    OR (category_id IS NULL)
    OR (category_id = '448c13cf-e5c0-404f-bf32-f299d411c944'::uuid)
    OR (category_id = 'd440a51d-1793-4fbf-9c46-a94f04f554e7'::uuid)
  ) STORED;

CREATE INDEX idx_items_needs_attention
  ON public.inventory_items USING btree (needs_attention)
  WHERE needs_attention;;
