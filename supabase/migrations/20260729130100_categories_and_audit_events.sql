-- Ensure review categories remain visible and persist structured audit events.

BEGIN;

DO $do$
DECLARE
  v_sort integer;
BEGIN
  SELECT COALESCE(MAX(sort_order), 0) + 1 INTO v_sort
  FROM public.inventory_categories;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_categories WHERE lower(name) = 'dairy'
  ) THEN
    INSERT INTO public.inventory_categories (name, sort_order)
    VALUES ('Dairy', v_sort);
    v_sort := v_sort + 1;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.inventory_categories WHERE lower(name) = 'new items'
  ) THEN
    INSERT INTO public.inventory_categories (name, sort_order)
    VALUES ('New Items', v_sort);
  END IF;
END;
$do$;

CREATE TABLE IF NOT EXISTS public.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  actor_id text,
  actor_name text,
  actor_role text,
  action text NOT NULL,
  method text,
  path text,
  target_type text,
  target_id text,
  sku text,
  category text,
  period_month integer,
  period_year integer,
  staging_id text,
  pr_id text,
  commit_id text,
  result text NOT NULL,
  status_code integer,
  duration_ms integer,
  error_type text,
  detail text,
  session_reason text,
  request_id text
);

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
  ON public.audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor
  ON public.audit_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action
  ON public.audit_events (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_request
  ON public.audit_events (request_id) WHERE request_id IS NOT NULL;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_events FROM anon, authenticated;
DROP POLICY IF EXISTS "service role manages audit events" ON public.audit_events;
CREATE POLICY "service role manages audit events" ON public.audit_events
  FOR ALL TO service_role USING (true) WITH CHECK (true);

COMMIT;
