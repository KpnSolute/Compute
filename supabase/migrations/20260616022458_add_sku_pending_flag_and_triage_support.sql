-- Clean, auto-maintained flag for "item has no real vendor SKU yet" (MJC- placeholder).
-- Lets the admin UI surface a "Needs SKU" group and the API filter it, without
-- moving the item out of its real category. Generated => zero maintenance, and it
-- is read-only so existing explicit-column writes are unaffected.
ALTER TABLE inventory_items
  ADD COLUMN IF NOT EXISTS sku_pending boolean
  GENERATED ALWAYS AS (sku LIKE 'MJC-%') STORED;

CREATE INDEX IF NOT EXISTS idx_inventory_items_sku_pending
  ON inventory_items (sku_pending) WHERE sku_pending;

COMMENT ON COLUMN inventory_items.sku_pending IS
  'TRUE when sku is an MJC- placeholder (no real vendor SKU assigned). Admin manual-override assigns a real SKU; once set, future invoice lines auto-map to this item by SKU identity.';;
