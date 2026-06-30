-- Preserve manager-entered weekly invoice product totals.
--
-- monthly_snapshots.wk*_total used to be recomputed as weekly received quantity
-- times unit price inside refresh_monthly_snapshot(). That is not a real invoice
-- total. New standardized workbooks provide invoice totals on Review!B14:B16;
-- dispatch stores those values under data->weekly_invoice_totals and mirrors
-- them into wk1_total..wk5_total.

CREATE OR REPLACE FUNCTION public.refresh_monthly_snapshot(p_month integer, p_year integer)
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
    SELECT 1 FROM month_status
    WHERE month = p_month AND year = p_year AND status = 'published'
  ) THEN
    RETURN;
  END IF;

  SELECT data
  INTO v_existing_data
  FROM monthly_snapshots
  WHERE month = p_month AND year = p_year
  LIMIT 1;

  v_wk1 := CASE
    WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,1}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,1}')::numeric
    ELSE NULL
  END;
  v_wk2 := CASE
    WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,2}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,2}')::numeric
    ELSE NULL
  END;
  v_wk3 := CASE
    WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,3}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,3}')::numeric
    ELSE NULL
  END;
  v_wk4 := CASE
    WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,4}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,4}')::numeric
    ELSE NULL
  END;
  v_wk5 := CASE
    WHEN COALESCE(v_existing_data #>> '{weekly_invoice_totals,weeks,5}', '') ~ '^-?[0-9]+(\.[0-9]+)?$'
    THEN (v_existing_data #>> '{weekly_invoice_totals,weeks,5}')::numeric
    ELSE NULL
  END;

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
       AND COALESCE(ii.par_level, 0) > 0
      THEN mi.item_id
    END),
    COALESCE(SUM(COALESCE(
      mi.opening_value,
      COALESCE(mi.opening_oh, 0) * COALESCE(mi.opening_unit_cost, mi.unit_price, ii.unit_price, 0)
    )), 0)
  INTO v_grand_total, v_item_count, v_reorder_count, v_starting
  FROM monthly_inventory mi
  JOIN inventory_items ii ON ii.id = mi.item_id
  WHERE mi.month = p_month AND mi.year = p_year;

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
    FROM monthly_inventory mi
    JOIN inventory_items ii ON ii.id = mi.item_id
    JOIN inventory_categories ic ON ic.id = ii.category_id
    WHERE mi.month = p_month AND mi.year = p_year
    GROUP BY ic.name
  ) category_rollup;

  INSERT INTO monthly_snapshots (
    month, year, grand_total, item_count, reorder_count, category_totals,
    starting_total, wk1_total, wk2_total, wk3_total, wk4_total, wk5_total, data, saved_at
  )
  VALUES (
    p_month, p_year, ROUND(v_grand_total, 2), v_item_count, v_reorder_count, v_category_totals,
    ROUND(v_starting, 2), ROUND(v_wk1, 2), ROUND(v_wk2, 2), ROUND(v_wk3, 2),
    ROUND(v_wk4, 2), ROUND(v_wk5, 2), v_existing_data, now()
  )
  ON CONFLICT (month, year) DO UPDATE SET
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

REVOKE ALL ON FUNCTION public.refresh_monthly_snapshot(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_monthly_snapshot(integer, integer) TO service_role;
