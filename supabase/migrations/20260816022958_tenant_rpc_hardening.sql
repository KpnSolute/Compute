-- Privileged functions take the validated tenant explicitly and constrain every
-- touched row. The legacy overloads remain temporarily for zero-downtime
-- deployment and are removed after the enforced-mode cutover.

create or replace function public.admin_merge_items(
  p_tenant_id uuid, p_keep uuid, p_remove uuid
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare keep_sku text; remove_sku text;
begin
  if p_keep is null or p_remove is null or p_keep = p_remove then
    raise exception 'keep and remove must be two distinct item ids';
  end if;
  select sku into keep_sku from public.inventory_items
    where id = p_keep and tenant_id = p_tenant_id for update;
  select sku into remove_sku from public.inventory_items
    where id = p_remove and tenant_id = p_tenant_id for update;
  if keep_sku is null or remove_sku is null then
    raise exception 'both items must exist in the selected workspace';
  end if;
  delete from public.monthly_inventory removed
    where removed.tenant_id = p_tenant_id and removed.item_id = p_remove
      and exists (
        select 1 from public.monthly_inventory kept
        where kept.tenant_id = p_tenant_id and kept.item_id = p_keep
          and kept.month = removed.month and kept.year = removed.year
      );
  update public.monthly_inventory set item_id = p_keep
    where tenant_id = p_tenant_id and item_id = p_remove;
  update public.item_barcodes set item_id = p_keep
    where tenant_id = p_tenant_id and item_id = p_remove;
  delete from public.inventory_items
    where tenant_id = p_tenant_id and id = p_remove;
  return jsonb_build_object(
    'kept', p_keep, 'kept_sku', keep_sku,
    'removed', p_remove, 'removed_sku', remove_sku
  );
end;
$$;

create or replace function public.link_invoice_items_by_id(
  p_tenant_id uuid, p_invoice_id uuid
) returns integer
language sql
set search_path = public, pg_temp
as $$
  with linked as (
    update public.invoice_items line
    set inventory_item_id = item.id
    from public.inventory_items item
    where line.tenant_id = p_tenant_id
      and item.tenant_id = p_tenant_id
      and line.invoice_id = p_invoice_id
      and item.sku = line.sku
      and line.inventory_item_id is distinct from item.id
    returning line.id
  )
  select count(*)::integer from linked;
$$;

create or replace function public.set_week_status(
  p_tenant_id uuid,
  p_month integer,
  p_year integer,
  p_week integer,
  p_status text,
  p_by uuid
) returns public.week_status
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare result_row public.week_status;
begin
  insert into public.week_status(
    tenant_id, month, year, week, status, locked_by, locked_at
  ) values (
    p_tenant_id, p_month, p_year, p_week, p_status,
    case when p_status in ('locked','published') then p_by end,
    case when p_status in ('locked','published') then now() end
  )
  on conflict(tenant_id, month, year, week) do update
  set status = excluded.status,
      locked_by = excluded.locked_by,
      locked_at = excluded.locked_at
  returning * into result_row;
  return result_row;
end;
$$;

create or replace function public.sku_add_alias(
  p_tenant_id uuid,
  p_item uuid,
  p_alias text,
  p_vendor uuid default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare existing_item uuid;
begin
  if p_item is null or p_alias is null or btrim(p_alias) = '' then
    raise exception 'item and alias required';
  end if;
  if not exists (
    select 1 from public.inventory_items
    where tenant_id = p_tenant_id and id = p_item
  ) then
    raise exception 'item is unavailable in the selected workspace';
  end if;
  select id into existing_item from public.inventory_items
    where tenant_id = p_tenant_id and sku = btrim(p_alias) limit 1;
  if existing_item is not null and existing_item <> p_item then
    return jsonb_build_object(
      'ok', false, 'error', 'alias_is_canonical_sku', 'item_id', existing_item
    );
  end if;
  select item_id into existing_item from public.item_barcodes
    where tenant_id = p_tenant_id and barcode = btrim(p_alias)
      and coalesce(type, '') in ('vendor_sku','alias','sku') limit 1;
  if existing_item is not null and existing_item <> p_item then
    return jsonb_build_object(
      'ok', false, 'error', 'alias_maps_other_item', 'item_id', existing_item
    );
  end if;
  insert into public.item_barcodes(
    tenant_id, item_id, barcode, type, is_primary
  ) values (
    p_tenant_id, p_item, btrim(p_alias), 'vendor_sku', false
  ) on conflict do nothing;
  return jsonb_build_object(
    'ok', true, 'item_id', p_item, 'alias', btrim(p_alias)
  );
end;
$$;

create or replace function public.sku_review_resolve(
  p_tenant_id uuid,
  p_id uuid,
  p_resolution text,
  p_item uuid,
  p_by uuid
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare parsed_alias text;
begin
  select parsed_sku into parsed_alias from public.sku_review_queue
    where tenant_id = p_tenant_id and id = p_id;
  if parsed_alias is null then
    raise exception 'review item is unavailable in the selected workspace';
  end if;
  if p_resolution = 'alias_existing' and p_item is not null then
    perform public.sku_add_alias(
      p_tenant_id, p_item, parsed_alias, null
    );
  end if;
  update public.sku_review_queue
  set status = 'resolved', resolution = p_resolution,
      resolved_item_id = p_item, resolved_by = p_by, resolved_at = now()
  where tenant_id = p_tenant_id and id = p_id;
end;
$$;

create or replace function public.sc_finalize_merge(
  p_tenant_id uuid, p_pr uuid, p_commit uuid, p_merged_by uuid
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.pull_requests
  set status = 'merged', merged_at = now(), merged_by = p_merged_by,
      commit_id = p_commit, updated_at = now()
  where tenant_id = p_tenant_id and pr_id = p_pr;
  if not found then
    raise exception 'pull request is unavailable in the selected workspace';
  end if;
  update public.commits set pull_request_id = p_pr
    where tenant_id = p_tenant_id and commit_id = p_commit;
end;
$$;

create or replace function public.sc_close_pull_request(
  p_tenant_id uuid, p_pr uuid, p_closed_by uuid, p_note text
) returns void
language plpgsql security definer
set search_path = public, pg_temp
as $$
begin
  update public.pull_requests
  set status = 'closed', closed_at = now(), closed_by = p_closed_by,
      review_note = coalesce(p_note, review_note), updated_at = now()
  where tenant_id = p_tenant_id and pr_id = p_pr;
  if not found then
    raise exception 'pull request is unavailable in the selected workspace';
  end if;
  update public.staging_entries
  set status = 'rejected', reviewed_by = p_closed_by, reviewed_at = now(),
      review_note = coalesce(p_note, review_note)
  where tenant_id = p_tenant_id and pull_request_id = p_pr
    and status = 'pending';
end;
$$;

create or replace function public.audit_inventory_period(
  p_tenant_id uuid, p_month integer, p_year integer
) returns integer
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare suspicious_quantity numeric := 500; finding_count integer := 0;
begin
  delete from public.inventory_audit_log
    where tenant_id = p_tenant_id and month = p_month and year = p_year
      and resolved = false;
  insert into public.inventory_audit_log(
    tenant_id, month, year, check_type, severity, item_id, sku, message, details
  )
  select p_tenant_id, p_month, p_year, 'negative_ending', 'error',
    monthly.item_id, item.sku,
    format(
      'Ending on hand is %s for %s - pulled more than available.',
      coalesce(monthly.opening_oh, 0)
        + coalesce(monthly.w1_received, 0)
        + coalesce(monthly.w2_received, 0)
        + coalesce(monthly.w3_received, 0)
        - coalesce(monthly.w1_pulled, 0)
        - coalesce(monthly.w2_pulled, 0)
        - coalesce(monthly.w3_pulled, 0),
      item.sku
    ),
    jsonb_build_object(
      'ending', coalesce(monthly.opening_oh, 0)
        + coalesce(monthly.w1_received, 0)
        + coalesce(monthly.w2_received, 0)
        + coalesce(monthly.w3_received, 0)
        - coalesce(monthly.w1_pulled, 0)
        - coalesce(monthly.w2_pulled, 0)
        - coalesce(monthly.w3_pulled, 0)
    )
  from public.monthly_inventory monthly
  join public.inventory_items item
    on item.id = monthly.item_id and item.tenant_id = monthly.tenant_id
  where monthly.tenant_id = p_tenant_id
    and monthly.month = p_month and monthly.year = p_year
    and coalesce(monthly.opening_oh, 0)
      + coalesce(monthly.w1_received, 0)
      + coalesce(monthly.w2_received, 0)
      + coalesce(monthly.w3_received, 0)
      - coalesce(monthly.w1_pulled, 0)
      - coalesce(monthly.w2_pulled, 0)
      - coalesce(monthly.w3_pulled, 0) < 0;
  insert into public.inventory_audit_log(
    tenant_id, month, year, check_type, severity, item_id, sku, message, details
  )
  select p_tenant_id, p_month, p_year, 'missing_price', 'warning',
    monthly.item_id, item.sku,
    format('%s has activity but no unit price.', item.sku),
    jsonb_build_object('opening_oh', monthly.opening_oh)
  from public.monthly_inventory monthly
  join public.inventory_items item
    on item.id = monthly.item_id and item.tenant_id = monthly.tenant_id
  where monthly.tenant_id = p_tenant_id
    and monthly.month = p_month and monthly.year = p_year
    and coalesce(monthly.unit_price, item.unit_price, 0) = 0
    and coalesce(monthly.opening_oh, 0)
      + coalesce(monthly.w1_received, 0)
      + coalesce(monthly.w2_received, 0)
      + coalesce(monthly.w3_received, 0)
      + coalesce(monthly.w1_pulled, 0)
      + coalesce(monthly.w2_pulled, 0)
      + coalesce(monthly.w3_pulled, 0) <> 0;
  insert into public.inventory_audit_log(
    tenant_id, month, year, check_type, severity, item_id, sku, message, details
  )
  select p_tenant_id, p_month, p_year, 'orphan_item', 'warning',
    monthly.item_id, item.sku,
    format('%s has no category assigned.', item.sku), '{}'::jsonb
  from public.monthly_inventory monthly
  join public.inventory_items item
    on item.id = monthly.item_id and item.tenant_id = monthly.tenant_id
  where monthly.tenant_id = p_tenant_id
    and monthly.month = p_month and monthly.year = p_year
    and item.category_id is null;
  insert into public.inventory_audit_log(
    tenant_id, month, year, check_type, severity, item_id, sku, message, details
  )
  select p_tenant_id, p_month, p_year, 'suspicious_qty', 'info',
    movement.item_id, movement.sku,
    format('Large %s movement for %s.', movement.txn_type, movement.sku),
    jsonb_build_object(
      'quantity', movement.quantity, 'week', movement.week_number,
      'source', movement.source_file
    )
  from public.inventory_transactions movement
  where movement.tenant_id = p_tenant_id
    and movement.month = p_month and movement.year = p_year
    and movement.quantity > suspicious_quantity;
  insert into public.inventory_audit_log(
    tenant_id, month, year, check_type, severity, item_id, sku, message, details
  )
  select p_tenant_id, p_month, p_year, 'duplicate_week', 'warning',
    movement.item_id, max(movement.sku),
    format(
      '%s received %s separate times in week %s - possible duplicate entry.',
      max(movement.sku), count(*), movement.week_number
    ),
    jsonb_build_object('count', count(*), 'week', movement.week_number)
  from public.inventory_transactions movement
  where movement.tenant_id = p_tenant_id
    and movement.month = p_month and movement.year = p_year
    and movement.txn_type = 'received'
  group by movement.item_id, movement.week_number
  having count(*) >= 3;
  select count(*) into finding_count from public.inventory_audit_log
    where tenant_id = p_tenant_id and month = p_month and year = p_year
      and resolved = false;
  return finding_count;
end;
$$;

create or replace function public.perform_rollover(
  p_tenant_id uuid,
  p_from_month integer,
  p_from_year integer,
  p_rolled_by uuid,
  p_message text default null
) returns jsonb
language plpgsql security definer
set search_path = public, pg_temp
as $$
declare
  next_month integer;
  next_year integer;
  new_commit uuid;
  starting_total numeric := 0;
  item_row record;
  ending_quantity numeric;
  ending_amount numeric;
  opening_cost numeric;
  commit_message text;
begin
  if p_from_month = 11 then
    next_month := 0; next_year := p_from_year + 1;
  else
    next_month := p_from_month + 1; next_year := p_from_year;
  end if;
  commit_message := coalesce(
    p_message,
    'rollover: ' || p_from_month || '/' || p_from_year ||
      ' -> ' || next_month || '/' || next_year
  );
  insert into public.month_status(
    tenant_id, month, year, status, opened_at
  ) values (
    p_tenant_id, next_month, next_year, 'open', now()
  )
  on conflict (tenant_id, month, year) do update
  set status = 'open', opened_at = now();

  insert into public.commits(
    tenant_id, author_id, message, branch, status, merged_by, merged_at,
    month, year, source
  ) values (
    p_tenant_id, p_rolled_by, commit_message, 'main', 'merged',
    p_rolled_by, now(), p_from_month, p_from_year, 'rollover'
  ) returning commit_id into new_commit;

  for item_row in
    select monthly.item_id,
      coalesce(monthly.unit_price, item.unit_price, 0) as unit_price,
      greatest(0, coalesce(monthly.opening_oh, 0)
        + coalesce(monthly.w1_received, 0)
        + coalesce(monthly.w2_received, 0)
        + coalesce(monthly.w3_received, 0)
        - coalesce(monthly.w1_pulled, 0)
        - coalesce(monthly.w2_pulled, 0)
        - coalesce(monthly.w3_pulled, 0)
      ) as ending_qty,
      coalesce(
        monthly.ending_value,
        coalesce(
          monthly.opening_value,
          coalesce(monthly.opening_oh, 0)
            * coalesce(
              monthly.opening_unit_cost, monthly.unit_price, item.unit_price, 0
            )
        )
          + coalesce(
            monthly.received_value,
            (
              coalesce(monthly.w1_received, 0)
              + coalesce(monthly.w2_received, 0)
              + coalesce(monthly.w3_received, 0)
            ) * coalesce(monthly.unit_price, item.unit_price, 0)
          )
          - coalesce(
            monthly.pulled_value,
            (
              coalesce(monthly.w1_pulled, 0)
              + coalesce(monthly.w2_pulled, 0)
              + coalesce(monthly.w3_pulled, 0)
            ) * coalesce(monthly.unit_price, item.unit_price, 0)
          )
      ) as ending_value
    from public.monthly_inventory monthly
    join public.inventory_items item
      on item.id = monthly.item_id and item.tenant_id = monthly.tenant_id
    where monthly.tenant_id = p_tenant_id
      and monthly.month = p_from_month and monthly.year = p_from_year
  loop
    ending_quantity := item_row.ending_qty;
    ending_amount := round(coalesce(item_row.ending_value, 0), 2);
    opening_cost := case when ending_quantity > 0
      then round(ending_amount / ending_quantity, 6) end;
    starting_total := starting_total + ending_amount;
    insert into public.commit_changes(
      tenant_id, commit_id, item_id, month, year, week_number,
      field, old_value, new_value, action
    ) values (
      p_tenant_id, new_commit, item_row.item_id, next_month, next_year, 0,
      'opening_oh', 0, ending_quantity, 'enter'
    );
    insert into public.monthly_inventory(
      tenant_id, item_id, month, year, opening_oh, unit_price,
      opening_unit_cost, opening_value, received_value, pulled_value,
      ending_value, w1_received, w2_received, w3_received,
      w1_pulled, w2_pulled, w3_pulled
    ) values (
      p_tenant_id, item_row.item_id, next_month, next_year, ending_quantity,
      item_row.unit_price, opening_cost, ending_amount, 0, 0, ending_amount,
      0, 0, 0, 0, 0, 0
    )
    on conflict (tenant_id, item_id, month, year) do update
    set opening_oh = excluded.opening_oh,
        opening_unit_cost = excluded.opening_unit_cost,
        opening_value = excluded.opening_value,
        unit_price = excluded.unit_price,
        received_value = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then 0 else monthly_inventory.received_value end,
        pulled_value = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then 0 else monthly_inventory.pulled_value end,
        ending_value = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then excluded.ending_value else monthly_inventory.ending_value end,
        w1_received = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then 0 else monthly_inventory.w1_received end,
        w2_received = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then 0 else monthly_inventory.w2_received end,
        w3_received = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then 0 else monthly_inventory.w3_received end,
        w1_pulled = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then 0 else monthly_inventory.w1_pulled end,
        w2_pulled = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then 0 else monthly_inventory.w2_pulled end,
        w3_pulled = case when (
          monthly_inventory.w1_received + monthly_inventory.w2_received
          + monthly_inventory.w3_received + monthly_inventory.w1_pulled
          + monthly_inventory.w2_pulled + monthly_inventory.w3_pulled
        ) = 0 then 0 else monthly_inventory.w3_pulled end;
  end loop;
  update public.month_status
  set status = 'published', published_at = now(), published_by = p_rolled_by
  where tenant_id = p_tenant_id
    and month = p_from_month and year = p_from_year;
  return jsonb_build_object(
    'commit_id', new_commit, 'next_month', next_month,
    'next_year', next_year, 'starting_total', round(starting_total, 2),
    'from_month', p_from_month, 'from_year', p_from_year
  );
end;
$$;

create or replace function public.recompute_week_totals(
  p_tenant_id uuid,
  p_item_id uuid,
  p_month integer,
  p_year integer
)
returns void
language plpgsql
security definer
set search_path to 'public', 'pg_temp'
as $function$
begin
  if not exists (
    select 1
    from public.inventory_items
    where tenant_id = p_tenant_id and id = p_item_id
  ) then
    raise exception 'Inventory item is not part of the active workspace';
  end if;

  insert into public.monthly_inventory (
    tenant_id,
    item_id,
    month,
    year,
    opening_oh,
    unit_price,
    w1_received,
    w2_received,
    w3_received,
    w1_pulled,
    w2_pulled,
    w3_pulled
  )
  select
    p_tenant_id,
    p_item_id,
    p_month,
    p_year,
    coalesce((
      select opening_oh
      from public.monthly_inventory
      where tenant_id = p_tenant_id
        and item_id = p_item_id
        and month = p_month
        and year = p_year
    ), 0),
    coalesce(nullif((
      select unit_price
      from public.inventory_items
      where tenant_id = p_tenant_id and id = p_item_id
    ), 0), 0),
    coalesce(sum(quantity) filter (
      where week_number = 1
        and txn_type in ('received', 'adjustment_increase')
    ), 0),
    coalesce(sum(quantity) filter (
      where week_number = 2
        and txn_type in ('received', 'adjustment_increase')
    ), 0),
    coalesce(sum(quantity) filter (
      where week_number = 3
        and txn_type in ('received', 'adjustment_increase')
    ), 0),
    coalesce(sum(quantity) filter (
      where week_number = 1
        and txn_type in ('issued', 'adjustment_decrease')
    ), 0),
    coalesce(sum(quantity) filter (
      where week_number = 2
        and txn_type in ('issued', 'adjustment_decrease')
    ), 0),
    coalesce(sum(quantity) filter (
      where week_number = 3
        and txn_type in ('issued', 'adjustment_decrease')
    ), 0)
  from public.inventory_transactions
  where tenant_id = p_tenant_id
    and item_id = p_item_id
    and month = p_month
    and year = p_year
  on conflict (tenant_id, item_id, month, year) do update set
    w1_received = excluded.w1_received,
    w2_received = excluded.w2_received,
    w3_received = excluded.w3_received,
    w1_pulled = excluded.w1_pulled,
    w2_pulled = excluded.w2_pulled,
    w3_pulled = excluded.w3_pulled,
    opening_oh = public.monthly_inventory.opening_oh,
    unit_price = case
      when public.monthly_inventory.unit_price is null
        or public.monthly_inventory.unit_price = 0
      then excluded.unit_price
      else public.monthly_inventory.unit_price
    end,
    updated_at = now();
end;
$function$;

do $$
declare function_row record;
begin
  for function_row in
    select procedure.oid::regprocedure as signature
    from pg_proc procedure
    join pg_namespace namespace_row on namespace_row.oid = procedure.pronamespace
    where namespace_row.nspname = 'public'
      and procedure.proname in (
        'admin_merge_items','audit_inventory_period','link_invoice_items_by_id',
        'perform_rollover','recompute_week_totals','sc_close_pull_request','sc_finalize_merge',
        'set_week_status','sku_add_alias','sku_review_resolve'
      )
      and pg_get_function_identity_arguments(procedure.oid) like 'p_tenant_id uuid%'
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      function_row.signature
    );
    execute format(
      'grant execute on function %s to service_role',
      function_row.signature
    );
  end loop;
end;
$$;
