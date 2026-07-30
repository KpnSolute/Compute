-- inventory_versions: Git-like version history for inventory snapshots.
--
-- Each row stores a full snapshot of the inventory state at a point in time,
-- along with a commit message, author reference, and optional parent pointer
-- for future branching support.
--
-- Apply via: MCP apply_migration or Supabase Dashboard > SQL Editor.

CREATE TABLE IF NOT EXISTS inventory_versions (
  version_id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_data      JSONB         NOT NULL,
  summary_data       JSONB,
  created_by         UUID REFERENCES user_profiles(id),
  created_at         TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
  message            TEXT,
  parent_version_id  UUID REFERENCES inventory_versions(version_id),
  month              INT           NOT NULL,
  year               INT           NOT NULL
);

-- Index for fast lookups by month/year and chronological ordering
CREATE INDEX IF NOT EXISTS idx_inventory_versions_month_year
  ON inventory_versions (year DESC, month DESC, created_at DESC);

-- Index for finding the latest version for a given month/year
CREATE INDEX IF NOT EXISTS idx_inventory_versions_latest
  ON inventory_versions (month, year, created_at DESC);

-- Enable RLS but allow all authenticated users to read, only admin/manager to write
ALTER TABLE inventory_versions ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read versions
CREATE POLICY "Anyone authenticated can read versions"
  ON inventory_versions
  FOR SELECT
  USING (auth.role() = 'authenticated');

-- Allow admin/manager to insert versions
CREATE POLICY "Admin/manager can insert versions"
  ON inventory_versions
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'manager')
        AND active = true
    )
  );;
