-- Enforce monthly unit-price valuation without bypassing published-period guards.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_monthly_inventory_value_standard()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp' AS $function$
DECLARE
  v_price numeric;
  v_received numeric;
  v_pulled numeric;
  v_ending numeric;
BEGIN
  v_price := GREATEST(0::numeric, COALESCE(NULLIF(NEW.unit_price, 0),
    (SELECT NULLIF(unit_price, 0) FROM public.inventory_items WHERE id = NEW.item_id), 0));
  v_received := GREATEST(0::numeric, COALESCE(NEW.w1_received, 0) + COALESCE(NEW.w2_received, 0) + COALESCE(NEW.w3_received, 0));
  v_pulled := GREATEST(0::numeric, COALESCE(NEW.w1_pulled, 0) + COALESCE(NEW.w2_pulled, 0) + COALESCE(NEW.w3_pulled, 0));
  v_ending := GREATEST(0::numeric, COALESCE(NEW.opening_oh, 0) + v_received - v_pulled);
  NEW.unit_price := round(v_price, 6);
  NEW.opening_unit_cost := round(v_price, 6);
  NEW.opening_value := round(GREATEST(0::numeric, COALESCE(NEW.opening_oh, 0)) * v_price, 2);
  NEW.received_value := round(v_received * v_price, 2);
  NEW.pulled_value := round(v_pulled * v_price, 2);
  NEW.ending_value := round(v_ending * v_price, 2);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS monthly_inventory_value_standard ON public.monthly_inventory;
CREATE TRIGGER monthly_inventory_value_standard
BEFORE INSERT OR UPDATE OF unit_price, opening_oh, w1_received, w2_received, w3_received,
  w1_pulled, w2_pulled, w3_pulled, opening_unit_cost, opening_value,
  received_value, pulled_value, ending_value
ON public.monthly_inventory
FOR EACH ROW EXECUTE FUNCTION public.enforce_monthly_inventory_value_standard();

COMMIT;
