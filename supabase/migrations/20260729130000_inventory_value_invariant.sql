-- Keep stored inventory value consistent with physical ending quantity.
-- This is intentionally idempotent and safe for existing rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.enforce_monthly_inventory_value_invariant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_ending_qty numeric;
BEGIN
  v_ending_qty := GREATEST(
    0::numeric,
    COALESCE(NEW.opening_oh, 0)
      + COALESCE(NEW.w1_received, 0)
      + COALESCE(NEW.w2_received, 0)
      + COALESCE(NEW.w3_received, 0)
      - COALESCE(NEW.w1_pulled, 0)
      - COALESCE(NEW.w2_pulled, 0)
      - COALESCE(NEW.w3_pulled, 0)
  );

  IF v_ending_qty <= 0 THEN
    NEW.ending_value := 0;
  ELSIF NEW.ending_value IS NOT NULL THEN
    NEW.ending_value := GREATEST(0::numeric, NEW.ending_value);
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS monthly_inventory_value_invariant ON public.monthly_inventory;
CREATE TRIGGER monthly_inventory_value_invariant
BEFORE INSERT OR UPDATE OF opening_oh, w1_received, w2_received, w3_received,
  w1_pulled, w2_pulled, w3_pulled, opening_value, received_value,
  pulled_value, ending_value
ON public.monthly_inventory
FOR EACH ROW
EXECUTE FUNCTION public.enforce_monthly_inventory_value_invariant();

-- Repair stranded/negative stored values without changing physical quantities.
UPDATE public.monthly_inventory
SET ending_value = 0
WHERE (
  COALESCE(opening_oh, 0)
    + COALESCE(w1_received, 0)
    + COALESCE(w2_received, 0)
    + COALESCE(w3_received, 0)
    - COALESCE(w1_pulled, 0)
    - COALESCE(w2_pulled, 0)
    - COALESCE(w3_pulled, 0)
) <= 0
AND COALESCE(ending_value, 0) <> 0;

UPDATE public.monthly_inventory
SET ending_value = 0
WHERE ending_value < 0;

ALTER TABLE public.monthly_inventory
  DROP CONSTRAINT IF EXISTS monthly_inventory_ending_value_non_negative;
ALTER TABLE public.monthly_inventory
  ADD CONSTRAINT monthly_inventory_ending_value_non_negative
  CHECK (ending_value IS NULL OR ending_value >= 0);

COMMIT;
