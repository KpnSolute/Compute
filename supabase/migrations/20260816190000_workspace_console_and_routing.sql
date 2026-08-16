-- KpnCompute workspace console foundation.
-- Adds idempotent workspace creation, tenant-owned venue/location resources,
-- and project idempotency without changing existing MJCC operational tables.

alter table public.tenants
  add constraint tenants_slug_not_reserved check (
    slug not in (
      'api', 'app', 'auth', 'login', 'logout', 'signup', 'account', 'admin',
      'docs', 'pricing', 'templates', 'health', 'status', 'workspaces'
    )
  ) not valid;

alter table public.tenants validate constraint tenants_slug_not_reserved;

create table public.workspace_creation_requests (
  id uuid primary key default gen_random_uuid(),
  requested_by uuid not null references auth.users(id) on delete restrict,
  idempotency_key text not null,
  requested_slug text not null,
  requested_name text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  tenant_id uuid references public.tenants(id) on delete restrict,
  failure_code text,
  failure_detail text,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  constraint workspace_creation_requests_actor_key
    unique (requested_by, idempotency_key),
  constraint workspace_creation_requests_slug_format check (
    requested_slug = lower(requested_slug)
    and requested_slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  )
);

alter table public.workspace_projects
  add column if not exists idempotency_key text;

create unique index if not exists workspace_projects_idempotency_key
  on public.workspace_projects(tenant_id, idempotency_key)
  where idempotency_key is not null;

create table public.workspace_sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  parent_id uuid,
  site_type text not null default 'venue'
    check (site_type in ('venue', 'location')),
  slug text not null,
  name text not null,
  status text not null default 'active'
    check (status in ('active', 'inactive', 'archived')),
  timezone text not null default 'America/New_York',
  address jsonb not null default '{}'::jsonb,
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_sites_tenant_slug_key unique (tenant_id, slug),
  constraint workspace_sites_tenant_id_id_key unique (tenant_id, id),
  constraint workspace_sites_parent_fkey
    foreign key (tenant_id, parent_id)
    references public.workspace_sites(tenant_id, id)
    on delete cascade,
  constraint workspace_sites_slug_format check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  constraint workspace_sites_hierarchy check (
    (site_type = 'venue' and parent_id is null)
    or (site_type = 'location' and parent_id is not null)
  )
);

create index workspace_creation_requests_actor_status_idx
  on public.workspace_creation_requests(requested_by, status, created_at desc);
create index workspace_sites_tenant_status_idx
  on public.workspace_sites(tenant_id, status, name);
create index workspace_sites_tenant_parent_idx
  on public.workspace_sites(tenant_id, parent_id);

alter table public.workspace_creation_requests enable row level security;
alter table public.workspace_sites enable row level security;

revoke all on public.workspace_creation_requests from public, anon, authenticated;
grant all on public.workspace_creation_requests to service_role;
revoke all on public.workspace_sites from public, anon;
grant select on public.workspace_sites to authenticated;
grant all on public.workspace_sites to service_role;

create policy tenant_member_select on public.workspace_sites
  for select to authenticated
  using (app_private.is_tenant_member(tenant_id));

create or replace function public.create_workspace_with_owner(
  p_user_id uuid,
  p_slug text,
  p_name text,
  p_idempotency_key text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  request_row public.workspace_creation_requests%rowtype;
  tenant_row public.tenants%rowtype;
begin
  if p_user_id is null then raise exception 'user_id_required'; end if;
  if p_slug is null or p_slug <> lower(p_slug)
     or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'invalid_workspace_slug';
  end if;
  if p_slug in (
    'api', 'app', 'auth', 'login', 'logout', 'signup', 'account', 'admin',
    'docs', 'pricing', 'templates', 'health', 'status', 'workspaces'
  ) then
    raise exception 'reserved_workspace_slug';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'invalid_workspace_name';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into request_row
  from public.workspace_creation_requests
  where requested_by = p_user_id and idempotency_key = p_idempotency_key;

  if found then
    if request_row.requested_slug <> p_slug
       or request_row.requested_name <> trim(p_name) then
      raise exception 'idempotency_key_payload_mismatch';
    end if;
    if request_row.status = 'completed' then
      select * into tenant_row from public.tenants where id = request_row.tenant_id;
      return jsonb_build_object(
        'request_id', request_row.id, 'tenant_id', tenant_row.id,
        'slug', tenant_row.slug, 'name', tenant_row.name,
        'status', request_row.status, 'replayed', true
      );
    end if;
    raise exception 'workspace_request_not_replayable';
  end if;

  insert into public.workspace_creation_requests (
    requested_by, idempotency_key, requested_slug, requested_name
  ) values (p_user_id, p_idempotency_key, p_slug, trim(p_name))
  returning * into request_row;

  insert into public.tenants (slug, name, status, plan, created_by, settings)
  values (
    p_slug, trim(p_name), 'active', 'managed', p_user_id,
    jsonb_build_object('source', 'workspace-console-v1')
  ) returning * into tenant_row;

  insert into public.tenant_memberships (
    tenant_id, user_id, role, status, is_default
  ) values (tenant_row.id, p_user_id, 'admin', 'active', false);

  update public.workspace_creation_requests
  set status = 'completed', tenant_id = tenant_row.id, completed_at = now()
  where id = request_row.id;

  return jsonb_build_object(
    'request_id', request_row.id, 'tenant_id', tenant_row.id,
    'slug', tenant_row.slug, 'name', tenant_row.name,
    'status', 'completed', 'replayed', false
  );
end;
$$;

revoke all on function public.create_workspace_with_owner(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_workspace_with_owner(uuid, text, text, text)
  to service_role;

insert into public.workspace_sites (
  tenant_id, site_type, slug, name, timezone, settings
)
select id, 'venue', 'main', 'Main Venue', 'America/New_York',
       jsonb_build_object('source', 'mjcc-backfill')
from public.tenants
where slug = 'mjcc'
on conflict (tenant_id, slug) do nothing;
