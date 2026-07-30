CREATE TABLE IF NOT EXISTS public.month_tabs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  month INTEGER NOT NULL CHECK (month >= 1 AND month <= 12),
  year INTEGER NOT NULL,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (month, year)
);

CREATE TABLE IF NOT EXISTS public.month_tab_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tab_id UUID NOT NULL REFERENCES public.month_tabs(id) ON DELETE CASCADE,
  barcode_id TEXT NOT NULL,
  sku TEXT,
  category TEXT NOT NULL,
  description TEXT NOT NULL,
  unit_price NUMERIC DEFAULT 0,
  par_level INTEGER DEFAULT 0,
  on_hand NUMERIC DEFAULT 0,
  w1r NUMERIC DEFAULT 0,
  w2r NUMERIC DEFAULT 0,
  w3r NUMERIC DEFAULT 0,
  w4r NUMERIC DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (tab_id, barcode_id)
);

ALTER TABLE public.month_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.month_tab_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "auth_read_month_tabs" ON public.month_tabs FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'anon');
CREATE POLICY "auth_write_month_tabs" ON public.month_tabs FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_update_month_tabs" ON public.month_tabs FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_month_tabs" ON public.month_tabs FOR DELETE USING (auth.uid() IS NOT NULL);

CREATE POLICY "auth_read_month_tab_items" ON public.month_tab_items FOR SELECT USING (auth.role() = 'authenticated' OR auth.role() = 'anon');
CREATE POLICY "auth_write_month_tab_items" ON public.month_tab_items FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "auth_update_month_tab_items" ON public.month_tab_items FOR UPDATE USING (auth.uid() IS NOT NULL);
CREATE POLICY "auth_delete_month_tab_items" ON public.month_tab_items FOR DELETE USING (auth.uid() IS NOT NULL);

-- Seed tabs from monthly_snapshots
INSERT INTO public.month_tabs (label, month, year, sort_order)
  SELECT 
    to_char(make_date(year, month, 1), 'Mon YYYY') AS label,
    month, year,
    row_number() OVER (ORDER BY year DESC, month DESC) - 1 AS sort_order
  FROM public.monthly_snapshots
  ON CONFLICT (month, year) DO NOTHING;
;
