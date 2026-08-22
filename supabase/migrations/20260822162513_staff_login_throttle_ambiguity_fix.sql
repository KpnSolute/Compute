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
  insert into public.staff_login_throttle (
    tenant_id, subject_key, failed_count, first_failed_at, last_failed_at
  )
  values (p_tenant_id, p_subject_key, 1, now(), now())
  on conflict on constraint staff_login_throttle_tenant_id_subject_key_key do update set
    failed_count = staff_login_throttle.failed_count + 1,
    last_failed_at = now(),
    first_failed_at = case
      when staff_login_throttle.failed_count = 0 then now()
      else staff_login_throttle.first_failed_at
    end,
    updated_at = now()
  returning staff_login_throttle.id into row_id;

  update public.staff_login_throttle
  set locked_until = now() + (p_lockout_seconds || ' seconds')::interval,
      updated_at = now()
  where staff_login_throttle.id = row_id
    and staff_login_throttle.failed_count >= p_max_attempts
    and (
      staff_login_throttle.locked_until is null
      or staff_login_throttle.locked_until < now()
    );

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
  from public.staff_login_throttle t
  where t.id = row_id;
end;
$$;

revoke all on function public.staff_login_throttle_fail(uuid, text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.staff_login_throttle_fail(uuid, text, integer, integer)
  to service_role;

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
  delete from public.staff_login_throttle as throttle
  where throttle.tenant_id = p_tenant_id
    and throttle.subject_key = p_subject_key
  returning throttle.* into cleared;

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

revoke all on function public.staff_login_throttle_reset(uuid, text)
  from public, anon, authenticated;
grant execute on function public.staff_login_throttle_reset(uuid, text)
  to service_role;
