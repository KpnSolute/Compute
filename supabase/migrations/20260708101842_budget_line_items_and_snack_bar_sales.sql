-- Snack Bar daily cash reconciliation, structured (replaces JSON-blob storage
-- in daily_operations_logs) so register sales are summable by period as revenue.
create table snack_bar_sales (
  id uuid primary key default gen_random_uuid(),
  business_date date not null unique,
  opening_cash numeric(12,2) not null default 0,
  register_sales numeric(12,2) not null default 0,
  closing_cash numeric(12,2) not null default 0,
  recorded_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table snack_bar_sales enable row level security;
create policy snack_bar_sales_read_all on snack_bar_sales for select using (true);

-- Customizable budget line items (Task-ID style, cost or revenue), matching
-- the org's existing "Department Budget Report" format, internalized so MJCC
-- tracks the same way without a separate external tool.
create table budget_line_items (
  id uuid primary key default gen_random_uuid(),
  fy_start_year int not null,
  task_id text,
  description text not null,
  line_type text not null default 'cost' check (line_type in ('cost','revenue')),
  annual_budget numeric(12,2) not null default 0,
  auto_source text check (auto_source in ('pulled','renewable','snack_bar_revenue')),
  sort_order int not null default 0,
  active boolean not null default true,
  created_by uuid references user_profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table budget_line_items enable row level security;
create policy budget_line_items_read_all on budget_line_items for select using (true);

-- Manual monthly actuals for line items without an auto_source
create table budget_line_actuals (
  id uuid primary key default gen_random_uuid(),
  line_item_id uuid not null references budget_line_items(id) on delete cascade,
  month int not null,
  year int not null,
  actual_amount numeric(12,2) not null default 0,
  updated_by uuid references user_profiles(id),
  updated_at timestamptz not null default now(),
  unique (line_item_id, month, year)
);
alter table budget_line_actuals enable row level security;
create policy budget_line_actuals_read_all on budget_line_actuals for select using (true);
;
