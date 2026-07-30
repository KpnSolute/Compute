
-- Fix refresh_week_gross so it never zeros out fuel_surcharge
-- fuel_surcharge is manually set per week and should be preserved on refresh
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
    -- NOTE: fuel_surcharge is intentionally NOT reset here —
    -- it is set manually per week and must be preserved across refreshes
    invoice_count    = (
      SELECT COUNT(*) FROM public.invoices i
      WHERE i.week_gross_id = wg.id
    ),
    updated_at       = now()
  WHERE wg.month_period_id = p_month_period_id;

  -- Bubble net totals up to month_periods
  UPDATE public.month_periods mp
  SET total_received = COALESCE((
    SELECT SUM(wg.net_received) FROM public.week_gross wg
    WHERE wg.month_period_id = mp.id
  ), 0)
  WHERE mp.id = p_month_period_id;
END;
$$;

COMMENT ON FUNCTION public.refresh_week_gross IS
  'Recomputes gross_received and vizient_discount from invoices. Does NOT touch fuel_surcharge — that is set manually per week.';
;
