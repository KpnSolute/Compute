-- Migration: create_haccp_logs_table
-- Created at: 2026-06-04
-- Target: MJCCv1

CREATE TABLE IF NOT EXISTS haccp_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location text NOT NULL,
  temperature float NOT NULL,
  unit text DEFAULT 'F',
  timestamp timestamptz NOT NULL,
  checked_by text,
  notes text,
  logged_by uuid REFERENCES user_profiles(id),
  created_at timestamptz DEFAULT now()
);

ALTER TABLE haccp_logs ENABLE ROW LEVEL SECURITY;

-- Service role bypass
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'haccp_logs' AND policyname = 'service_role_all') THEN
        CREATE POLICY "service_role_all" ON haccp_logs TO service_role USING (true) WITH CHECK (true);
    END IF;
END $$;

-- Authenticated read
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'haccp_logs' AND policyname = 'authenticated_read') THEN
        CREATE POLICY "authenticated_read" ON haccp_logs FOR SELECT TO authenticated USING (true);
    END IF;
END $$;
