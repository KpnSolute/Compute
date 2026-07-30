
-- Drop redundant duplicate indexes (linter 0009). In each pair we keep the
-- constraint-backed index (pkey / unique key) or the more descriptively named
-- one, and drop the standalone manual duplicate. None of these back a constraint.
DROP INDEX IF EXISTS public.idx_commit_changes_commit;        -- dup of idx_commit_changes_commit_id
DROP INDEX IF EXISTS public.idx_cc_entity;                    -- dup of idx_commit_changes_entity
DROP INDEX IF EXISTS public.idx_commit_changes_item;          -- dup of idx_commit_changes_item_month_year
DROP INDEX IF EXISTS public.idx_commits_pk;                   -- dup of commits_pkey
DROP INDEX IF EXISTS public.idx_invitems_cat;                 -- dup of idx_inventory_items_category
DROP INDEX IF EXISTS public.idx_invitems_sku;                 -- dup of idx_inventory_items_sku
DROP INDEX IF EXISTS public.idx_inventory_versions_commit;    -- dup of idx_inventory_versions_commit_id
DROP INDEX IF EXISTS public.idx_month_status_month_year;      -- dup of month_status_month_year_key
DROP INDEX IF EXISTS public.idx_monthly_item;                 -- dup of idx_monthly_inventory_item_id
DROP INDEX IF EXISTS public.idx_monthly_inventory_item_month_year; -- dup of monthly_inventory_item_id_month_year_key
DROP INDEX IF EXISTS public.idx_staging_entity;               -- dup of idx_staging_entries_entity
DROP INDEX IF EXISTS public.idx_staging_status;               -- dup of idx_staging_entries_status
;
