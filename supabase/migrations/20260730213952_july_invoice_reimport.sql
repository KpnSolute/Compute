drop table if exists july_reimport_backup_items;
create table july_reimport_backup_items as
select id, sku, description, unit_price, updated_at
from inventory_items
where sku in (select distinct sku from july_invoice_import);

drop table if exists july_reimport_backup_minv;
create table july_reimport_backup_minv as
select * from monthly_inventory where month = 6 and year = 2026;

drop table if exists july_reimport_backup_invoices;
create table july_reimport_backup_invoices as
select * from invoices where month = 7 and year = 2026;

drop table if exists july_reimport_backup_invoice_items;
create table july_reimport_backup_invoice_items as
select ii.* from invoice_items ii
join invoices i on i.id = ii.invoice_id
where i.month = 7 and i.year = 2026;

with best as (
    select distinct on (sku) sku, description
    from july_invoice_import
    order by sku, length(description) desc, week
)
update inventory_items ii
set description = best.description,
    updated_at  = now()
from best
where ii.sku = best.sku
  and ii.description is distinct from best.description;

insert into invoices (
    vendor_id, invoice_number, invoice_date, order_date, month, year, week_number,
    subtotal, vizient_discount, fuel_surcharge, discount, tax, total, net_total,
    status, payment_terms, account_number, notes
)
select '84436676-bf97-4587-b544-37026a3de3a5'::uuid,
       '1736605', date '2026-07-01', date '2026-06-28', 7, 2026, 1,
       20866.92, 417.33, 5.00, 0, 0, 20454.59, 20454.59,
       'received', 'NET 30 DAYS', '41736679',
       'Re-imported 2026-07-30 from Julywk1.pdf. Product total 20866.92; VIZIENT '
       || 'rebates -135.63/-125.20/-156.50 = -417.33; fuel +5.00; delivered 20454.59.'
where not exists (select 1 from invoices where invoice_number = '1736605');

update invoices
set subtotal         = 7792.62,
    vizient_discount = 109.09,
    fuel_surcharge   = 3.00,
    total            = 7686.53,
    net_total        = 7686.53,
    status           = 'received',
    updated_at       = now()
where invoice_number = '2140189';

delete from invoice_items
where invoice_id in (select id from invoices where invoice_number in ('1736605', '2140189'));

insert into invoice_items (
    invoice_id, inventory_item_id, sku, description, label, pack_size, unit,
    quantity_ordered, quantity_shipped, quantity_adjusted,
    unit_price, extended_price, pricing_unit, weight, line_number, category, notes
)
select inv.id,
       it.id,
       j.sku,
       j.description,
       nullif(j.brand, ''),
       nullif(j.pack, ''),
       case when j.by_weight then 'LB' else 'CS' end,
       coalesce(j.qty_ordered, j.qty_shipped, 0),
       coalesce(j.qty_shipped, 0),
       0,
       j.unit_price,
       j.extended_price,
       case when j.by_weight then 'LB' else 'CS' end,
       case when j.by_weight then j.implied_units end,
       row_number() over (partition by j.invoice_number order by j.page, j.sku),
       coalesce(cat.name, 'Uncategorized'),
       case when j.by_weight
            then 'Billed by weight: ' || j.implied_units || ' lb @ ' || j.unit_price || '/lb'
       end
from july_invoice_import j
join invoices inv               on inv.invoice_number = j.invoice_number
left join inventory_items it    on it.sku = j.sku
left join inventory_categories cat on cat.id = it.category_id;

with agg as (
    select sku,
           coalesce(sum(qty_shipped) filter (where week = 1), 0) w1,
           coalesce(sum(qty_shipped) filter (where week = 2), 0) w2,
           sum(qty_shipped)    total_qty,
           sum(extended_price) total_ext
    from july_invoice_import
    group by sku
)
update monthly_inventory m
set w1_received = agg.w1,
    w2_received = agg.w2,
    unit_price  = round(agg.total_ext / nullif(agg.total_qty, 0), 6),
    updated_at  = now()
from agg
join inventory_items it on it.sku = agg.sku
where m.item_id = it.id
  and m.month = 6
  and m.year  = 2026;;
