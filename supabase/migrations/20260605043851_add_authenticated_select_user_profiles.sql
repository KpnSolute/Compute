
-- Allow authenticated users (logged-in via Supabase Auth) to read profiles.
-- This is needed for the frontend admin login flow: after signInWithPassword()
-- succeeds, the client fetches the user_profiles row to build the session object.
CREATE POLICY "authenticated_select" ON user_profiles
  FOR SELECT TO authenticated
  USING (true);
;
