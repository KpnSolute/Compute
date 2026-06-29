-- Carry inventory financial values separately from movement quantities.
--
-- The monthly template has two different valuation bases:
--   1) opening stock value carried from the prior closing inventory
--   2) current-month receipt / pull / ending value from invoice flow
--
-- A single unit_price column cannot represent both when prices change between
-- months. These nullable value fields preserve workbook financial controls while
-- retaining quantity columns as the operational source of truth.

ALTER TABLE public.monthly_inventory
  ADD COLUMN IF NOT EXISTS opening_unit_cost numeric,
  ADD COLUMN IF NOT EXISTS opening_value numeric,
  ADD COLUMN IF NOT EXISTS received_value numeric,
  ADD COLUMN IF NOT EXISTS pulled_value numeric,
  ADD COLUMN IF NOT EXISTS ending_value numeric;

COMMENT ON COLUMN public.monthly_inventory.opening_unit_cost IS
  'Prior closing valuation basis for opening stock; may differ from current month unit_price.';
COMMENT ON COLUMN public.monthly_inventory.opening_value IS
  'Opening stock dollar value carried from the prior month closing value.';
COMMENT ON COLUMN public.monthly_inventory.received_value IS
  'Current period receipt dollar value from invoices or workbook financial control.';
COMMENT ON COLUMN public.monthly_inventory.pulled_value IS
  'Current period pull/issue dollar value from pull sheets or workbook financial control.';
COMMENT ON COLUMN public.monthly_inventory.ending_value IS
  'Ending inventory dollar value. Prefer workbook/reconciled value over quantity * unit_price.';

UPDATE public.monthly_inventory
SET
  opening_unit_cost = COALESCE(opening_unit_cost, NULLIF(unit_price, 0)),
  opening_value = COALESCE(opening_value, opening_oh * COALESCE(unit_price, 0)),
  received_value = COALESCE(
    received_value,
    (COALESCE(w1_received, 0) + COALESCE(w2_received, 0) + COALESCE(w3_received, 0)) * COALESCE(unit_price, 0)
  ),
  pulled_value = COALESCE(
    pulled_value,
    (COALESCE(w1_pulled, 0) + COALESCE(w2_pulled, 0) + COALESCE(w3_pulled, 0)) * COALESCE(unit_price, 0)
  ),
  ending_value = COALESCE(
    ending_value,
    (
      COALESCE(opening_oh, 0)
      + COALESCE(w1_received, 0) + COALESCE(w2_received, 0) + COALESCE(w3_received, 0)
      - COALESCE(w1_pulled, 0) - COALESCE(w2_pulled, 0) - COALESCE(w3_pulled, 0)
    ) * COALESCE(unit_price, 0)
  )
WHERE opening_unit_cost IS NULL
   OR opening_value IS NULL
   OR received_value IS NULL
   OR pulled_value IS NULL
   OR ending_value IS NULL;

CREATE OR REPLACE FUNCTION public.refresh_monthly_snapshot(p_month integer, p_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_grand_total numeric := 0;
  v_item_count integer := 0;
  v_reorder_count integer := 0;
  v_starting numeric := 0;
  v_category_totals jsonb := '{}';
  v_wk1 numeric := 0;
  v_wk2 numeric := 0;
  v_wk3 numeric := 0;
BEGIN
  IF EXISTS (
    SELECT 1 FROM month_status
    WHERE month = p_month AND year = p_year AND status = 'published'
  ) THEN
    RETURN;
  END IF;

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
    )), 0),
    COALESCE(SUM(COALESCE(mi.w1_received, 0) * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
    COALESCE(SUM(COALESCE(mi.w2_received, 0) * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
    COALESCE(SUM(COALESCE(mi.w3_received, 0) * COALESCE(mi.unit_price, ii.unit_price, 0)), 0)
  INTO v_grand_total, v_item_count, v_reorder_count, v_starting, v_wk1, v_wk2, v_wk3
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
    starting_total, wk1_total, wk2_total, wk3_total, wk4_total, wk5_total, saved_at
  )
  VALUES (
    p_month, p_year, ROUND(v_grand_total, 2), v_item_count, v_reorder_count, v_category_totals,
    ROUND(v_starting, 2), ROUND(v_wk1, 2), ROUND(v_wk2, 2), ROUND(v_wk3, 2), 0, 0, now()
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
    wk4_total = 0,
    wk5_total = 0,
    saved_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.refresh_monthly_snapshot(integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_monthly_snapshot(integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.recompute_week_totals(p_item_id uuid, p_month integer, p_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_received_value numeric := 0;
  v_pulled_value numeric := 0;
BEGIN
  SELECT
    COALESCE(SUM(quantity * unit_price) FILTER (WHERE txn_type IN ('received','adjustment_increase')), 0),
    COALESCE(SUM(quantity * unit_price) FILTER (WHERE txn_type IN ('issued','adjustment_decrease')), 0)
  INTO v_received_value, v_pulled_value
  FROM public.inventory_transactions
  WHERE item_id = p_item_id AND month = p_month AND year = p_year;

  INSERT INTO public.monthly_inventory (
    item_id, month, year, unit_price,
    w1_received, w2_received, w3_received,
    w1_pulled, w2_pulled, w3_pulled,
    received_value, pulled_value, opening_oh
  )
  SELECT p_item_id, p_month, p_year,
    COALESCE((SELECT NULLIF(unit_price, 0) FROM public.inventory_items WHERE id = p_item_id), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 1 AND txn_type IN ('received','adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 2 AND txn_type IN ('received','adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 3 AND txn_type IN ('received','adjustment_increase')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 1 AND txn_type IN ('issued','adjustment_decrease')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 2 AND txn_type IN ('issued','adjustment_decrease')), 0),
    COALESCE(SUM(quantity) FILTER (WHERE week_number = 3 AND txn_type IN ('issued','adjustment_decrease')), 0),
    v_received_value,
    v_pulled_value,
    0
  FROM public.inventory_transactions
  WHERE item_id = p_item_id AND month = p_month AND year = p_year
  ON CONFLICT (item_id, month, year) DO UPDATE SET
    w1_received = EXCLUDED.w1_received,
    w2_received = EXCLUDED.w2_received,
    w3_received = EXCLUDED.w3_received,
    w1_pulled = EXCLUDED.w1_pulled,
    w2_pulled = EXCLUDED.w2_pulled,
    w3_pulled = EXCLUDED.w3_pulled,
    received_value = EXCLUDED.received_value,
    pulled_value = EXCLUDED.pulled_value,
    ending_value = COALESCE(
      public.monthly_inventory.opening_value,
      COALESCE(public.monthly_inventory.opening_oh, 0) * COALESCE(public.monthly_inventory.opening_unit_cost, public.monthly_inventory.unit_price, EXCLUDED.unit_price, 0)
    ) + EXCLUDED.received_value - EXCLUDED.pulled_value,
    unit_price = CASE
      WHEN public.monthly_inventory.unit_price IS NULL OR public.monthly_inventory.unit_price = 0
      THEN EXCLUDED.unit_price
      ELSE public.monthly_inventory.unit_price
    END,
    updated_at = now();
END;
$$;

REVOKE ALL ON FUNCTION public.recompute_week_totals(uuid, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_week_totals(uuid, integer, integer) TO service_role;

CREATE OR REPLACE FUNCTION public.perform_rollover(
  p_from_month integer,
  p_from_year integer,
  p_rolled_by uuid,
  p_message text DEFAULT NULL::text
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
  v_next_month integer;
  v_next_year integer;
  v_commit_id uuid;
  v_start_total numeric := 0;
  v_item record;
  v_ending_qty numeric;
  v_ending_value numeric;
  v_opening_unit_cost numeric;
  v_msg text;
BEGIN
  IF p_from_month = 11 THEN
    v_next_month := 0;
    v_next_year := p_from_year + 1;
  ELSE
    v_next_month := p_from_month + 1;
    v_next_year := p_from_year;
  END IF;

  v_msg := COALESCE(p_message, 'rollover: ' || p_from_month || '/' || p_from_year || ' -> ' || v_next_month || '/' || v_next_year);

  INSERT INTO month_status (month, year, status, opened_at)
  VALUES (v_next_month, v_next_year, 'open', now())
  ON CONFLICT (month, year) DO UPDATE SET status = 'open', opened_at = now();

  INSERT INTO commits (author_id, message, branch, status, merged_by, merged_at, month, year, source)
  VALUES (p_rolled_by, v_msg, 'main', 'merged', p_rolled_by, now(), p_from_month, p_from_year, 'rollover')
  RETURNING commit_id INTO v_commit_id;

  FOR v_item IN
    SELECT mi.item_id,
      COALESCE(mi.unit_price, ii.unit_price, 0) AS unit_price,
      GREATEST(0,
        COALESCE(mi.opening_oh, 0)
        + COALESCE(mi.w1_received, 0) + COALESCE(mi.w2_received, 0) + COALESCE(mi.w3_received, 0)
        - COALESCE(mi.w1_pulled, 0) - COALESCE(mi.w2_pulled, 0) - COALESCE(mi.w3_pulled, 0)
      ) AS ending_qty,
      COALESCE(
        mi.ending_value,
        COALESCE(mi.opening_value, COALESCE(mi.opening_oh, 0) * COALESCE(mi.opening_unit_cost, mi.unit_price, ii.unit_price, 0))
          + COALESCE(mi.received_value, (COALESCE(mi.w1_received, 0) + COALESCE(mi.w2_received, 0) + COALESCE(mi.w3_received, 0)) * COALESCE(mi.unit_price, ii.unit_price, 0))
          - COALESCE(mi.pulled_value, (COALESCE(mi.w1_pulled, 0) + COALESCE(mi.w2_pulled, 0) + COALESCE(mi.w3_pulled, 0)) * COALESCE(mi.unit_price, ii.unit_price, 0))
      ) AS ending_value
    FROM monthly_inventory mi
    JOIN inventory_items ii ON ii.id = mi.item_id
    WHERE mi.month = p_from_month AND mi.year = p_from_year
  LOOP
    v_ending_qty := v_item.ending_qty;
    v_ending_value := ROUND(COALESCE(v_item.ending_value, 0), 2);
    v_opening_unit_cost := CASE WHEN v_ending_qty > 0 THEN ROUND(v_ending_value / v_ending_qty, 6) ELSE NULL END;
    v_start_total := v_start_total + v_ending_value;

    INSERT INTO commit_changes (commit_id, item_id, month, year, week_number, field, old_value, new_value, action)
    VALUES (v_commit_id, v_item.item_id, v_next_month, v_next_year, 0, 'opening_oh', 0, v_ending_qty, 'enter');

    INSERT INTO monthly_inventory (
      item_id, month, year, opening_oh, unit_price,
      opening_unit_cost, opening_value, received_value, pulled_value, ending_value,
      w1_received, w2_received, w3_received, w1_pulled, w2_pulled, w3_pulled
    )
    VALUES (
      v_item.item_id, v_next_month, v_next_year, v_ending_qty, v_item.unit_price,
      v_opening_unit_cost, v_ending_value, 0, 0, v_ending_value,
      0, 0, 0, 0, 0, 0
    )
    ON CONFLICT (item_id, month, year) DO UPDATE SET
      opening_oh = EXCLUDED.opening_oh,
      opening_unit_cost = EXCLUDED.opening_unit_cost,
      opening_value = EXCLUDED.opening_value,
      unit_price = EXCLUDED.unit_price,
      received_value = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN 0 ELSE monthly_inventory.received_value END,
      pulled_value = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN 0 ELSE monthly_inventory.pulled_value END,
      ending_value = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN EXCLUDED.ending_value ELSE monthly_inventory.ending_value END,
      w1_received = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN 0 ELSE monthly_inventory.w1_received END,
      w2_received = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN 0 ELSE monthly_inventory.w2_received END,
      w3_received = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN 0 ELSE monthly_inventory.w3_received END,
      w1_pulled = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN 0 ELSE monthly_inventory.w1_pulled END,
      w2_pulled = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN 0 ELSE monthly_inventory.w2_pulled END,
      w3_pulled = CASE WHEN (
        monthly_inventory.w1_received + monthly_inventory.w2_received + monthly_inventory.w3_received
        + monthly_inventory.w1_pulled + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
      ) = 0 THEN 0 ELSE monthly_inventory.w3_pulled END;
  END LOOP;

  UPDATE month_status
  SET status = 'published', published_at = now(), published_by = p_rolled_by
  WHERE month = p_from_month AND year = p_from_year;

  RETURN jsonb_build_object(
    'commit_id', v_commit_id,
    'next_month', v_next_month,
    'next_year', v_next_year,
    'starting_total', ROUND(v_start_total, 2),
    'from_month', p_from_month,
    'from_year', p_from_year
  );
END;
$$;

REVOKE ALL ON FUNCTION public.perform_rollover(integer, integer, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.perform_rollover(integer, integer, uuid, text) TO service_role;
