-- Keeping the constraint-backed/older name in each pair, dropping the redundant duplicate
DROP INDEX IF EXISTS public.idx_ai_stack_config_default; -- duplicate of unique-constraint index ai_stack_config_name_key
DROP INDEX IF EXISTS public.idx_inv_items_category;       -- duplicate of idx_invoice_items_category
DROP INDEX IF EXISTS public.idx_inv_items_sku;             -- duplicate of idx_invoice_items_sku
DROP INDEX IF EXISTS public.idx_monthly_inv_month_year;    -- duplicate of idx_monthly_inventory_month_year;
