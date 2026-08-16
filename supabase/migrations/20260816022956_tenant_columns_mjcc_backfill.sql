-- Add the tenant key additively, then place all existing rows behind MJCC.
do $$
declare
  table_name text;
  tenant_tables constant text[] := array[
    'agent_conversations','agent_usage','ai_provider_keys','ai_stack_config',
    'ai_usage_logs','api_keys','app_settings','archived_files','audit_events',
    'budget_line_actuals','budget_line_items','centers','commit_changes','commits',
    'cost_budgets','credential_access_audit','daily_operations_logs','error_logs',
    'events','flow_assignments','github_sync_queue','haccp_logs','import_batches',
    'incident_logs','inventory_audit_log','inventory_categories','inventory_items',
    'inventory_transactions','invoice_items','invoices','item_barcodes',
    'july_invoice_import','july_reimport_backup_invoice_items',
    'july_reimport_backup_invoices','july_reimport_backup_items',
    'july_reimport_backup_minv','lunchvoice_sso_handoffs','meal_periods',
    'menu_cycle_days','menu_cycle_slots','menu_feedback_summary','menu_items',
    'menu_suggestions','month_periods','month_status','monthly_inventory',
    'monthly_snapshots','opening_checklist_items','pull_requests',
    'role_permissions','servsafe_certifications','sku_review_queue',
    'snack_bar_entity_rates','snack_bar_products','snack_bar_sales',
    'snack_bar_transaction_items','snack_bar_transactions','sso_handoffs',
    'staging_entries','vendors','week_gross','week_status'
  ];
  mjcc_id uuid;
begin
  select id into strict mjcc_id from public.tenants where slug = 'mjcc';
  foreach table_name in array tenant_tables loop
    if to_regclass(format('public.%I', table_name)) is null then
      raise exception 'Required tenant table public.% is missing', table_name;
    end if;
    execute format(
      'alter table public.%I add column if not exists tenant_id uuid', table_name
    );
    -- Existing operational guards correctly reject edits to closed periods.
    -- This one-time ownership backfill changes no business value, so suspend
    -- user triggers for the bounded update while retaining system constraints.
    execute format(
      'alter table public.%I disable trigger user', table_name
    );
    execute format(
      'update public.%I set tenant_id = $1 where tenant_id is null', table_name
    ) using mjcc_id;
    execute format(
      'alter table public.%I enable trigger user', table_name
    );
    execute format(
      'alter table public.%I drop constraint if exists %I',
      table_name, table_name || '_tenant_id_fkey'
    );
    execute format(
      'alter table public.%I add constraint %I foreign key (tenant_id) ' ||
      'references public.tenants(id) on delete restrict not valid',
      table_name, table_name || '_tenant_id_fkey'
    );
    execute format(
      'alter table public.%I validate constraint %I',
      table_name, table_name || '_tenant_id_fkey'
    );
    execute format(
      'create index if not exists %I on public.%I(tenant_id)',
      left('idx_' || table_name || '_tenant_id', 63), table_name
    );
  end loop;
end;
$$;

-- Keep the existing MJCC deployment write-compatible while the tenant-aware
-- backend rolls out. Explicit tenant IDs always win. A later enforced-mode
-- migration removes these triggers after every writer supplies tenant_id.
create or replace function app_private.assign_legacy_mjcc_tenant()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.tenant_id is null then
    select id into strict new.tenant_id
    from public.tenants
    where slug = 'mjcc';
  end if;
  return new;
end;
$$;

revoke all on function app_private.assign_legacy_mjcc_tenant()
  from public, anon, authenticated;
grant execute on function app_private.assign_legacy_mjcc_tenant()
  to service_role;

do $$
declare
  table_name text;
  required_tenant_tables constant text[] := array[
    'agent_conversations','agent_usage','ai_provider_keys','ai_stack_config',
    'ai_usage_logs','api_keys','app_settings','archived_files',
    'budget_line_actuals','budget_line_items','centers','commit_changes','commits',
    'cost_budgets','credential_access_audit','daily_operations_logs','events',
    'flow_assignments','github_sync_queue','haccp_logs','import_batches',
    'incident_logs','inventory_audit_log','inventory_categories','inventory_items',
    'inventory_transactions','invoice_items','invoices','item_barcodes',
    'july_invoice_import','july_reimport_backup_invoice_items',
    'july_reimport_backup_invoices','july_reimport_backup_items',
    'july_reimport_backup_minv','lunchvoice_sso_handoffs','meal_periods',
    'menu_cycle_days','menu_cycle_slots','menu_feedback_summary','menu_items',
    'menu_suggestions','month_periods','month_status','monthly_inventory',
    'monthly_snapshots','opening_checklist_items','pull_requests',
    'role_permissions','servsafe_certifications','sku_review_queue',
    'snack_bar_entity_rates','snack_bar_products','snack_bar_sales',
    'snack_bar_transaction_items','snack_bar_transactions','sso_handoffs',
    'staging_entries','vendors','week_gross','week_status'
  ];
begin
  foreach table_name in array required_tenant_tables loop
    execute format(
      'drop trigger if exists legacy_mjcc_tenant_default on public.%I',
      table_name
    );
    execute format(
      'create trigger legacy_mjcc_tenant_default before insert on public.%I ' ||
      'for each row execute function app_private.assign_legacy_mjcc_tenant()',
      table_name
    );
    execute format(
      'alter table public.%I alter column tenant_id set not null',
      table_name
    );
  end loop;
end;
$$;

do $$
declare
  missing_count bigint;
  table_name text;
  tenant_tables constant text[] := array[
    'agent_conversations','agent_usage','ai_provider_keys','ai_stack_config',
    'ai_usage_logs','api_keys','app_settings','archived_files','audit_events',
    'budget_line_actuals','budget_line_items','centers','commit_changes','commits',
    'cost_budgets','credential_access_audit','daily_operations_logs','error_logs',
    'events','flow_assignments','github_sync_queue','haccp_logs','import_batches',
    'incident_logs','inventory_audit_log','inventory_categories','inventory_items',
    'inventory_transactions','invoice_items','invoices','item_barcodes',
    'july_invoice_import','july_reimport_backup_invoice_items',
    'july_reimport_backup_invoices','july_reimport_backup_items',
    'july_reimport_backup_minv','lunchvoice_sso_handoffs','meal_periods',
    'menu_cycle_days','menu_cycle_slots','menu_feedback_summary','menu_items',
    'menu_suggestions','month_periods','month_status','monthly_inventory',
    'monthly_snapshots','opening_checklist_items','pull_requests',
    'role_permissions','servsafe_certifications','sku_review_queue',
    'snack_bar_entity_rates','snack_bar_products','snack_bar_sales',
    'snack_bar_transaction_items','snack_bar_transactions','sso_handoffs',
    'staging_entries','vendors','week_gross','week_status'
  ];
begin
  foreach table_name in array tenant_tables loop
    execute format(
      'select count(*) from public.%I where tenant_id is null', table_name
    ) into missing_count;
    if missing_count <> 0 then
      raise exception 'Tenant backfill incomplete for public.%: % rows',
        table_name, missing_count;
    end if;
  end loop;
end;
$$;
