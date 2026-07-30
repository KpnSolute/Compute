
-- ============================================================
-- PHASE 1: SCHEMA FIXES
-- ============================================================

-- 1a. Add month/year columns to commits table for efficient filtering
ALTER TABLE commits 
  ADD COLUMN IF NOT EXISTS month INTEGER,
  ADD COLUMN IF NOT EXISTS year INTEGER;

-- 1b. Add a system author UUID constant for historic migrations
-- We'll use a fixed UUID so it's referenceable
INSERT INTO auth.users (id, email, created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin, encrypted_password, email_confirmed_at)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'system@mjcc.internal',
  NOW(), NOW(),
  '{"provider":"email","providers":["email"]}',
  '{"name":"System Migration"}',
  FALSE, '', NOW()
)
ON CONFLICT (id) DO NOTHING;

-- 1c. Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_commits_month_year ON commits(month, year);
CREATE INDEX IF NOT EXISTS idx_commits_status ON commits(status);
CREATE INDEX IF NOT EXISTS idx_commits_branch ON commits(branch);
CREATE INDEX IF NOT EXISTS idx_commit_changes_commit_id ON commit_changes(commit_id);
CREATE INDEX IF NOT EXISTS idx_commit_changes_item_month_year ON commit_changes(item_id, month, year);
CREATE INDEX IF NOT EXISTS idx_inventory_versions_month_year ON inventory_versions(month, year);
CREATE INDEX IF NOT EXISTS idx_inventory_versions_commit_id ON inventory_versions(commit_id);
CREATE INDEX IF NOT EXISTS idx_monthly_inventory_month_year ON monthly_inventory(month, year);
CREATE INDEX IF NOT EXISTS idx_monthly_inventory_item_id ON monthly_inventory(item_id);
;
