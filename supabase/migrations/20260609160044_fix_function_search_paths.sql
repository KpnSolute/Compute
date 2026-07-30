
-- Fix mutable search_path on both functions (security advisory)
CREATE OR REPLACE FUNCTION public.refresh_week_gross(p_month_period_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.week_gross wg
  SET
    gross_received   = COALESCE((
      SELECT SUM(i.subtotal) FROM public.invoices i WHERE i.week_gross_id = wg.id
    ), 0),
    vizient_discount = COALESCE((
      SELECT SUM(i.vizient_discount) FROM public.invoices i WHERE i.week_gross_id = wg.id
    ), 0),
    invoice_count    = (SELECT COUNT(*) FROM public.invoices i WHERE i.week_gross_id = wg.id),
    updated_at       = now()
  WHERE wg.month_period_id = p_month_period_id;

  UPDATE public.month_periods mp
  SET total_received = COALESCE((
    SELECT SUM(wg.net_received) FROM public.week_gross wg
    WHERE wg.month_period_id = mp.id
  ), 0)
  WHERE mp.id = p_month_period_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_invoice_refresh_week()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
;
