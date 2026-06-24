-- 017_recompute_unit_price_backfill.sql
-- recompute_week_totals: backfill monthly_inventory.unit_price from the item
-- catalog for rows first created by a weekly invoice (new items), so they value
-- correctly instead of at $0. Never clobbers an existing (baseline) price.

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
        unit_price = CASE WHEN public.monthly_inventory.unit_price IS NULL
                            OR public.monthly_inventory.unit_price = 0
                          THEN EXCLUDED.unit_price
                          ELSE public.monthly_inventory.unit_price END,
        updated_at=now();
END; $$;

REVOKE ALL ON FUNCTION public.recompute_week_totals(uuid,integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.recompute_week_totals(uuid,integer,integer) TO service_role;
