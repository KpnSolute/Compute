
-- ─────────────────────────────────────────────
-- 1. Drop RLS policies that reference public.profiles
-- ─────────────────────────────────────────────
DROP POLICY IF EXISTS pending_select            ON public.pending_changes;
DROP POLICY IF EXISTS pending_update            ON public.pending_changes;
DROP POLICY IF EXISTS pending_delete            ON public.pending_changes;
DROP POLICY IF EXISTS month_tabs_insert_mgmt    ON public.month_tabs;
DROP POLICY IF EXISTS month_tabs_update_mgmt    ON public.month_tabs;
DROP POLICY IF EXISTS month_tabs_delete_mgmt    ON public.month_tabs;
DROP POLICY IF EXISTS month_tab_items_insert_mgmt ON public.month_tab_items;
DROP POLICY IF EXISTS month_tab_items_delete_mgmt ON public.month_tab_items;

-- ─────────────────────────────────────────────
-- 2. Drop FK constraints pointing to public.profiles
-- ─────────────────────────────────────────────
ALTER TABLE public.weekly_counts          DROP CONSTRAINT IF EXISTS weekly_counts_recorded_by_fkey;
ALTER TABLE public.reorder_alerts         DROP CONSTRAINT IF EXISTS reorder_alerts_resolved_by_fkey;
ALTER TABLE public.pending_changes        DROP CONSTRAINT IF EXISTS pending_changes_created_by_fkey;
ALTER TABLE public.pending_changes        DROP CONSTRAINT IF EXISTS pending_changes_reviewed_by_fkey;
ALTER TABLE public.inventory_transactions DROP CONSTRAINT IF EXISTS inventory_transactions_created_by_fkey;
ALTER TABLE public.documents              DROP CONSTRAINT IF EXISTS documents_generated_by_fkey;

-- ─────────────────────────────────────────────
-- 3. Drop FK pointing to public.mjc_users, then drop auth tables
-- ─────────────────────────────────────────────
ALTER TABLE public.mjc_sessions DROP CONSTRAINT IF EXISTS mjc_sessions_user_id_fkey;

DROP TABLE IF EXISTS public.mjc_sessions;
DROP TABLE IF EXISTS public.mjc_users;
DROP TABLE IF EXISTS public.profiles CASCADE;

-- ─────────────────────────────────────────────
-- 4. Re-link FK constraints → auth.users
-- ─────────────────────────────────────────────
ALTER TABLE public.weekly_counts
  ADD CONSTRAINT weekly_counts_recorded_by_fkey
  FOREIGN KEY (recorded_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.reorder_alerts
  ADD CONSTRAINT reorder_alerts_resolved_by_fkey
  FOREIGN KEY (resolved_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pending_changes
  ADD CONSTRAINT pending_changes_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.pending_changes
  ADD CONSTRAINT pending_changes_reviewed_by_fkey
  FOREIGN KEY (reviewed_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.inventory_transactions
  ADD CONSTRAINT inventory_transactions_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_generated_by_fkey
  FOREIGN KEY (generated_by) REFERENCES auth.users(id) ON DELETE SET NULL;

-- ─────────────────────────────────────────────
-- 5. Recreate RLS policies using auth.users.raw_user_meta_data for role checks
-- ─────────────────────────────────────────────

-- Helper: is the current user an admin/manager/sudo?
-- Reads role from auth.users.raw_user_meta_data->>'role'

CREATE POLICY pending_select ON public.pending_changes
  FOR SELECT USING (
    created_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND (raw_user_meta_data->>'role') = ANY (ARRAY['admin','manager','sudo'])
    )
  );

CREATE POLICY pending_update ON public.pending_changes
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND (raw_user_meta_data->>'role') = ANY (ARRAY['admin','manager','sudo'])
    )
  );

CREATE POLICY pending_delete ON public.pending_changes
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND (raw_user_meta_data->>'role') = ANY (ARRAY['admin','manager','sudo'])
    )
  );

CREATE POLICY month_tabs_insert_mgmt ON public.month_tabs
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND (raw_user_meta_data->>'role') = ANY (ARRAY['admin','manager','sudo'])
    )
  );

CREATE POLICY month_tabs_update_mgmt ON public.month_tabs
  FOR UPDATE USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND (raw_user_meta_data->>'role') = ANY (ARRAY['admin','manager','sudo'])
    )
  );

CREATE POLICY month_tabs_delete_mgmt ON public.month_tabs
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND (raw_user_meta_data->>'role') = ANY (ARRAY['admin','manager','sudo'])
    )
  );

CREATE POLICY month_tab_items_insert_mgmt ON public.month_tab_items
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND (raw_user_meta_data->>'role') = ANY (ARRAY['admin','manager','sudo'])
    )
  );

CREATE POLICY month_tab_items_delete_mgmt ON public.month_tab_items
  FOR DELETE USING (
    EXISTS (
      SELECT 1 FROM auth.users
      WHERE id = auth.uid()
        AND (raw_user_meta_data->>'role') = ANY (ARRAY['admin','manager','sudo'])
    )
  );
;
