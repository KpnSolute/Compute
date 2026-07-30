
INSERT INTO public.user_profiles (id, username, display_name, role, pin, active)
VALUES
  -- Admins
  ('3b9cc7c2-ef21-4c49-aa86-332d8057a208', 'sudo',        'Super Admin',    'admin',   NULL,   true),
  ('11abc18f-8403-44d7-b2b3-09d4023cca16', 'admin',       'Admin',          'admin',   NULL,   true),
  ('57eb60ae-f0f0-4992-bc76-df0dea4519df', 'othniel',     'Othniel',        'admin',   NULL,   true),
  -- Manager / Accountant
  ('f040c512-90d4-4636-b0a4-d25130013749', 'accountant',  'Accountant',     'manager', NULL,   true),
  -- Developer (admin-level access)
  ('9247a11f-6529-4fbf-802d-a8ec28d8f0c2', 'developer',  'Developer',      'admin',   NULL,   true),
  -- Staff
  ('8079746f-c7cd-445b-999c-453e92b8116a', 'staff1',     'Staff One',      'staff',   '1234', true),
  ('a9e4777d-fa2b-4520-abba-6834edee7f0d', 'staff2',     'Staff Two',      'staff',   '1234', true),
  ('7361734a-f1c5-45fb-9363-d24c549a1df3', 'staff3',     'Staff Three',    'staff',   '1234', true),
  ('b6fd5774-c6cb-4dcf-93f9-da804c94c2c8', 'staff4',     'Staff Four',     'staff',   '1234', true),
  ('8b10d061-0896-4ada-be26-c987052b3913', 'staff5',     'Staff Five',     'staff',   '1234', true),
  ('5f3ac2c8-983b-415f-8f8d-4f326156f64c', 'staff6',     'Staff Six',      'staff',   '1234', true)
ON CONFLICT (id) DO NOTHING;
;
