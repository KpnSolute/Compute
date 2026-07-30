create table if not exists public.lunchvoice_sso_handoffs (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  tenant_slug text not null default 'LionCafe',
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint lunchvoice_sso_handoffs_future_expiry check (expires_at > created_at)
);

create index if not exists lunchvoice_sso_handoffs_expires_idx
  on public.lunchvoice_sso_handoffs (expires_at);

alter table public.lunchvoice_sso_handoffs enable row level security;
revoke all on table public.lunchvoice_sso_handoffs from anon, authenticated;
grant select, insert, update, delete on table public.lunchvoice_sso_handoffs to service_role;

insert into public.permission_scopes (key, label, group_name, min_role, sort_order, active)
values ('lioncafe', 'LionCafe', 'Records', 'manager', 145, true)
on conflict (key) do nothing;

insert into public.role_permissions (role, scope_key, allowed)
values
  ('manager', 'lioncafe', true),
  ('admin', 'lioncafe', true),
  ('sudo', 'lioncafe', true)
on conflict do nothing;;
