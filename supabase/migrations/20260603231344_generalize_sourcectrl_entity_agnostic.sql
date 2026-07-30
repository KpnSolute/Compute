
-- ══════════════════════════════════════════════
-- PHASE 1: staging_entries (0 rows — clean reshape)
-- ══════════════════════════════════════════════

-- Drop inventory FK so item_id can become nullable
ALTER TABLE staging_entries DROP CONSTRAINT staging_entries_item_id_fkey;

-- Relax inventory-specific NOT NULLs
ALTER TABLE staging_entries
  ALTER COLUMN item_id DROP NOT NULL,
  ALTER COLUMN month DROP NOT NULL,
  ALTER COLUMN year DROP NOT NULL,
  ALTER COLUMN week_number DROP NOT NULL,
  ALTER COLUMN field DROP NOT NULL,
  ALTER COLUMN action DROP NOT NULL,
  ALTER COLUMN submitted_value SET DEFAULT 0,
  ALTER COLUMN previous_value SET DEFAULT 0;

-- Add entity-agnostic columns
ALTER TABLE staging_entries
  ADD COLUMN IF NOT EXISTS entity_type  text,
  ADD COLUMN IF NOT EXISTS entity_id    text,
  ADD COLUMN IF NOT EXISTS field_name   text,
  ADD COLUMN IF NOT EXISTS old_value_text text,
  ADD COLUMN IF NOT EXISTS new_value_text text,
  ADD COLUMN IF NOT EXISTS change_type  text,
  ADD COLUMN IF NOT EXISTS metadata     jsonb DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_staging_entity ON staging_entries (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_staging_status ON staging_entries (status);

-- ══════════════════════════════════════════════
-- PHASE 2: commit_changes (5460 rows — non-destructive backfill)
-- ══════════════════════════════════════════════

-- Add new columns (nullable to allow backfill before constraining)
ALTER TABLE commit_changes
  ADD COLUMN IF NOT EXISTS entity_type    text,
  ADD COLUMN IF NOT EXISTS entity_id      text,
  ADD COLUMN IF NOT EXISTS field_name     text,
  ADD COLUMN IF NOT EXISTS old_value_text text,
  ADD COLUMN IF NOT EXISTS new_value_text text,
  ADD COLUMN IF NOT EXISTS change_type    text,
  ADD COLUMN IF NOT EXISTS metadata       jsonb DEFAULT '{}';

-- Backfill all 5460 existing rows from inventory-specific columns
UPDATE commit_changes SET
  entity_type    = 'inventory',
  entity_id      = item_id::text,
  field_name     = field,
  old_value_text = old_value::text,
  new_value_text = new_value::text,
  change_type    = action,
  metadata       = jsonb_build_object(
                     'month', month,
                     'year', year,
                     'week_number', week_number
                   )
WHERE entity_type IS NULL;

-- Drop the inventory FK so item_id can become nullable for future non-inventory rows
ALTER TABLE commit_changes DROP CONSTRAINT commit_changes_item_id_fkey;

-- Relax old inventory-specific NOT NULLs (keep columns for rollback window)
ALTER TABLE commit_changes
  ALTER COLUMN item_id DROP NOT NULL,
  ALTER COLUMN month DROP NOT NULL,
  ALTER COLUMN year DROP NOT NULL,
  ALTER COLUMN week_number DROP NOT NULL,
  ALTER COLUMN field DROP NOT NULL,
  ALTER COLUMN action DROP NOT NULL,
  ALTER COLUMN old_value SET DEFAULT 0,
  ALTER COLUMN new_value SET DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_cc_entity ON commit_changes (entity_type, entity_id);
;
