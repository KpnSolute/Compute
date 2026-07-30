
-- Replace all always-true write policies with auth.uid() IS NOT NULL.
-- This means writes require a signed-in user (even an anonymous Supabase session).
-- The dashboard will call signInAnonymously() on connect so this is transparent.
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendors', 'invoices', 'invoice_items',
    'inventory_categories', 'inventory_items',
    'monthly_inventory', 'monthly_snapshots', 'inventory_sync'
  ]
  LOOP
    -- Drop old always-true write policies
    EXECUTE format('DROP POLICY IF EXISTS "write_anon"  ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "update_anon" ON %I', t);
    EXECUTE format('DROP POLICY IF EXISTS "delete_anon" ON %I', t);

    -- INSERT: requires a logged-in user (anon session counts)
    EXECUTE format(
      'CREATE POLICY "write_auth" ON %I
       FOR INSERT TO authenticated
       WITH CHECK (auth.uid() IS NOT NULL)',
      t
    );

    -- UPDATE: requires a logged-in user
    EXECUTE format(
      'CREATE POLICY "update_auth" ON %I
       FOR UPDATE TO authenticated
       USING  (auth.uid() IS NOT NULL)
       WITH CHECK (auth.uid() IS NOT NULL)',
      t
    );

    -- DELETE: requires a logged-in user
    EXECUTE format(
      'CREATE POLICY "delete_auth" ON %I
       FOR DELETE TO authenticated
       USING (auth.uid() IS NOT NULL)',
      t
    );
  END LOOP;
END $$;
;
