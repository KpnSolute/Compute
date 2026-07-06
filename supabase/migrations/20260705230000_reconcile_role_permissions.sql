-- 032: access-scope reconciliation (audit 2026-07-05)
-- Applied live via MCP apply_migration; mirrored here for history.
update public.permission_scopes set active = false, updated_at = now() where key = 'barcodes';
delete from public.role_permissions where scope_key = 'barcodes';
delete from public.role_permissions where role = 'staff' and scope_key in ('dailyops','dataentry','haccp','inspection','menu');
insert into public.role_permissions (role, scope_key, allowed) values
  ('staff','sourcectrl',true), ('staff','reports',true)
on conflict do nothing;
delete from public.role_permissions where role = 'assistant' and scope_key = 'lioncafe';
insert into public.role_permissions (role, scope_key, allowed) values
  ('assistant','sourcectrl',true)
on conflict do nothing;
