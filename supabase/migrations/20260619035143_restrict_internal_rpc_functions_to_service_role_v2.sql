-- PUBLIC grant supersedes role-specific revokes — must revoke from PUBLIC directly.
REVOKE EXECUTE ON FUNCTION public.guard_locked_week_writes() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_monthly_snapshot(integer, integer) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_week_gross(uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.resolve_invoice_sku(text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sc_close_pull_request(uuid, uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sc_finalize_merge(uuid, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sc_open_pull_request(uuid, text, text, uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.set_week_status(integer, integer, integer, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sku_add_alias(uuid, text, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.sku_review_resolve(uuid, text, uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_invoice_refresh_week() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.trg_refresh_snapshot() FROM PUBLIC;

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
