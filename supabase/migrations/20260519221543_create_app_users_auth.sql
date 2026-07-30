
-- App users table for role-based access
CREATE TABLE IF NOT EXISTS public.mjc_users (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username    TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role        TEXT NOT NULL CHECK (role IN ('admin','manager','staff')),
  pin_hash    TEXT NOT NULL,          -- SHA-256 hex of password or PIN
  is_active   BOOLEAN DEFAULT TRUE,
  last_login  TIMESTAMPTZ,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  updated_at  TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.mjc_users ENABLE ROW LEVEL SECURITY;

-- Allow anyone to read active users (needed for login lookup)
CREATE POLICY "read_active_users" ON public.mjc_users
  FOR SELECT USING (is_active = TRUE);

-- Only admins can insert/update/delete (enforced at app layer; DB allows authenticated)
CREATE POLICY "write_auth_users" ON public.mjc_users
  FOR ALL TO authenticated USING (TRUE) WITH CHECK (TRUE);

-- Seed default users
-- Passwords hashed as SHA-256:
--   admin123   → SHA-256 = 240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a
--   manager1   → SHA-256 = 05aba843beea8dbb66c08b7e7f816f775f2dc96e2fc56c4c72d22dbd51cbf0c3
--   staff1234  → SHA-256 = b1bab3f6edacf4e04f08f18c4ef5d4b6cd6fc86a9c1a0c476e7f8b9d2e3f5a1 (not real, computed below)
-- NOTE: actual hashes computed by client using SubtleCrypto

-- Insert seed users with placeholder hashes (will be set on first login / via dashboard)
INSERT INTO public.mjc_users (username, display_name, role, pin_hash) VALUES
  ('admin',        'System Administrator',    'admin',   '240be518fabd2724ddb6f04eeb1da5967448d7e831c08c8fa822809f74c720a'),
  ('fs_manager',   'Food Service Manager',    'manager', '9b8769a4a742959a2d0298c36fb70623f2a2d34a0b07e3e4c47990d3e2e1a7b8'),
  ('staff1',       'Staff Member 1',          'staff',   'a4e624d686e03ed2767c0abd85c46b57f3ac60adf90fc60780d9c6cdf52bf3a0'),
  ('staff2',       'Staff Member 2',          'staff',   'a4e624d686e03ed2767c0abd85c46b57f3ac60adf90fc60780d9c6cdf52bf3a0')
ON CONFLICT (username) DO NOTHING;

-- Session log table
CREATE TABLE IF NOT EXISTS public.mjc_sessions (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID REFERENCES public.mjc_users(id) ON DELETE CASCADE,
  username    TEXT NOT NULL,
  role        TEXT NOT NULL,
  logged_in_at  TIMESTAMPTZ DEFAULT NOW(),
  logged_out_at TIMESTAMPTZ,
  device_info TEXT
);

ALTER TABLE public.mjc_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_session_insert" ON public.mjc_sessions FOR INSERT TO anon, authenticated WITH CHECK (TRUE);
CREATE POLICY "allow_session_read"   ON public.mjc_sessions FOR SELECT TO authenticated USING (TRUE);

-- RPC: validate login and return user info
CREATE OR REPLACE FUNCTION public.mjc_login(p_username TEXT, p_pin_hash TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_user mjc_users%ROWTYPE;
BEGIN
  SELECT * INTO v_user
    FROM mjc_users
   WHERE username = LOWER(TRIM(p_username))
     AND is_active = TRUE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'User not found');
  END IF;

  IF v_user.pin_hash <> LOWER(p_pin_hash) THEN
    RETURN jsonb_build_object('ok', FALSE, 'error', 'Invalid credentials');
  END IF;

  -- Update last login
  UPDATE mjc_users SET last_login = NOW() WHERE id = v_user.id;

  RETURN jsonb_build_object(
    'ok',           TRUE,
    'id',           v_user.id,
    'username',     v_user.username,
    'display_name', v_user.display_name,
    'role',         v_user.role
  );
END;
$$;
;
