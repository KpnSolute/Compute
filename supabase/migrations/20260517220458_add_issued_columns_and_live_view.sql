
-- ══════════════════════════════════════════════════════════════
-- ADD ISSUED COLUMNS (w1i–w4i)
-- The original Excel had BOTH received and issued per week.
-- Without issued we can't compute ending on-hand or order qty.
-- ══════════════════════════════════════════════════════════════
ALTER TABLE barcodes ADD COLUMN IF NOT EXISTS w1i numeric(10,2) DEFAULT 0;
ALTER TABLE barcodes ADD COLUMN IF NOT EXISTS w2i numeric(10,2) DEFAULT 0;
ALTER TABLE barcodes ADD COLUMN IF NOT EXISTS w3i numeric(10,2) DEFAULT 0;
ALTER TABLE barcodes ADD COLUMN IF NOT EXISTS w4i numeric(10,2) DEFAULT 0;

UPDATE barcodes SET w1i=0 WHERE w1i IS NULL;
UPDATE barcodes SET w2i=0 WHERE w2i IS NULL;
UPDATE barcodes SET w3i=0 WHERE w3i IS NULL;
UPDATE barcodes SET w4i=0 WHERE w4i IS NULL;

-- ══════════════════════════════════════════════════════════════
-- LIVE INVENTORY VIEW — mirrors the original Excel column layout
-- Columns match the original sheet exactly:
--   on_hand, unit_price, sub_total,
--   w1i–w4i (issued), w1r–w4r (received),
--   total_issued, total_received,
--   ending_on_hand, par_level, order_qty, inventory_total
-- ══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS live_inventory;
CREATE VIEW live_inventory
WITH (security_invoker = true)
AS
SELECT
  b.id,
  b.barcode_id,
  b.sku,
  b.category,
  b.description,
  b.unit_price,
  b.par_level,
  b.is_active,

  -- Starting on hand (beginning of month)
  b.on_hand,

  -- Sub total = on_hand × price  (like Excel "Sub Totals" column)
  ROUND((b.on_hand * b.unit_price)::numeric, 2)                                      AS sub_total,

  -- Week-by-week issued (W1–W4)
  COALESCE(b.w1i, 0) AS w1i,
  COALESCE(b.w2i, 0) AS w2i,
  COALESCE(b.w3i, 0) AS w3i,
  COALESCE(b.w4i, 0) AS w4i,

  -- Week-by-week received (W1–W4)
  COALESCE(b.w1r, 0) AS w1r,
  COALESCE(b.w2r, 0) AS w2r,
  COALESCE(b.w3r, 0) AS w3r,
  COALESCE(b.w4r, 0) AS w4r,

  -- Totals
  COALESCE(b.w1i,0) + COALESCE(b.w2i,0) + COALESCE(b.w3i,0) + COALESCE(b.w4i,0)   AS total_issued,
  COALESCE(b.w1r,0) + COALESCE(b.w2r,0) + COALESCE(b.w3r,0) + COALESCE(b.w4r,0)   AS total_received,

  -- Ending on hand = start + received − issued  (Excel "Total Wk 1" column)
  GREATEST(0,
    b.on_hand
    + COALESCE(b.w1r,0) + COALESCE(b.w2r,0) + COALESCE(b.w3r,0) + COALESCE(b.w4r,0)
    - COALESCE(b.w1i,0) - COALESCE(b.w2i,0) - COALESCE(b.w3i,0) - COALESCE(b.w4i,0)
  )                                                                                   AS ending_on_hand,

  -- Order quantity = MAX(0, par − ending)  (Excel "Order" column)
  GREATEST(0, b.par_level - GREATEST(0,
    b.on_hand
    + COALESCE(b.w1r,0) + COALESCE(b.w2r,0) + COALESCE(b.w3r,0) + COALESCE(b.w4r,0)
    - COALESCE(b.w1i,0) - COALESCE(b.w2i,0) - COALESCE(b.w3i,0) - COALESCE(b.w4i,0)
  ))                                                                                  AS order_qty,

  -- Inventory total = ending × price  (Excel "Inventory Totals" column)
  ROUND((GREATEST(0,
    b.on_hand
    + COALESCE(b.w1r,0) + COALESCE(b.w2r,0) + COALESCE(b.w3r,0) + COALESCE(b.w4r,0)
    - COALESCE(b.w1i,0) - COALESCE(b.w2i,0) - COALESCE(b.w3i,0) - COALESCE(b.w4i,0)
  ) * b.unit_price)::numeric, 2)                                                     AS inventory_total,

  b.barcode_type,
  b.item_ref,
  b.created_at,
  b.updated_at
FROM barcodes b
WHERE b.is_active = true;

-- ══════════════════════════════════════════════════════════════
-- CATEGORY SUMMARY VIEW — for dashboard and reports
-- Mirrors the category totals row from each Excel section
-- ══════════════════════════════════════════════════════════════
DROP VIEW IF EXISTS category_summary;
CREATE VIEW category_summary
WITH (security_invoker = true)
AS
SELECT
  category,
  COUNT(*)                                                     AS item_count,
  SUM(on_hand)                                                 AS total_on_hand,
  ROUND(SUM(on_hand * unit_price)::numeric, 2)                 AS sub_total_value,
  ROUND(SUM(
    GREATEST(0,
      on_hand
      + COALESCE(w1r,0)+COALESCE(w2r,0)+COALESCE(w3r,0)+COALESCE(w4r,0)
      - COALESCE(w1i,0)-COALESCE(w2i,0)-COALESCE(w3i,0)-COALESCE(w4i,0)
    ) * unit_price
  )::numeric, 2)                                               AS ending_value,
  SUM(COALESCE(w1r,0)+COALESCE(w2r,0)+COALESCE(w3r,0)+COALESCE(w4r,0)) AS total_received_units,
  SUM(COALESCE(w1i,0)+COALESCE(w2i,0)+COALESCE(w3i,0)+COALESCE(w4i,0)) AS total_issued_units,
  COUNT(*) FILTER (
    WHERE par_level > 0
    AND GREATEST(0,
      on_hand
      + COALESCE(w1r,0)+COALESCE(w2r,0)+COALESCE(w3r,0)+COALESCE(w4r,0)
      - COALESCE(w1i,0)-COALESCE(w2i,0)-COALESCE(w3i,0)-COALESCE(w4i,0)
    ) < par_level
  )                                                            AS reorder_count,
  SUM(GREATEST(0,
    par_level - GREATEST(0,
      on_hand
      + COALESCE(w1r,0)+COALESCE(w2r,0)+COALESCE(w3r,0)+COALESCE(w4r,0)
      - COALESCE(w1i,0)-COALESCE(w2i,0)-COALESCE(w3i,0)-COALESCE(w4i,0)
    )
  ))                                                           AS total_to_order
FROM barcodes
WHERE is_active = true
GROUP BY category
ORDER BY category;
;
