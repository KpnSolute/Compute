
-- Fix the mutable search_path warning on profiles_touch_updated_at
CREATE OR REPLACE FUNCTION public.profiles_touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY INVOKER SET search_path = public
AS $$ BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;
;
