
DO $$
DECLARE
  new_user_id uuid;
BEGIN
  -- Insert into auth.users
  INSERT INTO auth.users (
    id, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    raw_app_meta_data, raw_user_meta_data,
    is_super_admin, role, aud
  )
  VALUES (
    gen_random_uuid(),
    'jeremiah@mjc-cafeteria.com',
    crypt('JerBlue.16', gen_salt('bf', 6)),
    NOW(), NOW(), NOW(),
    '{"provider":"email","providers":["email"]}',
    '{"username":"jeremiah","display_name":"Jeremiah"}',
    FALSE, 'authenticated', 'authenticated'
  )
  RETURNING id INTO new_user_id;

  -- Insert into user_profiles using the returned ID
  INSERT INTO user_profiles (
    id, username, display_name, role, active, created_at, updated_at
  )
  VALUES (
    new_user_id,
    'jeremiah',
    'Jeremiah',
    'admin',
    TRUE,
    NOW(), NOW()
  );
END $$;
;
