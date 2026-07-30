
ALTER TABLE public.mjc_users DROP CONSTRAINT IF EXISTS mjc_users_role_check;
ALTER TABLE public.mjc_users ADD CONSTRAINT mjc_users_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'manager'::text, 'staff'::text, 'sudo'::text]));
;
