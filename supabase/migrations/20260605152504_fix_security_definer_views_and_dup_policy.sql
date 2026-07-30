
-- Convert SECURITY DEFINER views to security_invoker (linter 0010, ERROR level).
-- Both views are unused by the service-role backend; with security_invoker the
-- backend (service_role) still bypasses RLS, while direct authenticated access
-- correctly respects underlying-table RLS.
ALTER VIEW public.dashboard_summary SET (security_invoker = on);
ALTER VIEW public.commits_compat SET (security_invoker = on);

-- Drop the redundant duplicate permissive policy on user_profiles (linter 0006);
-- authenticated_read (identical: SELECT TO authenticated USING true) remains.
DROP POLICY IF EXISTS authenticated_select ON public.user_profiles;
;
