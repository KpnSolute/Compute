-- Reconcile July 2026 after formula enforcement without touching published periods.

BEGIN;

DO $block$
BEGIN
  IF EXISTS (SELECT 1 FROM public.month_status WHERE month = 6 AND year = 2026 AND status = 'open') THEN
    UPDATE public.monthly_inventory
    SET unit_price = COALESCE(NULLIF(monthly_inventory.unit_price, 0),
      (SELECT NULLIF(ii.unit_price, 0) FROM public.inventory_items ii WHERE ii.id = monthly_inventory.item_id), 0)
    WHERE month = 6 AND year = 2026;

    UPDATE public.monthly_inventory
    SET opening_unit_cost = round(greatest(0::numeric, coalesce(unit_price, 0)), 6),
        opening_value = round(greatest(0::numeric, coalesce(opening_oh, 0)) * greatest(0::numeric, coalesce(unit_price, 0)), 2),
        received_value = round((coalesce(w1_received, 0) + coalesce(w2_received, 0) + coalesce(w3_received, 0)) * greatest(0::numeric, coalesce(unit_price, 0)), 2),
        pulled_value = round((coalesce(w1_pulled, 0) + coalesce(w2_pulled, 0) + coalesce(w3_pulled, 0)) * greatest(0::numeric, coalesce(unit_price, 0)), 2),
        ending_value = round(greatest(0::numeric, coalesce(opening_oh, 0) + coalesce(w1_received, 0) + coalesce(w2_received, 0) + coalesce(w3_received, 0) - coalesce(w1_pulled, 0) - coalesce(w2_pulled, 0) - coalesce(w3_pulled, 0)) * greatest(0::numeric, coalesce(unit_price, 0)), 2)
    WHERE month = 6 AND year = 2026;
  END IF;
END
$block$;

COMMIT;
