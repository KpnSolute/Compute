-- Migration 007 — remove confirmed dead weight (full backup in schema bak_20260619).
-- Drops 9 empty/legacy tables with no live data or code dependency, 1 orphan
-- trigger function, and 3 redundant duplicate views. Rewrites admin_merge_items
-- so it no longer references the dropped child tables.

-- 1. Rewrite admin_merge_items WITHOUT the dead child tables (weekly_counts,
--    qr_codes, inventory_transactions, reorder_alerts). Keeps the real ones:
--    monthly_inventory (conflict-aware) + item_barcodes (straight reassign).
CREATE OR REPLACE FUNCTION public.admin_merge_items(p_keep uuid, p_remove uuid)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE v_keep_sku text; v_remove_sku text;
BEGIN
  IF p_keep IS NULL OR p_remove IS NULL OR p_keep = p_remove THEN
    RAISE EXCEPTION 'keep and remove must be two distinct item ids';
  END IF;
  SELECT sku INTO v_keep_sku   FROM inventory_items WHERE id = p_keep   FOR UPDATE;
  SELECT sku INTO v_remove_sku FROM inventory_items WHERE id = p_remove FOR UPDATE;
  IF v_keep_sku IS NULL OR v_remove_sku IS NULL THEN
    RAISE EXCEPTION 'both items must exist (keep=%, remove=%)', p_keep, p_remove;
  END IF;

  DELETE FROM monthly_inventory r WHERE r.item_id = p_remove
    AND EXISTS (SELECT 1 FROM monthly_inventory k
                 WHERE k.item_id = p_keep AND k.month = r.month AND k.year = r.year);
  UPDATE monthly_inventory SET item_id = p_keep WHERE item_id = p_remove;

  UPDATE item_barcodes SET item_id = p_keep WHERE item_id = p_remove;

  DELETE FROM inventory_items WHERE id = p_remove;

  RETURN jsonb_build_object('kept', p_keep, 'kept_sku', v_keep_sku,
    'removed', p_remove, 'removed_sku', v_remove_sku);
END;
$function$;

-- 2. Drop orphan trigger function (guarded transaction_history, which no longer exists)
DROP FUNCTION IF EXISTS public.block_txn_history_mutation();

-- 3. Drop redundant duplicate views (zero code references; duplicate monthly_inventory/commits access)
DROP VIEW IF EXISTS public.commits_compat;
DROP VIEW IF EXISTS public.v_monthly_inventory;
DROP VIEW IF EXISTS public.v_month_weekly_breakdown;

-- 4. Drop dead-weight tables (all 0 rows except month_close=2 legacy; all backed up)
DROP TABLE IF EXISTS public.email_log CASCADE;
DROP TABLE IF EXISTS public.email_templates CASCADE;
DROP TABLE IF EXISTS public.documents CASCADE;
DROP TABLE IF EXISTS public.uploads CASCADE;
DROP TABLE IF EXISTS public.qr_codes CASCADE;
DROP TABLE IF EXISTS public.reorder_alerts CASCADE;
DROP TABLE IF EXISTS public.inventory_transactions CASCADE;
DROP TABLE IF EXISTS public.weekly_counts CASCADE;
DROP TABLE IF EXISTS public.month_close CASCADE;;
