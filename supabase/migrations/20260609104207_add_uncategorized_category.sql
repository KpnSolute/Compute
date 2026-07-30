
-- Add Uncategorized category
INSERT INTO public.inventory_categories (name, color, sort_order)
VALUES ('Uncategorized', '#9CA3AF', 10)
ON CONFLICT DO NOTHING;

-- Default barcodes and invoice_items category to Uncategorized
ALTER TABLE public.barcodes
  ALTER COLUMN category SET DEFAULT 'Uncategorized';

ALTER TABLE public.invoice_items
  ALTER COLUMN category SET DEFAULT 'Uncategorized';

-- Null/blank category rows → Uncategorized
UPDATE public.barcodes      SET category='Uncategorized' WHERE category IS NULL OR category='';
UPDATE public.invoice_items SET category='Uncategorized' WHERE category IS NULL OR category='';

-- inventory_items uses category_id — link to Uncategorized for unassigned rows
UPDATE public.inventory_items SET category_id=(
  SELECT id FROM inventory_categories WHERE name='Uncategorized'
)
WHERE category_id IS NULL OR category_id NOT IN (SELECT id FROM inventory_categories);

COMMENT ON COLUMN public.barcodes.category      IS 'Defaults to Uncategorized — reassign via portal at month-end.';
COMMENT ON COLUMN public.invoice_items.category IS 'Defaults to Uncategorized — set from invoice line category.';
;
