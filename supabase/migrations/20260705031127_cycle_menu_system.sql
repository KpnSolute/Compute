-- 029: 28-day cycle menu system (catalog + cycle days + slot assignments + suggestions)
-- Source: Miami_Job_Corps_28_Day_Cycle_Menu_System_Import.xlsx (QA-passed, 1215 records, 266 items)

create table if not exists public.menu_items (
  id text primary key,
  name text not null,
  item_key text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.menu_cycle_days (
  cycle_day int primary key check (cycle_day between 1 and 28),
  cycle_week int not null,
  day_of_week text not null,
  zone int not null default 1,
  morning_service text,
  midday_service text,
  evening_service text,
  active boolean not null default true
);

create table if not exists public.menu_cycle_slots (
  record_id text primary key,
  cycle_day int not null references public.menu_cycle_days(cycle_day),
  meal_group text not null,
  meal_period text not null,
  service_order int not null default 1,
  slot_order int not null default 1,
  slot_name text not null,
  item_id text not null references public.menu_items(id),
  active boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by text
);
create index if not exists idx_menu_cycle_slots_day on public.menu_cycle_slots(cycle_day);

create table if not exists public.menu_suggestions (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'lunchvoice',
  cycle_day int,
  meal_period text,
  slot_name text,
  suggested_item text not null,
  notes text,
  submitted_by text,
  status text not null default 'new',
  created_at timestamptz not null default now()
);

alter table public.menu_items enable row level security;
alter table public.menu_cycle_days enable row level security;
alter table public.menu_cycle_slots enable row level security;
alter table public.menu_suggestions enable row level security;
do $$ declare t text;
begin
  foreach t in array array['menu_items','menu_cycle_days','menu_cycle_slots','menu_suggestions'] loop
    execute format('create policy service_role_all on public.%I for all to service_role using (true) with check (true)', t);
    execute format('create policy authenticated_read on public.%I for select to authenticated using (true)', t);
  end loop;
end $$;

insert into public.app_settings (setting_key, setting_value)
values ('menu_cycle_anchor_date', '"2026-06-28"'::jsonb)
on conflict (setting_key) do nothing;;
