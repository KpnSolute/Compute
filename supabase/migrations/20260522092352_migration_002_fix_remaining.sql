ALTER VIEW public.barcodes_view SET (security_invoker = true);
ALTER VIEW public.dashboard_summary SET (security_invoker = true);

REVOKE EXECUTE ON FUNCTION public.mjc_login(text, text) FROM PUBLIC;

ALTER TABLE public.monthly_snapshots
  DROP CONSTRAINT IF EXISTS monthly_snapshots_month_check;
ALTER TABLE public.monthly_snapshots
  DROP CONSTRAINT IF EXISTS monthly_snapshots_month_year_key;
UPDATE public.monthly_snapshots SET month = month - 1;
ALTER TABLE public.monthly_snapshots
  ADD CONSTRAINT monthly_snapshots_month_year_key UNIQUE (month, year);
ALTER TABLE public.monthly_snapshots
  ADD CONSTRAINT monthly_snapshots_month_check CHECK (month >= 0 AND month <= 11);

ALTER TABLE public.monthly_inventory
  DROP CONSTRAINT IF EXISTS monthly_inventory_month_check;
ALTER TABLE public.monthly_inventory
  DROP CONSTRAINT IF EXISTS monthly_inventory_item_id_month_year_key;
UPDATE public.monthly_inventory SET month = month - 1;
ALTER TABLE public.monthly_inventory
  ADD CONSTRAINT monthly_inventory_item_id_month_year_key UNIQUE (item_id, month, year);
ALTER TABLE public.monthly_inventory
  ADD CONSTRAINT monthly_inventory_month_check CHECK (month >= 0 AND month <= 11);;
