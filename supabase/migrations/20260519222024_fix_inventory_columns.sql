ALTER TABLE inventory_items 
  ADD COLUMN IF NOT EXISTS name text GENERATED ALWAYS AS (description) STORED,
  ADD COLUMN IF NOT EXISTS on_hand numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS price numeric DEFAULT 0;

UPDATE inventory_items SET price = unit_price WHERE price = 0 AND unit_price > 0;

ALTER TABLE inventory_items
  ALTER COLUMN on_hand SET DEFAULT 0,
  ALTER COLUMN price SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_inventory_items_name ON inventory_items(description);
CREATE INDEX IF NOT EXISTS idx_inventory_items_on_hand ON inventory_items(on_hand);
;
