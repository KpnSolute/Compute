-- First-class authorization scope model for MJCC.
-- FastAPI remains the only writer/reader for browser-facing role management.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.permission_scopes (
  key text PRIMARY KEY,
  label text NOT NULL,
  group_name text NOT NULL,
  min_role text NOT NULL CHECK (min_role IN ('staff', 'assistant', 'manager', 'admin', 'sudo')),
  sort_order integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.role_permissions (
  role text NOT NULL CHECK (role IN ('staff', 'assistant', 'manager', 'admin', 'sudo')),
  scope_key text NOT NULL REFERENCES public.permission_scopes(key) ON DELETE CASCADE,
  allowed boolean NOT NULL DEFAULT true,
  updated_by uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (role, scope_key)
);

CREATE INDEX IF NOT EXISTS idx_role_permissions_scope_key
  ON public.role_permissions(scope_key);

CREATE TABLE IF NOT EXISTS public.credential_access_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  target_user_id uuid REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('view', 'password_reset', 'pin_update', 'username_update')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_credential_access_audit_actor
  ON public.credential_access_audit(actor_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_credential_access_audit_target
  ON public.credential_access_audit(target_user_id, created_at DESC);

ALTER TABLE public.permission_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.credential_access_audit ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.permission_scopes FROM anon, authenticated;
REVOKE ALL ON TABLE public.role_permissions FROM anon, authenticated;
REVOKE ALL ON TABLE public.credential_access_audit FROM anon, authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.permission_scopes TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.role_permissions TO service_role;
GRANT SELECT, INSERT ON TABLE public.credential_access_audit TO service_role;

INSERT INTO public.permission_scopes (key, label, group_name, min_role, sort_order)
VALUES
  ('dashboard', 'Dashboard', 'Overview', 'staff', 10),
  ('inventory', 'Inventory', 'Data Entry', 'staff', 20),
  ('moninv', 'Monthly Inventory', 'Data Entry', 'assistant', 30),
  ('pullsheet', 'Pull Sheet', 'Data Entry', 'manager', 40),
  ('mballot', 'Meal Log', 'Data Entry', 'staff', 50),
  ('foodreq', 'Food Request', 'Data Entry', 'staff', 60),
  ('dataentry', 'Data Entry', 'Data Entry', 'assistant', 70),
  ('barcodes', 'Barcodes & Scan', 'Data Entry', 'staff', 80),
  ('haccp', 'HACCP & Logs', 'Logs', 'assistant', 90),
  ('dailyops', 'Daily Operations', 'Logs', 'assistant', 100),
  ('inspection', 'Inspection Sheet', 'Logs', 'assistant', 110),
  ('snackbar', 'Snack Bar', 'Logs', 'assistant', 120),
  ('events', 'Events & Programs', 'Calendar', 'staff', 130),
  ('menu', '28-Day Menu', 'Calendar', 'assistant', 140),
  ('sourcectrl', 'Source Control', 'Records', 'staff', 150),
  ('reports', 'Reports', 'Records', 'staff', 160),
  ('archives', 'Archives', 'Records', 'assistant', 170),
  ('ai-usage', 'My Usage', 'AI Studio', 'manager', 180),
  ('ai-tools', 'Tools', 'AI Studio', 'manager', 190),
  ('ai-presets', 'Automation', 'AI Studio', 'manager', 200),
  ('users', 'Users & Access', 'Administration', 'manager', 210),
  ('settings', 'Settings', 'Administration', 'admin', 220)
ON CONFLICT (key) DO UPDATE
SET
  label = EXCLUDED.label,
  group_name = EXCLUDED.group_name,
  min_role = EXCLUDED.min_role,
  sort_order = EXCLUDED.sort_order,
  active = true,
  updated_at = now();

WITH defaults(role, scope_key) AS (
  VALUES
    ('staff', 'dashboard'),
    ('staff', 'inventory'),
    ('staff', 'mballot'),
    ('staff', 'foodreq'),
    ('staff', 'barcodes'),
    ('staff', 'events'),
    ('staff', 'sourcectrl'),
    ('staff', 'reports'),
    ('assistant', 'dashboard'),
    ('assistant', 'inventory'),
    ('assistant', 'moninv'),
    ('assistant', 'mballot'),
    ('assistant', 'foodreq'),
    ('assistant', 'dataentry'),
    ('assistant', 'barcodes'),
    ('assistant', 'haccp'),
    ('assistant', 'dailyops'),
    ('assistant', 'inspection'),
    ('assistant', 'snackbar'),
    ('assistant', 'events'),
    ('assistant', 'menu'),
    ('assistant', 'sourcectrl'),
    ('assistant', 'reports'),
    ('assistant', 'archives'),
    ('manager', 'dashboard'),
    ('manager', 'inventory'),
    ('manager', 'moninv'),
    ('manager', 'pullsheet'),
    ('manager', 'mballot'),
    ('manager', 'foodreq'),
    ('manager', 'dataentry'),
    ('manager', 'barcodes'),
    ('manager', 'haccp'),
    ('manager', 'dailyops'),
    ('manager', 'inspection'),
    ('manager', 'snackbar'),
    ('manager', 'events'),
    ('manager', 'menu'),
    ('manager', 'sourcectrl'),
    ('manager', 'reports'),
    ('manager', 'archives'),
    ('manager', 'ai-usage'),
    ('manager', 'ai-tools'),
    ('manager', 'ai-presets'),
    ('manager', 'users'),
    ('admin', 'dashboard'),
    ('admin', 'inventory'),
    ('admin', 'moninv'),
    ('admin', 'pullsheet'),
    ('admin', 'mballot'),
    ('admin', 'foodreq'),
    ('admin', 'dataentry'),
    ('admin', 'barcodes'),
    ('admin', 'haccp'),
    ('admin', 'dailyops'),
    ('admin', 'inspection'),
    ('admin', 'snackbar'),
    ('admin', 'events'),
    ('admin', 'menu'),
    ('admin', 'sourcectrl'),
    ('admin', 'reports'),
    ('admin', 'archives'),
    ('admin', 'ai-usage'),
    ('admin', 'ai-tools'),
    ('admin', 'ai-presets'),
    ('admin', 'users'),
    ('admin', 'settings'),
    ('sudo', 'dashboard'),
    ('sudo', 'inventory'),
    ('sudo', 'moninv'),
    ('sudo', 'pullsheet'),
    ('sudo', 'mballot'),
    ('sudo', 'foodreq'),
    ('sudo', 'dataentry'),
    ('sudo', 'barcodes'),
    ('sudo', 'haccp'),
    ('sudo', 'dailyops'),
    ('sudo', 'inspection'),
    ('sudo', 'snackbar'),
    ('sudo', 'events'),
    ('sudo', 'menu'),
    ('sudo', 'sourcectrl'),
    ('sudo', 'reports'),
    ('sudo', 'archives'),
    ('sudo', 'ai-usage'),
    ('sudo', 'ai-tools'),
    ('sudo', 'ai-presets'),
    ('sudo', 'users'),
    ('sudo', 'settings')
)
INSERT INTO public.role_permissions (role, scope_key, allowed, updated_at)
SELECT role, scope_key, true, now()
FROM defaults
ON CONFLICT (role, scope_key) DO NOTHING;

WITH legacy AS (
  SELECT setting_value
  FROM public.app_settings
  WHERE setting_key = 'auth_role_scopes'
  LIMIT 1
),
legacy_rows AS (
  SELECT role.key AS role, scope.value #>> '{}' AS scope_key
  FROM legacy,
       jsonb_each(legacy.setting_value) AS role,
       jsonb_array_elements(role.value) AS scope
  WHERE role.key IN ('staff', 'assistant', 'manager', 'admin', 'sudo')
)
INSERT INTO public.role_permissions (role, scope_key, allowed, updated_at)
SELECT legacy_rows.role, legacy_rows.scope_key, true, now()
FROM legacy_rows
JOIN public.permission_scopes ps ON ps.key = legacy_rows.scope_key
ON CONFLICT (role, scope_key) DO UPDATE
SET allowed = true, updated_at = now();
