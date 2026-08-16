-- Tenant-local natural keys replace MJCC-global uniqueness.
alter table public.app_settings drop constraint if exists app_settings_pkey;
alter table public.app_settings
  add constraint app_settings_pkey primary key (tenant_id, setting_key);
alter table public.menu_cycle_slots
  drop constraint if exists menu_cycle_slots_cycle_day_fkey;
alter table public.menu_cycle_days drop constraint if exists menu_cycle_days_pkey;
alter table public.menu_cycle_days
  add constraint menu_cycle_days_pkey primary key (tenant_id, cycle_day);
alter table public.menu_cycle_slots drop constraint if exists menu_cycle_slots_pkey;
alter table public.menu_cycle_slots
  add constraint menu_cycle_slots_pkey primary key (tenant_id, record_id);
alter table public.menu_cycle_slots
  add constraint menu_cycle_slots_tenant_cycle_day_fkey
  foreign key (tenant_id, cycle_day)
  references public.menu_cycle_days(tenant_id, cycle_day);
alter table public.role_permissions drop constraint if exists role_permissions_pkey;
alter table public.role_permissions
  add constraint role_permissions_pkey primary key (tenant_id, role, scope_key);
alter table public.snack_bar_entity_rates
  drop constraint if exists snack_bar_entity_rates_pkey;
alter table public.snack_bar_entity_rates
  add constraint snack_bar_entity_rates_pkey primary key (tenant_id, entity_type);

drop index if exists public.idx_ai_provider_keys_default;
create unique index idx_ai_provider_keys_default
  on public.ai_provider_keys(tenant_id, provider)
  where is_default = true;
drop index if exists public.invoices_invoice_number_uidx;
create unique index invoices_invoice_number_uidx
  on public.invoices(tenant_id, vendor_id, invoice_number)
  where vendor_id is not null;
drop index if exists public.uq_import_batches_active_dedup;
create unique index uq_import_batches_active_dedup
  on public.import_batches(
    tenant_id, source_hash, month, year,
    coalesce(week_number, 0), coalesce(direction, '')
  ) where status in ('staged', 'merged');

alter table public.ai_provider_keys
  drop constraint if exists ai_provider_keys_provider_label_key;
alter table public.ai_provider_keys
  add constraint ai_provider_keys_tenant_provider_label_key
  unique (tenant_id, provider, label);
alter table public.ai_stack_config
  drop constraint if exists ai_stack_config_name_key;
alter table public.ai_stack_config
  add constraint ai_stack_config_tenant_name_key unique (tenant_id, name);
alter table public.api_keys drop constraint if exists api_keys_provider_key;
alter table public.api_keys
  add constraint api_keys_tenant_provider_key unique (tenant_id, provider);
alter table public.archived_files
  drop constraint if exists archived_files_object_key_key;
alter table public.archived_files
  add constraint archived_files_tenant_object_key_key unique (tenant_id, object_key);
alter table public.budget_line_actuals
  drop constraint if exists budget_line_actuals_line_item_id_month_year_key;
alter table public.budget_line_actuals
  add constraint budget_line_actuals_tenant_line_month_year_key
  unique (tenant_id, line_item_id, month, year);
alter table public.centers drop constraint if exists centers_code_key;
alter table public.centers
  add constraint centers_tenant_code_key unique (tenant_id, code);
alter table public.cost_budgets
  drop constraint if exists cost_budgets_month_year_key;
alter table public.cost_budgets
  add constraint cost_budgets_tenant_month_year_key unique (tenant_id, month, year);
alter table public.inventory_categories
  drop constraint if exists inventory_categories_name_key;
alter table public.inventory_categories
  add constraint inventory_categories_tenant_name_key unique (tenant_id, name);
alter table public.inventory_items
  drop constraint if exists inventory_items_barcode_id_key;
alter table public.inventory_items
  drop constraint if exists inventory_items_sku_key;
alter table public.inventory_items
  add constraint inventory_items_tenant_barcode_key unique (tenant_id, barcode_id);
alter table public.inventory_items
  add constraint inventory_items_tenant_sku_key unique (tenant_id, sku);
alter table public.item_barcodes
  drop constraint if exists item_barcodes_barcode_key;
alter table public.item_barcodes
  add constraint item_barcodes_tenant_barcode_key unique (tenant_id, barcode);
alter table public.meal_periods drop constraint if exists meal_periods_meal_key;
alter table public.meal_periods
  add constraint meal_periods_tenant_meal_key unique (tenant_id, meal);
alter table public.menu_feedback_summary
  drop constraint if exists menu_feedback_summary_cycle_day_slot_key;
alter table public.menu_feedback_summary
  add constraint menu_feedback_tenant_day_slot_key
  unique (tenant_id, cycle_day, slot);
alter table public.menu_items drop constraint if exists menu_items_item_key_key;
alter table public.menu_items
  add constraint menu_items_tenant_item_key unique (tenant_id, item_key);
alter table public.month_periods
  drop constraint if exists month_periods_month_year_key;
alter table public.month_periods
  add constraint month_periods_tenant_month_year_key unique (tenant_id, month, year);
alter table public.month_status
  drop constraint if exists month_status_month_year_key;
alter table public.month_status
  add constraint month_status_tenant_month_year_key unique (tenant_id, month, year);
alter table public.monthly_inventory
  drop constraint if exists monthly_inventory_item_id_month_year_key;
alter table public.monthly_inventory
  add constraint monthly_inventory_tenant_item_month_year_key
  unique (tenant_id, item_id, month, year);
alter table public.monthly_snapshots
  drop constraint if exists monthly_snapshots_month_year_key;
alter table public.monthly_snapshots
  add constraint monthly_snapshots_tenant_month_year_key
  unique (tenant_id, month, year);
alter table public.pull_requests
  drop constraint if exists pull_requests_pr_number_key;
alter table public.pull_requests
  add constraint pull_requests_tenant_pr_number_key unique (tenant_id, pr_number);
alter table public.snack_bar_sales
  drop constraint if exists snack_bar_sales_business_date_key;
alter table public.snack_bar_sales
  add constraint snack_bar_sales_tenant_business_date_key
  unique (tenant_id, business_date);
alter table public.week_status
  drop constraint if exists week_status_month_year_week_key;
alter table public.week_status
  add constraint week_status_tenant_month_year_week_key
  unique (tenant_id, month, year, week);

-- Every tenant table gets a composite identity so child relationships can
-- verify that parent and child belong to the same tenant.
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
  primary_columns text;
begin
  foreach table_name in array tenant_tables loop
    -- Pre-authentication failures and platform health faults may not yet have a
    -- workspace. Keep those two telemetry tables nullable; tenant-scoped rows
    -- are still stamped and filtered whenever a request context exists.
    if table_name not in ('audit_events', 'error_logs') then
      execute format(
        'alter table public.%I alter column tenant_id set not null', table_name
      );
    end if;
    select string_agg(quote_ident(attribute.attname), ', ' order by key_column.ordinality)
      into primary_columns
    from pg_constraint constraint_row
    cross join lateral unnest(constraint_row.conkey)
      with ordinality as key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = constraint_row.conrelid
     and attribute.attnum = key_column.attnum
    where constraint_row.conrelid = format('public.%I', table_name)::regclass
      and constraint_row.contype = 'p';
    if primary_columns is not null then
      execute format(
        'create unique index if not exists %I on public.%I(%s, tenant_id)',
        left('uq_' || table_name || '_identity_tenant', 63),
        table_name,
        primary_columns
      );
    end if;
  end loop;
end;
$$;

-- Add a tenant equality check beside every existing tenant-to-tenant FK.
do $$
declare
  fk record;
  source_columns text;
  target_columns text;
  tenant_constraint text;
begin
  for fk in
    select constraint_row.*
    from pg_constraint constraint_row
    where constraint_row.contype = 'f'
      and constraint_row.connamespace = 'public'::regnamespace
      and exists (
        select 1 from pg_attribute
        where attrelid = constraint_row.conrelid
          and attname = 'tenant_id' and not attisdropped
      )
      and exists (
        select 1 from pg_attribute
        where attrelid = constraint_row.confrelid
          and attname = 'tenant_id' and not attisdropped
      )
      and not exists (
        select 1
        from unnest(constraint_row.conkey) as source_key(attnum)
        join pg_attribute source_attribute
          on source_attribute.attrelid = constraint_row.conrelid
         and source_attribute.attnum = source_key.attnum
        where source_attribute.attname = 'tenant_id'
      )
  loop
    select string_agg(quote_ident(attribute.attname), ', ' order by key_column.ordinality)
      into source_columns
    from unnest(fk.conkey) with ordinality as key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = fk.conrelid and attribute.attnum = key_column.attnum;
    select string_agg(quote_ident(attribute.attname), ', ' order by key_column.ordinality)
      into target_columns
    from unnest(fk.confkey) with ordinality as key_column(attnum, ordinality)
    join pg_attribute attribute
      on attribute.attrelid = fk.confrelid and attribute.attnum = key_column.attnum;

    execute format(
      'create unique index if not exists %I on %s(%s, tenant_id)',
      left('uq_tenant_parent_' || substr(md5(fk.confrelid::text || target_columns), 1, 16), 63),
      fk.confrelid::regclass,
      target_columns
    );
    tenant_constraint := left(
      'tenant_' || fk.conname || '_' || substr(md5(fk.conrelid::text), 1, 8), 63
    );
    execute format(
      'alter table %s drop constraint if exists %I',
      fk.conrelid::regclass, tenant_constraint
    );
    execute format(
      'alter table %s add constraint %I foreign key (%s, tenant_id) ' ||
      'references %s(%s, tenant_id) not valid',
      fk.conrelid::regclass, tenant_constraint, source_columns,
      fk.confrelid::regclass, target_columns
    );
    execute format(
      'alter table %s validate constraint %I',
      fk.conrelid::regclass, tenant_constraint
    );
  end loop;
end;
$$;

-- Direct Data API reads are membership-scoped. Writes remain backend-mediated.
do $$
declare
  table_name text;
  policy_row record;
  readable_tables constant text[] := array[
    'app_settings','budget_line_actuals','budget_line_items','centers',
    'commit_changes','commits','cost_budgets','daily_operations_logs','events',
    'flow_assignments','haccp_logs','incident_logs','inventory_categories',
    'inventory_items','inventory_transactions','invoice_items','invoices',
    'item_barcodes','meal_periods','menu_cycle_days','menu_cycle_slots',
    'menu_feedback_summary','menu_items','menu_suggestions','month_periods',
    'month_status','monthly_inventory','monthly_snapshots',
    'opening_checklist_items','pull_requests','role_permissions',
    'servsafe_certifications','snack_bar_entity_rates','snack_bar_products',
    'snack_bar_sales','snack_bar_transaction_items','snack_bar_transactions',
    'staging_entries','vendors','week_gross','week_status'
  ];
  all_tenant_tables constant text[] := array[
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
  foreach table_name in array all_tenant_tables loop
    for policy_row in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = table_name
    loop
      execute format(
        'drop policy if exists %I on public.%I', policy_row.policyname, table_name
      );
    end loop;
    execute format('alter table public.%I enable row level security', table_name);
    execute format(
      'revoke all on public.%I from anon, authenticated', table_name
    );
  end loop;
  foreach table_name in array readable_tables loop
    execute format('grant select on public.%I to authenticated', table_name);
    execute format(
      'create policy tenant_member_select on public.%I for select to authenticated ' ||
      'using (app_private.is_tenant_member(tenant_id))',
      table_name
    );
  end loop;
end;
$$;

-- Every exposed view must carry tenant_id so privileged API reads are scoped.
drop view if exists public.category_spending;
drop view if exists public.invoice_spending_summary;
drop view if exists public.item_price_history;
drop view if exists public.dashboard_summary;
drop view if exists public.live_inventory;
drop view if exists public.monthly_comparison;

create or replace view public.category_spending
with (security_invoker = true) as
select inv.tenant_id, inv.year, inv.month, ii.category,
  sum(ii.extended_price) as total_value,
  count(*) as line_items,
  sum(ii.quantity_shipped) as units_received
from public.invoice_items ii
join public.invoices inv
  on inv.id = ii.invoice_id and inv.tenant_id = ii.tenant_id
where ii.category is not null
group by inv.tenant_id, inv.year, inv.month, ii.category;

create or replace view public.invoice_spending_summary
with (security_invoker = true) as
select invoice.tenant_id, invoice.year, invoice.month, invoice.week_number,
  vendor.name as vendor_name, vendor.vendor_code,
  count(distinct invoice.id) as invoice_count,
  sum(invoice.subtotal) as subtotal,
  sum(invoice.discount) as total_discount,
  sum(invoice.tax) as total_tax,
  sum(invoice.total) as total_paid
from public.invoices invoice
join public.vendors vendor
  on vendor.id = invoice.vendor_id and vendor.tenant_id = invoice.tenant_id
group by invoice.tenant_id, invoice.year, invoice.month, invoice.week_number,
  vendor.name, vendor.vendor_code;

create or replace view public.item_price_history
with (security_invoker = true) as
select line.tenant_id, line.sku, line.description, line.category,
  line.unit_price, line.extended_price, line.quantity_shipped,
  invoice.invoice_number, invoice.invoice_date, vendor.name as vendor_name
from public.invoice_items line
join public.invoices invoice
  on invoice.id = line.invoice_id and invoice.tenant_id = line.tenant_id
join public.vendors vendor
  on vendor.id = invoice.vendor_id and vendor.tenant_id = line.tenant_id
where line.sku is not null;

create or replace view public.dashboard_summary
with (security_invoker = true) as
select item.tenant_id, item.id as item_id, item.sku, item.description,
  coalesce(monthly.unit_price, item.unit_price) as unit_price,
  item.par_level, category.name as category, category.color as category_color,
  monthly.month, monthly.year,
  coalesce(monthly.opening_oh, 0) as opening_oh,
  coalesce(monthly.w1_received, 0) as w1_received,
  coalesce(monthly.w2_received, 0) as w2_received,
  coalesce(monthly.w3_received, 0) as w3_received,
  coalesce(monthly.w1_pulled, 0) as w1_pulled,
  coalesce(monthly.w2_pulled, 0) as w2_pulled,
  coalesce(monthly.w3_pulled, 0) as w3_pulled
from public.inventory_items item
left join public.monthly_inventory monthly
  on monthly.item_id = item.id and monthly.tenant_id = item.tenant_id
left join public.inventory_categories category
  on category.id = item.category_id and category.tenant_id = item.tenant_id
where item.active;

create or replace view public.live_inventory
with (security_invoker = true) as
with periods as (
  select tenant.id as tenant_id,
    coalesce(
      (select status.month from public.month_status status
       where status.tenant_id = tenant.id and status.status = 'open'
       order by status.year desc, status.month desc limit 1),
      (select monthly.month from public.monthly_inventory monthly
       where monthly.tenant_id = tenant.id
       order by monthly.year desc, monthly.month desc limit 1)
    ) as month,
    coalesce(
      (select status.year from public.month_status status
       where status.tenant_id = tenant.id and status.status = 'open'
       order by status.year desc, status.month desc limit 1),
      (select monthly.year from public.monthly_inventory monthly
       where monthly.tenant_id = tenant.id
       order by monthly.year desc, monthly.month desc limit 1)
    ) as year
  from public.tenants tenant
), current_rows as (
  select monthly.*,
    greatest(0,
      coalesce(monthly.opening_oh, 0)
      + coalesce(monthly.w1_received, 0)
      + coalesce(monthly.w2_received, 0)
      + coalesce(monthly.w3_received, 0)
      - coalesce(monthly.w1_pulled, 0)
      - coalesce(monthly.w2_pulled, 0)
      - coalesce(monthly.w3_pulled, 0)
    ) as ending_qty
  from public.monthly_inventory monthly
  join periods on periods.tenant_id = monthly.tenant_id
    and periods.month = monthly.month and periods.year = monthly.year
)
select item.tenant_id, item.id, item.sku, item.description,
  category.name as category,
  coalesce(monthly.unit_price, item.unit_price) as unit_price,
  item.par_level, item.active as is_active, barcode.barcode as barcode_id,
  coalesce(monthly.opening_oh, 0) as opening_on_hand,
  coalesce(monthly.w1_received, 0) as w1r,
  coalesce(monthly.w2_received, 0) as w2r,
  coalesce(monthly.w3_received, 0) as w3r,
  coalesce(monthly.w1_pulled, 0) as w1p,
  coalesce(monthly.w2_pulled, 0) as w2p,
  coalesce(monthly.w3_pulled, 0) as w3p,
  coalesce(monthly.w1_received, 0) + coalesce(monthly.w2_received, 0)
    + coalesce(monthly.w3_received, 0) as total_received,
  coalesce(monthly.w1_pulled, 0) + coalesce(monthly.w2_pulled, 0)
    + coalesce(monthly.w3_pulled, 0) as total_pulled,
  coalesce(monthly.ending_qty, 0) as on_hand,
  round(coalesce(
    monthly.ending_value,
    greatest(0, coalesce(monthly.opening_value, 0)
      + coalesce(monthly.received_value, 0)
      - coalesce(monthly.pulled_value, 0)),
    coalesce(monthly.ending_qty, 0)
      * coalesce(monthly.unit_price, item.unit_price, 0)
  ), 2) as sub_total,
  greatest(0, item.par_level::numeric - coalesce(monthly.ending_qty, 0))
    as order_qty
from public.inventory_items item
left join public.inventory_categories category
  on category.id = item.category_id and category.tenant_id = item.tenant_id
join periods on periods.tenant_id = item.tenant_id
left join current_rows monthly
  on monthly.item_id = item.id and monthly.tenant_id = item.tenant_id
left join lateral (
  select code.barcode
  from public.item_barcodes code
  where code.item_id = item.id and code.tenant_id = item.tenant_id
  order by code.is_primary desc nulls last limit 1
) barcode on true
where item.active;

create or replace view public.monthly_comparison
with (security_invoker = true) as
with ordered as (
  select snapshot.tenant_id, snapshot.month, snapshot.year,
    snapshot.grand_total, snapshot.category_totals, snapshot.preset,
    lag(snapshot.grand_total) over (
      partition by snapshot.tenant_id order by snapshot.year, snapshot.month
    ) as prev_total,
    lag(snapshot.year) over (
      partition by snapshot.tenant_id order by snapshot.year, snapshot.month
    ) as prev_year,
    lag(snapshot.month) over (
      partition by snapshot.tenant_id order by snapshot.year, snapshot.month
    ) as prev_month
  from public.monthly_snapshots snapshot
)
select current_row.tenant_id, current_row.month, current_row.year,
  current_row.grand_total, current_row.category_totals, current_row.preset,
  current_row.prev_total as prior_month_total,
  current_row.prev_month as prior_month,
  current_row.prev_year as prior_year,
  round(current_row.grand_total - current_row.prev_total, 2) as mom_delta,
  case when current_row.prev_total > 0 then
    round((current_row.grand_total - current_row.prev_total)
      / current_row.prev_total * 100, 1) end as mom_pct,
  prior.grand_total as prior_year_total,
  round(current_row.grand_total - prior.grand_total, 2) as yoy_delta,
  case when prior.grand_total > 0 then
    round((current_row.grand_total - prior.grand_total)
      / prior.grand_total * 100, 1) end as yoy_pct
from ordered current_row
left join public.monthly_snapshots prior
  on prior.tenant_id = current_row.tenant_id
 and prior.month = current_row.month
 and prior.year = current_row.year - 1;

revoke all on public.category_spending, public.invoice_spending_summary,
  public.item_price_history, public.dashboard_summary, public.live_inventory,
  public.monthly_comparison from anon, authenticated;
grant select on public.category_spending, public.invoice_spending_summary,
  public.item_price_history, public.dashboard_summary, public.live_inventory,
  public.monthly_comparison to authenticated;
