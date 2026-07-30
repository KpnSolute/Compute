ALTER TABLE public.inventory_items ALTER COLUMN sku SET NOT NULL;
ALTER TABLE public.inventory_items ADD CONSTRAINT inventory_items_sku_key UNIQUE (sku);;
