-- Seed inventory_items from barcodes
-- Maps barcodes.category → inventory_categories.name for category_id FK
INSERT INTO inventory_items (sku, barcode_id, description, category_id, unit_price, par_level, unit, active)
SELECT 
  b.sku,
  b.barcode_id,
  b.description,
  ic.id AS category_id,
  COALESCE(b.unit_price, 0),
  COALESCE(b.par_level, 0),
  'CS' AS unit,
  true AS active
FROM barcodes b
LEFT JOIN inventory_categories ic ON ic.name = b.category
WHERE NOT EXISTS (
  SELECT 1 FROM inventory_items ii WHERE ii.barcode_id = b.barcode_id
);

-- Verify row count
SELECT COUNT(*) AS items_seeded FROM inventory_items;
;
