-- ============================================================================
-- Week-level locking + issuance access control
-- Additive + idempotent. Does not alter any existing data or enums.
-- ============================================================================

-- 1. Week-level lock status (per month/year/week combination)
create table if not exists public.week_status (
  id           uuid primary key default gen_random_uuid(),
  month        int  not null,   -- 0-indexed (matches monthly_inventory)
  year         int  not null,
  week         int  not null check (week between 1 and 5),
  status       text not null default 'open',  -- open | locked | published
  locked_by    uuid references public.user_profiles(id),
  locked_at    timestamptz,
  created_at   timestamptz not null default now(),
  unique(month, year, week)
);

do $$ begin
  if not exists (select 1 from information_schema.table_constraints
    where constraint_schema='public' and table_name='week_status'
      and constraint_name='week_status_status_check') then
    alter table public.week_status add constraint week_status_status_check
      check (status = any(array['open','locked','published']));
  end if;
end $$;

create index if not exists idx_week_status_period on public.week_status(month, year);
alter table public.week_status enable row level security;

-- 2. Lock/unlock a week (manager+ only enforced in API)
create or replace function public.set_week_status(
  p_month int, p_year int, p_week int, p_status text, p_by uuid
) returns public.week_status language plpgsql security definer set search_path=public as $fn$
declare ws public.week_status;
begin
  insert into public.week_status(month, year, week, status, locked_by, locked_at)
  values (p_month, p_year, p_week, p_status,
          case when p_status in ('locked','published') then p_by else null end,
          case when p_status in ('locked','published') then now() else null end)
  on conflict(month, year, week) do update
    set status=excluded.status,
        locked_by=excluded.locked_by,
        locked_at=excluded.locked_at
  returning * into ws;
  return ws;
end $fn$;

-- 3. Guard: block writes to locked/published weeks inside monthly_inventory
create or replace function public.guard_locked_week_writes()
returns trigger language plpgsql security definer set search_path=public as $fn$
declare ws_status text;
begin
  -- determine which week column is being written (check any wN column changed)
  -- if any week column changes, look up that week's status
  -- simplified: guard based on ALL week columns; caller must pass week context via session var
  select coalesce(ws.status,'open') into ws_status
  from public.week_status ws
  where ws.month = NEW.month and ws.year = NEW.year
    and ws.status in ('locked','published')
  limit 1;

  if ws_status in ('locked','published') then
    -- allow service_role to bypass (replay path)
    if current_setting('role', true) = 'service_role' then
      return NEW;
    end if;
    raise exception 'Week is locked or published — changes not allowed (month=%/%, status=%)',
      NEW.month, NEW.year, ws_status using errcode='P0001';
  end if;
  return NEW;
end $fn$;

-- only create trigger if not already there
do $$ begin
  if not exists (select 1 from pg_trigger where tgname='trg_guard_locked_week') then
    create trigger trg_guard_locked_week
      before insert or update on public.monthly_inventory
      for each row execute function public.guard_locked_week_writes();
  end if;
end $$;

grant execute on function public.set_week_status(int,int,int,text,uuid) to service_role;;
