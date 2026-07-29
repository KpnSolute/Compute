-- 046_audit_events.sql
--
-- Durable, structured audit trail for state-changing actions and session
-- lifecycle events.
--
-- WHY: the 2026-07 production readiness review found that Source Control logs
-- show staging activity but cannot prove fulfilment or identify the human
-- actor after the fact, and that a user being logged out left no record of the
-- reason. `error_logs` (migration 039) only captures failures, and the live
-- request tail is an in-memory deque lost on every redeploy. This table answers
-- "who did what, to which target, when, and how did it end" for the events that
-- matter, and survives restarts.
--
-- NEVER write passwords, access tokens, PINs, or raw request payloads here.
-- `detail` is for safe diagnostic context only.

CREATE TABLE IF NOT EXISTS public.audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at timestamptz NOT NULL DEFAULT now(),

    -- who
    actor_id text,
    actor_name text,
    actor_role text,

    -- what
    action text NOT NULL,
    method text,
    path text,

    -- target
    target_type text,
    target_id text,
    sku text,
    category text,
    period_month integer,
    period_year integer,
    staging_id text,
    pr_id text,
    commit_id text,

    -- result
    result text NOT NULL,
    status_code integer,
    duration_ms integer,
    error_type text,
    detail text,

    -- session lifecycle: 'idle' | 'unauthorized' | 'logout' | 'refresh' | ...
    session_reason text,

    request_id text
);

COMMENT ON TABLE public.audit_events IS
    'Durable who/what/when/target/result audit trail for state-changing '
    'actions and session lifecycle events. Never stores credentials or raw '
    'request payloads.';
COMMENT ON COLUMN public.audit_events.result IS
    'accepted | staged | merged | rejected | failed | expired';

CREATE INDEX IF NOT EXISTS idx_audit_events_created_at
    ON public.audit_events (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor
    ON public.audit_events (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_action
    ON public.audit_events (action, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_period
    ON public.audit_events (period_year, period_month, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_staging
    ON public.audit_events (staging_id) WHERE staging_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_audit_events_pr
    ON public.audit_events (pr_id) WHERE pr_id IS NOT NULL;

ALTER TABLE public.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.audit_events FROM anon, authenticated;
DROP POLICY IF EXISTS "service role manages audit events" ON public.audit_events;
CREATE POLICY "service role manages audit events" ON public.audit_events
    FOR ALL TO service_role USING (true) WITH CHECK (true);
