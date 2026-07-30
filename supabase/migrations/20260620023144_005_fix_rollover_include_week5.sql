CREATE OR REPLACE FUNCTION public.perform_rollover(p_from_month integer, p_from_year integer, p_rolled_by uuid, p_message text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_next_month   INT;
  v_next_year    INT;
  v_commit_id    UUID;
  v_start_total  NUMERIC := 0;
  v_item         RECORD;
  v_ending_qty   NUMERIC;
  v_msg          TEXT;
BEGIN
  IF p_from_month = 11 THEN
    v_next_month := 0;
    v_next_year  := p_from_year + 1;
  ELSE
    v_next_month := p_from_month + 1;
    v_next_year  := p_from_year;
  END IF;

  v_msg := COALESCE(p_message,
    'rollover: ' || p_from_month || '/' || p_from_year ||
    ' -> ' || v_next_month || '/' || v_next_year
  );

  -- STEP 1: Open next month FIRST so the guard trigger allows writes to it
  INSERT INTO month_status (month, year, status, opened_at)
  VALUES (v_next_month, v_next_year, 'open', now())
  ON CONFLICT (month, year) DO UPDATE SET status = 'open', opened_at = now();

  -- STEP 2: Create commit record
  INSERT INTO commits (
    author_id, message, branch, status, merged_by, merged_at,
    month, year, source
  ) VALUES (
    p_rolled_by, v_msg, 'main', 'merged', p_rolled_by, now(),
    p_from_month, p_from_year, 'rollover'
  ) RETURNING commit_id INTO v_commit_id;

  -- STEP 3: Copy ending on_hand to next month for each item.
  -- FIX (005): include w5_received / w5_issued so 31-day months carry forward
  -- their full activity instead of silently dropping week 5.
  FOR v_item IN
    SELECT
      mi.item_id,
      COALESCE(mi.unit_price, ii.unit_price) AS unit_price,
      GREATEST(0,
        mi.on_hand
        + COALESCE(mi.w1_received,0) + COALESCE(mi.w2_received,0)
        + COALESCE(mi.w3_received,0) + COALESCE(mi.w4_received,0)
        + COALESCE(mi.w5_received,0)
        - COALESCE(mi.w1_issued,0)   - COALESCE(mi.w2_issued,0)
        - COALESCE(mi.w3_issued,0)   - COALESCE(mi.w4_issued,0)
        - COALESCE(mi.w5_issued,0)
      ) AS ending_qty
    FROM monthly_inventory mi
    JOIN inventory_items ii ON ii.id = mi.item_id
    WHERE mi.month = p_from_month AND mi.year = p_from_year
  LOOP
    v_ending_qty  := v_item.ending_qty;
    v_start_total := v_start_total + (v_ending_qty * v_item.unit_price);

    INSERT INTO commit_changes (
      commit_id, item_id, month, year, week_number,
      field, old_value, new_value, action
    ) VALUES (
      v_commit_id, v_item.item_id, v_next_month, v_next_year, 0,
      'on_hand', 0, v_ending_qty, 'enter'
    );

    INSERT INTO monthly_inventory (
      item_id, month, year, on_hand, unit_price,
      w1_received, w2_received, w3_received, w4_received, w5_received,
      w1_issued,   w2_issued,   w3_issued,   w4_issued,   w5_issued
    ) VALUES (
      v_item.item_id, v_next_month, v_next_year, v_ending_qty, v_item.unit_price,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0
    )
    ON CONFLICT (item_id, month, year)
    DO UPDATE SET
      on_hand    = EXCLUDED.on_hand,
      unit_price = EXCLUDED.unit_price,
      -- Only reset weekly columns if the target month has NO activity yet
      -- (all weeks 0). If real data exists, preserve it and only update opening.
      w1_received = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w1_received END,
      w2_received = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w2_received END,
      w3_received = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w3_received END,
      w4_received = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w4_received END,
      w5_received = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w5_received END,
      w1_issued   = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w1_issued END,
      w2_issued   = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w2_issued END,
      w3_issued   = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w3_issued END,
      w4_issued   = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w4_issued END,
      w5_issued   = CASE WHEN (monthly_inventory.w1_received + monthly_inventory.w2_received +
                                monthly_inventory.w3_received + monthly_inventory.w4_received + monthly_inventory.w5_received +
                                monthly_inventory.w1_issued   + monthly_inventory.w2_issued   +
                                monthly_inventory.w3_issued   + monthly_inventory.w4_issued   + monthly_inventory.w5_issued) = 0
                         THEN 0 ELSE monthly_inventory.w5_issued END;
  END LOOP;

  -- STEP 4: Close from_month (mark published)
  UPDATE month_status
  SET    status = 'published', published_at = now(), published_by = p_rolled_by
  WHERE  month  = p_from_month AND year = p_from_year;

  RETURN jsonb_build_object(
    'commit_id',      v_commit_id,
    'next_month',     v_next_month,
    'next_year',      v_next_year,
    'starting_total', ROUND(v_start_total, 2),
    'from_month',     p_from_month,
    'from_year',      p_from_year
  );
END;
$function$;;
