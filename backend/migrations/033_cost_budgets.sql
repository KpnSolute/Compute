-- Cost Manager: one row per (month, year) holding the manager-set monthly
-- government allotment (budget ceiling) plus optional wizard-derived planned
-- split amounts. Applied live via Supabase MCP against MJCCv1 (mgvyylvmkxhhataavqjz).

create table cost_budgets (
  id uuid primary key default gen_random_uuid(),
  month int not null,          -- 0-indexed, matches monthly_inventory convention
  year int not null,
  gov_allotment numeric(12,2) not null,
  planned_pull_amount numeric(12,2),        -- optional wizard output, informational target
  planned_reviewable_amount numeric(12,2),  -- optional wizard output, informational target
  notes text,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (month, year)
);

alter table cost_budgets enable row level security;

-- Writes go through the backend service-role client only (same pattern as
-- monthly_inventory / invoices) — no insert/update policy needed.
create policy cost_budgets_read_all on cost_budgets for select using (true);
