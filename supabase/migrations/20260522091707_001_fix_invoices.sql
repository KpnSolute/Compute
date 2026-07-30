
ALTER TABLE public.invoices
  ADD COLUMN IF NOT EXISTS vizient_discount NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS net_total        NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS applied_by       UUID REFERENCES auth.users(id);
;
