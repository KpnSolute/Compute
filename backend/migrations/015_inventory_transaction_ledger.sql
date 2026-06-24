-- 015_inventory_transaction_ledger.sql
-- Phase 1: rolling monthly inventory model.
--   Ending On Hand = Opening + Received - Pulled (+ Adjustments later)
-- Introduces an append-only transaction ledger as the SOURCE OF TRUTH for weekly
-- received/issued, with the monthly_inventory.w{n}_received/issued columns kept
-- as DERIVED cached summaries recomputed from the ledger after every batch.
--
-- Safe + repeatable: all objects use IF NOT EXISTS / CREATE OR REPLACE. No data is
-- destroyed. Compatible with an empty DB (current state) and a populated one.
-- Rollback section at the bottom (commented) for manual reversal.

-- ───────────────────────────────────────────────────────────────────────────
-- 1) import_batches — one row per uploaded file; the duplicate-protection gate.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.import_batches (
    batch_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file       text NOT NULL,                 -- original filename (display only)
    source_hash       text NOT NULL,                 -- sha256 of file CONTENT (rename-proof)
    source_type       text NOT NULL DEFAULT 'invoice', -- invoice | pull | baseline | manual
    direction         text,                          -- received | issued | null(baseline)
    month             integer NOT NULL,              -- 0-indexed (DB convention)
    year              integer NOT NULL,
    week_number       integer,                       -- 1-4; null for baseline/month
    invoice_number    text,                          -- US Foods invoice # / pull id when present
    item_count        integer NOT NULL DEFAULT 0,
    status            text NOT NULL DEFAULT 'staged', -- staged | merged | rejected
    staging_batch_id  uuid,                          -- links to staging_entries.batch_id
    created_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    merged_at         timestamptz,
    metadata          jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT import_batches_source_type_check
        CHECK (source_type IN ('invoice','pull','baseline','manual')),
    CONSTRAINT import_batches_status_check
        CHECK (status IN ('staged','merged','rejected')),
    CONSTRAINT import_batches_direction_check
        CHECK (direction IS NULL OR direction IN ('received','issued','both'))
);

-- Race-safe dedup: a file CONTENT already ACTIVE (staged or merged) for the same
-- scope cannot be re-imported — the unique violation fires at upload-INSERT time,
-- before any ledger row is written. A 'rejected' batch frees the slot so a
-- superseded/rejected upload can be retried.
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_active_dedup
    ON public.import_batches (
        source_hash, month, year,
        COALESCE(week_number, 0),
        COALESCE(direction, '')
    )
    WHERE status IN ('staged','merged');

CREATE INDEX IF NOT EXISTS idx_import_batches_hash     ON public.import_batches (source_hash);
CREATE INDEX IF NOT EXISTS idx_import_batches_staging  ON public.import_batches (staging_batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_period   ON public.import_batches (month, year);

ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_batches_service_all ON public.import_batches;
CREATE POLICY import_batches_service_all ON public.import_batches
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 2) inventory_transactions — append-only ledger. One row per movement per SKU.
-- ───────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    txn_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id           uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    sku               text NOT NULL,                 -- denormalized for audit/history
    month             integer NOT NULL,              -- 0-indexed
    year              integer NOT NULL,
    week_number       integer NOT NULL,              -- 1-4 (0 reserved for opening/rollover)
    txn_type          text NOT NULL,                 -- received|issued|adjustment_increase|adjustment_decrease|opening
    quantity          numeric NOT NULL,              -- NUMERIC, never float
    unit_price        numeric NOT NULL DEFAULT 0,
    source_file       text,
    source_hash       text,
    invoice_number    text,
    batch_id          uuid REFERENCES public.import_batches(batch_id) ON DELETE CASCADE,
    staging_entry_id  uuid,                          -- idempotency key for commit replay
    txn_date          date,
    created_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    adjustment_reason text,
    metadata          jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT inv_txn_type_check
        CHECK (txn_type IN ('received','issued','adjustment_increase','adjustment_decrease','opening')),
    CONSTRAINT inv_txn_week_check  CHECK (week_number BETWEEN 0 AND 4),
    CONSTRAINT inv_txn_month_check CHECK (month BETWEEN 0 AND 11),
    CONSTRAINT inv_txn_qty_nonneg  CHECK (quantity >= 0)  -- movements are magnitudes; direction is in txn_type
);

CREATE INDEX IF NOT EXISTS idx_inv_txn_item_period
    ON public.inventory_transactions (item_id, month, year, week_number);
CREATE INDEX IF NOT EXISTS idx_inv_txn_period ON public.inventory_transactions (month, year);
CREATE INDEX IF NOT EXISTS idx_inv_txn_batch  ON public.inventory_transactions (batch_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_hash   ON public.inventory_transactions (source_hash);
-- idempotent commit replay: a staging entry maps to exactly one ledger row.
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_txn_staging_entry
    ON public.inventory_transactions (staging_entry_id)
    WHERE staging_entry_id IS NOT NULL;

ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_txn_service_all ON public.inventory_transactions;
CREATE POLICY inv_txn_service_all ON public.inventory_transactions
    FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ───────────────────────────────────────────────────────────────────────────
-- 3) recompute_week_totals — rebuild ONE item's w{n}_received/issued from ledger.
--    Source of truth = ledger; the columns are a derived cache. Preserves on_hand
--    (opening) and unit_price by only touching the 8 weekly columns on conflict.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.recompute_week_totals(p_item_id uuid, p_month integer, p_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
    INSERT INTO public.monthly_inventory (
        item_id, month, year, unit_price,
        w1_received, w2_received, w3_received, w4_received,
        w1_issued,   w2_issued,   w3_issued,   w4_issued
    )
    SELECT p_item_id, p_month, p_year,
        COALESCE((SELECT NULLIF(unit_price,0) FROM public.inventory_items WHERE id=p_item_id), 0),
        COALESCE(SUM(quantity) FILTER (WHERE week_number=1 AND txn_type IN ('received','adjustment_increase')),0),
        COALESCE(SUM(quantity) FILTER (WHERE week_number=2 AND txn_type IN ('received','adjustment_increase')),0),
        COALESCE(SUM(quantity) FILTER (WHERE week_number=3 AND txn_type IN ('received','adjustment_increase')),0),
        COALESCE(SUM(quantity) FILTER (WHERE week_number=4 AND txn_type IN ('received','adjustment_increase')),0),
        COALESCE(SUM(quantity) FILTER (WHERE week_number=1 AND txn_type IN ('issued','adjustment_decrease')),0),
        COALESCE(SUM(quantity) FILTER (WHERE week_number=2 AND txn_type IN ('issued','adjustment_decrease')),0),
        COALESCE(SUM(quantity) FILTER (WHERE week_number=3 AND txn_type IN ('issued','adjustment_decrease')),0),
        COALESCE(SUM(quantity) FILTER (WHERE week_number=4 AND txn_type IN ('issued','adjustment_decrease')),0)
    FROM public.inventory_transactions
    WHERE item_id=p_item_id AND month=p_month AND year=p_year
    ON CONFLICT (item_id, month, year) DO UPDATE SET
        w1_received=EXCLUDED.w1_received, w2_received=EXCLUDED.w2_received,
        w3_received=EXCLUDED.w3_received, w4_received=EXCLUDED.w4_received,
        w1_issued=EXCLUDED.w1_issued,     w2_issued=EXCLUDED.w2_issued,
        w3_issued=EXCLUDED.w3_issued,     w4_issued=EXCLUDED.w4_issued,
        -- backfill price for items first seen on a weekly invoice; never clobber
        -- an existing (baseline) price.
        unit_price = CASE WHEN public.monthly_inventory.unit_price IS NULL
                            OR public.monthly_inventory.unit_price = 0
                          THEN EXCLUDED.unit_price
                          ELSE public.monthly_inventory.unit_price END,
        updated_at=now();
END; $$;

-- reconcile_period_from_ledger — rebuild EVERY item's weekly cache for a period.
-- Deterministic + repeatable (used by the reconciliation endpoint / Test H).
CREATE OR REPLACE FUNCTION public.reconcile_period_from_ledger(p_month integer, p_year integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r record; n integer := 0;
BEGIN
    FOR r IN SELECT DISTINCT item_id FROM public.inventory_transactions
             WHERE month=p_month AND year=p_year LOOP
        PERFORM public.recompute_week_totals(r.item_id, p_month, p_year);
        n := n + 1;
    END LOOP;
    RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.recompute_week_totals(uuid,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_period_from_ledger(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_week_totals(uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_period_from_ledger(integer,integer) TO service_role;

-- ───────────────────────────────────────────────────────────────────────────
-- 4) refresh_monthly_snapshot — PRESERVE negative ending (R6). Was GREATEST(0,…),
--    which silently hid over-issues. Also populate starting_total (opening $),
--    which the prior version never set.
-- ───────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.refresh_monthly_snapshot(p_month integer, p_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
    v_grand_total NUMERIC := 0; v_item_count INT := 0; v_reorder_count INT := 0;
    v_starting NUMERIC := 0;
    v_category_totals JSONB := '{}';
    v_wk1 NUMERIC := 0; v_wk2 NUMERIC := 0; v_wk3 NUMERIC := 0; v_wk4 NUMERIC := 0; v_wk5 NUMERIC := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM month_status WHERE month=p_month AND year=p_year AND status='published') THEN
        RETURN;  -- published months are frozen
    END IF;

    SELECT
        -- Ending value: real signed value, NOT floored at 0 (negatives preserved).
        COALESCE(SUM((
            COALESCE(mi.on_hand,0)
            + COALESCE(mi.w1_received,0)+COALESCE(mi.w2_received,0)+COALESCE(mi.w3_received,0)+COALESCE(mi.w4_received,0)+COALESCE(mi.w5_received,0)
            - (COALESCE(mi.w1_issued,0)+COALESCE(mi.w2_issued,0)+COALESCE(mi.w3_issued,0)+COALESCE(mi.w4_issued,0)+COALESCE(mi.w5_issued,0))
        ) * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
        COUNT(DISTINCT mi.item_id),
        COUNT(DISTINCT CASE WHEN mi.on_hand < COALESCE(ii.par_level,0) AND COALESCE(ii.par_level,0) > 0 THEN mi.item_id END),
        COALESCE(SUM(COALESCE(mi.on_hand,0) * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),  -- starting_total (opening $)
        COALESCE(SUM(mi.w1_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
        COALESCE(SUM(mi.w2_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
        COALESCE(SUM(mi.w3_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
        COALESCE(SUM(mi.w4_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
        COALESCE(SUM(mi.w5_received * COALESCE(mi.unit_price, ii.unit_price, 0)), 0)
    INTO v_grand_total, v_item_count, v_reorder_count, v_starting, v_wk1, v_wk2, v_wk3, v_wk4, v_wk5
    FROM monthly_inventory mi JOIN inventory_items ii ON ii.id = mi.item_id
    WHERE mi.month = p_month AND mi.year = p_year;

    SELECT COALESCE(jsonb_object_agg(ic.name, cat_total), '{}')
    INTO v_category_totals
    FROM (
        SELECT ic2.name, SUM((
            COALESCE(mi2.on_hand,0)
            + COALESCE(mi2.w1_received,0)+COALESCE(mi2.w2_received,0)+COALESCE(mi2.w3_received,0)+COALESCE(mi2.w4_received,0)+COALESCE(mi2.w5_received,0)
            - (COALESCE(mi2.w1_issued,0)+COALESCE(mi2.w2_issued,0)+COALESCE(mi2.w3_issued,0)+COALESCE(mi2.w4_issued,0)+COALESCE(mi2.w5_issued,0))
          ) * COALESCE(mi2.unit_price, ii2.unit_price, 0)) AS cat_total
        FROM monthly_inventory mi2
        JOIN inventory_items ii2 ON ii2.id = mi2.item_id
        JOIN inventory_categories ic2 ON ic2.id = ii2.category_id
        WHERE mi2.month = p_month AND mi2.year = p_year
        GROUP BY ic2.name
    ) sub JOIN inventory_categories ic ON ic.name = sub.name;

    INSERT INTO monthly_snapshots (month, year, grand_total, item_count, reorder_count, category_totals,
        starting_total, wk1_total, wk2_total, wk3_total, wk4_total, wk5_total, saved_at)
    VALUES (p_month, p_year, v_grand_total, v_item_count, v_reorder_count, v_category_totals,
        v_starting, v_wk1, v_wk2, v_wk3, v_wk4, v_wk5, now())
    ON CONFLICT (month, year) DO UPDATE SET
        grand_total=EXCLUDED.grand_total, item_count=EXCLUDED.item_count, reorder_count=EXCLUDED.reorder_count,
        category_totals=EXCLUDED.category_totals, starting_total=EXCLUDED.starting_total,
        wk1_total=EXCLUDED.wk1_total, wk2_total=EXCLUDED.wk2_total,
        wk3_total=EXCLUDED.wk3_total, wk4_total=EXCLUDED.wk4_total, wk5_total=EXCLUDED.wk5_total, saved_at=now();
END; $$;

-- ───────────────────────────────────────────────────────────────────────────
-- Rollback (manual):
--   DROP FUNCTION IF EXISTS public.reconcile_period_from_ledger(integer,integer);
--   DROP FUNCTION IF EXISTS public.recompute_week_totals(uuid,integer,integer);
--   DROP TABLE IF EXISTS public.inventory_transactions;
--   DROP TABLE IF EXISTS public.import_batches;
--   (and restore the prior GREATEST(0,…) refresh_monthly_snapshot from migration 012_…)
-- ───────────────────────────────────────────────────────────────────────────
