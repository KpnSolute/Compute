-- 039: Durable server-side error log.
--
-- The live-tail log buffer (routes/api_logs.py) is an in-memory deque that is
-- lost on every restart/redeploy and rolls off after 1000 events. This table is
-- written best-effort by the FastAPI exception handlers (backend/error_log.py)
-- for 5xx and actionable staff-facing 4xx (400/409/422/...), so a problem a
-- staff member hit can still be assessed later, even across deploys.
--
-- Service-role only (the backend writes/reads with the service key); browser
-- roles get nothing. No foreign keys — keeps it embed-safe and never blocks a
-- write while an error is being recorded.

CREATE TABLE IF NOT EXISTS public.error_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),
    method text,
    path text,
    status_code integer,
    error_type text,
    detail text,
    traceback text,
    user_hint text,
    request_id text
);

COMMENT ON TABLE public.error_logs IS
    'Durable server-side error record. Written best-effort by the FastAPI '
    'exception handlers for 5xx and actionable staff-facing 4xx. Survives '
    'restarts/redeploys (unlike the in-memory live tail).';

CREATE INDEX IF NOT EXISTS idx_error_logs_created_at ON public.error_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_error_logs_status ON public.error_logs (status_code, created_at DESC);

ALTER TABLE public.error_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.error_logs FROM anon, authenticated;
DROP POLICY IF EXISTS "service role manages error logs" ON public.error_logs;
CREATE POLICY "service role manages error logs" ON public.error_logs
    FOR ALL TO service_role USING (true) WITH CHECK (true);
