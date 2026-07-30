
-- Drop the broad allow_all policies and replace with explicit per-operation policies.
-- SELECT is open (public read). INSERT/UPDATE/DELETE require the anon key
-- (dashboard uses service role or anon key — no user auth yet).
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendors','invoices','invoice_items',
    'inventory_categories','inventory_items',
    'monthly_inventory','monthly_snapshots','inventory_sync'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS "allow_all" ON %I', t);

    -- Anyone with the anon key can read
    EXECUTE format(
      'CREATE POLICY "read_public" ON %I FOR SELECT TO anon, authenticated USING (true)',
      t
    );

    -- Writes: anon key allowed (dashboard sync uses anon key — tighten to authenticated when auth is added)
    EXECUTE format(
      'CREATE POLICY "write_anon" ON %I FOR INSERT TO anon, authenticated WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "update_anon" ON %I FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)',
      t
    );
    EXECUTE format(
      'CREATE POLICY "delete_anon" ON %I FOR DELETE TO anon, authenticated USING (true)',
      t
    );
  END LOOP;
END $$;
;
