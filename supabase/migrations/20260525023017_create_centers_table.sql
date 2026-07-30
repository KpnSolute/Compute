
-- Centers table: supports multi-tenancy (currently single MJCC center)
CREATE TABLE public.centers (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  code text UNIQUE,
  address text,
  city  text,
  state text,
  created_at timestamptz DEFAULT now()
);

-- Seed the single MJCC center with a stable UUID
INSERT INTO public.centers (id, name, code, city, state)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'Miami Job Corps Cafeteria',
  'MJCC',
  'Miami',
  'FL'
);

ALTER TABLE public.centers ENABLE ROW LEVEL SECURITY;

-- Everyone can read centers
CREATE POLICY "centers_select_authenticated"
  ON public.centers FOR SELECT
  USING (auth.role() = 'authenticated');

-- Only admin can mutate
CREATE POLICY "centers_admin_write"
  ON public.centers FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_profiles
      WHERE id = auth.uid() AND role = 'admin'
    )
  );
;
