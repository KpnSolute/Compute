-- Staff auth foundation: hashed PIN storage, version tracking, and login throttling.
--
-- Additive and idempotent. Every statement uses IF NOT EXISTS / CREATE OR REPLACE
-- so the migration can be re-run safely. No existing data is modified or deleted.
--
-- Columns added to user_profiles:
--   pin_hash        scrypt hash replacing the legacy plaintext pin column
--   pin_version     monotonically incrementing credential generation
--   pin_updated_at  last credential change timestamp
--   pin_must_rotate flag for weak PINs set during bulk import
--
-- New table:
--   staff_login_throttle  per-tenant, per-username rate limiting and lockout
--
-- New RPCs (all security definer, service_role only):
--   set_staff_pin_credential         atomic PIN write + version bump
--   clear_staff_pin_credential       atomic PIN clear + version bump
--   staff_login_throttle_state       read current lockout state
--   staff_login_throttle_fail        record a failed attempt, apply lockout
--   staff_login_throttle_reset       clear lockout on success
--
-- Rollback: This migration is additive. Rollback by dropping the functions,
-- table, and columns in reverse order listed above.  Do NOT drop pin_hash
-- while stale plaintext values may still exist in the pin column; wait for
-- the separate plaintext-drop migration after all rows are confirmed hashed.

-- =============================================================================
-- 1. user_profiles columns
-- =============================================================================

alter table user_profiles
  add column if not exists pin_hash text;

comment on column user_profiles.pin_hash is
  'scrypt hash of the staff PIN (kpn-scrypt$1$N$r$p$salt$digest). When present, '
  'the legacy plaintext pin column is ignored by authentication.';

alter table user_profiles
  add column if not exists pin_version integer not null default 0;

comment on column user_profiles.pin_version is
  'Monotonically incrementing credential generation counter. Incremented on every '
  'PIN set or clear so sessions minted from the old credential stop verifying.';

alter table user_profiles
  add column if not exists pin_updated_at timestamptz;

comment on column user_profiles.pin_updated_at is
  'Timestamp of the most recent PIN set or clear operation. NULL when no '
  'credential change has occurred yet.';

alter table user_profiles
  add column if not exists pin_must_rotate boolean not null default false;

comment on column user_profiles.pin_must_rotate is
  'True when the current PIN was flagged as weak during bulk import or first '
  'sign-in. The next login should force a rotation before granting access.';

-- =============================================================================
-- 2. staff_login_throttle table
-- =============================================================================

create table if not exists staff_login_throttle (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  subject_key   text not null,
  failed_count  integer not null default 0,
  first_failed_at timestamptz,
  last_failed_at  timestamptz,
  locked_until  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique(tenant_id, subject_key)
);

comment on table staff_login_throttle is
  'Per-tenant rate limiting for staff PIN sign-in. Keyed by (tenant_id, subject_key) '
  'so a lockout in one workspace never affects another, and probing for valid '
  'usernames costs the same as guessing PINs.';

create index if not exists staff_login_throttle_lookup_idx
  on staff_login_throttle (tenant_id, subject_key);

alter table staff_login_throttle enable row level security;

-- Service-role only — no public, anon, or authenticated access.
grant select, insert, update, delete on staff_login_throttle to service_role;

revoke all on staff_login_throttle from public, anon, authenticated;

-- RLS policy: service_role bypasses RLS by default, but the explicit policy
-- documents the intent and prevents accidental anon/authenticated reads if
-- the role check ever changes.
drop policy if exists service_role_full_access on staff_login_throttle;
create policy service_role_full_access on staff_login_throttle
  for all
  to service_role
  using (true)
  with check (true);

-- =============================================================================
-- 3. RPC: set_staff_pin_credential
-- =============================================================================

create or replace function public.set_staff_pin_credential(
  p_user_id uuid,
  p_tenant_id uuid,
  p_pin_hash text,
  p_must_rotate boolean,
  p_actor_id uuid
)
returns table (pin_version integer, pin_updated_at timestamptz, must_rotate boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Verify the target user has an active membership in the calling tenant.
  if p_tenant_id is not null then
    if not exists (
      select 1 from tenant_memberships
      where tenant_id = p_tenant_id
        and user_id = p_user_id
        and status = 'active'
    ) then
      raise exception 'User % has no active membership in tenant %', p_user_id, p_tenant_id;
    end if;
  end if;

  return query
  update user_profiles
  set
    pin_hash      = p_pin_hash,
    pin           = null,
    pin_version   = user_profiles.pin_version + 1,
    pin_updated_at = now(),
    pin_must_rotate = p_must_rotate
  where user_profiles.id = p_user_id
  returning
    user_profiles.pin_version,
    user_profiles.pin_updated_at,
    user_profiles.pin_must_rotate as must_rotate;
end;
$$;

comment on function public.set_staff_pin_credential(uuid, uuid, text, boolean, uuid) is
  'Atomically replace a staff PIN hash, clear the legacy plaintext column, and '
  'bump pin_version so all sessions from the old credential are revoked.';

revoke all on function public.set_staff_pin_credential(uuid, uuid, text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_staff_pin_credential(uuid, uuid, text, boolean, uuid) to service_role;

-- =============================================================================
-- 4. RPC: clear_staff_pin_credential
-- =============================================================================

create or replace function public.clear_staff_pin_credential(
  p_user_id uuid,
  p_tenant_id uuid,
  p_actor_id uuid
)
returns table (pin_version integer, pin_updated_at timestamptz, must_rotate boolean)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Verify the target user has an active membership in the calling tenant.
  if p_tenant_id is not null then
    if not exists (
      select 1 from tenant_memberships
      where tenant_id = p_tenant_id
        and user_id = p_user_id
        and status = 'active'
    ) then
      raise exception 'User % has no active membership in tenant %', p_user_id, p_tenant_id;
    end if;
  end if;

  return query
  update user_profiles
  set
    pin_hash      = null,
    pin           = null,
    pin_version   = user_profiles.pin_version + 1,
    pin_updated_at = now(),
    pin_must_rotate = false
  where user_profiles.id = p_user_id
  returning
    user_profiles.pin_version,
    user_profiles.pin_updated_at,
    false as must_rotate;
end;
$$;

comment on function public.clear_staff_pin_credential(uuid, uuid, uuid) is
  'Remove a staff PIN entirely, clearing both the hash and legacy plaintext '
  'columns, bumping pin_version, and clearing the rotation flag.';

revoke all on function public.clear_staff_pin_credential(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.clear_staff_pin_credential(uuid, uuid, uuid) to service_role;

-- =============================================================================
-- 5. RPC: staff_login_throttle_state
-- =============================================================================

create or replace function public.staff_login_throttle_state(
  p_tenant_id uuid,
  p_subject_key text
)
returns table (
  id uuid,
  tenant_id uuid,
  subject_key text,
  failed_count integer,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
security definer
set search_path = public
as $$
  select
    t.id,
    t.tenant_id,
    t.subject_key,
    t.failed_count,
    t.first_failed_at,
    t.last_failed_at,
    t.locked_until,
    t.created_at,
    t.updated_at
  from staff_login_throttle t
  where t.tenant_id = p_tenant_id
    and t.subject_key = p_subject_key;
$$;

comment on function public.staff_login_throttle_state(uuid, text) is
  'Read the current lockout state for a (tenant, username) pair. Returns no rows '
  'when the pair has no failure history — callers treat that as failed_count = 0.';

revoke all on function public.staff_login_throttle_state(uuid, text) from public, anon, authenticated;
grant execute on function public.staff_login_throttle_state(uuid, text) to service_role;

-- =============================================================================
-- 6. RPC: staff_login_throttle_fail
-- =============================================================================

create or replace function public.staff_login_throttle_fail(
  p_tenant_id uuid,
  p_subject_key text,
  p_max_attempts integer,
  p_lockout_seconds integer
)
returns table (
  id uuid,
  tenant_id uuid,
  subject_key text,
  failed_count integer,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  row_id uuid;
begin
  -- Upsert: create the row on first failure, increment on subsequent failures.
  insert into staff_login_throttle (tenant_id, subject_key, failed_count, first_failed_at, last_failed_at)
  values (p_tenant_id, p_subject_key, 1, now(), now())
  on conflict (tenant_id, subject_key) do update set
    failed_count = staff_login_throttle.failed_count + 1,
    last_failed_at = now(),
    -- Only set first_failed_at on the very first failure (failed_count was 0).
    first_failed_at = case
      when staff_login_throttle.failed_count = 0 then now()
      else staff_login_throttle.first_failed_at
    end,
    updated_at = now()
  returning staff_login_throttle.id into row_id;

  -- If the threshold is reached, lock the account.
  update staff_login_throttle
  set locked_until = now() + (p_lockout_seconds || ' seconds')::interval,
      updated_at = now()
  where staff_login_throttle.id = row_id
    and staff_login_throttle.failed_count >= p_max_attempts
    and staff_login_throttle.locked_until is null;

  -- Return the (possibly updated) row.
  return query
  select
    t.id,
    t.tenant_id,
    t.subject_key,
    t.failed_count,
    t.first_failed_at,
    t.last_failed_at,
    t.locked_until,
    t.created_at,
    t.updated_at
  from staff_login_throttle t
  where t.id = row_id;
end;
$$;

comment on function public.staff_login_throttle_fail(uuid, text, integer, integer) is
  'Record a failed sign-in attempt. Increments the failure counter and locks the '
  'account when the threshold is reached. Returns the updated throttle row.';

revoke all on function public.staff_login_throttle_fail(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.staff_login_throttle_fail(uuid, text, integer, integer) to service_role;

-- =============================================================================
-- 7. RPC: staff_login_throttle_reset
-- =============================================================================

create or replace function public.staff_login_throttle_reset(
  p_tenant_id uuid,
  p_subject_key text
)
returns table (
  id uuid,
  tenant_id uuid,
  subject_key text,
  failed_count integer,
  first_failed_at timestamptz,
  last_failed_at timestamptz,
  locked_until timestamptz,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = public
as $$
declare
  cleared record;
begin
  delete from staff_login_throttle
  where tenant_id = p_tenant_id
    and subject_key = p_subject_key
  returning * into cleared;

  -- Return the deleted row so callers can inspect what was cleared, or NULL-like
  -- defaults when no row existed.
  if cleared.id is not null then
    return query
    select
      cleared.id,
      cleared.tenant_id,
      cleared.subject_key,
      0 as failed_count,
      null::timestamptz as first_failed_at,
      null::timestamptz as last_failed_at,
      null::timestamptz as locked_until,
      cleared.created_at,
      now() as updated_at;
  else
    return query
    select
      null::uuid as id,
      p_tenant_id as tenant_id,
      p_subject_key as subject_key,
      0 as failed_count,
      null::timestamptz as first_failed_at,
      null::timestamptz as last_failed_at,
      null::timestamptz as locked_until,
      now() as created_at,
      now() as updated_at;
  end if;
end;
$$;

comment on function public.staff_login_throttle_reset(uuid, text) is
  'Delete the throttle row for a (tenant, username) pair, clearing all lockout '
  'state. Called after a successful sign-in.';

revoke all on function public.staff_login_throttle_reset(uuid, text) from public, anon, authenticated;
grant execute on function public.staff_login_throttle_reset(uuid, text) to service_role;
