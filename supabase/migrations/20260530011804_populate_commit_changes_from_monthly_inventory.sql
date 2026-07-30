
-- ============================================================
-- PHASE 4: BACKFILL commit_changes FROM monthly_inventory
-- action must be one of: 'pull', 'enter', 'revert'
-- We use 'enter' for historic data entry
-- ============================================================

INSERT INTO commit_changes (
  change_id, commit_id, item_id,
  month, year, week_number, field,
  old_value, new_value, action, created_at
)
SELECT
  gen_random_uuid()   AS change_id,
  c.commit_id,
  mi.item_id,
  mi.month,
  mi.year,
  wk.week_number,
  wk.field,
  0                   AS old_value,
  wk.value            AS new_value,
  'enter'             AS action,
  COALESCE(mi.updated_at, NOW()) AS created_at
FROM monthly_inventory mi
JOIN commits c ON c.month = mi.month AND c.year = mi.year
CROSS JOIN LATERAL (
  VALUES
    (1, 'w1_received', COALESCE(mi.w1_received, 0)),
    (2, 'w2_received', COALESCE(mi.w2_received, 0)),
    (3, 'w3_received', COALESCE(mi.w3_received, 0)),
    (4, 'w4_received', COALESCE(mi.w4_received, 0)),
    (1, 'w1_issued',   COALESCE(mi.w1_issued,   0)),
    (2, 'w2_issued',   COALESCE(mi.w2_issued,   0)),
    (3, 'w3_issued',   COALESCE(mi.w3_issued,   0)),
    (4, 'w4_issued',   COALESCE(mi.w4_issued,   0))
) AS wk(week_number, field, value)
WHERE wk.value <> 0
  AND c.commit_id IS NOT NULL;
;
