
-- ============================================================
-- PHASE 2: BACKFILL COMMITS FROM monthly_snapshots
-- One commit per snapshot (each month/year that was saved)
-- Uses a temp staging table to carry generated IDs forward
-- ============================================================

-- Step 1: Generate commits with stable IDs stored temporarily
CREATE TEMP TABLE _commit_map AS
SELECT
  gen_random_uuid()                                          AS commit_id,
  ms.id                                                      AS snapshot_id,
  ms.month,
  ms.year,
  ms.grand_total,
  ms.saved_at,
  ROW_NUMBER() OVER (ORDER BY ms.year, ms.month)             AS seq
FROM monthly_snapshots ms;

-- Step 2: Insert commits
INSERT INTO commits (
  commit_id, parent_ids, message, author_id,
  status, branch, month, year, created_at, merged_at, merged_by
)
SELECT
  cm.commit_id,
  COALESCE(
    ARRAY[(SELECT prev.commit_id FROM _commit_map prev WHERE prev.seq = cm.seq - 1)],
    ARRAY[]::uuid[]
  )                                                          AS parent_ids,
  FORMAT(
    'Historic import: %s %s  |  Grand Total: $%s',
    TO_CHAR(MAKE_DATE(cm.year, cm.month + 1, 1), 'Month'),
    cm.year,
    ROUND(COALESCE(cm.grand_total, 0), 2)
  )                                                          AS message,
  '00000000-0000-0000-0000-000000000001'::uuid               AS author_id,
  'merged'                                                   AS status,
  'main'                                                     AS branch,
  cm.month,
  cm.year,
  COALESCE(cm.saved_at, NOW())                               AS created_at,
  COALESCE(cm.saved_at, NOW())                               AS merged_at,
  '00000000-0000-0000-0000-000000000001'::uuid               AS merged_by
FROM _commit_map cm
ORDER BY cm.seq;

DROP TABLE _commit_map;
;
