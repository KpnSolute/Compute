-- LunchVoice writes survey-rating aggregates here; MJCC staff read them.
-- Contract fixed by the LunchVoice team — do not rename fields/types.
create table if not exists public.menu_feedback_summary (
  id uuid primary key default gen_random_uuid(),
  cycle_day int not null,           -- 1-28, matches the day numbering above
  slot text not null,               -- 'lunchEntree' | 'lunchAlt' | 'dinnerEntree' | 'dinnerAlt'
  dish_name text not null,
  avg_rating numeric,
  response_count int not null default 0,
  updated_at timestamptz not null default now(),
  unique (cycle_day, slot)
);
alter table public.menu_feedback_summary enable row level security;

-- service_role/authenticated_read pattern per existing tables (inventory_items, commits, etc.)
create policy service_role_all on public.menu_feedback_summary
  for all to service_role using (true) with check (true);

create policy authenticated_read on public.menu_feedback_summary
  for select to authenticated using (true);
