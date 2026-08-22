-- Workspace Provisioning V1: idempotent workspace creation and auditable jobs.

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

create table public.provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  idempotency_key text not null,
  job_kind text not null
    check (job_kind in ('blueprint_generation', 'project_export', 'provision')),
  status text not null default 'queued'
    check (status in ('queued', 'running', 'review_required', 'completed', 'failed', 'cancelled')),
  input_manifest jsonb not null default '{}'::jsonb,
  output_manifest jsonb not null default '{}'::jsonb,
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_detail text,
  constraint provisioning_jobs_project_fkey
    foreign key (tenant_id, project_id)
    references public.workspace_projects(tenant_id, id)
    on delete cascade,
  constraint provisioning_jobs_tenant_project_id_key
    unique (tenant_id, project_id, id),
  constraint provisioning_jobs_idempotency_key
    unique (tenant_id, project_id, idempotency_key)
);

create table public.provisioning_steps (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  job_id uuid not null,
  step_key text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed', 'skipped', 'rolled_back')),
  safe_log jsonb not null default '{}'::jsonb,
  produced_resources jsonb not null default '[]'::jsonb,
  started_at timestamptz,
  completed_at timestamptz,
  constraint provisioning_steps_job_fkey
    foreign key (tenant_id, project_id, job_id)
    references public.provisioning_jobs(tenant_id, project_id, id)
    on delete cascade,
  constraint provisioning_steps_job_step_key
    unique (tenant_id, job_id, step_key)
);

create index workspace_creation_requests_actor_status_idx
  on public.workspace_creation_requests(requested_by, status, created_at desc);
create index provisioning_jobs_project_status_idx
  on public.provisioning_jobs(tenant_id, project_id, status, requested_at desc);
create index provisioning_steps_job_status_idx
  on public.provisioning_steps(tenant_id, job_id, status);

alter table public.workspace_creation_requests enable row level security;
alter table public.provisioning_jobs enable row level security;
alter table public.provisioning_steps enable row level security;

revoke all on public.workspace_creation_requests from public, anon, authenticated;
grant all on public.workspace_creation_requests to service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array['provisioning_jobs', 'provisioning_steps']
  loop
    execute format('revoke all on public.%I from public, anon', table_name);
    execute format('grant select on public.%I to authenticated', table_name);
    execute format('grant all on public.%I to service_role', table_name);
    execute format(
      'create policy tenant_member_select on public.%I for select to authenticated ' ||
      'using (app_private.is_tenant_member(tenant_id))',
      table_name
    );
  end loop;
end;
$$;

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
  if p_user_id is null then
    raise exception 'user_id_required';
  end if;
  if p_slug is null or p_slug <> lower(p_slug)
     or p_slug !~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$' then
    raise exception 'invalid_workspace_slug';
  end if;
  if length(trim(coalesce(p_name, ''))) < 2 then
    raise exception 'invalid_workspace_name';
  end if;
  if length(trim(coalesce(p_idempotency_key, ''))) < 8 then
    raise exception 'invalid_idempotency_key';
  end if;

  select * into request_row
  from public.workspace_creation_requests
  where requested_by = p_user_id
    and idempotency_key = p_idempotency_key;

  if found then
    if request_row.requested_slug <> p_slug
       or request_row.requested_name <> trim(p_name) then
      raise exception 'idempotency_key_payload_mismatch';
    end if;
    if request_row.status = 'completed' then
      select * into tenant_row from public.tenants where id = request_row.tenant_id;
      return jsonb_build_object(
        'request_id', request_row.id,
        'tenant_id', tenant_row.id,
        'slug', tenant_row.slug,
        'name', tenant_row.name,
        'status', request_row.status,
        'replayed', true
      );
    end if;
    raise exception 'workspace_request_not_replayable';
  end if;

  insert into public.workspace_creation_requests (
    requested_by, idempotency_key, requested_slug, requested_name
  ) values (
    p_user_id, p_idempotency_key, p_slug, trim(p_name)
  ) returning * into request_row;

  insert into public.tenants (slug, name, status, plan, created_by, settings)
  values (
    p_slug,
    trim(p_name),
    'active',
    'managed',
    p_user_id,
    jsonb_build_object('source', 'workspace-provisioning-v1')
  ) returning * into tenant_row;

  insert into public.tenant_memberships (
    tenant_id, user_id, role, status, is_default
  ) values (
    tenant_row.id, p_user_id, 'admin', 'active', false
  );

  update public.workspace_creation_requests
  set status = 'completed', tenant_id = tenant_row.id, completed_at = now()
  where id = request_row.id;

  return jsonb_build_object(
    'request_id', request_row.id,
    'tenant_id', tenant_row.id,
    'slug', tenant_row.slug,
    'name', tenant_row.name,
    'status', 'completed',
    'replayed', false
  );
end;
$$;

revoke all on function public.create_workspace_with_owner(uuid, text, text, text)
  from public, anon, authenticated;
grant execute on function public.create_workspace_with_owner(uuid, text, text, text)
  to service_role;
