-- Migration 010 — make the snapshot refresh statement-level instead of per-row.
-- Before: trg_monthly_inventory_snapshot fired FOR EACH ROW, so a 300-item batch
-- recomputed the whole period snapshot 300x. Now it fires once per statement and
-- refreshes each affected (month,year) exactly once via transition tables.

CREATE OR REPLACE FUNCTION public.trg_refresh_snapshot_stmt()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp'
AS $function$
DECLARE r record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR r IN SELECT DISTINCT month, year FROM new_rows WHERE month IS NOT NULL AND year IS NOT NULL LOOP
      PERFORM refresh_monthly_snapshot(r.month, r.year);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR r IN SELECT DISTINCT month, year FROM old_rows WHERE month IS NOT NULL AND year IS NOT NULL LOOP
      PERFORM refresh_monthly_snapshot(r.month, r.year);
    END LOOP;
  ELSE  -- UPDATE: rows may move between periods, refresh both sides
    FOR r IN
      SELECT DISTINCT month, year FROM (
        SELECT month, year FROM new_rows
        UNION
        SELECT month, year FROM old_rows
      ) z WHERE month IS NOT NULL AND year IS NOT NULL
    LOOP
      PERFORM refresh_monthly_snapshot(r.month, r.year);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_monthly_inventory_snapshot ON public.monthly_inventory;

CREATE TRIGGER trg_mi_snapshot_ins AFTER INSERT ON public.monthly_inventory
  REFERENCING NEW TABLE AS new_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_refresh_snapshot_stmt();
CREATE TRIGGER trg_mi_snapshot_upd AFTER UPDATE ON public.monthly_inventory
  REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_refresh_snapshot_stmt();
CREATE TRIGGER trg_mi_snapshot_del AFTER DELETE ON public.monthly_inventory
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION trg_refresh_snapshot_stmt();;
