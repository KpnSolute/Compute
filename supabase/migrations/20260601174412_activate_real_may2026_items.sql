
-- The 258 items in the inventory_versions May 2026 snapshot are the REAL
-- active items — they were in the system before OpenCode's changes.
-- Re-activate them and ensure they're all in monthly_inventory for May 2026.

-- Step 1: Activate all items that are in the May 2026 inventory_versions snapshot
UPDATE inventory_items
SET active = true
WHERE id IN (
  SELECT (item->>'item_id')::uuid
  FROM inventory_versions,
    LATERAL jsonb_array_elements((snapshot_data #>> '{}')::jsonb) AS item
  WHERE year=2026 AND month=4
);

-- Step 2: Also activate items present in May 2026 monthly_inventory 
-- (from our current data)
UPDATE inventory_items
SET active = true
WHERE id IN (
  SELECT DISTINCT item_id FROM monthly_inventory WHERE month=4 AND year=2026
);

-- Step 3: Restore correct unit_price for May 2026 items from the snapshot
-- (OpenCode may have zeroed prices when doing backfill)
UPDATE monthly_inventory mi
SET unit_price = (
  SELECT (item->>'unit_price')::numeric
  FROM inventory_versions iv,
    LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
  WHERE iv.year=2026 AND iv.month=4
    AND (item->>'item_id')::uuid = mi.item_id
  LIMIT 1
)
WHERE mi.month=4 AND mi.year=2026
  AND EXISTS (
    SELECT 1 FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
  );

-- Step 4: Restore on_hand values from May 2026 snapshot for rows that got zeroed
UPDATE monthly_inventory mi
SET 
  on_hand = COALESCE((
    SELECT (item->>'on_hand')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.on_hand),
  w1_received = COALESCE((
    SELECT (item->>'w1_received')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.w1_received),
  w2_received = COALESCE((
    SELECT (item->>'w2_received')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.w2_received),
  w3_received = COALESCE((
    SELECT (item->>'w3_received')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.w3_received),
  w4_received = COALESCE((
    SELECT (item->>'w4_received')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.w4_received),
  w1_issued = COALESCE((
    SELECT (item->>'w1_issued')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.w1_issued),
  w2_issued = COALESCE((
    SELECT (item->>'w2_issued')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.w2_issued),
  w3_issued = COALESCE((
    SELECT (item->>'w3_issued')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.w3_issued),
  w4_issued = COALESCE((
    SELECT (item->>'w4_issued')::numeric
    FROM inventory_versions iv,
      LATERAL jsonb_array_elements((iv.snapshot_data #>> '{}')::jsonb) AS item
    WHERE iv.year=2026 AND iv.month=4
      AND (item->>'item_id')::uuid = mi.item_id
    LIMIT 1
  ), mi.w4_issued)
WHERE mi.month=4 AND mi.year=2026;
;
