-- Default-credential tracking: managers are provisioned with the standard
-- default password (Manager@2026) and staff with the default PIN (2222).
-- must_change_password is a stored flag because Auth passwords are hashed;
-- the PIN default state is derived directly from user_profiles.pin = '2222'.

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS must_change_password boolean NOT NULL DEFAULT false;
