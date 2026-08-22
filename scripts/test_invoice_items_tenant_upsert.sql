-- Live integration check for the tenant-scoped invoice_items upsert.
-- Run only against the KpnCompute project with the Supabase MCP.
do $$
declare
  v_tenant_id uuid := '6a40b9fd-73fa-4d80-9110-fed6c3d5468e';
  v_invoice_id uuid;
  v_invoice_number text := '__codex_live_upsert_' || replace(gen_random_uuid()::text, '-', '');
  v_count integer;
  v_quantity numeric;
begin
  insert into public.invoices (tenant_id, invoice_number, invoice_date, status)
  values (v_tenant_id, v_invoice_number, date '2026-08-22', 'pending')
  returning id into v_invoice_id;

  insert into public.invoice_items (
    tenant_id, invoice_id, line_number, sku, description,
    quantity_shipped, unit_price, extended_price
  ) values (
    v_tenant_id, v_invoice_id, 1, '__CODEX_TEST__',
    'Codex live tenant upsert verification', 2, 3.25, 6.50
  )
  on conflict (tenant_id, invoice_id, line_number)
  do update set quantity_shipped = excluded.quantity_shipped,
                extended_price = excluded.extended_price;

  select count(*), max(quantity_shipped)
    into v_count, v_quantity
    from public.invoice_items
   where tenant_id = v_tenant_id and invoice_id = v_invoice_id and line_number = 1;
  if v_count <> 1 or v_quantity <> 2 then
    raise exception 'first tenant invoice_items upsert failed: count=% quantity=%', v_count, v_quantity;
  end if;

  insert into public.invoice_items (
    tenant_id, invoice_id, line_number, sku, description,
    quantity_shipped, unit_price, extended_price
  ) values (
    v_tenant_id, v_invoice_id, 1, '__CODEX_TEST__',
    'Codex live tenant upsert verification', 4, 3.25, 13.00
  )
  on conflict (tenant_id, invoice_id, line_number)
  do update set quantity_shipped = excluded.quantity_shipped,
                extended_price = excluded.extended_price;

  select count(*), max(quantity_shipped)
    into v_count, v_quantity
    from public.invoice_items
   where tenant_id = v_tenant_id and invoice_id = v_invoice_id and line_number = 1;
  if v_count <> 1 or v_quantity <> 4 then
    raise exception 'second tenant invoice_items upsert failed: count=% quantity=%', v_count, v_quantity;
  end if;

  delete from public.invoices where id = v_invoice_id and tenant_id = v_tenant_id;
  raise notice 'PASS tenant invoice_items upsert created and updated one row; cleanup complete';
exception when others then
  if v_invoice_id is not null then
    delete from public.invoices where id = v_invoice_id and tenant_id = v_tenant_id;
  end if;
  raise;
end;
$$;
