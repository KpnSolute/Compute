CREATE TABLE IF NOT EXISTS public.import_batches (
    batch_id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    source_file       text NOT NULL,
    source_hash       text NOT NULL,
    source_type       text NOT NULL DEFAULT 'invoice',
    direction         text,
    month             integer NOT NULL,
    year              integer NOT NULL,
    week_number       integer,
    invoice_number    text,
    item_count        integer NOT NULL DEFAULT 0,
    status            text NOT NULL DEFAULT 'staged',
    staging_batch_id  uuid,
    created_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    merged_at         timestamptz,
    metadata          jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT import_batches_source_type_check CHECK (source_type IN ('invoice','pull','baseline','manual')),
    CONSTRAINT import_batches_status_check CHECK (status IN ('staged','merged','rejected')),
    CONSTRAINT import_batches_direction_check CHECK (direction IS NULL OR direction IN ('received','issued','both'))
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_merged_dedup
    ON public.import_batches (source_hash, month, year, COALESCE(week_number, 0), COALESCE(direction, ''))
    WHERE status = 'merged';
CREATE INDEX IF NOT EXISTS idx_import_batches_hash    ON public.import_batches (source_hash);
CREATE INDEX IF NOT EXISTS idx_import_batches_staging ON public.import_batches (staging_batch_id);
CREATE INDEX IF NOT EXISTS idx_import_batches_period  ON public.import_batches (month, year);
ALTER TABLE public.import_batches ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS import_batches_service_all ON public.import_batches;
CREATE POLICY import_batches_service_all ON public.import_batches FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE TABLE IF NOT EXISTS public.inventory_transactions (
    txn_id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_id           uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
    sku               text NOT NULL,
    month             integer NOT NULL,
    year              integer NOT NULL,
    week_number       integer NOT NULL,
    txn_type          text NOT NULL,
    quantity          numeric NOT NULL,
    unit_price        numeric NOT NULL DEFAULT 0,
    source_file       text,
    source_hash       text,
    invoice_number    text,
    batch_id          uuid REFERENCES public.import_batches(batch_id) ON DELETE CASCADE,
    staging_entry_id  uuid,
    txn_date          date,
    created_by        uuid,
    created_at        timestamptz NOT NULL DEFAULT now(),
    adjustment_reason text,
    metadata          jsonb DEFAULT '{}'::jsonb,
    CONSTRAINT inv_txn_type_check CHECK (txn_type IN ('received','issued','adjustment_increase','adjustment_decrease','opening')),
    CONSTRAINT inv_txn_week_check  CHECK (week_number BETWEEN 0 AND 4),
    CONSTRAINT inv_txn_month_check CHECK (month BETWEEN 0 AND 11),
    CONSTRAINT inv_txn_qty_nonneg  CHECK (quantity >= 0)
);
CREATE INDEX IF NOT EXISTS idx_inv_txn_item_period ON public.inventory_transactions (item_id, month, year, week_number);
CREATE INDEX IF NOT EXISTS idx_inv_txn_period ON public.inventory_transactions (month, year);
CREATE INDEX IF NOT EXISTS idx_inv_txn_batch  ON public.inventory_transactions (batch_id);
CREATE INDEX IF NOT EXISTS idx_inv_txn_hash   ON public.inventory_transactions (source_hash);
CREATE UNIQUE INDEX IF NOT EXISTS uq_inv_txn_staging_entry ON public.inventory_transactions (staging_entry_id) WHERE staging_entry_id IS NOT NULL;
ALTER TABLE public.inventory_transactions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inv_txn_service_all ON public.inventory_transactions;
CREATE POLICY inv_txn_service_all ON public.inventory_transactions FOR ALL TO service_role USING (true) WITH CHECK (true);

CREATE OR REPLACE FUNCTION public.recompute_week_totals(p_item_id uuid, p_month integer, p_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
BEGIN
    INSERT INTO public.monthly_inventory (
        item_id, month, year,
        w1_received, w2_received, w3_received, w4_received,
        w1_issued,   w2_issued,   w3_issued,   w4_issued
    )
    SELECT p_item_id, p_month, p_year,
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
        updated_at=now();
END; $$;

CREATE OR REPLACE FUNCTION public.reconcile_period_from_ledger(p_month integer, p_year integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE r record; n integer := 0;
BEGIN
    FOR r IN SELECT DISTINCT item_id FROM public.inventory_transactions WHERE month=p_month AND year=p_year LOOP
        PERFORM public.recompute_week_totals(r.item_id, p_month, p_year);
        n := n + 1;
    END LOOP;
    RETURN n;
END; $$;

REVOKE ALL ON FUNCTION public.recompute_week_totals(uuid,integer,integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.reconcile_period_from_ledger(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_week_totals(uuid,integer,integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.reconcile_period_from_ledger(integer,integer) TO service_role;

CREATE OR REPLACE FUNCTION public.refresh_monthly_snapshot(p_month integer, p_year integer)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
    v_grand_total NUMERIC := 0; v_item_count INT := 0; v_reorder_count INT := 0;
    v_starting NUMERIC := 0;
    v_category_totals JSONB := '{}';
    v_wk1 NUMERIC := 0; v_wk2 NUMERIC := 0; v_wk3 NUMERIC := 0; v_wk4 NUMERIC := 0; v_wk5 NUMERIC := 0;
BEGIN
    IF EXISTS (SELECT 1 FROM month_status WHERE month=p_month AND year=p_year AND status='published') THEN
        RETURN;
    END IF;
    SELECT
        COALESCE(SUM((
            COALESCE(mi.on_hand,0)
            + COALESCE(mi.w1_received,0)+COALESCE(mi.w2_received,0)+COALESCE(mi.w3_received,0)+COALESCE(mi.w4_received,0)+COALESCE(mi.w5_received,0)
            - (COALESCE(mi.w1_issued,0)+COALESCE(mi.w2_issued,0)+COALESCE(mi.w3_issued,0)+COALESCE(mi.w4_issued,0)+COALESCE(mi.w5_issued,0))
        ) * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
        COUNT(DISTINCT mi.item_id),
        COUNT(DISTINCT CASE WHEN mi.on_hand < COALESCE(ii.par_level,0) AND COALESCE(ii.par_level,0) > 0 THEN mi.item_id END),
        COALESCE(SUM(COALESCE(mi.on_hand,0) * COALESCE(mi.unit_price, ii.unit_price, 0)), 0),
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
END; $$;;
