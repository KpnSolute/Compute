
-- Barcodes view
CREATE OR REPLACE VIEW public.barcodes_view AS
SELECT
  b.id,
  b.barcode_id,
  ii.sku,
  ic.name        AS category,
  ic.color       AS category_color,
  ii.description,
  ii.unit_price,
  ii.par_level,
  ii.on_hand,
  b.barcode_type,
  b.is_active,
  ii.id          AS item_id
FROM public.barcodes b
JOIN public.inventory_items      ii ON ii.barcode_id = b.barcode_id
JOIN public.inventory_categories ic ON ic.id         = ii.category_id;

-- Drop legacy duplicate tables
DROP TABLE IF EXISTS public.suppliers CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;

-- Dashboard summary view
-- NOTE: month is stored as 1-12 in DB. API translates to JS 0-11.
CREATE OR REPLACE VIEW public.dashboard_summary AS
SELECT
  mi.id                                                AS state_id,
  mi.item_id,
  ii.sku,
  ii.description,
  ic.name                                              AS category,
  ic.color                                             AS category_color,
  ii.unit_price,
  ii.par_level,
  ii.barcode_id,
  mi.on_hand,
  mi.month,
  mi.year,
  mi.w1_received,  mi.w2_received,
  mi.w3_received,  mi.w4_received,
  mi.w1_issued,    mi.w2_issued,
  mi.w3_issued,    mi.w4_issued,
  GREATEST(0,
    mi.on_hand
    + COALESCE(mi.w1_received,0) + COALESCE(mi.w2_received,0)
    + COALESCE(mi.w3_received,0) + COALESCE(mi.w4_received,0)
    - COALESCE(mi.w1_issued,0)   - COALESCE(mi.w2_issued,0)
    - COALESCE(mi.w3_issued,0)   - COALESCE(mi.w4_issued,0)
  )                                                    AS ending_qty,
  GREATEST(0,
    mi.on_hand
    + COALESCE(mi.w1_received,0) + COALESCE(mi.w2_received,0)
    + COALESCE(mi.w3_received,0) + COALESCE(mi.w4_received,0)
    - COALESCE(mi.w1_issued,0)   - COALESCE(mi.w2_issued,0)
    - COALESCE(mi.w3_issued,0)   - COALESCE(mi.w4_issued,0)
  ) * ii.unit_price                                    AS item_total,
  COALESCE(mi.w1_received,0) * ii.unit_price           AS w1_value,
  COALESCE(mi.w2_received,0) * ii.unit_price           AS w2_value,
  COALESCE(mi.w3_received,0) * ii.unit_price           AS w3_value,
  COALESCE(mi.w4_received,0) * ii.unit_price           AS w4_value,
  (mi.on_hand < ii.par_level AND ii.par_level > 0)     AS needs_reorder
FROM public.monthly_inventory   mi
JOIN public.inventory_items      ii ON ii.id  = mi.item_id
JOIN public.inventory_categories ic ON ic.id  = ii.category_id;
;
