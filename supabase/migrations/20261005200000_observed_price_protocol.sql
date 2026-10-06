-- Observed-price protocol (AGENTS.md §4A, owner decision 2026-10-05).
--
-- Inventory carries the latest received invoice price for each item and
-- month. Before this, recompute_week_totals_batch kept an existing monthly
-- price forever (`CASE WHEN current_row.unit_price IS NULL OR = 0`), so a
-- period seeded from an opening count or rollover never picked up its own
-- invoices: September 2026 valued stock at August-era prices.
--
-- Additive only. recompute_week_totals_batch is deliberately left unchanged
-- (no new overload — a coexisting stale overload is what broke commits in
-- August); prices are applied by the separate set-based function below, and
-- the existing BEFORE UPDATE OF unit_price row trigger
-- (monthly_inventory_value_standard) re-settles every value column.

-- (1) Price observations that changed a price, and changes awaiting a decision.
create table if not exists public.price_review_queue (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid,
  item_id           uuid not null references public.inventory_items(id) on delete cascade,
  sku               text,
  description       text,
  month             integer not null check (month between 0 and 11),
  year              integer not null,
  week              integer,
  invoice_number    text,
  source_file       text,
  staging_entry_id  uuid,
  previous_price    numeric(12, 4),
  observed_price    numeric(12, 4) not null check (observed_price > 0),
  applied_price     numeric(12, 4),
  change_pct        numeric(10, 4),
  status            text not null default 'pending'
                    check (status in ('auto_applied', 'pending', 'applied', 'kept', 'dismissed')),
  reason            text,
  created_by        uuid,
  resolved_by       uuid,
  resolved_at       timestamptz,
  created_at        timestamptz not null default now()
);

-- One row per commit observation: a retried commit replays the same staging
-- entry and must not stack duplicates or reopen a decision a manager already
-- made. Manual drift decisions carry no staging entry; NULLs stay distinct so
-- an item can be decided more than once over time. Deliberately not a
-- partial index: ON CONFLICT inference cannot target one through PostgREST.
create unique index if not exists uq_price_review_observation
  on public.price_review_queue (tenant_id, item_id, month, year, staging_entry_id);
create index if not exists idx_price_review_pending
  on public.price_review_queue (tenant_id, year, month) where status = 'pending';
create index if not exists idx_price_review_item
  on public.price_review_queue (tenant_id, item_id, year, month);

alter table public.price_review_queue enable row level security;
drop policy if exists "service role only" on public.price_review_queue;
create policy "service role only" on public.price_review_queue
  using (auth.role() = 'service_role');

-- Stamp tenant_id the way every other tenant-scoped table does
-- (supabase/migrations/20260816022956_tenant_columns_mjcc_backfill.sql).
drop trigger if exists legacy_mjcc_tenant_default on public.price_review_queue;
create trigger legacy_mjcc_tenant_default
  before insert on public.price_review_queue
  for each row execute function app_private.assign_legacy_mjcc_tenant();
alter table public.price_review_queue alter column tenant_id set not null;

-- (2) Apply observed prices to a period in one statement. One statement means
-- one statement-level snapshot refresh, and the row trigger recomputes
-- received/pulled/ending value from quantity x the new price while opening
-- stock keeps its own carried cost (opening_unit_cost).
create or replace function public.apply_observed_prices(
  p_tenant_id uuid, p_month int, p_year int, p_prices jsonb
)
returns integer
language plpgsql
security invoker
set search_path = public, pg_temp
as $function$
declare
  affected_rows integer;
begin
  if p_tenant_id is null or p_month is null or p_month not between 0 and 11 or p_year is null then
    raise exception 'Tenant and valid period are required' using errcode = '22023';
  end if;
  if p_prices is null or jsonb_typeof(p_prices) <> 'array' then
    raise exception 'Prices must be a JSON array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_prices) as p(value)
    where jsonb_typeof(p.value) <> 'object'
       or jsonb_typeof(p.value -> 'item_id') is distinct from 'string'
       or jsonb_typeof(p.value -> 'unit_price') is distinct from 'number'
       or (p.value ->> 'unit_price')::numeric <= 0
  ) then
    raise exception 'Each price must be {item_id: string, unit_price: positive number}' using errcode = '22023';
  end if;
  if exists (
    select (p.value ->> 'item_id')::uuid from jsonb_array_elements(p_prices) as p(value)
    group by (p.value ->> 'item_id')::uuid having count(*) > 1
  ) then
    raise exception 'Duplicate item_id in prices' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_prices) as p(value)
    where not exists (
      select 1 from public.inventory_items as i
      where i.tenant_id = p_tenant_id and i.id = (p.value ->> 'item_id')::uuid
    )
  ) then
    raise exception 'Inventory item is not part of the active workspace' using errcode = '22023';
  end if;

  update public.monthly_inventory as m
  set unit_price = (p.value ->> 'unit_price')::numeric,
      updated_at = now()
  from jsonb_array_elements(p_prices) as p(value)
  where m.tenant_id = p_tenant_id and m.month = p_month and m.year = p_year
    and m.item_id = (p.value ->> 'item_id')::uuid
    and m.unit_price is distinct from (p.value ->> 'unit_price')::numeric;
  get diagnostics affected_rows = row_count;
  return affected_rows;
end;
$function$;

revoke all on function public.apply_observed_prices(uuid, int, int, jsonb) from public, anon, authenticated;
grant execute on function public.apply_observed_prices(uuid, int, int, jsonb) to service_role;

-- (3) Price drift: a monthly price that differs from the latest received
-- invoice price in the same period. Latest = highest week, then latest
-- transaction date, then latest ledger row.
create or replace view public.inventory_price_drift
with (security_invoker = true) as
with latest as (
  select distinct on (t.tenant_id, t.item_id, t.month, t.year)
    t.tenant_id, t.item_id, t.month, t.year,
    t.unit_price as observed_price, t.invoice_number, t.week_number, t.txn_date
  from public.inventory_transactions as t
  where t.txn_type = 'received' and coalesce(t.unit_price, 0) > 0
  order by t.tenant_id, t.item_id, t.month, t.year,
    t.week_number desc, t.txn_date desc nulls last, t.txn_id desc
)
select
  m.tenant_id, m.item_id, i.sku, i.description, m.month, m.year,
  m.unit_price as inventory_price, l.observed_price,
  l.invoice_number, l.week_number, l.txn_date,
  round((l.observed_price - m.unit_price) / nullif(m.unit_price, 0), 4) as change_pct,
  exists (
    select 1 from public.price_review_queue as q
    where q.tenant_id = m.tenant_id and q.item_id = m.item_id
      and q.month = m.month and q.year = m.year and q.status = 'pending'
  ) as review_pending,
  exists (
    select 1 from public.price_review_queue as q
    where q.tenant_id = m.tenant_id and q.item_id = m.item_id
      and q.month = m.month and q.year = m.year and q.status = 'kept'
      and q.observed_price = l.observed_price
  ) as difference_accepted
from public.monthly_inventory as m
join latest as l
  on l.tenant_id = m.tenant_id and l.item_id = m.item_id
 and l.month = m.month and l.year = m.year
join public.inventory_items as i
  on i.id = m.item_id and i.tenant_id = m.tenant_id
where abs(coalesce(m.unit_price, 0) - l.observed_price) >= 0.005;

grant select on public.inventory_price_drift to service_role;
