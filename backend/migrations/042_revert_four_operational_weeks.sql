-- 042_revert_four_operational_weeks.sql
--
-- Reverts migration 013_enforce_four_operational_weeks (partially-applied 2026-06-21,
-- version 20260621150647) back to the 3-operational-week model that every active code
-- path already enforces: backend/periods.py MAX_WEEKS=3, data_entry.py _validate_week,
-- staging/dispatch.py, and ai/tools.py all hard-reject week 4.
--
-- The 013 migration set app_settings.data_entry.operational_week_count=4 and widened
-- the week_status check to 1-4, but its monthly_inventory ALTER statements referenced
-- w5_received/w5_issued columns that don't exist (dropped in an earlier redesign), so
-- those statements silently never applied. Net result: settings/week_status claimed
-- 4 weeks while every real code path enforced 3. Product decision: roll back to 3,
-- do not build real W4 support.
--
-- Safe + idempotent: constraint drops use IF EXISTS guards; adds use duplicate_object
-- exception handlers (same pattern as migration 013).
-- Does NOT touch monthly_snapshots or its wk5_unused_check (out of scope).

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Remove orphaned week_status rows for week > 3 that were never used.
--    Guard: only open + unlocked rows; never silently drop locked/published data.
-- ─────────────────────────────────────────────────────────────────────────────
DELETE FROM public.week_status
WHERE week > 3
  AND status = 'open'
  AND locked_by IS NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Tighten week_status check constraint from 1–4 back to 1–3.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.week_status'::regclass
      AND contype = 'c'
      AND conname = 'week_status_week_1_4_check'
  ) THEN
    ALTER TABLE public.week_status DROP CONSTRAINT week_status_week_1_4_check;
  END IF;

  ALTER TABLE public.week_status
    ADD CONSTRAINT week_status_week_1_3_check
    CHECK (week >= 1 AND week <= 3);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Tighten inventory_transactions.week_number check from 0–4 back to 0–3.
--    (0 = opening/baseline/aggregate; 1–3 = operational weeks.)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.inventory_transactions'::regclass
      AND contype = 'c'
      AND conname = 'inv_txn_week_check'
  ) THEN
    ALTER TABLE public.inventory_transactions DROP CONSTRAINT inv_txn_week_check;
  END IF;

  ALTER TABLE public.inventory_transactions
    ADD CONSTRAINT inv_txn_week_check
    CHECK (week_number BETWEEN 0 AND 3);
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Reset app_settings.data_entry.operational_week_count back to 3.
--    jsonb || merge overwrites only the specified key; all other data_entry keys
--    (floor_year, floor_month, calendar_rollover_rule, allow_new_items_on_weekly,
--    max_file_size_mb, reconcile_max_delta_pct) are preserved unchanged.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
VALUES (
  'data_entry',
  '{"operational_week_count": 3}'::jsonb,
  now()
)
ON CONFLICT (setting_key) DO UPDATE
  SET setting_value = public.app_settings.setting_value || excluded.setting_value,
      updated_at = now();
