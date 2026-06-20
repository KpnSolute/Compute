-- Migration 006 — fix the closed-month write guard.
--
-- BUG: guard_closed_month_writes() allowed a write to ANY month that merely had
-- a month_status row. A published month always retains its row, so the publish
-- lock never actually locked — closed periods stayed fully writable, and edits
-- kept landing in closed months (e.g. May 2026) without propagating forward.
--
-- FIX: a registered month is writable ONLY while status = 'open'; 'locked' and
-- 'published' reject. Unregistered months fall back to the open/current month.
-- No service_role bypass on purpose: the backend connects with the service key,
-- so a bypass would re-open the same hole. To edit a closed period an admin must
-- explicitly reopen it (set month_status.status = 'open'), edit, then re-close.
--
-- perform_rollover still works: it opens the next month (STEP 1) before writing
-- to it (STEP 3), so the guard sees status='open' and allows the carry-forward.

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
$function$;
