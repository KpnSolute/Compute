-- Supporting tables: uploads, app_settings, audit_log; plus schema
-- modifications to user_profiles and inventory_versions.
--
-- Apply via: MCP apply_migration or Supabase Dashboard > SQL Editor.

-- ── audit_log ────────────────────────────────────────────────────────
-- Created here because the new commit RPCs write audit entries.
CREATE TABLE IF NOT EXISTS audit_log (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  table_name   TEXT          NOT NULL,
  record_id    UUID,
  action       TEXT          NOT NULL,
  old_values   JSONB,
  new_values   JSONB,
  performed_by UUID          REFERENCES user_profiles(id),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can select audit_log"
  ON audit_log FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role all on audit_log"
  ON audit_log FOR ALL
  USING (auth.role() = 'service_role');

-- ── uploads ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS uploads (
  upload_id    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  file_name    TEXT          NOT NULL,
  file_type    TEXT          NOT NULL
                 CHECK (file_type IN ('invoice_pdf', 'delivery_photo', 'receipt', 'other')),
  file_size    INT           NOT NULL,
  storage_path TEXT          NOT NULL,
  uploaded_by  UUID          REFERENCES user_profiles(id),
  commit_id    UUID          REFERENCES commits(commit_id),
  created_at   TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE uploads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can select uploads"
  ON uploads FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role all on uploads"
  ON uploads FOR ALL
  USING (auth.role() = 'service_role');

-- ── app_settings ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS app_settings (
  setting_key   TEXT PRIMARY KEY,
  setting_value JSONB         NOT NULL,
  updated_by    UUID          REFERENCES user_profiles(id),
  updated_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can select app_settings"
  ON app_settings FOR SELECT
  USING (auth.role() = 'authenticated');

CREATE POLICY "Service role all on app_settings"
  ON app_settings FOR ALL
  USING (auth.role() = 'service_role');

-- ── user_profiles modifications ──────────────────────────────────────
ALTER TABLE user_profiles
  ADD COLUMN IF NOT EXISTS last_name TEXT;

-- Update the role CHECK constraint to include 'assistant' and drop 'corporate'
ALTER TABLE user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role IN ('admin', 'manager', 'assistant', 'staff'));

-- ── inventory_versions modifications ──────────────────────────────────
ALTER TABLE inventory_versions
  ADD COLUMN IF NOT EXISTS commit_id UUID REFERENCES commits(commit_id);

CREATE INDEX IF NOT EXISTS idx_inventory_versions_commit
  ON inventory_versions(commit_id);
