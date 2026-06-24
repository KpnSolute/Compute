-- 016_fix_import_dedup_index_scope.sql
-- Broaden the import_batches dedup unique index from merged-only to active
-- (staged OR merged) so a duplicate file is rejected at upload-INSERT time —
-- before any ledger row is written — rather than only at merge time.
-- Idempotent + safe on both fresh (015 already broad) and existing DBs.

DROP INDEX IF EXISTS public.uq_import_batches_merged_dedup;

CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_active_dedup
    ON public.import_batches (
        source_hash, month, year,
        COALESCE(week_number, 0),
        COALESCE(direction, '')
    )
    WHERE status IN ('staged','merged');
