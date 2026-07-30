
-- ============================================================
-- PHASE 6: ENSURE MAY 2026 INVENTORY IS POPULATED
-- monthly_inventory has 258 rows for month=4, year=2026.
-- Fill any missing active items (316 total, 258 present = 58 gaps)
-- ============================================================

INSERT INTO monthly_inventory (id, item_id, month, year, on_hand,
  w1_received, w2_received, w3_received, w4_received,
  w1_issued,   w2_issued,   w3_issued,   w4_issued,
  unit_price, created_at, updated_at)
SELECT
  gen_random_uuid(),
  ii.id       AS item_id,
  4           AS month,
  2026        AS year,
  ii.on_hand  AS on_hand,
  0, 0, 0, 0,
  0, 0, 0, 0,
  ii.unit_price,
  NOW(),
  NOW()
FROM inventory_items ii
WHERE ii.active = true
  AND NOT EXISTS (
    SELECT 1 FROM monthly_inventory mi
    WHERE mi.item_id = ii.id
      AND mi.month = 4 AND mi.year = 2026
  );

-- ============================================================
-- Update the May 2026 commit parent_ids to chain from April 2026
-- ============================================================
UPDATE commits
SET parent_ids = ARRAY(
  SELECT commit_id FROM commits
  WHERE year = 2026 AND month = 3
  LIMIT 1
)
WHERE year = 2026 AND month = 4
  AND parent_ids = ARRAY[]::uuid[];
;
