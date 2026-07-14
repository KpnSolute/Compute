-- Make a parsed invoice and its line items the authoritative receipt record.

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_status_check;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_status_check
  CHECK (status = ANY (ARRAY[
    'pending'::text,
    'received'::text,
    'verified'::text,
    'paid'::text,
    'disputed'::text,
    'rejected'::text
  ]));

ALTER TABLE public.invoices
  DROP CONSTRAINT IF EXISTS invoices_applied_by_fkey;

ALTER TABLE public.invoices
  ADD CONSTRAINT invoices_applied_by_fkey
  FOREIGN KEY (applied_by) REFERENCES public.user_profiles(id) ON DELETE SET NULL;

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS total_items_shipped integer,
  ADD COLUMN IF NOT EXISTS total_pieces_delivered integer,
  ADD COLUMN IF NOT EXISTS source_hash text;

CREATE UNIQUE INDEX IF NOT EXISTS invoices_invoice_number_uidx
  ON public.invoices (vendor_id, invoice_number)
  WHERE vendor_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS invoices_source_hash_idx
  ON public.invoices (source_hash);

ALTER TABLE public.invoice_items
  ADD COLUMN IF NOT EXISTS line_number integer,
  ADD COLUMN IF NOT EXISTS inventory_item_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'invoice_items_inventory_item_id_fkey'
      AND conrelid = 'public.invoice_items'::regclass
  ) THEN
    ALTER TABLE public.invoice_items
      ADD CONSTRAINT invoice_items_inventory_item_id_fkey
      FOREIGN KEY (inventory_item_id)
      REFERENCES public.inventory_items(id)
      ON DELETE SET NULL;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_invoice_line_uidx
  ON public.invoice_items (invoice_id, line_number);

CREATE INDEX IF NOT EXISTS invoice_items_inventory_item_id_idx
  ON public.invoice_items (inventory_item_id);

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
