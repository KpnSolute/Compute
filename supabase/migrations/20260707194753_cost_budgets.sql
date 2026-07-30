create table cost_budgets (
  id uuid primary key default gen_random_uuid(),
  month int not null,
  year int not null,
  gov_allotment numeric(12,2) not null,
  planned_pull_amount numeric(12,2),
  planned_reviewable_amount numeric(12,2),
  notes text,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (month, year)
);

alter table cost_budgets enable row level security;

create policy cost_budgets_read_all on cost_budgets for select using (true);
;
