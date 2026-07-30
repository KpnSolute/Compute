-- ============================================================================
-- Multi-key AI provider architecture
-- Replaces the single-row-per-provider api_keys with named keys + a separate
-- active-stack config. Additive + idempotent. Existing api_keys rows preserved.
-- ============================================================================

-- 1. Named API keys (multiple per provider)
create table if not exists public.ai_provider_keys (
  id           uuid primary key default gen_random_uuid(),
  provider     text not null,        -- groq | anthropic | openai | mistral | ollama | lm_studio
  label        text not null,        -- user-defined name e.g. "Groq Production", "OpenAI Dev"
  api_key      text,                 -- encrypted at rest via Supabase vault ideally; stored here for now
  base_url     text,                 -- for ollama / lm_studio
  is_active    boolean not null default false,  -- only ONE per provider should be active
  notes        text,
  created_by   uuid references public.user_profiles(id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique(provider, label)
);

alter table public.ai_provider_keys enable row level security;

create index if not exists idx_ai_pkeys_provider on public.ai_provider_keys(provider);
create index if not exists idx_ai_pkeys_active   on public.ai_provider_keys(provider) where is_active;

-- auto-touch updated_at
create or replace function public.touch_ai_provider_key()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end $fn$;
drop trigger if exists trg_touch_ai_pkey on public.ai_provider_keys;
create trigger trg_touch_ai_pkey before update on public.ai_provider_keys
  for each row execute function public.touch_ai_provider_key();

-- 2. Active AI stack config (replaces app_settings ai_config)
create table if not exists public.ai_stack_config (
  id            uuid primary key default gen_random_uuid(),
  name          text not null unique default 'default',   -- named config slots; 'default' is the live one
  provider      text not null,
  key_id        uuid references public.ai_provider_keys(id) on delete set null,
  model         text not null,
  is_vision     boolean not null default false,           -- computed; updated when model changes
  ollama_url    text,                                     -- base URL for local providers
  updated_by    uuid references public.user_profiles(id),
  updated_at    timestamptz not null default now()
);

alter table public.ai_stack_config enable row level security;

-- Seed with the current active stack from api_keys if not already present
insert into public.ai_stack_config (name, provider, model, is_vision)
select 'default',
       (select provider from public.api_keys where is_active limit 1),
       coalesce(
         (select (setting_value->>'model')
          from public.app_settings where setting_key='ai_config' limit 1),
         'llama-3.3-70b-versatile'
       ),
       false
where not exists (select 1 from public.ai_stack_config where name='default')
  and exists (select 1 from public.api_keys where is_active);

-- 3. Migrate existing api_keys rows into ai_provider_keys (keep api_keys for backward compat)
insert into public.ai_provider_keys (provider, label, api_key, base_url, is_active)
select provider,
       initcap(provider) || ' (imported)',
       api_key,
       base_url,
       is_active
from public.api_keys
where (api_key is not null and length(api_key) > 0)
   or (base_url is not null and length(base_url) > 0)
on conflict (provider, label) do nothing;

grant all on public.ai_provider_keys to service_role;
grant all on public.ai_stack_config   to service_role;;
