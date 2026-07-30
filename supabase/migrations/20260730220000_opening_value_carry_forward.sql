-- Opening value must carry over from the prior month's close.
--
-- THE DEFECT: enforce_monthly_inventory_value_standard (20260730130000) wrote
--
--     NEW.opening_unit_cost := round(v_price, 6);
--     NEW.opening_value     := round(opening_oh * v_price, 2);
--
-- where v_price is the CURRENT month's unit price. That overwrote the carried
-- basis and revalued opening stock at this month's price, so the invariant
-- "opening value of month N == ending value of month N-1" could not hold
-- whenever a price moved between months. The opening_unit_cost column exists
-- precisely to hold the prior close's basis, and was being destroyed on every
-- write. July 2026 opened at 9,775.39 against a June close of 9,505.58 -- a
-- 269.81 break that was pure revaluation (quantities were already continuous:
-- zero rows differ between June ending qty and July opening qty).
--
-- THE FIX, matching backend/inventory_formulas.py:
--     opening_value  = opening_qty  * opening_unit_cost   (carried basis)
--     received_value = received_qty * unit_price          (this month's price)
--     pulled_value   = pulled_qty   * unit_price
--     ending_value   = max(0, opening_value + received_value - pulled_value)
--                      and 0 when ending quantity is 0 -- quantity governs
--
-- Note the ending_value change: the previous form computed ending_qty *
-- unit_price, which only agrees with the formula module when the opening basis
-- happens to equal the current price. Deriving it from the value residual is
-- what makes the carry-forward chain close month over month.
--
-- This deliberately does NOT adopt 20260730120000's transaction-sourced
-- received/pulled logic. That migration is retired; received and pulled stay
-- priced off unit_price.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_monthly_inventory_value_standard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_price      numeric;
  v_open_cost  numeric;
  v_received   numeric;
  v_pulled     numeric;
  v_end_qty    numeric;
BEGIN
  v_price := GREATEST(0::numeric, COALESCE(NULLIF(NEW.unit_price, 0),
    (SELECT NULLIF(unit_price, 0) FROM public.inventory_items WHERE id = NEW.item_id), 0));

  -- Preserve the carried basis when one is present; only fall back to this
  -- month's price for a row that has no prior close to inherit from.
  v_open_cost := GREATEST(0::numeric, COALESCE(NULLIF(NEW.opening_unit_cost, 0), v_price));

  v_received := GREATEST(0::numeric, COALESCE(NEW.w1_received, 0) + COALESCE(NEW.w2_received, 0) + COALESCE(NEW.w3_received, 0));
  v_pulled   := GREATEST(0::numeric, COALESCE(NEW.w1_pulled, 0)   + COALESCE(NEW.w2_pulled, 0)   + COALESCE(NEW.w3_pulled, 0));
  v_end_qty  := GREATEST(0::numeric, COALESCE(NEW.opening_oh, 0) + v_received - v_pulled);

  NEW.unit_price        := round(v_price, 6);
  NEW.opening_unit_cost := round(v_open_cost, 6);
  NEW.opening_value     := round(GREATEST(0::numeric, COALESCE(NEW.opening_oh, 0)) * v_open_cost, 2);
  NEW.received_value    := round(v_received * v_price, 2);
  NEW.pulled_value      := round(v_pulled   * v_price, 2);

  -- Quantity governs: an empty row holds no dollars, whatever the residual says.
  NEW.ending_value := CASE
    WHEN v_end_qty <= 0 THEN 0
    ELSE round(GREATEST(0::numeric,
           NEW.opening_value + NEW.received_value - NEW.pulled_value), 2)
  END;

  RETURN NEW;
END;
$function$;

-- Seed July 2026's carried basis from June's closing unit cost. Rows with no
-- June counterpart keep their own price via the COALESCE above.
-- June (month=5) is published and is NOT written here.
UPDATE public.monthly_inventory jul
SET opening_unit_cost = jun.unit_price
FROM public.monthly_inventory jun
WHERE jun.item_id = jul.item_id
  AND jun.month = 5 AND jun.year = 2026
  AND jul.month = 6 AND jul.year = 2026
  AND COALESCE(jun.unit_price, 0) > 0
  AND jul.opening_oh > 0;

COMMIT;
