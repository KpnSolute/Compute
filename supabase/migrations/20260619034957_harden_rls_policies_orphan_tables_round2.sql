-- Matches precedent from add_service_role_policies_orphan_tables (v3026):
-- These 6 tables gained RLS-enabled-no-policy status after that migration landed
-- (they were created later, in the AI-system and SourceControl/SKU-review work).
-- service_role_all preserves secure deny-by-default for anon/authenticated
-- (none of these are queried directly by the frontend — all access is via the
-- FastAPI backend's service_role client) while clearing the advisory.
CREATE POLICY service_role_all ON public.ai_provider_keys FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.ai_providers FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.ai_stack_config FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.pull_requests FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.sku_review_queue FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY service_role_all ON public.week_status FOR ALL TO service_role USING (true) WITH CHECK (true);;
