
-- ═══════════════════════════════════════════════════════════════════════════════
-- MONTHLY WEEKLY GROSS — Proper relational object model
-- 
-- HIERARCHY:
--   month_periods  (1)
--       └── week_gross  (1-4 per month)
--               └── invoices  (1+ per week)
--                       └── invoice_items  (N per invoice)
-- ═══════════════════════════════════════════════════════════════════════════════

-- STEP 1: month_periods — canonical month record (replaces scattered month_status/month_close)
CREATE TABLE IF NOT EXISTS public.month_periods (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month            int  NOT NULL CHECK (month BETWEEN 1 AND 12),   -- 1-indexed
  year             int  NOT NULL CHECK (year BETWEEN 2020 AND 2040),
  status           text NOT NULL DEFAULT 'open'
                        CHECK (status IN ('open','published')),
  starting_balance numeric(12,2) DEFAULT 0,
  closing_balance  numeric(12,2) GENERATED ALWAYS AS (
                     starting_balance + total_received - total_pulled
                   ) STORED,
  total_received   numeric(12,2) DEFAULT 0,   -- sum of week_gross.net_received
  total_pulled     numeric(12,2) DEFAULT 0,   -- sum of pulls entered via pull sheet
  opened_at        timestamptz DEFAULT now(),
  published_at     timestamptz,
  notes            text,
  UNIQUE (month, year)
);

-- STEP 2: week_gross — one row per week per month, tracks invoice financials
CREATE TABLE IF NOT EXISTS public.week_gross (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  month_period_id  uuid NOT NULL REFERENCES public.month_periods(id) ON DELETE CASCADE,
  week_number      int  NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  gross_received   numeric(12,2) DEFAULT 0,   -- sum of invoice subtotals this week
  vizient_discount numeric(12,2) DEFAULT 0,   -- total VIZIENT credits this week
  fuel_surcharge   numeric(12,2) DEFAULT 0,
  net_received     numeric(12,2) GENERATED ALWAYS AS (
                     gross_received - vizient_discount + fuel_surcharge
                   ) STORED,
  invoice_count    int DEFAULT 0,             -- how many invoices this week
  notes            text,
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (month_period_id, week_number)
);

-- STEP 3: Add FK from invoices → week_gross so invoices are linked to their week
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS week_gross_id uuid REFERENCES public.week_gross(id);

-- STEP 4: Add FK from invoices → month_periods for direct month linkage
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS month_period_id uuid REFERENCES public.month_periods(id);

-- STEP 5: Function to recompute week_gross totals from invoices
CREATE OR REPLACE FUNCTION public.refresh_week_gross(p_month_period_id uuid)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  UPDATE public.week_gross wg
  SET
    gross_received   = COALESCE((
      SELECT SUM(i.subtotal) FROM public.invoices i
      WHERE i.week_gross_id = wg.id
    ), 0),
    vizient_discount = COALESCE((
      SELECT SUM(i.vizient_discount) FROM public.invoices i
      WHERE i.week_gross_id = wg.id
    ), 0),
    fuel_surcharge   = 0,
    invoice_count    = (
      SELECT COUNT(*) FROM public.invoices i
      WHERE i.week_gross_id = wg.id
    ),
    updated_at       = now()
  WHERE wg.month_period_id = p_month_period_id;

  -- Bubble totals up to month_periods
  UPDATE public.month_periods mp
  SET total_received = COALESCE((
    SELECT SUM(wg.net_received) FROM public.week_gross wg
    WHERE wg.month_period_id = mp.id
  ), 0)
  WHERE mp.id = p_month_period_id;
END;
$$;

-- STEP 6: Trigger to auto-refresh week_gross when invoices change
CREATE OR REPLACE FUNCTION public.trg_invoice_refresh_week()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'DELETE') THEN
    IF OLD.week_gross_id IS NOT NULL THEN
      PERFORM public.refresh_week_gross(
        (SELECT month_period_id FROM public.week_gross WHERE id = OLD.week_gross_id)
      );
    END IF;
  ELSE
    IF NEW.week_gross_id IS NOT NULL THEN
      PERFORM public.refresh_week_gross(
        (SELECT month_period_id FROM public.week_gross WHERE id = NEW.week_gross_id)
      );
    END IF;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_invoice_refresh_week ON public.invoices;
CREATE TRIGGER trg_invoice_refresh_week
  AFTER INSERT OR UPDATE OR DELETE ON public.invoices
  FOR EACH ROW EXECUTE FUNCTION public.trg_invoice_refresh_week();

-- STEP 7: Convenience view — full month breakdown with weekly gross
CREATE OR REPLACE VIEW public.v_month_weekly_breakdown AS
SELECT
  mp.id             AS month_period_id,
  mp.month,
  mp.year,
  TO_CHAR(MAKE_DATE(mp.year, mp.month, 1), 'Month YYYY') AS period_label,
  mp.status,
  mp.starting_balance,
  mp.total_received,
  mp.total_pulled,
  mp.closing_balance,
  wg.week_number,
  wg.gross_received  AS wk_gross,
  wg.vizient_discount AS wk_vizient,
  wg.net_received    AS wk_net,
  wg.invoice_count   AS wk_invoices
FROM public.month_periods mp
JOIN public.week_gross wg ON wg.month_period_id = mp.id
ORDER BY mp.year, mp.month, wg.week_number;

-- Enable RLS
ALTER TABLE public.month_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.week_gross     ENABLE ROW LEVEL SECURITY;

CREATE POLICY "read_month_periods" ON public.month_periods FOR SELECT USING (true);
CREATE POLICY "write_month_periods" ON public.month_periods FOR ALL USING (auth.role() = 'service_role');
CREATE POLICY "read_week_gross" ON public.week_gross FOR SELECT USING (true);
CREATE POLICY "write_week_gross" ON public.week_gross FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE public.month_periods IS 'Master month record. Parent of week_gross → invoices → invoice_items hierarchy.';
COMMENT ON TABLE public.week_gross    IS 'Weekly invoice financial totals per month. Auto-refreshed by trigger when invoices are added/changed.';
COMMENT ON COLUMN public.week_gross.net_received IS 'Computed: gross_received - vizient_discount + fuel_surcharge. Matches what was actually paid.';
;
