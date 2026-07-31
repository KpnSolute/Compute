-- Preserve the period opening balance when the weekly ledger cache is rebuilt.
--
-- The previous INSERT ... ON CONFLICT path omitted opening_oh.  PostgreSQL
-- therefore evaluated the monthly_inventory over-pull trigger against the
-- INSERT tuple's default opening value while replaying an existing item.  A
-- valid item with pulls in later weeks could be rejected as requested N,
-- available 0.  Weekly recompute must only replace derived weekly totals.

CREATE OR REPLACE FUNCTION public.recompute_week_totals(
  p_item_id uuid,
  p_month integer,
  p_year integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  INSERT INTO public.monthly_inventory (
    item_id,
    month,
    year,
    opening_oh,
    unit_price,
    w1_received,
    w2_received,
    w3_received,
    w1_pulled,
    w2_pulled,
    w3_pulled
  )
  SELECT
    p_item_id,
    p_month,
    p_year,
    COALESCE((
      SELECT opening_oh
      FROM public.monthly_inventory
      WHERE item_id = p_item_id AND month = p_month AND year = p_year
    ), 0),
    COALESCE(NULLIF((
      SELECT unit_price
      FROM public.inventory_items
      WHERE id = p_item_id
    ), 0), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 1 AND txn_type IN ('received', 'adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 2 AND txn_type IN ('received', 'adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 3 AND txn_type IN ('received', 'adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 1 AND txn_type IN ('issued', 'adjustment_decrease')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 2 AND txn_type IN ('issued', 'adjustment_decrease')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 3 AND txn_type IN ('issued', 'adjustment_decrease')), 0)
  FROM public.inventory_transactions
  WHERE item_id = p_item_id AND month = p_month AND year = p_year
  ON CONFLICT (item_id, month, year) DO UPDATE SET
    w1_received = EXCLUDED.w1_received,
    w2_received = EXCLUDED.w2_received,
    w3_received = EXCLUDED.w3_received,
    w1_pulled = EXCLUDED.w1_pulled,
    w2_pulled = EXCLUDED.w2_pulled,
    w3_pulled = EXCLUDED.w3_pulled,
    opening_oh = public.monthly_inventory.opening_oh,
    unit_price = CASE
      WHEN public.monthly_inventory.unit_price IS NULL
        OR public.monthly_inventory.unit_price = 0
      THEN EXCLUDED.unit_price
      ELSE public.monthly_inventory.unit_price
    END,
    updated_at = now();
END;
$function$;
