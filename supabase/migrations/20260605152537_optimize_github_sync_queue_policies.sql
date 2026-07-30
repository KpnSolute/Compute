
-- The pre-existing github_sync_queue policies target the `public` role with
-- auth.role() evaluated per-row (initplan warning) and overlap for every role
-- on SELECT (multiple-permissive warning). Replace with the clean role-targeted
-- pattern used on user_profiles: USING (true) + explicit TO <role>, no per-row
-- function call, no overlap.
DROP POLICY IF EXISTS "Authenticated can select github_sync_queue" ON public.github_sync_queue;
DROP POLICY IF EXISTS "Service role all on github_sync_queue" ON public.github_sync_queue;

CREATE POLICY service_role_all ON public.github_sync_queue
  FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY authenticated_read ON public.github_sync_queue
  FOR SELECT TO authenticated USING (true);
;
