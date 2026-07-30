
-- ── FIX 1: RLS policy for month_close (security advisory) ─────────────────
CREATE POLICY "Authenticated users can read month_close"
  ON public.month_close FOR SELECT
  USING (auth.role() IN ('authenticated', 'service_role'));

CREATE POLICY "Service role can write month_close"
  ON public.month_close FOR ALL
  USING (auth.role() = 'service_role');

-- ── FIX 2: Normalized view that unifies month indexing ─────────────────────
-- monthly_inventory uses 0-indexed months (0=Jan, 4=May, 5=June)
-- invoices/month_close use 1-indexed months (5=May, 6=June)
-- This view normalizes to 1-indexed for all joins

CREATE OR REPLACE VIEW public.v_monthly_inventory AS
SELECT
  mi.*,
  mi.month + 1                                    AS month_1indexed,
  TO_CHAR(MAKE_DATE(mi.year, mi.month + 1, 1), 'Month YYYY') AS period_label,
  ROUND((mi.on_hand * mi.unit_price)::numeric, 2) AS starting_value,
  ROUND(((mi.w1_received+mi.w2_received+mi.w3_received+mi.w4_received)*mi.unit_price)::numeric,2) AS total_rcvd_value,
  ROUND(((mi.w1_issued+mi.w2_issued+mi.w3_issued+mi.w4_issued)*mi.unit_price)::numeric,2) AS total_pulled_value,
  ROUND(((mi.on_hand+mi.w1_received+mi.w2_received+mi.w3_received+mi.w4_received
         -mi.w1_issued-mi.w2_issued-mi.w3_issued-mi.w4_issued)*mi.unit_price)::numeric,2) AS ending_value
FROM public.monthly_inventory mi;

-- ── FIX 3: Comment on month indexing to prevent future confusion ───────────
COMMENT ON COLUMN public.monthly_inventory.month IS '0-indexed month: 0=Jan, 1=Feb, ..., 4=May, 5=June, ..., 11=Dec';
COMMENT ON COLUMN public.invoices.month IS '1-indexed month: 1=Jan, 2=Feb, ..., 5=May, 6=June, ..., 12=Dec';
COMMENT ON COLUMN public.month_close.month IS '1-indexed month: 1=Jan, ..., 5=May, 6=June, ..., 12=Dec';
COMMENT ON COLUMN public.month_status.month IS '0-indexed month: 0=Jan, 1=Feb, ..., 4=May, 5=June, ..., 11=Dec';
;
