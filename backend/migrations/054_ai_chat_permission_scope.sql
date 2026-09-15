-- Register the full-page MJCC AI workspace without overwriting later operator choices.
insert into public.permission_scopes (key, label, group_name, min_role, sort_order, active)
values ('ai-chat', 'MJCC AI', 'AI Studio', 'manager', 170, true)
on conflict (key) do nothing;

insert into public.role_permissions (tenant_id, role, scope_key, allowed)
select tenant.id, grant_row.role, 'ai-chat', true
from public.tenants as tenant
cross join (
  values
    ('manager'),
    ('admin'),
    ('sudo')
) as grant_row(role)
where lower(tenant.slug) = 'mjcc'
on conflict (tenant_id, role, scope_key) do nothing;
