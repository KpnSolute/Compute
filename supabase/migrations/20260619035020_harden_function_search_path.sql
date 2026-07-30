ALTER FUNCTION public.refresh_monthly_snapshot(integer, integer) SET search_path = public, pg_temp;
ALTER FUNCTION public.trg_refresh_snapshot() SET search_path = public, pg_temp;
ALTER FUNCTION public.sc_touch_updated_at() SET search_path = public, pg_temp;
ALTER FUNCTION public.touch_ai_provider_key() SET search_path = public, pg_temp;;
