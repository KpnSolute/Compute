
ALTER TABLE events ADD COLUMN IF NOT EXISTS staging_entry_id uuid UNIQUE;
ALTER TABLE haccp_logs ADD COLUMN IF NOT EXISTS staging_entry_id uuid UNIQUE;
ALTER TABLE daily_operations_logs ADD COLUMN IF NOT EXISTS staging_entry_id uuid UNIQUE;
;
