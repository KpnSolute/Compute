
-- Supabase uses bcrypt cost 10 internally, not 6
-- Insert with the correct cost factor that matches what Supabase Auth expects
DO $$
DECLARE
  new_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO auth.users (
    id,
    instance_id,
    email,
    encrypted_password,
    email_confirmed_at,
    created_at,
    updated_at,
    raw_app_meta_data,
    raw_user_meta_data,
    is_super_admin,
    role,
    aud,
    confirmation_token,
    recovery_token,
    email_change_token_new,
    email_change
  ) VALUES (
    new_id,
    '00000000-0000-0000-0000-000000000000',
    'jeremiah@mjc-cafeteria.com',
    extensions.crypt('JerBlue.16', extensions.gen_salt('bf', 10)),
    NOW(),
    NOW(),
    NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"jeremiah","display_name":"Jeremiah"}',
    FALSE,
    'authenticated',
    'authenticated',
    '', '', '', ''
  );

  INSERT INTO user_profiles (
    id, username, display_name, role, active, created_at, updated_at
  ) VALUES (
    new_id, 'jeremiah', 'Jeremiah', 'admin', TRUE, NOW(), NOW()
  );
END $$;
;
