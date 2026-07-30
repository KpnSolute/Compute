DO $$
DECLARE
  max_id bigint;
  next_id bigint;
  item RECORD;
BEGIN
  SELECT MAX(CAST(barcode_id AS bigint)) INTO max_id FROM barcodes WHERE barcode_id ~ '^\d+$';
  IF max_id IS NULL THEN max_id := 9999999; END IF;
  next_id := max_id + 1;

  FOR item IN
    SELECT i.id, i.sku, i.description, i.unit_price, COALESCE(c.name, 'Uncategorized') AS category
    FROM inventory_items i
    LEFT JOIN inventory_categories c ON i.category_id = c.id
    WHERE i.active = true
    AND NOT EXISTS (SELECT 1 FROM barcodes b WHERE b.sku = i.sku AND i.sku IS NOT NULL)
  LOOP
    INSERT INTO barcodes (barcode_id, sku, category, description, unit_price, is_active, barcode_type)
    VALUES (
      CASE WHEN item.sku IS NOT NULL THEN next_id::text ELSE 'MJC' || upper(replace(gen_random_uuid()::text, '-', '')) END,
      item.sku,
      item.category,
      item.description,
      COALESCE(item.unit_price, 0),
      true,
      'CODE128'
    );
    IF item.sku IS NOT NULL THEN next_id := next_id + 1; END IF;
  END LOOP;
END $$;;
