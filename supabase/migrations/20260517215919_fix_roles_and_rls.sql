
-- STORAGE FIX 3: role consistency
-- The DB has role='sudo' but auth.tsx canWrite() only checks 'admin'|'manager'
-- Add 'sudo' to the role check constraint so it's valid
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('admin','manager','staff','sudo'));

-- Fix month_tabs: 78 rows exist but they should only be user-created tabs,
-- not auto-seeded historical months. Wipe them so the UI starts clean.
-- (monthly_snapshots already holds all 76 historical months)
DELETE FROM month_tab_items;
DELETE FROM month_tabs;

-- Fix month_tabs RLS — currently it requires role='admin' to insert,
-- but managers also need to create tabs
DROP POLICY IF EXISTS "month_tabs_insert_admin" ON month_tabs;
CREATE POLICY "month_tabs_insert_mgmt"
  ON month_tabs FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','manager','sudo')
    )
  );

DROP POLICY IF EXISTS "month_tabs_update_admin" ON month_tabs;
CREATE POLICY "month_tabs_update_mgmt"
  ON month_tabs FOR UPDATE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','manager','sudo')
    )
  );

DROP POLICY IF EXISTS "month_tabs_delete_admin" ON month_tabs;
CREATE POLICY "month_tabs_delete_mgmt"
  ON month_tabs FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','manager','sudo')
    )
  );

-- Same for month_tab_items
DROP POLICY IF EXISTS "month_tab_items_insert_admin" ON month_tab_items;
CREATE POLICY "month_tab_items_insert_mgmt"
  ON month_tab_items FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','manager','sudo')
    )
  );

DROP POLICY IF EXISTS "month_tab_items_delete_admin" ON month_tab_items;
CREATE POLICY "month_tab_items_delete_mgmt"
  ON month_tab_items FOR DELETE
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE id = auth.uid()
        AND role IN ('admin','manager','sudo')
    )
  );

-- Also fix barcodes write policies so anon sessions work
-- (ensureAuth signs in anonymously, so uid() IS NOT NULL)
-- These already exist from the original migration — verify they allow anon writes
-- The existing policy is: FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL)
-- Anonymous sessions ARE "authenticated" after signInAnonymously() — this is correct.
;
