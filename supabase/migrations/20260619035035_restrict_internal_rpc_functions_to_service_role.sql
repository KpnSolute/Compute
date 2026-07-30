-- Verified via grep: every .rpc() call in the codebase uses supabase_service/_client()
-- (SUPABASE_SERVICE_KEY). Frontend lib/supabase.ts never calls .rpc() with the anon key.
-- These SECURITY DEFINER functions were reachable by anon/authenticated over
-- /rest/v1/rpc/* for no functional reason -- pure unnecessary attack surface
-- since they bypass RLS by design. Restricting to service_role only; backend is unaffected.
REVOKE EXECUTE ON FUNCTION public.guard_locked_week_writes() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_monthly_snapshot(integer, integer) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.refresh_week_gross(uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.resolve_invoice_sku(text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sc_close_pull_request(uuid, uuid, text) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sc_finalize_merge(uuid, uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sc_open_pull_request(uuid, text, text, uuid[]) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.set_week_status(integer, integer, integer, text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sku_add_alias(uuid, text, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sku_review_resolve(uuid, text, uuid, uuid) FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_refresh_week() FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_snapshot() FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.guard_locked_week_writes() TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_monthly_snapshot(integer, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.refresh_week_gross(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.resolve_invoice_sku(text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sc_close_pull_request(uuid, uuid, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.sc_finalize_merge(uuid, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sc_open_pull_request(uuid, text, text, uuid[]) TO service_role;
GRANT EXECUTE ON FUNCTION public.set_week_status(integer, integer, integer, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sku_add_alias(uuid, text, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.sku_review_resolve(uuid, text, uuid, uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_invoice_refresh_week() TO service_role;
GRANT EXECUTE ON FUNCTION public.trg_refresh_snapshot() TO service_role;;
