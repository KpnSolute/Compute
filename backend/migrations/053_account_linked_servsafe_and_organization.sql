-- Link ServSafe records to MJCC account identities and expose the two new
-- tenant-scoped navigation panels. Existing template rows remain intact and
-- unassigned because their position labels do not identify a unique account.

alter table public.servsafe_certifications
  add column if not exists user_id uuid;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'servsafe_certifications_tenant_user_fkey'
      and conrelid = 'public.servsafe_certifications'::regclass
  ) then
    alter table public.servsafe_certifications
      add constraint servsafe_certifications_tenant_user_fkey
      foreign key (tenant_id, user_id)
      references public.tenant_memberships (tenant_id, user_id)
      on delete cascade;
  end if;
end
$$;

create index if not exists idx_servsafe_certifications_tenant_user
  on public.servsafe_certifications (tenant_id, user_id);

create unique index if not exists uq_servsafe_certifications_tenant_user_type
  on public.servsafe_certifications (tenant_id, user_id, certification)
  where user_id is not null;

comment on column public.servsafe_certifications.user_id is
  'MJCC account identity that owns this certification; legacy position-label rows may remain null.';

insert into public.permission_scopes
  (key, label, group_name, min_role, sort_order, active)
values
  ('servsafe', 'ServSafe Manager', 'Calendar', 'manager', 145, true),
  ('organization', 'Organization', 'Administration', 'manager', 215, true)
on conflict (key) do update set
  label = excluded.label,
  group_name = excluded.group_name,
  min_role = excluded.min_role,
  sort_order = excluded.sort_order,
  active = excluded.active,
  updated_at = now();

insert into public.role_permissions (tenant_id, role, scope_key, allowed)
select tenant.id, grant_row.role, grant_row.scope_key, true
from public.tenants as tenant
cross join (
  values
    ('manager', 'servsafe'),
    ('admin', 'servsafe'),
    ('sudo', 'servsafe'),
    ('manager', 'organization'),
    ('admin', 'organization'),
    ('sudo', 'organization')
) as grant_row(role, scope_key)
where lower(tenant.slug) = 'mjcc'
on conflict (tenant_id, role, scope_key) do nothing;
