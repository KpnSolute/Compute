-- Tenant-owned project tree and immutable artifact provenance foundation.
--
-- Supabase Storage remains a shared private service, while every object key is
-- rooted beneath tenants/{tenant_id}/projects/{project_id}. Database constraints
-- enforce that prefix and composite foreign keys prevent cross-tenant links.

create table public.workspace_projects (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  slug text not null,
  name text not null,
  description text,
  project_kind text not null default 'managed_workspace'
    check (project_kind in ('existing_portal', 'managed_workspace', 'template_instance')),
  status text not null default 'draft'
    check (status in ('draft', 'active', 'suspended', 'archived')),
  settings jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint workspace_projects_slug_format check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  constraint workspace_projects_tenant_slug_key unique (tenant_id, slug),
  constraint workspace_projects_tenant_id_id_key unique (tenant_id, id)
);

create table public.tenant_tree_nodes (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  parent_id uuid,
  node_kind text not null default 'folder'
    check (node_kind in ('root', 'folder')),
  slug text not null,
  name text not null,
  logical_path text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tenant_tree_nodes_project_fkey
    foreign key (tenant_id, project_id)
    references public.workspace_projects(tenant_id, id)
    on delete cascade,
  constraint tenant_tree_nodes_tenant_project_id_key
    unique (tenant_id, project_id, id),
  constraint tenant_tree_nodes_parent_fkey
    foreign key (tenant_id, project_id, parent_id)
    references public.tenant_tree_nodes(tenant_id, project_id, id)
    on delete cascade
    deferrable initially deferred,
  constraint tenant_tree_nodes_path_key
    unique (tenant_id, project_id, logical_path),
  constraint tenant_tree_nodes_slug_format check (
    slug = lower(slug)
    and slug ~ '^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$'
  ),
  constraint tenant_tree_nodes_path_format check (
    logical_path like '/%'
    and logical_path not like '%//%'
    and logical_path not like '%..%'
  ),
  constraint tenant_tree_nodes_root_shape check (
    (node_kind = 'root' and parent_id is null and logical_path = '/')
    or (node_kind = 'folder' and parent_id is not null and logical_path <> '/')
  )
);

create table public.project_artifacts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  tree_node_id uuid not null,
  artifact_kind text not null
    check (artifact_kind in (
      'sop', 'supporting_document', 'source_archive', 'generated_code',
      'configuration', 'dataset', 'blueprint', 'build', 'deployment',
      'export', 'other'
    )),
  storage_bucket text not null default 'kpncompute-artifacts',
  object_key text not null,
  original_filename text not null,
  content_type text not null,
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[a-f0-9]{64}$'),
  lifecycle_status text not null default 'pending_upload'
    check (lifecycle_status in (
      'pending_upload', 'quarantined', 'ready', 'rejected', 'archived', 'deleted'
    )),
  provenance jsonb not null default '{}'::jsonb,
  retention_until timestamptz,
  uploaded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint project_artifacts_project_fkey
    foreign key (tenant_id, project_id)
    references public.workspace_projects(tenant_id, id)
    on delete cascade,
  constraint project_artifacts_tree_node_fkey
    foreign key (tenant_id, project_id, tree_node_id)
    references public.tenant_tree_nodes(tenant_id, project_id, id)
    on delete restrict,
  constraint project_artifacts_object_key
    unique (tenant_id, storage_bucket, object_key),
  constraint project_artifacts_tenant_project_id_key
    unique (tenant_id, project_id, id),
  constraint project_artifacts_tenant_path check (
    object_key like (
      'tenants/' || tenant_id::text || '/projects/' || project_id::text || '/%'
    )
  )
);

create table public.project_source_documents (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  artifact_id uuid not null,
  logical_name text not null,
  version integer not null default 1 check (version > 0),
  document_kind text not null default 'sop'
    check (document_kind in ('sop', 'policy', 'procedure', 'requirements', 'reference')),
  ingestion_status text not null default 'pending'
    check (ingestion_status in ('pending', 'scanning', 'ready', 'rejected', 'retired')),
  extraction_metadata jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint project_source_documents_project_fkey
    foreign key (tenant_id, project_id)
    references public.workspace_projects(tenant_id, id)
    on delete cascade,
  constraint project_source_documents_artifact_fkey
    foreign key (tenant_id, project_id, artifact_id)
    references public.project_artifacts(tenant_id, project_id, id)
    on delete restrict,
  constraint project_source_documents_version_key
    unique (tenant_id, project_id, logical_name, version),
  constraint project_source_documents_tenant_project_id_key
    unique (tenant_id, project_id, id)
);

create table public.project_generation_runs (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  status text not null default 'queued'
    check (status in ('queued', 'analyzing', 'review_required', 'completed', 'failed', 'cancelled')),
  prompt_policy_version text not null,
  model_provider text,
  model_name text,
  source_manifest_hash text not null check (source_manifest_hash ~ '^[a-f0-9]{64}$'),
  requested_by uuid references auth.users(id) on delete set null,
  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  failure_code text,
  failure_detail text,
  usage_metadata jsonb not null default '{}'::jsonb,
  constraint project_generation_runs_project_fkey
    foreign key (tenant_id, project_id)
    references public.workspace_projects(tenant_id, id)
    on delete cascade,
  constraint project_generation_runs_tenant_project_id_key
    unique (tenant_id, project_id, id)
);

create table public.generation_run_sources (
  tenant_id uuid not null,
  project_id uuid not null,
  generation_run_id uuid not null,
  source_document_id uuid not null,
  source_sha256 text not null check (source_sha256 ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  primary key (tenant_id, generation_run_id, source_document_id),
  constraint generation_run_sources_run_fkey
    foreign key (tenant_id, project_id, generation_run_id)
    references public.project_generation_runs(tenant_id, project_id, id)
    on delete cascade,
  constraint generation_run_sources_document_fkey
    foreign key (tenant_id, project_id, source_document_id)
    references public.project_source_documents(tenant_id, project_id, id)
    on delete restrict
);

create table public.project_blueprint_versions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  project_id uuid not null,
  generation_run_id uuid,
  version integer not null check (version > 0),
  schema_version text not null,
  status text not null default 'proposed'
    check (status in ('proposed', 'validation_failed', 'review_required', 'approved', 'rejected', 'superseded')),
  blueprint jsonb not null,
  validation_findings jsonb not null default '[]'::jsonb,
  content_sha256 text not null check (content_sha256 ~ '^[a-f0-9]{64}$'),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  review_note text,
  constraint project_blueprint_versions_project_fkey
    foreign key (tenant_id, project_id)
    references public.workspace_projects(tenant_id, id)
    on delete cascade,
  constraint project_blueprint_versions_run_fkey
    foreign key (tenant_id, project_id, generation_run_id)
    references public.project_generation_runs(tenant_id, project_id, id)
    on delete restrict,
  constraint project_blueprint_versions_version_key
    unique (tenant_id, project_id, version),
  constraint project_blueprint_versions_review_shape check (
    (status in ('approved', 'rejected') and reviewed_by is not null and reviewed_at is not null)
    or status not in ('approved', 'rejected')
  )
);

create index workspace_projects_tenant_status_idx
  on public.workspace_projects(tenant_id, status, updated_at desc);
create index tenant_tree_nodes_parent_idx
  on public.tenant_tree_nodes(tenant_id, project_id, parent_id);
create index project_artifacts_project_status_idx
  on public.project_artifacts(tenant_id, project_id, lifecycle_status, created_at desc);
create index project_artifacts_sha256_idx
  on public.project_artifacts(tenant_id, sha256);
create index project_source_documents_project_status_idx
  on public.project_source_documents(tenant_id, project_id, ingestion_status);
create index project_generation_runs_project_status_idx
  on public.project_generation_runs(tenant_id, project_id, status, requested_at desc);
create index project_blueprint_versions_project_status_idx
  on public.project_blueprint_versions(tenant_id, project_id, status, version desc);

create trigger workspace_projects_updated_at
before update on public.workspace_projects
for each row execute function public.update_updated_at();

create trigger tenant_tree_nodes_updated_at
before update on public.tenant_tree_nodes
for each row execute function public.update_updated_at();

create trigger project_artifacts_updated_at
before update on public.project_artifacts
for each row execute function public.update_updated_at();

create or replace function app_private.seed_project_tree()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  root_id uuid;
begin
  insert into public.tenant_tree_nodes (
    tenant_id, project_id, node_kind, slug, name, logical_path, created_by
  ) values (
    new.tenant_id, new.id, 'root', 'root', new.name, '/', new.created_by
  ) returning id into root_id;

  insert into public.tenant_tree_nodes (
    tenant_id, project_id, parent_id, node_kind, slug, name, logical_path, created_by
  ) values
    (new.tenant_id, new.id, root_id, 'folder', 'documents', 'Documents', '/documents', new.created_by),
    (new.tenant_id, new.id, root_id, 'folder', 'source', 'Source', '/source', new.created_by),
    (new.tenant_id, new.id, root_id, 'folder', 'generated', 'Generated', '/generated', new.created_by),
    (new.tenant_id, new.id, root_id, 'folder', 'data', 'Data', '/data', new.created_by),
    (new.tenant_id, new.id, root_id, 'folder', 'archive', 'Archive', '/archive', new.created_by);

  insert into public.tenant_tree_nodes (
    tenant_id, project_id, parent_id, node_kind, slug, name, logical_path, created_by
  )
  select new.tenant_id, new.id, id, 'folder', 'sops', 'SOPs', '/documents/sops', new.created_by
  from public.tenant_tree_nodes
  where tenant_id = new.tenant_id
    and project_id = new.id
    and logical_path = '/documents';

  return new;
end;
$$;

revoke all on function app_private.seed_project_tree() from public, anon, authenticated;
grant execute on function app_private.seed_project_tree() to service_role;

create trigger workspace_projects_seed_tree
after insert on public.workspace_projects
for each row execute function app_private.seed_project_tree();

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'workspace_projects', 'tenant_tree_nodes', 'project_artifacts',
    'project_source_documents', 'project_generation_runs',
    'generation_run_sources', 'project_blueprint_versions'
  ]
  loop
    execute format('alter table public.%I enable row level security', table_name);
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

insert into storage.buckets (
  id, name, public, file_size_limit, allowed_mime_types
)
values (
  'kpncompute-artifacts',
  'kpncompute-artifacts',
  false,
  262144000,
  null
)
on conflict (id) do update
set public = false,
    file_size_limit = excluded.file_size_limit;

insert into public.workspace_projects (
  tenant_id, slug, name, description, project_kind, status, settings
)
select
  id,
  'mjcc-operations',
  'MJCC Operations',
  'Existing MJCC portal preserved as tenant one and the first managed project.',
  'existing_portal',
  'active',
  '{"source":"existing-kpncompute-deployment","migration":"tenant-project-tree-foundation"}'::jsonb
from public.tenants
where slug = 'mjcc'
on conflict (tenant_id, slug) do update
set name = excluded.name,
    description = excluded.description,
    project_kind = excluded.project_kind,
    status = excluded.status,
    updated_at = now();
