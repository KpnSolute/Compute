
-- Clear "RLS enabled, no policy" on backend-mediated tables by declaring an
-- explicit service_role ALL policy. We deliberately DO NOT grant authenticated
-- read here: the frontend never queries these tables directly (all access is
-- via the FastAPI service-role backend), so deny-by-default for anon/authenticated
-- is the correct, more-secure posture. service_role bypasses RLS regardless;
-- the explicit policy documents intent and satisfies the linter.
DO $$
DECLARE
  t text;
  tbls text[] := ARRAY[
    'archive_import_log','audit_log','centers','daily_operations_logs','documents',
    'email_log','email_templates','events','haccp_logs','incident_logs',
    'inventory_master','inventory_transactions','invoice_items','invoices','item_barcodes',
    'meal_periods','menu_cycles','menu_entries','month_status','opening_checklist_items',
    'qr_codes','reorder_alerts','servsafe_certifications','uploads','vendors','weekly_counts'
  ];
BEGIN
  FOREACH t IN ARRAY tbls LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public' AND tablename = t AND policyname = 'service_role_all'
    ) THEN
      EXECUTE format(
        'CREATE POLICY service_role_all ON public.%I FOR ALL TO service_role USING (true) WITH CHECK (true)',
        t
      );
    END IF;
  END LOOP;
END $$;
;
