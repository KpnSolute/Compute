-- ============================================================================
-- Source-control PR architecture (additive, idempotent).
-- Model: staff OPEN a pull_request (groups their pending staging_entries) →
--        admin/manager MERGES it → existing commit is recorded + back-linked.
-- Does NOT touch existing enums, the approve_commit flow, or any data.
-- ============================================================================

-- 1. GitHub-style sequential PR number
create sequence if not exists public.pull_request_number_seq;

-- 2. First-class pull_requests object
create table if not exists public.pull_requests (
  pr_id        uuid primary key default gen_random_uuid(),
  pr_number    bigint not null unique default nextval('public.pull_request_number_seq'),
  title        text not null,
  description  text,
  author_id    uuid not null references public.user_profiles(id),
  status       text not null default 'open',     -- draft | open | merged | closed
  branch       text not null default 'main',
  entity_scope text,                              -- e.g. 'inventory'
  source       text default 'manual',            -- manual | ai_upload | ...
  review_note  text,
  commit_id    uuid references public.commits(commit_id),  -- set on merge
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  merged_at    timestamptz,
  merged_by    uuid references public.user_profiles(id),
  closed_at    timestamptz,
  closed_by    uuid references public.user_profiles(id)
);

do $$ begin
  if not exists (
    select 1 from information_schema.table_constraints
    where constraint_schema='public' and table_name='pull_requests'
      and constraint_name='pull_requests_status_check'
  ) then
    alter table public.pull_requests
      add constraint pull_requests_status_check
      check (status = any (array['draft','open','merged','closed']));
  end if;
end $$;

-- 3. Link columns (nullable → legacy rows & current approve_commit keep working)
alter table public.staging_entries
  add column if not exists pull_request_id uuid references public.pull_requests(pr_id) on delete set null;
alter table public.commits
  add column if not exists pull_request_id uuid references public.pull_requests(pr_id);

-- 4. Indexes
create index if not exists idx_pr_author   on public.pull_requests(author_id);
create index if not exists idx_pr_status   on public.pull_requests(status);
create index if not exists idx_pr_created  on public.pull_requests(created_at desc);
create index if not exists idx_staging_pr  on public.staging_entries(pull_request_id);
create index if not exists idx_commits_pr  on public.commits(pull_request_id);

-- 5. updated_at trigger
create or replace function public.sc_touch_updated_at()
  returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end $fn$;

drop trigger if exists trg_pr_touch on public.pull_requests;
create trigger trg_pr_touch before update on public.pull_requests
  for each row execute function public.sc_touch_updated_at();

-- 6. RLS on (service_role bypasses — matches the other SC tables / lockdown intent)
alter table public.pull_requests enable row level security;

-- 7. Atomic OPEN: create PR + claim the author's own pending, unlinked entries
create or replace function public.sc_open_pull_request(
  p_author uuid, p_title text, p_description text, p_entry_ids uuid[]
) returns public.pull_requests
language plpgsql security definer set search_path = public as $fn$
declare pr public.pull_requests;
begin
  insert into public.pull_requests(title, description, author_id, entity_scope)
  values (coalesce(nullif(trim(p_title),''),'Untitled request'),
          nullif(trim(coalesce(p_description,'')),''),
          p_author, 'inventory')
  returning * into pr;

  update public.staging_entries
     set pull_request_id = pr.pr_id
   where entry_id = any(p_entry_ids)
     and submitted_by = p_author          -- a staffer can only bundle their OWN work
     and status = 'pending'
     and pull_request_id is null;

  return pr;
end $fn$;

-- 8. Atomic MERGE-finalize: replay/commit stays in the API; this records the result
create or replace function public.sc_finalize_merge(
  p_pr uuid, p_commit uuid, p_merged_by uuid
) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update public.pull_requests
     set status='merged', merged_at=now(), merged_by=p_merged_by,
         commit_id=p_commit, updated_at=now()
   where pr_id=p_pr;
  update public.commits set pull_request_id=p_pr where commit_id=p_commit;
end $fn$;

-- 9. CLOSE (decline) helper
create or replace function public.sc_close_pull_request(
  p_pr uuid, p_closed_by uuid, p_note text
) returns void
language plpgsql security definer set search_path = public as $fn$
begin
  update public.pull_requests
     set status='closed', closed_at=now(), closed_by=p_closed_by,
         review_note = coalesce(p_note, review_note), updated_at=now()
   where pr_id=p_pr;
  -- release the claimed entries back to the open pool, marked rejected
  update public.staging_entries
     set status='rejected', reviewed_by=p_closed_by, reviewed_at=now(),
         review_note = coalesce(p_note, review_note)
   where pull_request_id=p_pr and status='pending';
end $fn$;

grant execute on function public.sc_open_pull_request(uuid,text,text,uuid[]) to service_role;
grant execute on function public.sc_finalize_merge(uuid,uuid,uuid) to service_role;
grant execute on function public.sc_close_pull_request(uuid,uuid,text) to service_role;;
