
-- Add 'corporate' role (global read-only observer) to user_profiles
ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_role_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'manager'::text, 'staff'::text, 'corporate'::text]));
;
