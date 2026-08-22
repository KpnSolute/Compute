-- Make the tenant-scoped invoice-item upsert conflict target valid.
-- tenancy.py prepends tenant_id to every tenant-scoped on_conflict clause.
create unique index if not exists invoice_items_tenant_invoice_line_uidx
  on public.invoice_items (tenant_id, invoice_id, line_number);
