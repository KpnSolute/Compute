insert into permission_scopes (key, label, group_name, min_role, sort_order, active)
values ('costmgr', 'Cost Manager', 'Finance', 'manager', 205, true)
on conflict (key) do nothing;

insert into role_permissions (role, scope_key, allowed)
values ('manager', 'costmgr', true), ('admin', 'costmgr', true), ('sudo', 'costmgr', true)
on conflict (role, scope_key) do update set allowed = true;
;
