CREATE OR REPLACE FUNCTION public.guard_closed_month_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  open_month integer;
  open_year  integer;
BEGIN
  SELECT month, year INTO open_month, open_year
  FROM public.month_status
  WHERE status = 'open'
  LIMIT 1;

  -- If no open month row exists, fall back to current calendar month
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

DROP TRIGGER IF EXISTS trg_guard_closed_month ON public.monthly_inventory;
CREATE TRIGGER trg_guard_closed_month
  BEFORE INSERT OR UPDATE ON public.monthly_inventory
  FOR EACH ROW EXECUTE FUNCTION public.guard_closed_month_writes();;
