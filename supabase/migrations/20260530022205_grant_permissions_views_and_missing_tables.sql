
-- ============================================================
-- GRANT SELECT/ALL on views (RLS policies don't cover views)
-- ============================================================
GRANT SELECT ON dashboard_summary TO authenticated, service_role, anon;
GRANT SELECT ON commits_compat TO authenticated, service_role, anon;
GRANT SELECT ON staging_entries_compat TO authenticated, service_role, anon;

-- ============================================================
-- GRANT on all tables that were missed
-- ============================================================
GRANT ALL ON app_settings TO service_role;
GRANT SELECT ON app_settings TO authenticated;

GRANT ALL ON inventory_items TO service_role;
GRANT SELECT ON inventory_items TO authenticated;

GRANT ALL ON inventory_categories TO service_role;
GRANT SELECT ON inventory_categories TO authenticated;

GRANT ALL ON monthly_inventory TO service_role;
GRANT SELECT ON monthly_inventory TO authenticated;

GRANT ALL ON monthly_snapshots TO service_role;
GRANT SELECT ON monthly_snapshots TO authenticated;

GRANT ALL ON staging_entries TO service_role;
GRANT SELECT ON staging_entries TO authenticated;

GRANT ALL ON barcodes TO service_role;
GRANT SELECT ON barcodes TO authenticated;

GRANT ALL ON user_profiles TO service_role;
GRANT SELECT ON user_profiles TO authenticated;

GRANT ALL ON commits TO service_role;
GRANT SELECT ON commits TO authenticated;

GRANT ALL ON commit_changes TO service_role;
GRANT SELECT ON commit_changes TO authenticated;

GRANT ALL ON inventory_versions TO service_role;
GRANT SELECT ON inventory_versions TO authenticated;

GRANT ALL ON month_status TO service_role;
GRANT SELECT ON month_status TO authenticated;

-- ============================================================
-- Also enable RLS on app_settings and add policy
-- ============================================================
ALTER TABLE app_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON app_settings FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON app_settings FOR SELECT TO authenticated USING (true);
;
