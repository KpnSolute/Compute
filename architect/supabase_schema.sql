CREATE TABLE IF NOT EXISTS public.user_profiles (
  id           UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username     TEXT UNIQUE NOT NULL,
  display_name TEXT,
  role         TEXT NOT NULL DEFAULT 'staff'
                 CHECK (role IN ('admin','manager','staff')),
  pin          TEXT,
  active       BOOLEAN NOT NULL DEFAULT true,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_profile" ON public.user_profiles;
CREATE POLICY "users_read_own_profile" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "admin_manage_profiles" ON public.user_profiles;
CREATE POLICY "admin_manage_profiles" ON public.user_profiles
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles p
      WHERE p.id = auth.uid() AND p.role IN ('admin','manager')
    )
  );

ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS price;
ALTER TABLE public.inventory_items DROP COLUMN IF EXISTS name;

ALTER TABLE public.monthly_snapshots
  DROP CONSTRAINT IF EXISTS monthly_snapshots_month_check;
ALTER TABLE public.monthly_snapshots
  ADD CONSTRAINT monthly_snapshots_month_check
  CHECK (month >= 0 AND month <= 11);
ALTER TABLE public.monthly_snapshots
  ADD COLUMN IF NOT EXISTS wk1_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wk2_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wk3_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wk4_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starting_total NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saved_by       UUID REFERENCES auth.users(id);

ALTER TABLE public.monthly_inventory
  DROP CONSTRAINT IF EXISTS monthly_inventory_month_check;
ALTER TABLE public.monthly_inventory
  ADD CONSTRAINT monthly_inventory_month_check
  CHECK (month >= 0 AND month <= 11);

ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vizient_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_total        NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_by       UUID REFERENCES auth.users(id);

CREATE OR REPLACE VIEW public.barcodes_view WITH (security_invoker = true) AS
SELECT
  b.id,
  b.barcode_id,
  ii.sku,
  ic.name        AS category,
  ic.color       AS category_color,
  ii.description,
  ii.unit_price,
  ii.par_level,
  ii.on_hand,
  b.barcode_type,
  b.is_active,
  ii.id          AS item_id
FROM public.barcodes b
JOIN public.inventory_items     ii ON ii.barcode_id = b.barcode_id
JOIN public.inventory_categories ic ON ic.id        = ii.category_id;

DROP TABLE IF EXISTS public.suppliers CASCADE;
DROP TABLE IF EXISTS public.categories CASCADE;

CREATE OR REPLACE VIEW public.dashboard_summary WITH (security_invoker = true) AS
SELECT
  mi.id                                                AS state_id,
  mi.item_id,
  ii.sku,
  ii.description,
  ic.name                                              AS category,
  ic.color                                             AS category_color,
  ii.unit_price,
  ii.par_level,
  ii.barcode_id,
  mi.on_hand,
  mi.month,
  mi.year,
  mi.w1_received,  mi.w2_received,
  mi.w3_received,  mi.w4_received,
  mi.w1_issued,    mi.w2_issued,
  mi.w3_issued,    mi.w4_issued,
  GREATEST(0,
    mi.on_hand
    + COALESCE(mi.w1_received,0) + COALESCE(mi.w2_received,0)
    + COALESCE(mi.w3_received,0) + COALESCE(mi.w4_received,0)
    - COALESCE(mi.w1_issued,0)   - COALESCE(mi.w2_issued,0)
    - COALESCE(mi.w3_issued,0)   - COALESCE(mi.w4_issued,0)
  )                                                    AS ending_qty,
  GREATEST(0,
    mi.on_hand
    + COALESCE(mi.w1_received,0) + COALESCE(mi.w2_received,0)
    + COALESCE(mi.w3_received,0) + COALESCE(mi.w4_received,0)
    - COALESCE(mi.w1_issued,0)   - COALESCE(mi.w2_issued,0)
    - COALESCE(mi.w3_issued,0)   - COALESCE(mi.w4_issued,0)
  ) * ii.unit_price                                    AS item_total,
  COALESCE(mi.w1_received,0) * ii.unit_price           AS w1_value,
  COALESCE(mi.w2_received,0) * ii.unit_price           AS w2_value,
  COALESCE(mi.w3_received,0) * ii.unit_price           AS w3_value,
  COALESCE(mi.w4_received,0) * ii.unit_price           AS w4_value,
  (mi.on_hand < ii.par_level AND ii.par_level > 0)     AS needs_reorder
FROM public.monthly_inventory   mi
JOIN public.inventory_items     ii ON ii.id  = mi.item_id
JOIN public.inventory_categories ic ON ic.id = ii.category_id;

REVOKE EXECUTE ON FUNCTION public.mjc_login(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mjc_login(text, text) FROM authenticated;
REVOKE EXECUTE ON FUNCTION public.mjc_login(text, text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
