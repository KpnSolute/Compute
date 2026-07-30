-- 048_formula_only_inventory_values.sql
-- Make stored financial columns formula-only. Ledger movement values remain the
-- only exception because they are sourced from invoice/pull transactions.

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

  NEW.opening_unit_cost := round(v_open_cost, 6);
  NEW.opening_value := CASE WHEN COALESCE(NEW.opening_oh, 0) <= 0 THEN 0
    ELSE round(GREATEST(0::numeric, NEW.opening_oh) * v_open_cost, 2) END;
  NEW.received_value := CASE WHEN COALESCE(NEW.w1_received, 0)
    + COALESCE(NEW.w2_received, 0) + COALESCE(NEW.w3_received, 0) <= 0 THEN 0
    WHEN v_has_received THEN round(GREATEST(0::numeric, v_received), 2)
    ELSE round(GREATEST(0::numeric,
      (COALESCE(NEW.w1_received, 0) + COALESCE(NEW.w2_received, 0)
       + COALESCE(NEW.w3_received, 0)) * v_price), 2) END;
  NEW.pulled_value := CASE WHEN COALESCE(NEW.w1_pulled, 0)
    + COALESCE(NEW.w2_pulled, 0) + COALESCE(NEW.w3_pulled, 0) <= 0 THEN 0
    WHEN v_has_pulled THEN round(GREATEST(0::numeric, v_pulled), 2)
    ELSE round(GREATEST(0::numeric,
      (COALESCE(NEW.w1_pulled, 0) + COALESCE(NEW.w2_pulled, 0)
       + COALESCE(NEW.w3_pulled, 0)) * v_price), 2) END;
  v_end_qty := GREATEST(0::numeric,
    COALESCE(NEW.opening_oh, 0) + COALESCE(NEW.w1_received, 0)
    + COALESCE(NEW.w2_received, 0) + COALESCE(NEW.w3_received, 0)
    - COALESCE(NEW.w1_pulled, 0) - COALESCE(NEW.w2_pulled, 0)
    - COALESCE(NEW.w3_pulled, 0));
  NEW.ending_value := CASE WHEN v_end_qty <= 0 THEN 0 ELSE round(GREATEST(0::numeric,
    NEW.opening_value + NEW.received_value - NEW.pulled_value), 2) END;
  RETURN NEW;
END;
$function$;

COMMIT;
