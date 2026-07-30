
-- ── FIX 1: RLS auth re-evaluation — use (select auth.role()) pattern ──────────
DROP POLICY IF EXISTS "Authenticated users can read month_close" ON public.month_close;
DROP POLICY IF EXISTS "Service role can write month_close" ON public.month_close;

CREATE POLICY "read_month_close" ON public.month_close
  FOR SELECT USING (true);

CREATE POLICY "write_month_close" ON public.month_close
  FOR ALL USING ((SELECT auth.role()) = 'service_role');

-- Fix month_periods write policy
DROP POLICY IF EXISTS "write_month_periods" ON public.month_periods;
CREATE POLICY "write_month_periods" ON public.month_periods
  FOR ALL USING ((SELECT auth.role()) = 'service_role');

-- Fix week_gross write policy
DROP POLICY IF EXISTS "write_week_gross" ON public.week_gross;
CREATE POLICY "write_week_gross" ON public.week_gross
  FOR ALL USING ((SELECT auth.role()) = 'service_role');

-- ── FIX 2: Add missing FK indexes (performance) ──────────────────────────────
CREATE INDEX IF NOT EXISTS idx_invoices_month_period_id
  ON public.invoices(month_period_id);

CREATE INDEX IF NOT EXISTS idx_invoices_week_gross_id
  ON public.invoices(week_gross_id);

-- ── FIX 3: Add useful indexes for common dashboard queries ───────────────────
CREATE INDEX IF NOT EXISTS idx_barcodes_category
  ON public.barcodes(category);

CREATE INDEX IF NOT EXISTS idx_barcodes_sku
  ON public.barcodes(sku);

CREATE INDEX IF NOT EXISTS idx_monthly_inv_month_year
  ON public.monthly_inventory(month, year);

CREATE INDEX IF NOT EXISTS idx_invoice_items_sku
  ON public.invoice_items(sku);

CREATE INDEX IF NOT EXISTS idx_invoice_items_category
  ON public.invoice_items(category);
;
