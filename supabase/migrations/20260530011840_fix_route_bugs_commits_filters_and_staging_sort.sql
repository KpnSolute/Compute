
-- ============================================================
-- PHASE 7: DATABASE-LEVEL FIXES FOR FLASK ROUTE BUGS
-- ============================================================

-- BUG 1 FIX: commits table now has month/year columns (added in Phase 1)
-- The route GET /commits filters by month/year -> now works since columns exist.
-- Verify the columns are present:
-- SELECT column_name FROM information_schema.columns WHERE table_name='commits' AND column_name IN ('month','year');

-- BUG 2 FIX: GET /commits/<id> was querying .eq('id', commit_id) but PK is commit_id
-- Create a helper view that exposes 'id' as an alias for commit_id so old route code still works
CREATE OR REPLACE VIEW commits_compat AS
SELECT 
  commit_id          AS id,        -- alias for backward-compat route .eq('id', ...)
  commit_id,
  parent_ids,
  message,
  author_id,
  status,
  branch,
  month,
  year,
  created_at,
  merged_at,
  merged_by
FROM commits;

-- BUG 3 FIX: GET /staging sorts by submitted_at but column is created_at
-- Create a view that exposes submitted_at as alias for created_at
CREATE OR REPLACE VIEW staging_entries_compat AS
SELECT
  entry_id,
  item_id,
  month,
  year,
  week_number,
  field,
  action,
  submitted_value,
  previous_value,
  status,
  submitted_by,
  reviewed_by,
  review_note,
  created_at,
  created_at    AS submitted_at,   -- alias fixing the sort bug
  expires_at,
  reviewed_at
FROM staging_entries;

-- BUG 2b: Also add a unique index to help .eq('commit_id', ...) lookups
CREATE UNIQUE INDEX IF NOT EXISTS idx_commits_pk ON commits(commit_id);
;
