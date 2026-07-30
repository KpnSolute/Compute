create index if not exists archived_files_deleted_by_idx on public.archived_files (deleted_by) where deleted_by is not null;;
