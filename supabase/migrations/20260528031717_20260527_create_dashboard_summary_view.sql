-- Drop existing view first, then recreate to handle column changes
DROP VIEW IF EXISTS dashboard_summary CASCADE;

CREATE OR REPLACE VIEW dashboard_summary AS
SELECT
  ii.id                                                    AS item_id,
  ii.sku,
  ii.description,
  ii.unit_price,
  ii.par_level,
  ic.name                                                  AS category,
  ic.color                                                 AS category_color,
  mi.month,
  mi.year,
  COALESCE(mi.on_hand, 0)                                  AS on_hand,
  COALESCE(mi.w1_received, 0)                              AS w1_received,
  COALESCE(mi.w2_received, 0)                              AS w2_received,
  COALESCE(mi.w3_received, 0)                              AS w3_received,
  COALESCE(mi.w4_received, 0)                              AS w4_received,
  COALESCE(mi.w1_issued, 0)                                AS w1_issued,
  COALESCE(mi.w2_issued, 0)                                AS w2_issued,
  COALESCE(mi.w3_issued, 0)                                AS w3_issued,
  COALESCE(mi.w4_issued, 0)                                AS w4_issued
FROM inventory_items ii
LEFT JOIN monthly_inventory mi ON ii.id = mi.item_id
LEFT JOIN inventory_categories ic ON ii.category_id = ic.id;;
