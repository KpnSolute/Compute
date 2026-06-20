-- Migration 011 — drop stale/broken staging-merge SQL functions (applied to MJCCv1).
-- execute_stage_merge (-> dropped staging_area/inventory_master),
-- merge_single_staging / push_all_staging (-> non-existent staging_entries cols),
-- reject_staging (-> staging_entries.id; PK is entry_id). None called from the app;
-- the live path is the Python _apply_entries. Backups in bak_20260619.
DROP FUNCTION IF EXISTS public.execute_stage_merge(uuid, uuid);
DROP FUNCTION IF EXISTS public.merge_single_staging(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.push_all_staging(uuid, text, text);
DROP FUNCTION IF EXISTS public.reject_staging(uuid, uuid, text);
