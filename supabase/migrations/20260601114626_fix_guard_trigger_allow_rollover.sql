
-- Fix: guard trigger must allow writes to the NEXT month during rollover
-- Strategy: open the next month in month_status BEFORE inserting rows,
-- so the trigger sees it as valid. The RPC already does this but the
-- INSERT into month_status happens AFTER the inventory loop.
-- Fix: add a session variable bypass that the RPC sets before writing.

CREATE OR REPLACE FUNCTION public.guard_closed_month_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  open_month  integer;
  open_year   integer;
  bypass      text;
BEGIN
  -- RPCs can set this session variable to bypass the guard
  -- e.g. SET LOCAL mjcc.skip_month_guard = 'rollover'
  bypass := current_setting('mjcc.skip_month_guard', true);
  IF bypass IS NOT NULL AND bypass != '' THEN
    RETURN NEW;
  END IF;

  SELECT month, year INTO open_month, open_year
  FROM public.month_status
  WHERE status = 'open'
  LIMIT 1;

  IF open_month IS NULL THEN
    open_month := EXTRACT(MONTH FROM now())::integer - 1;
    open_year  := EXTRACT(YEAR  FROM now())::integer;
  END IF;

  IF (NEW.month <> open_month OR NEW.year <> open_year) THEN
    RAISE EXCEPTION 'Cannot write to month %/% — only the open month (%/%) is writable.',
      NEW.month, NEW.year, open_month, open_year;
  END IF;

  RETURN NEW;
END;
$$;
;
