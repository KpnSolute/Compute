
ALTER TABLE public.invoices ADD COLUMN IF NOT EXISTS fuel_surcharge numeric(10,2) DEFAULT 0;
COMMENT ON COLUMN public.invoices.fuel_surcharge IS 'US Foods fuel surcharge added to net total. Not subject to VIZIENT discount.';
;
