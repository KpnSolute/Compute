-- Commits, commit_changes, and staging_entries tables for the MJCC
-- Git-style commit tree inventory system.
--
-- This replaces the ad-hoc pending-submissions workflow with a proper
-- commit DAG, per-change tracking, and a staging area with TTL expiry.
--
-- Apply via: MCP apply_migration or Supabase Dashboard > SQL Editor.

-- ── commits ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commits (
  commit_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_ids  UUID[]        NOT NULL DEFAULT '{}',
  message     TEXT          NOT NULL,
  author_id   UUID          NOT NULL REFERENCES user_profiles(id),
  status      TEXT          NOT NULL DEFAULT 'merged'
                            CHECK (status IN ('merged', 'reverted')),
  branch      TEXT          NOT NULL DEFAULT 'main',
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now(),
  merged_at   TIMESTAMPTZ   NOT NULL DEFAULT now(),
  merged_by   UUID          REFERENCES user_profiles(id)
);

-- ── commit_changes ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS commit_changes (
  change_id   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  commit_id   UUID          NOT NULL REFERENCES commits(commit_id) ON DELETE CASCADE,
  item_id     UUID          NOT NULL REFERENCES inventory_items(id),
  month       INT           NOT NULL,
  year        INT           NOT NULL,
  week_number INT           NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  field       TEXT          NOT NULL,
  old_value   NUMERIC       NOT NULL DEFAULT 0,
  new_value   NUMERIC       NOT NULL DEFAULT 0,
  action      TEXT          NOT NULL CHECK (action IN ('pull', 'enter', 'revert')),
  created_at  TIMESTAMPTZ   NOT NULL DEFAULT now()
);

-- ── staging_entries ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS staging_entries (
  entry_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id          UUID          NOT NULL REFERENCES inventory_items(id),
  month            INT           NOT NULL,
  year             INT           NOT NULL,
  week_number      INT           NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  field            TEXT          NOT NULL,
  action           TEXT          NOT NULL CHECK (action IN ('pull', 'enter')),
  submitted_value  NUMERIC       NOT NULL DEFAULT 0,
  previous_value   NUMERIC       NOT NULL DEFAULT 0,
  status           TEXT          NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending', 'merged', 'rejected')),
  submitted_by     UUID          NOT NULL REFERENCES user_profiles(id),
  reviewed_by      UUID          REFERENCES user_profiles(id),
  review_note      TEXT,
  created_at       TIMESTAMPTZ   NOT NULL DEFAULT now(),
  expires_at       TIMESTAMPTZ   NOT NULL DEFAULT now() + INTERVAL '15 days',
  reviewed_at      TIMESTAMPTZ
);

-- ── Indexes ──────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_staging_expires
  ON staging_entries(expires_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_commits_author
  ON commits(author_id);

CREATE INDEX IF NOT EXISTS idx_commit_changes_commit
  ON commit_changes(commit_id);

CREATE INDEX IF NOT EXISTS idx_commit_changes_item
  ON commit_changes(item_id, month, year);

-- ── Row Level Security ───────────────────────────────────────────────
ALTER TABLE commits ENABLE ROW LEVEL SECURITY;
ALTER TABLE commit_changes ENABLE ROW LEVEL SECURITY;
ALTER TABLE staging_entries ENABLE ROW LEVEL SECURITY;

-- Authenticated users can SELECT from all three tables
CREATE POLICY "Authenticated can select commits"
  ON commits FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can select commit_changes"
  ON commit_changes FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Authenticated can select staging_entries"
  ON staging_entries FOR SELECT
  USING (auth.role() = 'authenticated');

-- Service role can do everything (INSERT / UPDATE / DELETE)
-- These policies are intentionally permissive for now; they will be
-- tightened once the role-based permission model is finalised.
CREATE POLICY "Service role all on commits"
  ON commits FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role all on commit_changes"
  ON commit_changes FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Service role all on staging_entries"
  ON staging_entries FOR ALL
  USING (auth.role() = 'service_role');
