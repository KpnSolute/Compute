-- Enforce MJCC's corrected four-operational-week inventory model.
-- Days after the 28th are handled as the next month's W1 operationally;
-- legacy W5 columns remain for compatibility but must stay zero.

update public.monthly_inventory
set w5_received = 0,
    w5_issued = 0
where coalesce(w5_received, 0) <> 0
   or coalesce(w5_issued, 0) <> 0;

update public.monthly_snapshots
set wk5_total = 0
where coalesce(wk5_total, 0) <> 0;

insert into public.app_settings (setting_key, setting_value, updated_at)
values (
  'data_entry',
  '{
    "floor_year": 2026,
    "floor_month": 3,
    "operational_week_count": 4,
    "calendar_rollover_rule": "days_after_28_to_next_month_w1",
    "allow_new_items_on_weekly": false,
    "max_file_size_mb": 10,
    "reconcile_max_delta_pct": 5.0
  }'::jsonb,
  now()
)
on conflict (setting_key) do update
set setting_value = public.app_settings.setting_value || excluded.setting_value,
    updated_at = now();

do $$
begin
  alter table public.monthly_inventory
    add constraint monthly_inventory_w5_unused_check
    check (coalesce(w5_received, 0) = 0 and coalesce(w5_issued, 0) = 0);
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.monthly_snapshots
    add constraint monthly_snapshots_wk5_unused_check
    check (coalesce(wk5_total, 0) = 0);
exception
  when duplicate_object then null;
end $$;

do $$
declare
  constraint_name text;
begin
  select conname into constraint_name
  from pg_constraint
  where conrelid = 'public.week_status'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) ilike '%week%'
    and pg_get_constraintdef(oid) ilike '%<= 5%'
  limit 1;

  if constraint_name is not null then
    execute format('alter table public.week_status drop constraint %I', constraint_name);
  end if;

  alter table public.week_status
    add constraint week_status_week_1_4_check
    check (week >= 1 and week <= 4);
exception
  when duplicate_object then null;
end $$;
