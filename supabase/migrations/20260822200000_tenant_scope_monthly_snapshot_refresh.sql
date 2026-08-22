-- The inventory statement trigger still called the legacy, unscoped snapshot
-- refresh helper.  monthly_snapshots is tenant-scoped, so carry tenant_id from
-- the transition tables all the way through the aggregate and upsert.
DROP FUNCTION IF EXISTS public.refresh_monthly_snapshot(integer, integer);

CREATE OR REPLACE FUNCTION public.refresh_monthly_snapshot(
  p_tenant_id uuid,
  p_month integer,
  p_year integer
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_grand_total numeric := 0;
  v_item_count integer := 0;
  v_reorder_count integer := 0;
  v_starting numeric := 0;
  v_category_totals jsonb := '{}';
  v_existing_data jsonb := NULL;
  v_wk1 numeric := NULL;
  v_wk2 numeric := NULL;
  v_wk3 numeric := NULL;
  v_wk4 numeric := NULL;
  v_wk5 numeric := NULL;
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.month_status
    WHERE tenant_id = p_tenant_id
      AND month = p_month
      AND year = p_year
      AND status = 'published'
  ) THEN
    RETURN;
  END IF;

  SELECT data INTO v_existing_data
  FROM public.monthly_snapshots
  WHERE tenant_id = p_tenant_id AND month = p_month AND year = p_year
  LIMIT 1;

  v_wk1 := CASE WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,1}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,1}')::numeric END;
  v_wk2 := CASE WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,2}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,2}')::numeric END;
  v_wk3 := CASE WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,3}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,3}')::numeric END;
  v_wk4 := CASE WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,4}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,4}')::numeric END;
  v_wk5 := CASE WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,5}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,5}')::numeric END;

  SELECT
    COALESCE(SUM(COALESCE(
      mi.ending_value,
      COALESCE(mi.opening_value, COALESCE(mi.opening_oh, 0) * COALESCE(mi.opening_unit_cost, mi.unit_price, ii.unit_price, 0))
        + COALESCE(mi.received_value, (COALESCE(mi.w1_received, 0) + COALESCE(mi.w2_received, 0) + COALESCE(mi.w3_received, 0)) * COALESCE(mi.unit_price, ii.unit_price, 0))
        - COALESCE(mi.pulled_value, (COALESCE(mi.w1_pulled, 0) + COALESCE(mi.w2_pulled, 0) + COALESCE(mi.w3_pulled, 0)) * COALESCE(mi.unit_price, ii.unit_price, 0))
    )), 0),
    COUNT(DISTINCT mi.item_id),
    COUNT(DISTINCT CASE
      WHEN (COALESCE(mi.opening_oh, 0) + COALESCE(mi.w1_received, 0) + COALESCE(mi.w2_received, 0) + COALESCE(mi.w3_received, 0)
            - COALESCE(mi.w1_pulled, 0) - COALESCE(mi.w2_pulled, 0) - COALESCE(mi.w3_pulled, 0)) < COALESCE(ii.par_level, 0)
       AND COALESCE(ii.par_level, 0) > 0 THEN mi.item_id END),
    COALESCE(SUM(COALESCE(
      mi.opening_value,
      COALESCE(mi.opening_oh, 0) * COALESCE(mi.opening_unit_cost, mi.unit_price, ii.unit_price, 0)
    )), 0)
  INTO v_grand_total, v_item_count, v_reorder_count, v_starting
  FROM public.monthly_inventory mi
  JOIN public.inventory_items ii ON ii.id = mi.item_id AND ii.tenant_id = mi.tenant_id
  WHERE mi.tenant_id = p_tenant_id AND mi.month = p_month AND mi.year = p_year;

  SELECT COALESCE(jsonb_object_agg(name, cat_total), '{}')
  INTO v_category_totals
  FROM (
    SELECT ic.name,
      SUM(COALESCE(
        mi.ending_value,
        COALESCE(mi.opening_value, COALESCE(mi.opening_oh, 0) * COALESCE(mi.opening_unit_cost, mi.unit_price, ii.unit_price, 0))
          + COALESCE(mi.received_value, (COALESCE(mi.w1_received, 0) + COALESCE(mi.w2_received, 0) + COALESCE(mi.w3_received, 0)) * COALESCE(mi.unit_price, ii.unit_price, 0))
          - COALESCE(mi.pulled_value, (COALESCE(mi.w1_pulled, 0) + COALESCE(mi.w2_pulled, 0) + COALESCE(mi.w3_pulled, 0)) * COALESCE(mi.unit_price, ii.unit_price, 0))
      )) AS cat_total
    FROM public.monthly_inventory mi
    JOIN public.inventory_items ii ON ii.id = mi.item_id AND ii.tenant_id = mi.tenant_id
    JOIN public.inventory_categories ic ON ic.id = ii.category_id AND ic.tenant_id = mi.tenant_id
    WHERE mi.tenant_id = p_tenant_id AND mi.month = p_month AND mi.year = p_year
    GROUP BY ic.name
  ) category_rollup;

  INSERT INTO public.monthly_snapshots (
    tenant_id, month, year, grand_total, item_count, reorder_count, category_totals,
    starting_total, wk1_total, wk2_total, wk3_total, wk4_total, wk5_total, data, saved_at
  )
  VALUES (
    p_tenant_id, p_month, p_year, ROUND(v_grand_total, 2), v_item_count, v_reorder_count, v_category_totals,
    ROUND(v_starting, 2), ROUND(v_wk1, 2), ROUND(v_wk2, 2), ROUND(v_wk3, 2),
    ROUND(v_wk4, 2), ROUND(v_wk5, 2), v_existing_data, now()
  )
  ON CONFLICT (tenant_id, month, year) DO UPDATE SET
    grand_total = EXCLUDED.grand_total,
    item_count = EXCLUDED.item_count,
    reorder_count = EXCLUDED.reorder_count,
    category_totals = EXCLUDED.category_totals,
    starting_total = EXCLUDED.starting_total,
    wk1_total = EXCLUDED.wk1_total,
    wk2_total = EXCLUDED.wk2_total,
    wk3_total = EXCLUDED.wk3_total,
    wk4_total = EXCLUDED.wk4_total,
    wk5_total = EXCLUDED.wk5_total,
    saved_at = now();
END;
$function$;

CREATE OR REPLACE FUNCTION public.trg_refresh_snapshot_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE r record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    FOR r IN SELECT DISTINCT tenant_id, month, year FROM new_rows
      WHERE tenant_id IS NOT NULL AND month IS NOT NULL AND year IS NOT NULL LOOP
      PERFORM public.refresh_monthly_snapshot(r.tenant_id, r.month, r.year);
    END LOOP;
  ELSIF TG_OP = 'DELETE' THEN
    FOR r IN SELECT DISTINCT tenant_id, month, year FROM old_rows
      WHERE tenant_id IS NOT NULL AND month IS NOT NULL AND year IS NOT NULL LOOP
      PERFORM public.refresh_monthly_snapshot(r.tenant_id, r.month, r.year);
    END LOOP;
  ELSE
    FOR r IN
      SELECT DISTINCT tenant_id, month, year FROM (
        SELECT tenant_id, month, year FROM new_rows
        UNION
        SELECT tenant_id, month, year FROM old_rows
      ) z WHERE tenant_id IS NOT NULL AND month IS NOT NULL AND year IS NOT NULL
    LOOP
      PERFORM public.refresh_monthly_snapshot(r.tenant_id, r.month, r.year);
    END LOOP;
  END IF;
  RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION public.refresh_monthly_snapshot(uuid, integer, integer)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_monthly_snapshot(uuid, integer, integer)
  TO service_role;
REVOKE ALL ON FUNCTION public.trg_refresh_snapshot_stmt() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_refresh_snapshot_stmt() TO service_role;
