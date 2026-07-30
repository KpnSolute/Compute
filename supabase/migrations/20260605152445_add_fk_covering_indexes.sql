
-- Covering indexes for unindexed foreign keys (linter 0001).
CREATE INDEX IF NOT EXISTS idx_app_settings_updated_by ON public.app_settings(updated_by);
CREATE INDEX IF NOT EXISTS idx_audit_log_performed_by ON public.audit_log(performed_by);
CREATE INDEX IF NOT EXISTS idx_commits_merged_by ON public.commits(merged_by);
CREATE INDEX IF NOT EXISTS idx_github_sync_queue_commit_id ON public.github_sync_queue(commit_id);
CREATE INDEX IF NOT EXISTS idx_month_status_published_by ON public.month_status(published_by);
CREATE INDEX IF NOT EXISTS idx_staging_entries_reviewed_by ON public.staging_entries(reviewed_by);
CREATE INDEX IF NOT EXISTS idx_staging_entries_submitted_by ON public.staging_entries(submitted_by);
CREATE INDEX IF NOT EXISTS idx_uploads_commit_id ON public.uploads(commit_id);
CREATE INDEX IF NOT EXISTS idx_uploads_uploaded_by ON public.uploads(uploaded_by);
;
