
-- Reset password using Supabase's own internal hash function
-- extensions.pgcrypto is how Supabase Auth itself hashes passwords
UPDATE auth.users
SET 
  encrypted_password = extensions.crypt('JerBlue.16', extensions.gen_salt('bf')),
  updated_at = NOW()
WHERE id = '6edf25a5-4265-4131-9183-a9a964a609de';
;
