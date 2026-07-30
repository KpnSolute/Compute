
-- ============================================================
-- PHASE 3: BACKFILL inventory_versions FROM monthly_snapshots
-- Each snapshot -> one version record linked to its commit
-- ============================================================

INSERT INTO inventory_versions (
  version_id,
  snapshot_data,
  summary_data,
  created_by,
  created_at,
  message,
  parent_version_id,
  month,
  year,
  commit_id
)
SELECT
  gen_random_uuid()                    AS version_id,
  -- Embed snapshot's full data jsonb (or rebuild from known fields)
  COALESCE(
    ms.data,
    jsonb_build_object(
      'grand_total',      ms.grand_total,
      'item_count',       ms.item_count,
      'reorder_count',    ms.reorder_count,
      'category_totals',  ms.category_totals,
      'wk1_total',        ms.wk1_total,
      'wk2_total',        ms.wk2_total,
      'wk3_total',        ms.wk3_total,
      'wk4_total',        ms.wk4_total,
      'starting_total',   ms.starting_total
    )
  )                                    AS snapshot_data,
  jsonb_build_object(
    'grand_total',        ms.grand_total,
    'item_count',         ms.item_count,
    'reorder_count',      ms.reorder_count,
    'wk1_total',          ms.wk1_total,
    'wk2_total',          ms.wk2_total,
    'wk3_total',          ms.wk3_total,
    'wk4_total',          ms.wk4_total,
    'starting_total',     ms.starting_total,
    'category_totals',    ms.category_totals
  )                                    AS summary_data,
  '00000000-0000-0000-0000-000000000001'::uuid AS created_by,
  COALESCE(ms.saved_at, NOW())         AS created_at,
  FORMAT('Historic version: %s %s', 
    TO_CHAR(MAKE_DATE(ms.year, ms.month + 1, 1), 'Month'), ms.year
  )                                    AS message,
  -- parent_version_id: previous month's version (linked via subquery)
  (
    SELECT iv2.version_id 
    FROM inventory_versions iv2
    JOIN commits c2 ON c2.commit_id = iv2.commit_id
    WHERE c2.year  = CASE WHEN ms.month = 0 THEN ms.year - 1 ELSE ms.year END
      AND c2.month = CASE WHEN ms.month = 0 THEN 11 ELSE ms.month - 1 END
    LIMIT 1
  )                                    AS parent_version_id,
  ms.month                             AS month,
  ms.year                              AS year,
  -- Link to the commit we just created
  (
    SELECT c.commit_id FROM commits c
    WHERE c.month = ms.month AND c.year = ms.year
    LIMIT 1
  )                                    AS commit_id
FROM monthly_snapshots ms
ORDER BY ms.year, ms.month;
;
