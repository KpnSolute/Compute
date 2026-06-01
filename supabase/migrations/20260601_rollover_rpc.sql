-- perform_rollover: atomic month close + next month open
-- Opens next month FIRST so guard trigger allows writes, then copies ending qty

CREATE OR REPLACE FUNCTION perform_rollover(
  p_from_month INT, p_from_year INT, p_rolled_by UUID, p_message TEXT DEFAULT NULL
) RETURNS JSONB LANGUAGE plpgsql SECURITY DEFINER AS \$\$
DECLARE
  v_next_month INT; v_next_year INT; v_commit_id UUID;
  v_start_total NUMERIC := 0; v_item RECORD; v_ending_qty NUMERIC; v_msg TEXT;
BEGIN
  IF p_from_month = 11 THEN v_next_month := 0; v_next_year := p_from_year + 1;
  ELSE v_next_month := p_from_month + 1; v_next_year := p_from_year; END IF;
  v_msg := COALESCE(p_message, 'rollover: '||p_from_month||'/'||p_from_year||' → '||v_next_month||'/'||v_next_year);
  INSERT INTO month_status (month, year, status, opened_at) VALUES (v_next_month, v_next_year, 'open', now())
  ON CONFLICT (month, year) DO UPDATE SET status = 'open', opened_at = now();
  INSERT INTO commits (author_id, message, branch, status, merged_by, merged_at, month, year, source)
  VALUES (p_rolled_by, v_msg, 'main', 'merged', p_rolled_by, now(), p_from_month, p_from_year, 'rollover')
  RETURNING commit_id INTO v_commit_id;
  FOR v_item IN
    SELECT mi.item_id, COALESCE(mi.unit_price, ii.unit_price) AS unit_price,
      GREATEST(0, mi.on_hand + COALESCE(mi.w1_received,0)+COALESCE(mi.w2_received,0)+COALESCE(mi.w3_received,0)+COALESCE(mi.w4_received,0)
                             - COALESCE(mi.w1_issued,0)-COALESCE(mi.w2_issued,0)-COALESCE(mi.w3_issued,0)-COALESCE(mi.w4_issued,0)) AS ending_qty
    FROM monthly_inventory mi JOIN inventory_items ii ON ii.id = mi.item_id
    WHERE mi.month = p_from_month AND mi.year = p_from_year
  LOOP
    v_ending_qty := v_item.ending_qty; v_start_total := v_start_total + (v_ending_qty * v_item.unit_price);
    INSERT INTO commit_changes (commit_id, item_id, month, year, week_number, field, old_value, new_value, action)
    VALUES (v_commit_id, v_item.item_id, v_next_month, v_next_year, 0, 'on_hand', 0, v_ending_qty, 'enter');
    INSERT INTO monthly_inventory (item_id, month, year, on_hand, unit_price, w1_received, w2_received, w3_received, w4_received, w1_issued, w2_issued, w3_issued, w4_issued)
    VALUES (v_item.item_id, v_next_month, v_next_year, v_ending_qty, v_item.unit_price, 0,0,0,0,0,0,0,0)
    ON CONFLICT (item_id, month, year) DO UPDATE SET on_hand=EXCLUDED.on_hand, unit_price=EXCLUDED.unit_price,
      w1_received=0,w2_received=0,w3_received=0,w4_received=0,w1_issued=0,w2_issued=0,w3_issued=0,w4_issued=0;
  END LOOP;
  UPDATE month_status SET status='published', published_at=now(), published_by=p_rolled_by WHERE month=p_from_month AND year=p_from_year;
  RETURN jsonb_build_object('commit_id',v_commit_id,'next_month',v_next_month,'next_year',v_next_year,'starting_total',ROUND(v_start_total,2),'from_month',p_from_month,'from_year',p_from_year);
END; \$\$;

-- Guard trigger: allow writes to any month registered in month_status
CREATE OR REPLACE FUNCTION public.guard_closed_month_writes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS \$\$
DECLARE open_month integer; open_year integer;
BEGIN
  IF EXISTS (SELECT 1 FROM public.month_status WHERE month=NEW.month AND year=NEW.year) THEN RETURN NEW; END IF;
  SELECT month, year INTO open_month, open_year FROM public.month_status WHERE status='open' LIMIT 1;
  IF open_month IS NULL THEN open_month := EXTRACT(MONTH FROM now())::integer-1; open_year := EXTRACT(YEAR FROM now())::integer; END IF;
  IF (NEW.month=open_month AND NEW.year=open_year) THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Cannot write to month %/% — only the open month (%/%) is writable.', NEW.month, NEW.year, open_month, open_year;
END; \$\$;

ALTER TABLE commit_changes DROP CONSTRAINT IF EXISTS commit_changes_week_number_check;
ALTER TABLE commit_changes ADD CONSTRAINT commit_changes_week_number_check CHECK (week_number BETWEEN 0 AND 4);

CREATE UNIQUE INDEX IF NOT EXISTS idx_monthly_inventory_item_month_year ON monthly_inventory(item_id, month, year);
CREATE UNIQUE INDEX IF NOT EXISTS idx_month_status_month_year ON month_status(month, year);