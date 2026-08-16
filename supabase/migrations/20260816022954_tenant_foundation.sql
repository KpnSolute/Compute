-- KpnCompute organization-first tenancy foundation.
create table if not exists public.tenants (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  name text not null,
  status text not null default 'active'
    check (status in ('provisioning', 'active', 'suspended', 'archived')),
  plan text not null default 'managed',
  brand_config jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenants_slug_format check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  constraint tenants_slug_key unique (slug)
);

create table if not exists public.tenant_memberships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null default 'staff'
    check (role in ('staff', 'assistant', 'manager', 'admin', 'sudo')),
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'removed')),
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_memberships_tenant_user_key unique (tenant_id, user_id)
);

create unique index if not exists tenant_memberships_one_default_per_user
  on public.tenant_memberships(user_id)
  where is_default and status = 'active';
create index if not exists tenant_memberships_user_active_idx
  on public.tenant_memberships(user_id, status, tenant_id);

alter table public.tenants enable row level security;
alter table public.tenant_memberships enable row level security;

create schema if not exists app_private;
revoke all on schema app_private from public, anon;
grant usage on schema app_private to authenticated;

create or replace function app_private.is_tenant_member(
  p_tenant_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = p_tenant_id
      and membership.user_id = (select auth.uid())
      and membership.status = 'active'
      and (p_roles is null or membership.role = any(p_roles))
  );
$$;
revoke all on function app_private.is_tenant_member(uuid, text[]) from public, anon;
grant execute on function app_private.is_tenant_member(uuid, text[]) to authenticated;

drop policy if exists tenants_member_select on public.tenants;
create policy tenants_member_select on public.tenants
  for select to authenticated
  using (app_private.is_tenant_member(id));

drop policy if exists memberships_self_select on public.tenant_memberships;
create policy memberships_self_select on public.tenant_memberships
  for select to authenticated
  using (user_id = (select auth.uid()));

grant select on public.tenants, public.tenant_memberships to authenticated;

insert into public.tenants (slug, name, status, plan, brand_config, settings)
values (
  'mjcc',
  'Miami Job Corps Center',
  'active',
  'managed',
  '{"short_name":"MJCC"}'::jsonb,
  '{"source":"existing-kpncompute-deployment"}'::jsonb
)
on conflict (slug) do update
set name = excluded.name,
    updated_at = now();

insert into public.tenant_memberships (
  tenant_id, user_id, role, status, is_default
)
select
  tenant.id,
  profile.id,
  case
    when profile.role in ('staff', 'assistant', 'manager', 'admin', 'sudo')
      then profile.role
    else 'staff'
  end,
  case when profile.active then 'active' else 'suspended' end,
  true
from public.user_profiles profile
cross join lateral (
  select id from public.tenants where slug = 'mjcc'
) tenant
where exists (select 1 from auth.users user_row where user_row.id = profile.id)
on conflict (tenant_id, user_id) do update
set role = excluded.role,
    status = excluded.status,
    is_default = excluded.is_default,
    updated_at = now();
