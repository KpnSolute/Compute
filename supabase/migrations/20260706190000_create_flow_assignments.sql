-- Flow Assignments table
-- Backs the "Flow" task/assignment feature: admin/manager assigns tasks to staff,
-- staff sees and completes them, tasks can deep-link to a specific page/action.
--
-- assigned_to (specific user) and assigned_to_role (broadcast to role group) are
-- mutually exclusive in practice; no DB constraint enforced — backend decides.
--
-- link_type values (non-exhaustive, documented for API layer):
--   'nav_page'       — link_key is a NAV key from constants.ts (e.g. 'pullsheet', 'haccp')
--   'inventory_item' — link_key is an item SKU
--   'daily_log'      — link_key is a daily_operations_logs row id
--   'haccp_log'      — link_key is a haccp_logs row id
--
-- RLS: mirrors daily_operations_logs / haccp_logs pattern — service_role_all policy
-- (qual: true). Backend always uses the service role key which bypasses RLS entirely;
-- no anon/authenticated policies are added so public access is default-denied.

CREATE TABLE IF NOT EXISTS public.flow_assignments (
    id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    title           text        NOT NULL,
    description     text        NOT NULL DEFAULT '',
    assigned_to     uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    assigned_to_role text,
    created_by      uuid        NOT NULL REFERENCES public.user_profiles(id) ON DELETE RESTRICT,
    status          text        NOT NULL DEFAULT 'open'
                                CHECK (status IN ('open', 'in_progress', 'done', 'cancelled')),
    priority        text        NOT NULL DEFAULT 'normal'
                                CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    due_date        date,
    link_type       text,
    link_key        text,
    link_params     jsonb       NOT NULL DEFAULT '{}'::jsonb,
    completed_at    timestamptz,
    completed_by    uuid        REFERENCES public.user_profiles(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- Indexes for the common query patterns
CREATE INDEX IF NOT EXISTS flow_assignments_assigned_to_idx     ON public.flow_assignments (assigned_to);
CREATE INDEX IF NOT EXISTS flow_assignments_assigned_to_role_idx ON public.flow_assignments (assigned_to_role);
CREATE INDEX IF NOT EXISTS flow_assignments_status_idx          ON public.flow_assignments (status);
CREATE INDEX IF NOT EXISTS flow_assignments_created_by_idx      ON public.flow_assignments (created_by);

-- Enable RLS
ALTER TABLE public.flow_assignments ENABLE ROW LEVEL SECURITY;

-- Single permissive policy mirroring daily_operations_logs / haccp_logs:
-- service role (used by FastAPI backend) bypasses RLS at the Postgres level anyway,
-- but this explicit policy is consistent with the rest of the operational tables.
-- No anon/authenticated policies → public access is default-denied.
CREATE POLICY service_role_all
    ON public.flow_assignments
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);
