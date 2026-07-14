-- Scope invoice identity to the vendor and finalize/link by immutable invoice id.

DROP INDEX IF EXISTS public.invoices_invoice_number_uidx;

CREATE UNIQUE INDEX invoices_invoice_number_uidx
  ON public.invoices (vendor_id, invoice_number)
  WHERE vendor_id IS NOT NULL;

DROP FUNCTION IF EXISTS public.link_invoice_items_by_number(text);

CREATE OR REPLACE FUNCTION public.link_invoice_items_by_id(p_invoice_id uuid)
RETURNS integer
LANGUAGE sql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  WITH linked AS (
    UPDATE public.invoice_items AS line
    SET inventory_item_id = item.id
    FROM public.inventory_items AS item
    WHERE line.invoice_id = p_invoice_id
      AND item.sku = line.sku
      AND line.inventory_item_id IS DISTINCT FROM item.id
    RETURNING line.id
  )
  SELECT count(*)::integer FROM linked;
$$;

REVOKE ALL ON FUNCTION public.link_invoice_items_by_id(uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.link_invoice_items_by_id(uuid)
  TO service_role;
