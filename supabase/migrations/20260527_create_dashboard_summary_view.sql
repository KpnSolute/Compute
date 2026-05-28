-- Create (or replace) the dashboard_summary view.
-- This view joins inventory_items, monthly_inventory, and inventory_categories
-- to provide the complete inventory picture for any given month/year.
--
-- The view already exists in the live DB; this migration captures it for
-- version-controlled reproducibility.
-- Apply via: MCP apply_migration or Supabase Dashboard > SQL Editor.

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
LEFT JOIN inventory_categories ic ON ii.category_id = ic.id;
