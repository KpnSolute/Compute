-- FIX (006): the previous guard allowed a write to ANY month that merely had a
-- month_status row — which a published month always has — so the publish lock
-- never actually locked. Corrected logic: a registered month is writable ONLY
-- while its status = 'open'; 'locked'/'published' reject. Unregistered months
-- fall back to the open/current month as before. No service_role bypass: the
-- backend uses the service key, so a bypass would re-open the same hole.
CREATE OR REPLACE FUNCTION public.guard_closed_month_writes()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_status    text;
  open_month  integer;
  open_year   integer;
BEGIN
  SELECT status INTO v_status
  FROM public.month_status
  WHERE month = NEW.month AND year = NEW.year
  LIMIT 1;

  IF v_status IS NOT NULL THEN
    IF v_status = 'open' THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Cannot write to %/% — period is % (only open periods are writable). Reopen the period to edit it.',
      NEW.month, NEW.year, v_status USING ERRCODE = 'P0001';
  END IF;

  -- No month_status row yet: allow only the open month, else the real-world
  -- current month (0-indexed) so a first-ever save in a new period works.
  SELECT month, year INTO open_month, open_year
  FROM public.month_status WHERE status = 'open' LIMIT 1;

  IF open_month IS NULL THEN
    open_month := EXTRACT(MONTH FROM now())::integer - 1;
    open_year  := EXTRACT(YEAR  FROM now())::integer;
  END IF;

  IF (NEW.month = open_month AND NEW.year = open_year) THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Cannot write to %/% — only the open month (%/%) is writable.',
    NEW.month, NEW.year, open_month, open_year USING ERRCODE = 'P0001';
END;
$function$;;
