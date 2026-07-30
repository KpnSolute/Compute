-- 047_invoice_backed_valuation_writer.sql
--
-- The inventory transaction ledger is the source of truth for received and
-- pulled dollars.  The prior standardization migration rebuilt those fields
-- from the catalog price, which silently changed invoice-backed totals after a
-- weekly recompute.  Keep the monthly row as the API cache, but price ledger
-- movements at the transaction price and preserve imported review values when
-- no ledger exists.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_monthly_inventory_value_standard()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_price numeric;
  v_open_cost numeric;
  v_received numeric;
  v_pulled numeric;
  v_has_received boolean;
  v_has_pulled boolean;
  v_end_qty numeric;
BEGIN
  v_price := GREATEST(0::numeric, COALESCE(
    NULLIF(NEW.unit_price, 0),
    (SELECT NULLIF(unit_price, 0) FROM public.inventory_items WHERE id = NEW.item_id),
    0
  ));
  v_open_cost := GREATEST(0::numeric, COALESCE(
    NULLIF(NEW.opening_unit_cost, 0), v_price
  ));

  SELECT
    EXISTS (
      SELECT 1 FROM public.inventory_transactions
      WHERE item_id = NEW.item_id AND month = NEW.month AND year = NEW.year
        AND txn_type IN ('received', 'adjustment_increase')
    ),
    EXISTS (
      SELECT 1 FROM public.inventory_transactions
      WHERE item_id = NEW.item_id AND month = NEW.month AND year = NEW.year
        AND txn_type IN ('issued', 'adjustment_decrease')
    ),
    COALESCE(SUM(quantity * GREATEST(0::numeric, unit_price)) FILTER (
      WHERE txn_type IN ('received', 'adjustment_increase')
    ), 0),
    COALESCE(SUM(quantity * GREATEST(0::numeric, unit_price)) FILTER (
      WHERE txn_type IN ('issued', 'adjustment_decrease')
    ), 0)
  INTO v_has_received, v_has_pulled, v_received, v_pulled
  FROM public.inventory_transactions
  WHERE item_id = NEW.item_id AND month = NEW.month AND year = NEW.year;

  -- A populated ledger wins.  Otherwise retain imported review/invoice values;
  -- only derive a missing value from quantity and the period price.
  IF COALESCE(NEW.w1_received, 0) + COALESCE(NEW.w2_received, 0) + COALESCE(NEW.w3_received, 0) <= 0 THEN
    NEW.received_value := 0;
  ELSIF v_has_received THEN
    NEW.received_value := round(GREATEST(0::numeric, v_received), 2);
  ELSE
    NEW.received_value := round(GREATEST(0::numeric, COALESCE(
      NEW.received_value,
      (COALESCE(NEW.w1_received, 0) + COALESCE(NEW.w2_received, 0) + COALESCE(NEW.w3_received, 0)) * v_price
    )), 2);
  END IF;
  IF COALESCE(NEW.w1_pulled, 0) + COALESCE(NEW.w2_pulled, 0) + COALESCE(NEW.w3_pulled, 0) <= 0 THEN
    NEW.pulled_value := 0;
  ELSIF v_has_pulled THEN
    NEW.pulled_value := round(GREATEST(0::numeric, v_pulled), 2);
  ELSE
    NEW.pulled_value := round(GREATEST(0::numeric, COALESCE(
      NEW.pulled_value,
      (COALESCE(NEW.w1_pulled, 0) + COALESCE(NEW.w2_pulled, 0) + COALESCE(NEW.w3_pulled, 0)) * v_price
    )), 2);
  END IF;

  IF COALESCE(NEW.opening_oh, 0) <= 0 THEN
    NEW.opening_value := 0;
  ELSIF COALESCE(NEW.opening_value, 0) = 0 THEN
    NEW.opening_value := round(GREATEST(0::numeric, NEW.opening_oh) * v_open_cost, 2);
  ELSE
    NEW.opening_value := round(GREATEST(0::numeric, COALESCE(NEW.opening_value, 0)), 2);
  END IF;
  NEW.opening_unit_cost := round(v_open_cost, 6);
  v_end_qty := GREATEST(0::numeric,
    COALESCE(NEW.opening_oh, 0)
    + COALESCE(NEW.w1_received, 0) + COALESCE(NEW.w2_received, 0) + COALESCE(NEW.w3_received, 0)
    - COALESCE(NEW.w1_pulled, 0) - COALESCE(NEW.w2_pulled, 0) - COALESCE(NEW.w3_pulled, 0)
  );
  NEW.ending_value := CASE WHEN v_end_qty <= 0 THEN 0 ELSE round(GREATEST(0::numeric,
    NEW.opening_value + NEW.received_value - NEW.pulled_value), 2) END;
  RETURN NEW;
END;
$function$;

CREATE OR REPLACE FUNCTION public.recompute_week_totals(p_item_id uuid, p_month integer, p_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public', 'pg_temp' AS $function$
BEGIN
  INSERT INTO public.monthly_inventory (
    item_id, month, year, unit_price,
    w1_received, w2_received, w3_received,
    w1_pulled, w2_pulled, w3_pulled
  )
  SELECT p_item_id, p_month, p_year,
    COALESCE(NULLIF((SELECT unit_price FROM public.inventory_items WHERE id = p_item_id), 0), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 1 AND txn_type IN ('received','adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 2 AND txn_type IN ('received','adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 3 AND txn_type IN ('received','adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 1 AND txn_type IN ('issued','adjustment_decrease')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 2 AND txn_type IN ('issued','adjustment_decrease')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 3 AND txn_type IN ('issued','adjustment_decrease')), 0)
  FROM public.inventory_transactions
  WHERE item_id = p_item_id AND month = p_month AND year = p_year
  ON CONFLICT (item_id, month, year) DO UPDATE SET
    w1_received = EXCLUDED.w1_received,
    w2_received = EXCLUDED.w2_received,
    w3_received = EXCLUDED.w3_received,
    w1_pulled = EXCLUDED.w1_pulled,
    w2_pulled = EXCLUDED.w2_pulled,
    w3_pulled = EXCLUDED.w3_pulled,
    unit_price = CASE WHEN public.monthly_inventory.unit_price IS NULL OR public.monthly_inventory.unit_price = 0
      THEN EXCLUDED.unit_price ELSE public.monthly_inventory.unit_price END,
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_week_totals(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_week_totals(uuid, integer, integer) TO service_role;

-- Repair monthly cache dollars from the ledger without changing quantities or
-- opening balances. Rows without ledger movements retain their imported values.
UPDATE public.monthly_inventory mi
SET received_value = x.received_value,
    pulled_value = x.pulled_value,
    ending_value = CASE WHEN GREATEST(0::numeric,
      COALESCE(mi.opening_oh, 0) + COALESCE(mi.w1_received, 0) + COALESCE(mi.w2_received, 0) + COALESCE(mi.w3_received, 0)
      - COALESCE(mi.w1_pulled, 0) - COALESCE(mi.w2_pulled, 0) - COALESCE(mi.w3_pulled, 0)) <= 0 THEN 0
      ELSE round(GREATEST(0::numeric, COALESCE(mi.opening_value, 0) + x.received_value - x.pulled_value), 2) END
FROM (
  SELECT item_id, month, year,
    round(COALESCE(SUM(quantity * GREATEST(0::numeric, unit_price)) FILTER (WHERE txn_type IN ('received','adjustment_increase')), 0), 2) AS received_value,
    round(COALESCE(SUM(quantity * GREATEST(0::numeric, unit_price)) FILTER (WHERE txn_type IN ('issued','adjustment_decrease')), 0), 2) AS pulled_value
  FROM public.inventory_transactions
  GROUP BY item_id, month, year
) x
WHERE mi.item_id = x.item_id AND mi.month = x.month AND mi.year = x.year;

COMMIT;
