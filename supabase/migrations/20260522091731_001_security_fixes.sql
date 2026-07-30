
-- Lock down mjc_login — auth is handled by Flask + Supabase Auth SDK
REVOKE EXECUTE ON FUNCTION public.mjc_login(text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.mjc_login(text, text) FROM authenticated;

-- Fix update_updated_at trigger — set fixed search_path to prevent injection
CREATE OR REPLACE FUNCTION public.update_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
;
