-- ============================================================================
-- (1) UNIFIED TRIAGE FLAG  — merge "Needs SKU" + "Uncategorized" into ONE signal.
--     An item needs the manager's attention when it has a placeholder SKU
--     (MJC-*) OR no real category (null / the Uncategorized bucket).
-- (2) SKU RESOLUTION + OVERRIDE  — SKU is the primary identity of an item.
--     On invoice import: direct sku match -> else alias/override (item_barcodes)
--     -> else queue for the SKU manager to decide. Reuses item_barcodes as the
--     alias store (no redundant table).
-- Additive + idempotent. Does not alter existing data, enums, or generated sku_pending.
-- ============================================================================

-- (1) Unified flag (base-column generated; safe to reference sku + category_id)
alter table public.inventory_items
  add column if not exists needs_attention boolean
  generated always as (
        sku like 'MJC-%'
     or category_id is null
     or category_id = '448c13cf-e5c0-404f-bf32-f299d411c944'::uuid
  ) stored;

create index if not exists idx_items_needs_attention
  on public.inventory_items(needs_attention) where needs_attention;

-- (2a) Manager decision queue for unresolved import SKUs
create table if not exists public.sku_review_queue (
  id                 uuid primary key default gen_random_uuid(),
  parsed_sku         text not null,
  parsed_description text,
  vendor_id          uuid references public.vendors(id),
  source_ref         text,                 -- invoice number / upload batch id
  qty                numeric,
  unit_price         numeric,
  suggested_item_id  uuid references public.inventory_items(id),  -- best description match
  status             text not null default 'pending',
  resolution         text,                 -- new_item | alias_existing | override_existing
  resolved_item_id   uuid references public.inventory_items(id),
  resolved_by        uuid references public.user_profiles(id),
  resolved_at        timestamptz,
  created_at         timestamptz not null default now()
);

do $$ begin
  if not exists (select 1 from information_schema.table_constraints
    where constraint_schema='public' and table_name='sku_review_queue'
      and constraint_name='sku_review_queue_status_check') then
    alter table public.sku_review_queue add constraint sku_review_queue_status_check
      check (status = any (array['pending','resolved','dismissed']));
  end if;
  if not exists (select 1 from information_schema.table_constraints
    where constraint_schema='public' and table_name='sku_review_queue'
      and constraint_name='sku_review_queue_resolution_check') then
    alter table public.sku_review_queue add constraint sku_review_queue_resolution_check
      check (resolution is null or resolution = any (array['new_item','alias_existing','override_existing']));
  end if;
end $$;

create index if not exists idx_skurev_status on public.sku_review_queue(status) where status='pending';
create index if not exists idx_skurev_vendor on public.sku_review_queue(vendor_id);
alter table public.sku_review_queue enable row level security;

-- (2b) Resolver: direct sku -> alias(item_barcodes) -> none
create or replace function public.resolve_invoice_sku(p_sku text, p_vendor uuid default null)
returns jsonb language plpgsql stable security definer set search_path = public as $fn$
declare v_item uuid; v_isku text;
begin
  if p_sku is null or btrim(p_sku) = '' then
    return jsonb_build_object('item_id', null, 'match_type', 'none');
  end if;

  -- 1) canonical SKU is the primary identity
  select id, sku into v_item, v_isku
    from public.inventory_items where sku = btrim(p_sku) limit 1;
  if v_item is not null then
    return jsonb_build_object('item_id', v_item, 'sku', v_isku, 'match_type', 'direct');
  end if;

  -- 2) alias / override mapping (reuses item_barcodes)
  select ib.item_id into v_item
    from public.item_barcodes ib
   where ib.barcode = btrim(p_sku)
     and coalesce(ib.type,'') in ('vendor_sku','alias','sku')
   limit 1;
  if v_item is not null then
    select sku into v_isku from public.inventory_items where id = v_item;
    return jsonb_build_object('item_id', v_item, 'sku', v_isku, 'match_type', 'alias');
  end if;

  -- 3) unknown -> caller should queue for the SKU manager
  return jsonb_build_object('item_id', null, 'match_type', 'none');
end $fn$;

-- (2c) Add an alias/override mapping (metadata; alias_existing path). SKU edits that
--      change an item's CANONICAL sku still flow through staging -> commit, not here.
create or replace function public.sku_add_alias(p_item uuid, p_alias text, p_vendor uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare v_existing uuid;
begin
  if p_item is null or p_alias is null or btrim(p_alias)='' then
    raise exception 'item and alias required';
  end if;
  -- guard: alias must not collide with a canonical sku or another item's alias
  select id into v_existing from public.inventory_items where sku = btrim(p_alias) limit 1;
  if v_existing is not null and v_existing <> p_item then
    return jsonb_build_object('ok', false, 'error','alias_is_canonical_sku','item_id', v_existing);
  end if;
  select item_id into v_existing from public.item_barcodes
    where barcode = btrim(p_alias) and coalesce(type,'') in ('vendor_sku','alias','sku') limit 1;
  if v_existing is not null and v_existing <> p_item then
    return jsonb_build_object('ok', false, 'error','alias_maps_other_item','item_id', v_existing);
  end if;

  insert into public.item_barcodes(item_id, barcode, type, is_primary)
  values (p_item, btrim(p_alias), 'vendor_sku', false)
  on conflict do nothing;
  return jsonb_build_object('ok', true, 'item_id', p_item, 'alias', btrim(p_alias));
end $fn$;

-- (2d) Resolve a queue row (mark resolved; alias_existing also writes the alias)
create or replace function public.sku_review_resolve(
  p_id uuid, p_resolution text, p_item uuid, p_by uuid
) returns void language plpgsql security definer set search_path = public as $fn$
begin
  if p_resolution = 'alias_existing' and p_item is not null then
    perform public.sku_add_alias(p_item, (select parsed_sku from public.sku_review_queue where id=p_id), null);
  end if;
  update public.sku_review_queue
     set status='resolved', resolution=p_resolution, resolved_item_id=p_item,
         resolved_by=p_by, resolved_at=now()
   where id=p_id;
end $fn$;

grant execute on function public.resolve_invoice_sku(text,uuid) to service_role;
grant execute on function public.sku_add_alias(uuid,text,uuid) to service_role;
grant execute on function public.sku_review_resolve(uuid,text,uuid,uuid) to service_role;;
