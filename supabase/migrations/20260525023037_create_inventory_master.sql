
-- Sheet 1: finalized live inventory state
-- One row = one unique item per center (barcode is the cell address)
CREATE TABLE public.inventory_master (
  id          uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
  center_id   uuid    NOT NULL REFERENCES public.centers(id),
  barcode     text    NOT NULL,
  item_name   text    NOT NULL,
  sku         text,
  category    text,
  unit        text    DEFAULT 'CS',
  unit_price  numeric DEFAULT 0,
  par_level   integer DEFAULT 0,
  quantity    numeric NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  active      boolean DEFAULT true,
  created_at  timestamptz DEFAULT now(),
  updated_at  timestamptz DEFAULT now(),
  UNIQUE (center_id, barcode)
);

-- Seed from existing barcodes table (316 items)
INSERT INTO public.inventory_master
  (center_id, barcode, item_name, sku, category, unit_price, par_level, quantity, active)
SELECT
  '00000000-0000-0000-0000-000000000001',
  b.barcode_id,
  b.description,
  b.sku,
  b.category,
  COALESCE(b.unit_price, 0),
  COALESCE(b.par_level, 0),
  COALESCE(b.on_hand, 0),
  COALESCE(b.is_active, true)
FROM public.barcodes b
WHERE b.barcode_id IS NOT NULL
ON CONFLICT (center_id, barcode) DO NOTHING;

ALTER TABLE public.inventory_master ENABLE ROW LEVEL SECURITY;

-- Corporate: global read-only
CREATE POLICY "im_corporate_select"
  ON public.inventory_master FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'corporate')
  );

-- Admin / Manager: full read-write
CREATE POLICY "im_manager_all"
  ON public.inventory_master FOR ALL
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role IN ('admin', 'manager'))
  );

-- Staff: read-only (cannot touch inventory_master directly)
CREATE POLICY "im_staff_select"
  ON public.inventory_master FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'staff')
  );
;
