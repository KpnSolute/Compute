-- 045_inventory_value_invariant.sql
--
-- Enforce the canonical inventory value contract at the database layer.
--
--   Total Received = w1_received + w2_received + w3_received
--   Total Pulled   = w1_pulled   + w2_pulled   + w3_pulled
--   Ending Qty     = max(0, opening_oh + Total Received - Total Pulled)
--   Ending Value   = 0                                              when Ending Qty = 0
--                  = max(0, opening_value + received_value - pulled_value)  otherwise
--
-- WHY: the 2026-07 production audit found 43 rows in period month=6/2026 that
-- held zero physical stock but a nonzero stored ending_value, 20 of them
-- negative (the reported Disposables "FORK, MW BLK PLST REFL" row displayed
-- -$1.14). Two writers produced them:
--
--   1. recompute_week_totals() derived
--        ending_value = opening_value + received_value - pulled_value
--      with NO zero clamp and no reference to quantity. received_value is
--      summed from the ledger at the price actually invoiced while
--      pulled_value is summed at the catalog unit_price, so a row that
--      receives and pulls the same quantity still lands on a nonzero residual.
--   2. Sparse upserts in backend/staging/dispatch.py, which preserve omitted
--      columns, so zeroing quantities left the prior period's dollars behind.
--
-- The API now applies the same invariant on every read path
-- (backend/inventory_formulas.py :: resolve_row_financials) and settles rows
-- after every write (dispatch._enforce_value_invariants). This migration makes
-- the database agree, so a future writer cannot reintroduce the drift.
--
-- The unclamped residual is NOT discarded — it remains derivable from the
-- component columns and is reported by the API as an audit signal. Only the
-- DISPLAYED stock value is constrained.

BEGIN;

-- ── 1. recompute_week_totals: clamp + quantity rule ─────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_week_totals(p_item_id uuid, p_month integer, p_year integer)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
    -- A direction with no quantity carries no value.
    received_value = CASE
      WHEN EXCLUDED.w1_received + EXCLUDED.w2_received + EXCLUDED.w3_received <= 0 THEN 0
      ELSE EXCLUDED.received_value END,
    pulled_value = CASE
      WHEN EXCLUDED.w1_pulled + EXCLUDED.w2_pulled + EXCLUDED.w3_pulled <= 0 THEN 0
      ELSE EXCLUDED.pulled_value END,
    -- Ending value: zero when no stock remains, never negative otherwise.
    ending_value = CASE
      WHEN GREATEST(0::numeric,
             COALESCE(public.monthly_inventory.opening_oh, 0)
             + EXCLUDED.w1_received + EXCLUDED.w2_received + EXCLUDED.w3_received
             - EXCLUDED.w1_pulled - EXCLUDED.w2_pulled - EXCLUDED.w3_pulled) <= 0
        THEN 0
      ELSE GREATEST(0::numeric,
             CASE WHEN COALESCE(public.monthly_inventory.opening_oh, 0) <= 0 THEN 0 ELSE COALESCE(
               public.monthly_inventory.opening_value,
               COALESCE(public.monthly_inventory.opening_oh, 0)
                 * COALESCE(public.monthly_inventory.opening_unit_cost,
                            public.monthly_inventory.unit_price,
                            EXCLUDED.unit_price, 0)) END
             + CASE WHEN EXCLUDED.w1_received + EXCLUDED.w2_received + EXCLUDED.w3_received <= 0
                    THEN 0 ELSE EXCLUDED.received_value END
             - CASE WHEN EXCLUDED.w1_pulled + EXCLUDED.w2_pulled + EXCLUDED.w3_pulled <= 0
                    THEN 0 ELSE EXCLUDED.pulled_value END)
      END,
    unit_price = CASE
      WHEN public.monthly_inventory.unit_price IS NULL OR public.monthly_inventory.unit_price = 0
      THEN EXCLUDED.unit_price
      ELSE public.monthly_inventory.unit_price
    END,
    updated_at = now();
END;
$function$;

-- ── 2. live_inventory: never surface a negative or stranded value ───────────
-- sub_total previously COALESCEd straight onto the stored ending_value, so a
-- negative stored balance passed through unaltered (COALESCE only skips NULL).
CREATE OR REPLACE VIEW public.live_inventory AS
 WITH per AS (
         SELECT COALESCE(( SELECT month_status.month
                   FROM month_status
                  WHERE month_status.status = 'open'::text
                  ORDER BY month_status.year DESC, month_status.month DESC
                 LIMIT 1), ( SELECT monthly_inventory.month
                   FROM monthly_inventory
                  ORDER BY monthly_inventory.year DESC, monthly_inventory.month DESC
                 LIMIT 1)) AS month,
            COALESCE(( SELECT month_status.year
                   FROM month_status
                  WHERE month_status.status = 'open'::text
                  ORDER BY month_status.year DESC, month_status.month DESC
                 LIMIT 1), ( SELECT monthly_inventory.year
                   FROM monthly_inventory
                  ORDER BY monthly_inventory.year DESC, monthly_inventory.month DESC
                 LIMIT 1)) AS year
        ), current_rows AS (
         SELECT mi_1.id,
            mi_1.item_id,
            mi_1.month,
            mi_1.year,
            mi_1.w1_received,
            mi_1.w2_received,
            mi_1.w3_received,
            mi_1.unit_price,
            mi_1.created_at,
            mi_1.updated_at,
            mi_1.opening_oh,
            mi_1.w1_pulled,
            mi_1.w2_pulled,
            mi_1.w3_pulled,
            mi_1.status,
            mi_1.opening_unit_cost,
            mi_1.opening_value,
            mi_1.received_value,
            mi_1.pulled_value,
            mi_1.ending_value,
            GREATEST(0::numeric, COALESCE(mi_1.opening_oh, 0::numeric) + COALESCE(mi_1.w1_received, 0::numeric) + COALESCE(mi_1.w2_received, 0::numeric) + COALESCE(mi_1.w3_received, 0::numeric) - COALESCE(mi_1.w1_pulled, 0::numeric) - COALESCE(mi_1.w2_pulled, 0::numeric) - COALESCE(mi_1.w3_pulled, 0::numeric)) AS ending_qty
           FROM monthly_inventory mi_1
             JOIN per per_1 ON per_1.month = mi_1.month AND per_1.year = mi_1.year
        )
 SELECT i.id,
    i.sku,
    i.description,
    c.name AS category,
    COALESCE(mi.unit_price, i.unit_price) AS unit_price,
    i.par_level,
    i.active AS is_active,
    bc.barcode AS barcode_id,
    COALESCE(mi.opening_oh, 0::numeric) AS opening_on_hand,
    COALESCE(mi.w1_received, 0::numeric) AS w1r,
    COALESCE(mi.w2_received, 0::numeric) AS w2r,
    COALESCE(mi.w3_received, 0::numeric) AS w3r,
    COALESCE(mi.w1_pulled, 0::numeric) AS w1p,
    COALESCE(mi.w2_pulled, 0::numeric) AS w2p,
    COALESCE(mi.w3_pulled, 0::numeric) AS w3p,
    COALESCE(mi.w1_received, 0::numeric) + COALESCE(mi.w2_received, 0::numeric) + COALESCE(mi.w3_received, 0::numeric) AS total_received,
    COALESCE(mi.w1_pulled, 0::numeric) + COALESCE(mi.w2_pulled, 0::numeric) + COALESCE(mi.w3_pulled, 0::numeric) AS total_pulled,
    COALESCE(mi.ending_qty, 0::numeric) AS on_hand,
    -- No stock => no value; otherwise clamp at zero.
    CASE WHEN COALESCE(mi.ending_qty, 0::numeric) <= 0 THEN 0::numeric
         ELSE round(GREATEST(0::numeric, COALESCE(mi.ending_value,
                GREATEST(0::numeric, COALESCE(mi.opening_value, 0::numeric) + COALESCE(mi.received_value, 0::numeric) - COALESCE(mi.pulled_value, 0::numeric)),
                COALESCE(mi.ending_qty, 0::numeric) * COALESCE(mi.unit_price, i.unit_price, 0::numeric))), 2)
    END AS sub_total,
    GREATEST(0::numeric, i.par_level::numeric - COALESCE(mi.ending_qty, 0::numeric)) AS order_qty
   FROM inventory_items i
     LEFT JOIN inventory_categories c ON c.id = i.category_id
     CROSS JOIN per
     LEFT JOIN current_rows mi ON mi.item_id = i.id
     LEFT JOIN LATERAL ( SELECT b.barcode
           FROM item_barcodes b
          WHERE b.item_id = i.id
          ORDER BY b.is_primary DESC NULLS LAST
         LIMIT 1) bc ON true
  WHERE i.active = true;

-- ── 3. Backstop: a stored ending_value may never be negative ────────────────
-- Deliberately NOT VALID: existing rows are repaired by the separate, reviewed
-- data-repair statement (see CHANGELOG) rather than blocking this deploy.
ALTER TABLE public.monthly_inventory
  DROP CONSTRAINT IF EXISTS monthly_inventory_ending_value_non_negative;
ALTER TABLE public.monthly_inventory
  ADD CONSTRAINT monthly_inventory_ending_value_non_negative
  CHECK (ending_value IS NULL OR ending_value >= 0) NOT VALID;

COMMIT;
