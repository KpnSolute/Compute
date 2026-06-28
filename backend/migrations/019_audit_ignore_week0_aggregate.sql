-- 019_audit_ignore_week0_aggregate.sql
-- Week 0 inventory_transactions are month-level aggregate movements. They are
-- intentionally not cached into monthly_inventory.w1_*..w4_* columns, so the
-- reconciliation_drift audit must compare the weekly cache against only weeks
-- 1-4 in the ledger. Week 0 rows remain visible to suspicious_qty and history.

CREATE OR REPLACE FUNCTION public.audit_inventory_period(p_month integer, p_year integer)
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE
    v_susp_qty numeric := 500;
    v_count integer := 0;
BEGIN
    DELETE FROM inventory_audit_log WHERE month=p_month AND year=p_year AND resolved=false;

    INSERT INTO inventory_audit_log (month,year,check_type,severity,item_id,sku,message,details)
    SELECT p_month,p_year,'negative_ending','error',mi.item_id,ii.sku,
        format('Ending on hand is %s for %s - pulled more than available.',
               (mi.on_hand + mi.w1_received+mi.w2_received+mi.w3_received+mi.w4_received
                - (mi.w1_issued+mi.w2_issued+mi.w3_issued+mi.w4_issued)), ii.sku),
        jsonb_build_object('ending',
            mi.on_hand + mi.w1_received+mi.w2_received+mi.w3_received+mi.w4_received
            - (mi.w1_issued+mi.w2_issued+mi.w3_issued+mi.w4_issued))
    FROM monthly_inventory mi JOIN inventory_items ii ON ii.id=mi.item_id
    WHERE mi.month=p_month AND mi.year=p_year
      AND (mi.on_hand + mi.w1_received+mi.w2_received+mi.w3_received+mi.w4_received
           - (mi.w1_issued+mi.w2_issued+mi.w3_issued+mi.w4_issued)) < 0;

    INSERT INTO inventory_audit_log (month,year,check_type,severity,item_id,sku,message,details)
    SELECT p_month,p_year,'reconciliation_drift','error',mi.item_id,ii.sku,
        format('Cached weekly totals for %s do not match the transaction ledger.', ii.sku),
        jsonb_build_object('cached_received',
            mi.w1_received+mi.w2_received+mi.w3_received+mi.w4_received,
            'ledger_received', COALESCE(lr.recv,0),
            'cached_issued', mi.w1_issued+mi.w2_issued+mi.w3_issued+mi.w4_issued,
            'ledger_issued', COALESCE(lr.iss,0))
    FROM monthly_inventory mi JOIN inventory_items ii ON ii.id=mi.item_id
    LEFT JOIN (
        SELECT item_id,
               SUM(quantity) FILTER (WHERE txn_type IN ('received','adjustment_increase')) recv,
               SUM(quantity) FILTER (WHERE txn_type IN ('issued','adjustment_decrease')) iss
        FROM inventory_transactions
        WHERE month=p_month AND year=p_year AND week_number BETWEEN 1 AND 4
        GROUP BY item_id
    ) lr ON lr.item_id=mi.item_id
    WHERE mi.month=p_month AND mi.year=p_year
      AND (
        (mi.w1_received+mi.w2_received+mi.w3_received+mi.w4_received) <> COALESCE(lr.recv,0)
        OR (mi.w1_issued+mi.w2_issued+mi.w3_issued+mi.w4_issued) <> COALESCE(lr.iss,0)
      );

    INSERT INTO inventory_audit_log (month,year,check_type,severity,item_id,sku,message,details)
    SELECT p_month,p_year,'missing_price','warning',mi.item_id,ii.sku,
        format('%s has activity but no unit price ($0).', ii.sku),
        jsonb_build_object('on_hand',mi.on_hand)
    FROM monthly_inventory mi JOIN inventory_items ii ON ii.id=mi.item_id
    WHERE mi.month=p_month AND mi.year=p_year
      AND COALESCE(mi.unit_price, ii.unit_price, 0) = 0
      AND (mi.on_hand <> 0 OR mi.w1_received+mi.w2_received+mi.w3_received+mi.w4_received
                              + mi.w1_issued+mi.w2_issued+mi.w3_issued+mi.w4_issued <> 0);

    INSERT INTO inventory_audit_log (month,year,check_type,severity,item_id,sku,message,details)
    SELECT p_month,p_year,'orphan_item','warning',mi.item_id,ii.sku,
        format('%s has no category assigned.', ii.sku), '{}'::jsonb
    FROM monthly_inventory mi JOIN inventory_items ii ON ii.id=mi.item_id
    WHERE mi.month=p_month AND mi.year=p_year AND ii.category_id IS NULL;

    INSERT INTO inventory_audit_log (month,year,check_type,severity,item_id,sku,message,details)
    SELECT p_month,p_year,'suspicious_qty','info',t.item_id,t.sku,
        format('Large %s movement of %s for %s (week %s) - verify.', t.txn_type, t.quantity, t.sku, t.week_number),
        jsonb_build_object('quantity',t.quantity,'week',t.week_number,'source',t.source_file)
    FROM inventory_transactions t
    WHERE t.month=p_month AND t.year=p_year AND t.quantity > v_susp_qty;

    INSERT INTO inventory_audit_log (month,year,check_type,severity,item_id,sku,message,details)
    SELECT p_month,p_year,'duplicate_week','warning',t.item_id,max(t.sku),
        format('%s received %s separate times in week %s - possible duplicate entry.',
               max(t.sku), count(*), t.week_number),
        jsonb_build_object('count',count(*),'week',t.week_number)
    FROM inventory_transactions t
    WHERE t.month=p_month AND t.year=p_year AND t.txn_type='received'
    GROUP BY t.item_id, t.week_number
    HAVING count(*) >= 3;

    SELECT count(*) INTO v_count FROM inventory_audit_log
    WHERE month=p_month AND year=p_year AND resolved=false;
    RETURN v_count;
END; $$;

REVOKE ALL ON FUNCTION public.audit_inventory_period(integer,integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_inventory_period(integer,integer) TO service_role;
