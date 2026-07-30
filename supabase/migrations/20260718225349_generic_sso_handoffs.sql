-- Generic, app-scoped, one-time SSO handoffs from MJCC/KpnCompute to allowlisted apps.
create table if not exists public.sso_handoffs (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  user_id uuid not null references public.user_profiles(id) on delete cascade,
  target_app text not null check (target_app in ('marquee')),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now(),
  constraint sso_handoffs_future_expiry check (expires_at > created_at)
);
create index if not exists sso_handoffs_expires_idx on public.sso_handoffs (expires_at);
create index if not exists sso_handoffs_user_id_idx on public.sso_handoffs (user_id);
create index if not exists sso_handoffs_target_app_idx on public.sso_handoffs (target_app);
alter table public.sso_handoffs enable row level security;
alter table public.sso_handoffs force row level security;
revoke all on table public.sso_handoffs from anon, authenticated;
grant select, insert, update, delete on table public.sso_handoffs to service_role;
insert into public.permission_scopes (key, label, group_name, min_role, sort_order, active)
values ('marquee', 'Marquee', 'Records', 'manager', 146, true)
on conflict (key) do update set label = excluded.label, group_name = excluded.group_name, min_role = excluded.min_role, active = true;
insert into public.role_permissions (role, scope_key, allowed)
values ('manager', 'marquee', true), ('admin', 'marquee', true), ('sudo', 'marquee', true)
on conflict (role, scope_key) do update set allowed = excluded.allowed;;
