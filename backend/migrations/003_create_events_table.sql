-- Migration: create_events_table
-- Created at: 2026-06-04
-- Target: MJCCv1

CREATE TABLE IF NOT EXISTS events (
  event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  event_date date NOT NULL,
  cat text NOT NULL, -- Documentation says 'cat', not 'category'
  theme text,
  description text,
  suggested_menu text,
  created_by uuid REFERENCES user_profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE events ENABLE ROW LEVEL SECURITY;

-- Service role bypass
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'events' AND policyname = 'service_role_all') THEN
        CREATE POLICY "service_role_all" ON events TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Authenticated read
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'events' AND policyname = 'authenticated_read') THEN
        CREATE POLICY "authenticated_read" ON events FOR SELECT TO authenticated USING (true);
    END IF;
END $$;
