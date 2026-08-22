-- Remove the legacy overload that omits tenant_id.  The application calls
-- this RPC through TenantScopedClient, which supplies p_tenant_id in legacy
-- mode as well as in shadow/enforced modes.  Leaving the three-argument
-- overload callable allows a stale deployment to reach an unscoped
-- ON CONFLICT target and fail against the tenant-scoped unique index.
DROP FUNCTION IF EXISTS public.recompute_week_totals(uuid, integer, integer);

CREATE OR REPLACE FUNCTION public.recompute_week_totals(
  p_tenant_id uuid,
  p_item_id uuid,
  p_month integer,
  p_year integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.inventory_items
    WHERE tenant_id = p_tenant_id AND id = p_item_id
  ) THEN
    RAISE EXCEPTION 'Inventory item is not part of the active workspace';
  END IF;

  INSERT INTO public.monthly_inventory (
    tenant_id,
    item_id,
    month,
    year,
    opening_oh,
    unit_price,
    w1_received,
    w2_received,
    w3_received,
    w1_pulled,
    w2_pulled,
    w3_pulled
  )
  SELECT
    p_tenant_id,
    p_item_id,
    p_month,
    p_year,
    COALESCE((
      SELECT opening_oh
      FROM public.monthly_inventory
      WHERE tenant_id = p_tenant_id
        AND item_id = p_item_id
        AND month = p_month
        AND year = p_year
    ), 0),
    COALESCE(NULLIF((
      SELECT unit_price
      FROM public.inventory_items
      WHERE tenant_id = p_tenant_id AND id = p_item_id
    ), 0), 0),
    COALESCE(SUM(quantity) FILTER (
      WHERE week_number = 1
        AND txn_type IN ('received', 'adjustment_increase')
    ), 0),
    COALESCE(SUM(quantity) FILTER (
      WHERE week_number = 2
        AND txn_type IN ('received', 'adjustment_increase')
    ), 0),
    COALESCE(SUM(quantity) FILTER (
      WHERE week_number = 3
        AND txn_type IN ('received', 'adjustment_increase')
    ), 0),
    COALESCE(SUM(quantity) FILTER (
      WHERE week_number = 1
        AND txn_type IN ('issued', 'adjustment_decrease')
    ), 0),
    COALESCE(SUM(quantity) FILTER (
      WHERE week_number = 2
        AND txn_type IN ('issued', 'adjustment_decrease')
    ), 0),
    COALESCE(SUM(quantity) FILTER (
      WHERE week_number = 3
        AND txn_type IN ('issued', 'adjustment_decrease')
    ), 0)
  FROM public.inventory_transactions
  WHERE tenant_id = p_tenant_id
    AND item_id = p_item_id
    AND month = p_month
    AND year = p_year
  ON CONFLICT (tenant_id, item_id, month, year) DO UPDATE SET
    w1_received = EXCLUDED.w1_received,
    w2_received = EXCLUDED.w2_received,
    w3_received = EXCLUDED.w3_received,
    w1_pulled = EXCLUDED.w1_pulled,
    w2_pulled = EXCLUDED.w2_pulled,
    w3_pulled = EXCLUDED.w3_pulled,
    opening_oh = public.monthly_inventory.opening_oh,
    unit_price = CASE
      WHEN public.monthly_inventory.unit_price IS NULL
        OR public.monthly_inventory.unit_price = 0
      THEN EXCLUDED.unit_price
      ELSE public.monthly_inventory.unit_price
    END,
    updated_at = now();
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_week_totals(uuid, uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_week_totals(uuid, uuid, integer, integer)
  TO service_role;
