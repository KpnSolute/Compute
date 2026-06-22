-- Allow MJCC's initial historical backfill window while preserving published-period locks.
--
-- After the inventory reset, month_status can be empty while Data Entry still
-- allows imports from the configured floor (April 2026) through the current
-- operational month. The previous guard treated unregistered months as writable
-- only when they exactly matched the single open/current month, so April backfill
-- commits failed even though the API accepted the upload.

CREATE OR REPLACE FUNCTION public.guard_closed_month_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status      text;
  open_month    integer;
  open_year     integer;
  floor_month   integer := 3;
  floor_year    integer := 2026;
  floor_setting jsonb;
BEGIN
  SELECT status INTO v_status
  FROM public.month_status
  WHERE month = NEW.month AND year = NEW.year
  LIMIT 1;

  IF v_status IS NOT NULL THEN
    IF v_status = 'open' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot write to %/% - period is % (only open periods are writable). Reopen the period to edit it.',
      NEW.month, NEW.year, v_status USING ERRCODE = 'P0001';
  END IF;

  SELECT setting_value INTO floor_setting
  FROM public.app_settings
  WHERE setting_key = 'data_entry'
  LIMIT 1;

  IF floor_setting IS NOT NULL THEN
    floor_month := COALESCE((floor_setting->>'floor_month')::integer, floor_month);
    floor_year := COALESCE((floor_setting->>'floor_year')::integer, floor_year);
  END IF;

  SELECT month, year INTO open_month, open_year
  FROM public.month_status
  WHERE status = 'open'
  ORDER BY year DESC, month DESC
  LIMIT 1;

  IF open_month IS NULL THEN
    open_month := EXTRACT(MONTH FROM now())::integer - 1;
    open_year  := EXTRACT(YEAR FROM now())::integer;
  END IF;

  IF (NEW.year * 12 + NEW.month) < (floor_year * 12 + floor_month) THEN
    RAISE EXCEPTION 'Cannot write to %/% - data entry backfill starts at %/%.' ,
      NEW.month, NEW.year, floor_month, floor_year USING ERRCODE = 'P0001';
  END IF;

  IF (NEW.year * 12 + NEW.month) <= (open_year * 12 + open_month) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Cannot write to %/% - only periods from %/% through the open month (%/%) are writable.',
    NEW.month, NEW.year, floor_month, floor_year, open_month, open_year USING ERRCODE = 'P0001';
END;
$function$;
