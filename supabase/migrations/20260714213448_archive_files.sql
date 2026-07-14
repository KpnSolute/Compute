create table if not exists public.archived_files (
  id uuid primary key default gen_random_uuid(),
  bucket text not null,
  object_key text not null unique,
  category text not null default 'document'
    check (category in ('invoice', 'menu', 'recipe', 'report', 'document', 'other')),
  original_filename text not null,
  content_type text not null default 'application/octet-stream',
  size_bytes bigint not null check (size_bytes >= 0),
  sha256 text not null check (sha256 ~ '^[0-9a-f]{64}$'),
  source text not null default 'manual',
  description text,
  linked_entity_type text,
  linked_entity_id text,
  period_month smallint check (period_month between 1 and 12),
  period_year smallint check (period_year between 2000 and 2200),
  week_number smallint check (week_number between 0 and 6),
  uploaded_by uuid not null references public.user_profiles(id),
  uploaded_at timestamptz not null default now(),
  status text not null default 'active' check (status in ('active', 'deleted')),
  deleted_at timestamptz,
  deleted_by uuid references public.user_profiles(id),
  metadata jsonb not null default '{}'::jsonb
);

create index if not exists archived_files_uploaded_at_idx
  on public.archived_files (uploaded_at desc);
create index if not exists archived_files_category_idx
  on public.archived_files (category, uploaded_at desc);
create index if not exists archived_files_sha256_idx
  on public.archived_files (sha256) where status = 'active';
create index if not exists archived_files_uploaded_by_idx
  on public.archived_files (uploaded_by, uploaded_at desc);

alter table public.archived_files enable row level security;
revoke all on public.archived_files from anon, authenticated;
grant all on public.archived_files to service_role;

drop policy if exists "service role manages archived files" on public.archived_files;
create policy "service role manages archived files"
  on public.archived_files for all to service_role
  using (true) with check (true);
