-- Migration 011 — drop stale/broken staging-merge SQL functions.
-- These were written against an older staging schema and now reference objects
-- that no longer exist: execute_stage_merge -> staging_area + inventory_master
-- (both dropped); merge_single_staging / push_all_staging -> staging_entries
-- columns item_id/previous_value/submitted_value/action (don't exist);
-- reject_staging -> staging_entries.id (PK is entry_id). None are called from
-- the app (the live path is the Python _apply_entries). They are dead traps.
-- Backups of all tables remain in bak_20260619.
DROP FUNCTION IF EXISTS public.execute_stage_merge(uuid, uuid);
DROP FUNCTION IF EXISTS public.merge_single_staging(uuid, uuid, text);
DROP FUNCTION IF EXISTS public.push_all_staging(uuid, text, text);
DROP FUNCTION IF EXISTS public.reject_staging(uuid, uuid, text);;
