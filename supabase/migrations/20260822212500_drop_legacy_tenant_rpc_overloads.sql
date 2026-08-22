-- All application callers use TenantScopedClient, which supplies the
-- tenant-aware signatures.  The legacy overloads are unscoped and can reach
-- conflict targets that no longer exist on tenant-scoped tables.
-- Drop sku_review_resolve first because its legacy body calls the legacy
-- sku_add_alias overload.
DROP FUNCTION IF EXISTS public.sku_review_resolve(uuid, text, uuid, uuid);
DROP FUNCTION IF EXISTS public.sku_add_alias(uuid, text, uuid);

DROP FUNCTION IF EXISTS public.admin_merge_items(uuid, uuid);
DROP FUNCTION IF EXISTS public.audit_inventory_period(integer, integer);
DROP FUNCTION IF EXISTS public.link_invoice_items_by_id(uuid);
DROP FUNCTION IF EXISTS public.perform_rollover(integer, integer, uuid, text);
DROP FUNCTION IF EXISTS public.sc_close_pull_request(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.sc_finalize_merge(uuid, uuid, uuid);
DROP FUNCTION IF EXISTS public.set_week_status(integer, integer, integer, text, uuid);
