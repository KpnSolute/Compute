-- Keep the ledger reconciliation helper aligned with the tenant-scoped
-- recompute_week_totals RPC.  The former two-argument overload called the
-- removed unscoped recompute overload and could not be safely retained.
DROP FUNCTION IF EXISTS public.reconcile_period_from_ledger(integer, integer);

CREATE OR REPLACE FUNCTION public.reconcile_period_from_ledger(
  p_tenant_id uuid,
  p_month integer,
  p_year integer
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  r record;
  n integer := 0;
BEGIN
  FOR r IN
    SELECT DISTINCT item_id
    FROM public.inventory_transactions
    WHERE tenant_id = p_tenant_id
      AND month = p_month
      AND year = p_year
  LOOP
    PERFORM public.recompute_week_totals(p_tenant_id, r.item_id, p_month, p_year);
    n := n + 1;
  END LOOP;
  RETURN n;
END;
$function$;

REVOKE ALL ON FUNCTION public.reconcile_period_from_ledger(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_period_from_ledger(uuid, integer, integer)
  TO service_role;
