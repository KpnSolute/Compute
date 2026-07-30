
-- Insert system migration user into user_profiles
INSERT INTO user_profiles (id, username, display_name, role, active, created_at, updated_at)
VALUES (
  '00000000-0000-0000-0000-000000000001'::uuid,
  'system',
  'System Migration',
  'admin',
  false,
  NOW(),
  NOW()
)
ON CONFLICT (id) DO NOTHING;
;
