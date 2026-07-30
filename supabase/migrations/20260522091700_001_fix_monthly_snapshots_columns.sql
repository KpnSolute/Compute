
-- Keep month as 1-12 in DB. API layer will translate to/from JS 0-11.
-- Just add the missing columns.
ALTER TABLE public.monthly_snapshots
  ADD COLUMN IF NOT EXISTS wk1_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wk2_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wk3_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wk4_total      NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS starting_total NUMERIC(12,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS saved_by       UUID REFERENCES auth.users(id);
;
