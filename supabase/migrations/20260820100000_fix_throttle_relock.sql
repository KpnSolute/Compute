-- Fix: staff_login_throttle_fail must re-lock after an expired lockout.
--
-- The original function required `locked_until IS NULL` before applying a new
-- lock.  After the lockout window expires, locked_until is still set (not null)
-- so the UPDATE silently skips — the account can never be re-locked.
--
-- Fix: allow re-lock when the previous lock has expired
--   (locked_until IS NULL OR locked_until < now()).

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
  -- Allow re-locking when the previous lockout has expired
  -- (locked_until IS NULL OR locked_until < now()).
  update staff_login_throttle
  set locked_until = now() + (p_lockout_seconds || ' seconds')::interval,
      updated_at = now()
  where staff_login_throttle.id = row_id
    and staff_login_throttle.failed_count >= p_max_attempts
    and (staff_login_throttle.locked_until is null
         or staff_login_throttle.locked_until < now());

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
  'account when the threshold is reached. Allows re-locking after an expired '
  'lockout window. Returns the updated throttle row.';

revoke all on function public.staff_login_throttle_fail(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.staff_login_throttle_fail(uuid, text, integer, integer) to service_role;
