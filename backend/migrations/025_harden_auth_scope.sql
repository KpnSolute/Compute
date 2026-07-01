-- Harden browser-facing auth/profile scope for the backend-mediated API model.
--
-- Frontend data access goes through FastAPI, which uses the service role after
-- validating the bearer token and user_profiles.role. Browser Supabase sessions
-- should not be able to enumerate profiles/settings through PostgREST.

ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS authenticated_read ON public.user_profiles;
DROP POLICY IF EXISTS authenticated_read ON public.app_settings;

DROP POLICY IF EXISTS user_profiles_self_read ON public.user_profiles;
CREATE POLICY user_profiles_self_read
  ON public.user_profiles
  FOR SELECT
  TO authenticated
  USING ((SELECT auth.uid()) = id);

DROP POLICY IF EXISTS app_settings_self_preferences_read ON public.app_settings;
CREATE POLICY app_settings_self_preferences_read
  ON public.app_settings
  FOR SELECT
  TO authenticated
  USING (setting_key = ('user_prefs_' || (SELECT auth.uid())::text));

REVOKE SELECT ON TABLE public.user_profiles FROM anon;
REVOKE SELECT ON TABLE public.app_settings FROM anon;

-- The current browser no longer depends on these direct reads. Leave SELECT
-- grants to authenticated in place so the restrictive RLS policies above decide
-- row visibility if a legacy client still calls the Data API.

REVOKE EXECUTE ON FUNCTION public.sc_attach_to_open_pr(uuid, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sc_attach_to_open_pr(uuid, uuid[]) FROM anon;
REVOKE EXECUTE ON FUNCTION public.sc_attach_to_open_pr(uuid, uuid[]) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.sc_attach_to_open_pr(uuid, uuid[]) TO service_role;

REVOKE EXECUTE ON FUNCTION public.trg_refresh_snapshot_stmt() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_snapshot_stmt() FROM anon;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_snapshot_stmt() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.trg_refresh_snapshot_stmt() TO service_role;
