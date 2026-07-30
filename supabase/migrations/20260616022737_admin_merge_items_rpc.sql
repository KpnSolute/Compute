-- Deliberate, atomic item merge for the manual-override / remap dedup workflow.
-- When an admin assigns a SKU that another item already holds (e.g. an invoice
-- auto-created a placeholder for it), the two represent the same physical item.
-- The admin picks which to KEEP; this moves every reference off the REMOVE item
-- and deletes it. Conservative conflict rule: where both items already have a row
-- for the same key (month/year, week/year, qr code), the KEPT item's row wins and
-- the removed item's duplicate row is dropped (no summing, fully predictable).
CREATE OR REPLACE FUNCTION public.admin_merge_items(p_keep uuid, p_remove uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_keep_sku text;
  v_remove_sku text;
BEGIN
  IF p_keep IS NULL OR p_remove IS NULL OR p_keep = p_remove THEN
    RAISE EXCEPTION 'keep and remove must be two distinct item ids';
  END IF;
  SELECT sku INTO v_keep_sku   FROM inventory_items WHERE id = p_keep   FOR UPDATE;
  SELECT sku INTO v_remove_sku FROM inventory_items WHERE id = p_remove FOR UPDATE;
  IF v_keep_sku IS NULL OR v_remove_sku IS NULL THEN
    RAISE EXCEPTION 'both items must exist (keep=%, remove=%)', p_keep, p_remove;
  END IF;

  -- Conflict-bearing children: drop the removed item's row where the kept item
  -- already owns the same unique key, then reassign the rest.
  DELETE FROM monthly_inventory r WHERE r.item_id = p_remove
    AND EXISTS (SELECT 1 FROM monthly_inventory k
                 WHERE k.item_id = p_keep AND k.month = r.month AND k.year = r.year);
  UPDATE monthly_inventory SET item_id = p_keep WHERE item_id = p_remove;

  DELETE FROM weekly_counts r WHERE r.item_id = p_remove
    AND EXISTS (SELECT 1 FROM weekly_counts k
                 WHERE k.item_id = p_keep AND k.week_number = r.week_number AND k.year = r.year);
  UPDATE weekly_counts SET item_id = p_keep WHERE item_id = p_remove;

  DELETE FROM qr_codes r WHERE r.item_id = p_remove
    AND EXISTS (SELECT 1 FROM qr_codes k WHERE k.item_id = p_keep AND k.code = r.code);
  UPDATE qr_codes SET item_id = p_keep WHERE item_id = p_remove;

  -- Conflict-free children: straight reassign.
  UPDATE inventory_transactions SET item_id = p_keep WHERE item_id = p_remove;
  UPDATE item_barcodes          SET item_id = p_keep WHERE item_id = p_remove;
  UPDATE reorder_alerts         SET item_id = p_keep WHERE item_id = p_remove;

  DELETE FROM inventory_items WHERE id = p_remove;

  RETURN jsonb_build_object(
    'kept', p_keep, 'kept_sku', v_keep_sku,
    'removed', p_remove, 'removed_sku', v_remove_sku
  );
END;
$$;

-- Lock down: only the service role (the API) may call it; not anon/authenticated clients.
REVOKE ALL ON FUNCTION public.admin_merge_items(uuid, uuid) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_merge_items(uuid, uuid) TO service_role;;
