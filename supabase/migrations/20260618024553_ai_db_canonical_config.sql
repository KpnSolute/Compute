-- ============================================================================
-- Canonical AI config: all settings in DB, no env vars for AI (except OCR).
-- Consolidates api_keys + ai_provider_keys + ai_stack_config into a clean
-- multi-key-per-provider architecture.
-- Additive + idempotent. Migrates existing data.
-- ============================================================================

-- 1. ai_providers — one row per provider (static metadata)
create table if not exists public.ai_providers (
  provider    text primary key,  -- groq | anthropic | openai | mistral | ollama | lm_studio
  label       text not null,
  description text,
  has_key     boolean not null default true,   -- false = URL-only (ollama, lm_studio)
  default_url text,                            -- default base_url for URL-only providers
  sort_order  int not null default 99
);

insert into public.ai_providers (provider, label, description, has_key, default_url, sort_order) values
  ('groq',      'Groq',       'Cloud · fast inference',                          true,  null,                    1),
  ('anthropic', 'Anthropic',  'Cloud · Claude sonnet / haiku / opus',             true,  null,                    2),
  ('openai',    'OpenAI',     'Cloud · GPT-4o / GPT-4o-mini',                     true,  null,                    3),
  ('mistral',   'Mistral AI', 'Cloud · mistral-small / large / pixtral',          true,  null,                    4),
  ('ollama',    'Ollama',     'Local server — any model',                          false, 'http://localhost:11434', 5),
  ('lm_studio', 'LM Studio',  'Local GUI — OpenAI-compatible GGUF models',        false, 'http://localhost:1234',  6)
on conflict (provider) do update
  set label=excluded.label, description=excluded.description,
      has_key=excluded.has_key, default_url=excluded.default_url, sort_order=excluded.sort_order;

-- 2. ai_provider_keys — multiple named keys per provider (already exists, extend it)
alter table public.ai_provider_keys
  add column if not exists model_override text,      -- optional per-key model lock
  add column if not exists is_default     boolean not null default false;

-- Index: only one default per provider
create unique index if not exists idx_ai_provider_keys_default
  on public.ai_provider_keys(provider) where is_default = true;

-- 3. Migrate api_keys → ai_provider_keys (avoid losing existing Groq key)
insert into public.ai_provider_keys (provider, label, api_key, base_url, is_active, is_default, created_at, updated_at)
select
  ak.provider,
  coalesce(
    (select label from public.ai_provider_keys where provider=ak.provider limit 1),
    initcap(ak.provider) || ' key'
  ),
  ak.api_key,
  ak.base_url,
  ak.is_active,
  true,   -- make this the default for the provider
  coalesce(ak.updated_at, now()),
  now()
from public.api_keys ak
where ak.api_key is not null and length(ak.api_key) > 0
  and not exists (
    select 1 from public.ai_provider_keys where provider=ak.provider and api_key=ak.api_key
  )
on conflict do nothing;

-- 4. ai_stack_config — single active stack (provider + key + model)
--    Extend existing table: add key_id FK if missing
alter table public.ai_stack_config
  add column if not exists key_id uuid references public.ai_provider_keys(id) on delete set null,
  add column if not exists vision_capable boolean not null default false;

-- Ensure unique active config named 'default'
create unique index if not exists idx_ai_stack_config_default
  on public.ai_stack_config(name);

-- Migrate existing ai_stack_config: link to the matching key row
update public.ai_stack_config sc
set key_id = (
  select id from public.ai_provider_keys
  where provider = sc.provider and is_active = true
  order by created_at asc limit 1
)
where sc.key_id is null;

-- 5. app_settings: store model selection there (keep existing ai_config key working)
-- No change needed — context.py already reads/writes app_settings.ai_config for model.
-- We will update context.py to read from ai_provider_keys + ai_stack_config instead.

-- 6. RLS: service_role reads everything; users read non-secret columns only
alter table public.ai_providers       enable row level security;
alter table public.ai_provider_keys   enable row level security;
alter table public.ai_stack_config    enable row level security;

-- Grant service_role full access (backend uses service_role client)
grant all on public.ai_providers     to service_role;
grant all on public.ai_provider_keys to service_role;
grant all on public.ai_stack_config  to service_role;

comment on column public.ai_provider_keys.api_key is
  'Encrypted at rest by Supabase. Never returned to browser — backend reads via service_role only.';;
