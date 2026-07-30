
-- Fix touch_updated_at: pin search_path so it can't be hijacked
CREATE OR REPLACE FUNCTION public.touch_updated_at()
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

-- Revoke public execute on rls_auto_enable — it's an internal helper only
REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, authenticated;
;
