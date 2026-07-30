-- 032: access-scope reconciliation (audit 2026-07-05)
-- 1) Retire dead 'barcodes' scope (page removed in v4.27.5).
update public.permission_scopes set active = false, updated_at = now() where key = 'barcodes';
delete from public.role_permissions where scope_key = 'barcodes';

-- 2) Reconcile role_permissions to lived behavior (NAV min levels), since scopes were
--    never actually enforced for staff/assistant until now.
-- staff: remove grants for pages their level can't reach anyway; add the min-10 pages they use today.
delete from public.role_permissions where role = 'staff' and scope_key in ('dailyops','dataentry','haccp','inspection','menu');
insert into public.role_permissions (role, scope_key, allowed) values
  ('staff','sourcectrl',true), ('staff','reports',true)
on conflict do nothing;
-- assistant: add sourcectrl (min 10); remove lioncafe (min 30, above their level).
delete from public.role_permissions where role = 'assistant' and scope_key = 'lioncafe';
insert into public.role_permissions (role, scope_key, allowed) values
  ('assistant','sourcectrl',true)
on conflict do nothing;;
