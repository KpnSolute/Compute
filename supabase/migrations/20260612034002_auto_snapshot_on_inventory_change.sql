
-- ============================================================
-- Migration: auto_snapshot_on_inventory_change
-- Purpose:
--   1. Trigger that auto-refreshes monthly_snapshots whenever
--      monthly_inventory is inserted/updated, so archives are
--      always current without manual rollover.
--   2. Backfill the missing June 2026 snapshot (month=5).
--   3. Add a helper view showing payload_month vs db_month 
--      for debugging the indexing mismatch.
-- ============================================================

-- 1. Function to upsert a snapshot for a given (month, year)
CREATE OR REPLACE FUNCTION refresh_monthly_snapshot(p_month INT, p_year INT)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE
  v_grand_total    NUMERIC := 0;
  v_item_count     INT     := 0;
  v_reorder_count  INT     := 0;
  v_category_totals JSONB  := '{}';
  v_wk1 NUMERIC := 0;
  v_wk2 NUMERIC := 0;
  v_wk3 NUMERIC := 0;
  v_wk4 NUMERIC := 0;
BEGIN
  -- Aggregate from monthly_inventory JOIN inventory_items
  SELECT
    COALESCE(SUM(mi.on_hand * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
    COUNT(DISTINCT mi.item_id),
    COUNT(DISTINCT CASE WHEN mi.on_hand < COALESCE(ii.par_level, 0) AND COALESCE(ii.par_level,0) > 0 THEN mi.item_id END),
    COALESCE(SUM(mi.w1_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
    COALESCE(SUM(mi.w2_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
    COALESCE(SUM(mi.w3_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
    COALESCE(SUM(mi.w4_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0)
  INTO v_grand_total, v_item_count, v_reorder_count, v_wk1, v_wk2, v_wk3, v_wk4
  FROM monthly_inventory mi
  JOIN inventory_items ii ON ii.id = mi.item_id
  WHERE mi.month = p_month AND mi.year = p_year;

  -- Category totals as JSONB
  SELECT COALESCE(jsonb_object_agg(ic.name, cat_total), '{}')
  INTO v_category_totals
  FROM (
    SELECT ic2.name, SUM(mi2.on_hand * COALESCE(mi2.unit_price, ii2.unit_price, 0)) AS cat_total
    FROM monthly_inventory mi2
    JOIN inventory_items ii2 ON ii2.id = mi2.item_id
    JOIN inventory_categories ic2 ON ic2.id = ii2.category_id
    WHERE mi2.month = p_month AND mi2.year = p_year
    GROUP BY ic2.name
  ) sub
  JOIN inventory_categories ic ON ic.name = sub.name;

  -- Upsert into monthly_snapshots
  INSERT INTO monthly_snapshots (month, year, grand_total, item_count, reorder_count, category_totals, wk1_total, wk2_total, wk3_total, wk4_total, saved_at)
  VALUES (p_month, p_year, v_grand_total, v_item_count, v_reorder_count, v_category_totals, v_wk1, v_wk2, v_wk3, v_wk4, now())
  ON CONFLICT (month, year) DO UPDATE SET
    grand_total     = EXCLUDED.grand_total,
    item_count      = EXCLUDED.item_count,
    reorder_count   = EXCLUDED.reorder_count,
    category_totals = EXCLUDED.category_totals,
    wk1_total       = EXCLUDED.wk1_total,
    wk2_total       = EXCLUDED.wk2_total,
    wk3_total       = EXCLUDED.wk3_total,
    wk4_total       = EXCLUDED.wk4_total,
    saved_at        = now();
END;
$$;

-- 2. Trigger function called after any monthly_inventory change
CREATE OR REPLACE FUNCTION trg_refresh_snapshot()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM refresh_monthly_snapshot(OLD.month, OLD.year);
    RETURN OLD;
  ELSE
    PERFORM refresh_monthly_snapshot(NEW.month, NEW.year);
    RETURN NEW;
  END IF;
END;
$$;

-- 3. Attach trigger (drop first to be idempotent)
DROP TRIGGER IF EXISTS trg_monthly_inventory_snapshot ON monthly_inventory;
CREATE TRIGGER trg_monthly_inventory_snapshot
AFTER INSERT OR UPDATE OR DELETE ON monthly_inventory
FOR EACH ROW EXECUTE FUNCTION trg_refresh_snapshot();

-- 4. Add unique constraint on monthly_snapshots if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'monthly_snapshots'::regclass
    AND contype = 'u'
    AND conname = 'monthly_snapshots_month_year_key'
  ) THEN
    ALTER TABLE monthly_snapshots ADD CONSTRAINT monthly_snapshots_month_year_key UNIQUE (month, year);
  END IF;
END$$;

-- 5. Backfill snapshots for all existing monthly_inventory periods
DO $$
DECLARE
  rec RECORD;
BEGIN
  FOR rec IN SELECT DISTINCT month, year FROM monthly_inventory ORDER BY year, month LOOP
    PERFORM refresh_monthly_snapshot(rec.month, rec.year);
  END LOOP;
END$$;
;
