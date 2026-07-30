-- Migration 008 — collapse the duplicate inventory stores into one model.
-- Backups: bak_20260619 (all tables) + bak_20260619b (the tables touched here).
--
-- Problem: `barcodes` (450 rows) and `inventory_master` (316 rows) were parallel
-- denormalized inventory stores; `live_inventory` (dashboard source) read from
-- `barcodes`, so it drifted from the real `monthly_inventory` period model.
-- Fix: canonical model = inventory_items (catalog) + item_barcodes (barcode map)
-- + monthly_inventory (period fact). Rebuild live_inventory on monthly_inventory.

-- 1. Preserve barcode->item mappings: migrate any barcode present in `barcodes`
--    (matched to an item by SKU) that isn't already in item_barcodes.
INSERT INTO item_barcodes (item_id, barcode, type, is_primary)
SELECT i.id, b.barcode_id, 'migrated', false
FROM barcodes b
JOIN inventory_items i ON i.sku = b.sku
WHERE b.barcode_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM item_barcodes x WHERE x.barcode = b.barcode_id);

-- 2. Rebuild live_inventory off the current open period (fallback: latest period)
--    in monthly_inventory. Exposes the columns the API reads (on_hand, par_level,
--    sub_total) where on_hand = ENDING (current) stock and sub_total = its value,
--    so dashboard total_value and low_stock are correct and period-aligned.
DROP VIEW IF EXISTS public.live_inventory;

-- (barcodes & inventory_master are now unreferenced by any view/code)
DROP TABLE IF EXISTS public.barcodes CASCADE;
DROP TABLE IF EXISTS public.inventory_master CASCADE;

CREATE VIEW public.live_inventory AS
WITH per AS (
  SELECT
    COALESCE(
      (SELECT month FROM month_status WHERE status='open' ORDER BY year DESC, month DESC LIMIT 1),
      (SELECT month FROM monthly_inventory ORDER BY year DESC, month DESC LIMIT 1)
    ) AS month,
    COALESCE(
      (SELECT year FROM month_status WHERE status='open' ORDER BY year DESC, month DESC LIMIT 1),
      (SELECT year FROM monthly_inventory ORDER BY year DESC, month DESC LIMIT 1)
    ) AS year
)
SELECT
  i.id,
  i.sku,
  i.description,
  c.name AS category,
  i.unit_price,
  i.par_level,
  i.active AS is_active,
  bc.barcode AS barcode_id,
  COALESCE(mi.on_hand,0)        AS opening_on_hand,
  COALESCE(mi.w1_received,0) AS w1r, COALESCE(mi.w2_received,0) AS w2r,
  COALESCE(mi.w3_received,0) AS w3r, COALESCE(mi.w4_received,0) AS w4r,
  COALESCE(mi.w5_received,0) AS w5r,
  COALESCE(mi.w1_issued,0) AS w1i, COALESCE(mi.w2_issued,0) AS w2i,
  COALESCE(mi.w3_issued,0) AS w3i, COALESCE(mi.w4_issued,0) AS w4i,
  COALESCE(mi.w5_issued,0) AS w5i,
  (COALESCE(mi.w1_received,0)+COALESCE(mi.w2_received,0)+COALESCE(mi.w3_received,0)
   +COALESCE(mi.w4_received,0)+COALESCE(mi.w5_received,0)) AS total_received,
  (COALESCE(mi.w1_issued,0)+COALESCE(mi.w2_issued,0)+COALESCE(mi.w3_issued,0)
   +COALESCE(mi.w4_issued,0)+COALESCE(mi.w5_issued,0)) AS total_issued,
  GREATEST(0::numeric,
    COALESCE(mi.on_hand,0)
    + COALESCE(mi.w1_received,0)+COALESCE(mi.w2_received,0)+COALESCE(mi.w3_received,0)+COALESCE(mi.w4_received,0)+COALESCE(mi.w5_received,0)
    - COALESCE(mi.w1_issued,0)-COALESCE(mi.w2_issued,0)-COALESCE(mi.w3_issued,0)-COALESCE(mi.w4_issued,0)-COALESCE(mi.w5_issued,0)
  ) AS on_hand,
  round(GREATEST(0::numeric,
    COALESCE(mi.on_hand,0)
    + COALESCE(mi.w1_received,0)+COALESCE(mi.w2_received,0)+COALESCE(mi.w3_received,0)+COALESCE(mi.w4_received,0)+COALESCE(mi.w5_received,0)
    - COALESCE(mi.w1_issued,0)-COALESCE(mi.w2_issued,0)-COALESCE(mi.w3_issued,0)-COALESCE(mi.w4_issued,0)-COALESCE(mi.w5_issued,0)
  ) * COALESCE(i.unit_price,0), 2) AS sub_total,
  GREATEST(0::numeric, i.par_level::numeric - GREATEST(0::numeric,
    COALESCE(mi.on_hand,0)
    + COALESCE(mi.w1_received,0)+COALESCE(mi.w2_received,0)+COALESCE(mi.w3_received,0)+COALESCE(mi.w4_received,0)+COALESCE(mi.w5_received,0)
    - COALESCE(mi.w1_issued,0)-COALESCE(mi.w2_issued,0)-COALESCE(mi.w3_issued,0)-COALESCE(mi.w4_issued,0)-COALESCE(mi.w5_issued,0)
  )) AS order_qty
FROM inventory_items i
LEFT JOIN inventory_categories c ON c.id = i.category_id
CROSS JOIN per
LEFT JOIN monthly_inventory mi ON mi.item_id = i.id AND mi.month = per.month AND mi.year = per.year
LEFT JOIN LATERAL (
  SELECT barcode FROM item_barcodes b WHERE b.item_id = i.id
  ORDER BY is_primary DESC NULLS LAST LIMIT 1
) bc ON true
WHERE i.active = true;;
