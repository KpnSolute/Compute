DROP INDEX IF EXISTS public.uq_import_batches_merged_dedup;
CREATE UNIQUE INDEX IF NOT EXISTS uq_import_batches_active_dedup
    ON public.import_batches (
        source_hash, month, year,
        COALESCE(week_number, 0),
        COALESCE(direction, '')
    )
    WHERE status IN ('staged','merged');;
