
-- Add github_sha to commits (stores the GitHub commit SHA after sync)
ALTER TABLE commits
  ADD COLUMN IF NOT EXISTS github_sha TEXT,
  ADD COLUMN IF NOT EXISTS github_synced_at TIMESTAMPTZ;

-- github_sync_queue: retry queue for failed GitHub writes
CREATE TABLE IF NOT EXISTS github_sync_queue (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation    TEXT NOT NULL
                 CHECK (operation IN (
                   'push_inventory',
                   'push_archive_snapshot',
                   'push_invoice',
                   'push_menu',
                   'push_items_catalog'
                 )),
  payload      JSONB NOT NULL,
  commit_id    UUID REFERENCES commits(commit_id) ON DELETE SET NULL,
  attempts     INT  NOT NULL DEFAULT 0,
  last_error   TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  synced_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_sync_queue_pending
  ON github_sync_queue(created_at)
  WHERE synced_at IS NULL AND attempts < 5;

ALTER TABLE github_sync_queue ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role all on github_sync_queue"
  ON github_sync_queue FOR ALL
  USING (auth.role() = 'service_role');

CREATE POLICY "Authenticated can select github_sync_queue"
  ON github_sync_queue FOR SELECT
  USING (auth.role() = 'authenticated');
;
