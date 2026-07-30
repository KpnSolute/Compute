
-- Pin search_path on functions flagged by the linter (hijack hardening).
-- guard_closed_month_writes already has a pinned search_path; leave it.
ALTER FUNCTION public.perform_rollover(integer, integer, uuid, text) SET search_path = public, pg_temp;
ALTER FUNCTION public.get_current_period() SET search_path = public, pg_temp;
ALTER FUNCTION public.get_distinct_months() SET search_path = public, pg_temp;
ALTER FUNCTION public.import_archive_month(integer, integer, jsonb) SET search_path = public, pg_temp;

-- Revoke unauthenticated/authenticated RPC access to the SECURITY DEFINER functions.
-- perform_rollover is an admin-only privileged op; it must only run via the
-- service-role backend, never via the public PostgREST /rpc endpoint.
REVOKE EXECUTE ON FUNCTION public.perform_rollover(integer, integer, uuid, text) FROM anon, authenticated, public;
-- guard_closed_month_writes is a trigger function; triggers fire as table owner
-- regardless of EXECUTE grants, so revoking RPC access is safe and correct.
REVOKE EXECUTE ON FUNCTION public.guard_closed_month_writes() FROM anon, authenticated, public;
;
