-- These are internal audit/scratch tables. PostgREST exposes public tables, so
-- enable RLS with no policies: service_role keeps full access, anon and
-- authenticated get nothing.
alter table july_invoice_import            enable row level security;
alter table july_reimport_backup_items     enable row level security;
alter table july_reimport_backup_minv      enable row level security;
alter table july_reimport_backup_invoices  enable row level security;
alter table july_reimport_backup_invoice_items enable row level security;

revoke all on july_invoice_import            from anon, authenticated;
revoke all on july_reimport_backup_items     from anon, authenticated;
revoke all on july_reimport_backup_minv      from anon, authenticated;
revoke all on july_reimport_backup_invoices  from anon, authenticated;
revoke all on july_reimport_backup_invoice_items from anon, authenticated;;
