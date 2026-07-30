CREATE TABLE IF NOT EXISTS public.item_barcodes (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id     uuid        NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  barcode     text        NOT NULL UNIQUE,
  type        text        NOT NULL DEFAULT 'CODE128',
  is_primary  boolean     NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_item_barcodes_item_id ON public.item_barcodes(item_id);
CREATE INDEX IF NOT EXISTS idx_item_barcodes_barcode  ON public.item_barcodes(barcode);

-- Backfill: assign one primary barcode per active inventory item from barcodes table
-- (match on sku; items with no matching sku get a generated barcode)
INSERT INTO public.item_barcodes (item_id, barcode, type, is_primary)
SELECT
  ii.id,
  COALESCE(b.barcode_id, 'BC-' || upper(substring(ii.id::text, 1, 8))),
  'CODE128',
  true
FROM public.inventory_items ii
LEFT JOIN public.barcodes b ON b.sku = ii.sku AND b.is_active = true
WHERE ii.active = true
ON CONFLICT DO NOTHING;;
