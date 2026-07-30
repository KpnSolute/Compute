
-- 1. Remove duplicate policies on inventory_items
DROP POLICY IF EXISTS "Public read inventory_items" ON public.inventory_items;
DROP POLICY IF EXISTS "Auth insert inventory_items" ON public.inventory_items;
DROP POLICY IF EXISTS "Auth update inventory_items" ON public.inventory_items;

-- 2. Drop obsolete inventory_sync table (replaced by backend API)
DROP TABLE IF EXISTS public.inventory_sync CASCADE;

-- 3. Tighten write policies — only authenticated users via service key
--    Staff can read everything, only authenticated sessions can write
--    (service key bypasses RLS anyway, this is belt-and-suspenders)
DROP POLICY IF EXISTS "write_auth" ON public.monthly_inventory;
CREATE POLICY "write_auth" ON public.monthly_inventory
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "write_auth" ON public.monthly_snapshots;
CREATE POLICY "write_auth" ON public.monthly_snapshots
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "write_auth" ON public.invoices;
CREATE POLICY "write_auth" ON public.invoices
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "write_auth" ON public.invoice_items;
CREATE POLICY "write_auth" ON public.invoice_items
  FOR INSERT WITH CHECK (auth.role() = 'authenticated');
;
