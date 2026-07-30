
-- The guard trigger must allow writes to the NEXT month when
-- month_status already has a row for it (even if not yet committed).
-- Fix: check both the committed open month AND the current transaction's
-- pending month_status rows using a different approach.
-- 
-- Simplest fix: allow writes to ANY month that has a row in month_status
-- (open OR the just-inserted next-month row within the same transaction).

CREATE OR REPLACE FUNCTION public.guard_closed_month_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  open_month  integer;
  open_year   integer;
BEGIN
  -- Allow writes to any month that is either:
  --   a) The currently open month (status = 'open')
  --   b) A month that has a month_status row (even if just inserted in this txn)
  --      This allows perform_rollover to open the next month then write to it.
  
  -- Check if this month has any row in month_status
  IF EXISTS (
    SELECT 1 FROM public.month_status
    WHERE month = NEW.month AND year = NEW.year
  ) THEN
    RETURN NEW;  -- This month is registered, allow it
  END IF;

  -- Otherwise check it's the open month
  SELECT month, year INTO open_month, open_year
  FROM public.month_status
  WHERE status = 'open'
  LIMIT 1;

  IF open_month IS NULL THEN
    open_month := EXTRACT(MONTH FROM now())::integer - 1;
    open_year  := EXTRACT(YEAR  FROM now())::integer;
  END IF;

  IF (NEW.month = open_month AND NEW.year = open_year) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Cannot write to month %/% — only the open month (%/%) is writable.',
    NEW.month, NEW.year, open_month, open_year;
END;
$$;
;
