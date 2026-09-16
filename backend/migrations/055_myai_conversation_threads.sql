-- MyAI conversation threads: several named conversations per user instead of
-- one flat history.
--
-- Note on naming: the existing `agent_conversations` table is a turn log, not a
-- conversation — one row per user/assistant/tool turn. Rather than deepen that
-- confusion, threads get their own table and the turn log gains a nullable
-- `thread_id`. Existing history is preserved and adopted by each user's first
-- thread, so nobody loses a conversation.
--
-- The per-user cap is enforced in the API layer (backend/routes/agent.py); this
-- migration adds no hard limit so an operator can lift it without a migration.

create table if not exists public.agent_threads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  tenant_id uuid,
  title text not null default 'New chat',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_agent_threads_user
  on public.agent_threads(user_id, updated_at desc);

alter table public.agent_threads enable row level security;
drop policy if exists "service role only" on public.agent_threads;
create policy "service role only" on public.agent_threads
  using (auth.role() = 'service_role');

-- Stamp tenant_id exactly the way every other tenant-scoped table does, so a
-- writer that omits it cannot create an unscoped row. Matches the trigger
-- installed by supabase/migrations/20260816022956_tenant_columns_mjcc_backfill.
drop trigger if exists legacy_mjcc_tenant_default on public.agent_threads;
create trigger legacy_mjcc_tenant_default
  before insert on public.agent_threads
  for each row execute function app_private.assign_legacy_mjcc_tenant();

alter table public.agent_threads alter column tenant_id set not null;

-- Link the turn log to a thread. Nullable: a row written by an older build, or
-- during the rollout, is still valid and is treated as the default thread.
alter table public.agent_conversations
  add column if not exists thread_id uuid references public.agent_threads(id) on delete cascade;

create index if not exists idx_agent_conv_thread
  on public.agent_conversations(thread_id, created_at);

-- Adopt existing history: one thread per user who already has turns. Grouping
-- by user_id guarantees a single thread per user even if rows somehow carry
-- more than one tenant. Re-running is a no-op once nothing is unassigned.
with unassigned as (
  select user_id, min(tenant_id::text)::uuid as tenant_id
  from public.agent_conversations
  where thread_id is null
  group by user_id
),
created as (
  insert into public.agent_threads (user_id, tenant_id, title)
  select user_id, tenant_id, 'Conversation 1'
  from unassigned
  returning id, user_id
)
update public.agent_conversations as turn
set thread_id = created.id
from created
where turn.user_id = created.user_id
  and turn.thread_id is null;
