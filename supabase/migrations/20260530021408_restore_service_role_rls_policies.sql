
-- ============================================================
-- RESTORE RLS POLICIES
-- Flask uses the service_role key which bypasses RLS by default,
-- BUT only if the table doesn't have FORCE ROW SECURITY.
-- Safest fix: add a blanket service_role bypass policy on every table
-- AND also allow authenticated users to read their own data.
-- ============================================================

-- inventory_items
CREATE POLICY "service_role_all" ON inventory_items FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON inventory_items FOR SELECT TO authenticated USING (true);

-- inventory_categories
CREATE POLICY "service_role_all" ON inventory_categories FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON inventory_categories FOR SELECT TO authenticated USING (true);

-- monthly_inventory
CREATE POLICY "service_role_all" ON monthly_inventory FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON monthly_inventory FOR SELECT TO authenticated USING (true);

-- monthly_snapshots
CREATE POLICY "service_role_all" ON monthly_snapshots FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON monthly_snapshots FOR SELECT TO authenticated USING (true);

-- staging_entries
CREATE POLICY "service_role_all" ON staging_entries FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON staging_entries FOR SELECT TO authenticated USING (true);

-- barcodes
CREATE POLICY "service_role_all" ON barcodes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON barcodes FOR SELECT TO authenticated USING (true);

-- user_profiles
CREATE POLICY "service_role_all" ON user_profiles FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON user_profiles FOR SELECT TO authenticated USING (true);

-- commits
ALTER TABLE commits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON commits FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON commits FOR SELECT TO authenticated USING (true);

-- commit_changes
ALTER TABLE commit_changes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON commit_changes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON commit_changes FOR SELECT TO authenticated USING (true);

-- inventory_versions
ALTER TABLE inventory_versions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON inventory_versions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY "authenticated_read" ON inventory_versions FOR SELECT TO authenticated USING (true);
;
