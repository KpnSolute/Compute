-- Cover the SSO handoff user foreign key for cleanup and account maintenance.
create index if not exists lunchvoice_sso_handoffs_user_id_idx
  on public.lunchvoice_sso_handoffs (user_id);
