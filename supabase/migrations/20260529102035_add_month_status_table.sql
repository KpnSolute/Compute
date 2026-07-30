CREATE TABLE IF NOT EXISTS public.month_status (
  id          serial PRIMARY KEY,
  month       integer NOT NULL CHECK (month BETWEEN 0 AND 11),
  year        integer NOT NULL CHECK (year BETWEEN 2020 AND 2040),
  status      text    NOT NULL DEFAULT 'open' CHECK (status IN ('open','published')),
  opened_at   timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  published_by uuid REFERENCES public.user_profiles(id),
  UNIQUE (month, year)
);

-- Seed the current open month (May 2026 = month 4)
INSERT INTO public.month_status (month, year, status)
VALUES (4, 2026, 'open')
ON CONFLICT (month, year) DO NOTHING;;
