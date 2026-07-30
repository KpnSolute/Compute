
-- Add current month/year settings so the app always knows the active period
INSERT INTO app_settings (setting_key, setting_value) 
VALUES 
  ('CURRENT_MONTH', '4'),
  ('CURRENT_YEAR', '2026'),
  ('CURRENT_WEEK', '3')
ON CONFLICT (setting_key) DO UPDATE SET 
  setting_value = EXCLUDED.setting_value,
  updated_at = now();

-- Add source field to commits so we know if it came from file parse, manual edit, etc.
ALTER TABLE commits ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
-- source values: 'manual', 'file_parse', 'invoice', 'bulk_import'

-- Add file reference to commits for Files page integration  
ALTER TABLE commits ADD COLUMN IF NOT EXISTS file_ref TEXT;
-- stores filename like "US_Foods_Invoice_May2026_Wk1.xlsx"

-- Add source_type to staging_entries too
ALTER TABLE staging_entries ADD COLUMN IF NOT EXISTS source TEXT DEFAULT 'manual';
ALTER TABLE staging_entries ADD COLUMN IF NOT EXISTS file_ref TEXT;
ALTER TABLE staging_entries ADD COLUMN IF NOT EXISTS batch_id UUID;
-- batch_id groups multiple staging entries from one file parse into one "push"
;
