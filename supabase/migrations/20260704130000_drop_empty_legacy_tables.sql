-- 030: drop verified-empty, unreferenced legacy tables (schema hygiene audit 2026-07-04)
-- Every table below had exactly 0 rows and 0 code references at drop time.
-- Kept: month_periods + week_gross (invoices FKs depend on them - live invoice-period model, not dups).
drop table if exists public._bak_0624_commit_changes;
drop table if exists public._bak_0624_commits;
drop table if exists public._bak_0624_inventory_items;
drop table if exists public._bak_0624_inventory_transactions;
drop table if exists public._bak_0624_monthly_inventory;
drop table if exists public._bak_20260623_commit_changes;
drop table if exists public._bak_20260623_commits;
drop table if exists public._bak_20260623_github_sync_queue;
drop table if exists public._bak_20260623_inventory_items;
drop table if exists public._bak_20260623_monthly_inventory;
drop table if exists public._bak_20260623_monthly_snapshots;
drop table if exists public._bak_20260623_pull_requests;
drop table if exists public._bak_20260623_sku_review_queue;
drop table if exists public._bak_20260623_staging_entries;
drop table if exists public.audit_log;
drop table if exists public.archive_import_log;
drop table if exists public.inventory_versions;
