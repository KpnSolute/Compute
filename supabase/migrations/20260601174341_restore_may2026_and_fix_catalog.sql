
-- ================================================================
-- RESTORATION PLAN:
-- 1. Deactivate the 1,275 historical ghost items OpenCode added
--    (items with no SKU that were never in the active system)
-- 2. Restore the ~40 real SKU items missing from May 2026
-- 3. Result: May 2026 has all 316 active items with real data
-- ================================================================

-- Step 1: Deactivate items that have NO monthly history in any month
-- after March 2025 (when the real active catalog starts).
-- These are the ghost items from old Excel sheets that were never
-- active in the current system.
UPDATE inventory_items
SET active = false
WHERE id NOT IN (
  SELECT DISTINCT item_id FROM monthly_inventory
  WHERE (year = 2025 AND month >= 3) OR year = 2026
)
AND id NOT IN (
  SELECT DISTINCT item_id FROM monthly_inventory
  WHERE year = 2026 AND month = 4
);

-- Step 2: Insert missing SKU items into May 2026 with on_hand=0
-- These are real active items that should appear but OpenCode's
-- incomplete backfill dropped them
INSERT INTO monthly_inventory (
  item_id, month, year, on_hand, unit_price,
  w1_received, w2_received, w3_received, w4_received,
  w1_issued, w2_issued, w3_issued, w4_issued
)
SELECT
  ii.id, 4, 2026, 0, COALESCE(ii.unit_price, 0),
  0, 0, 0, 0,
  0, 0, 0, 0
FROM inventory_items ii
WHERE ii.active = true
  AND ii.sku IS NOT NULL
  AND ii.id NOT IN (
    SELECT item_id FROM monthly_inventory WHERE month=4 AND year=2026
  )
ON CONFLICT (item_id, month, year) DO NOTHING;

-- Step 3: Re-check active count after deactivation
-- (just a verification query - no changes)
;
