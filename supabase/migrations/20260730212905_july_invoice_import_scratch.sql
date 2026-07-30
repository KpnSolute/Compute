drop table if exists july_invoice_import;

create table july_invoice_import (
    invoice_number  text    not null,
    invoice_date    date    not null,
    week            int     not null,
    page            int,
    sku             text    not null,
    description     text,
    brand           text,
    pack            text,
    qty_ordered     numeric,
    qty_shipped     numeric,
    unit_price      numeric not null,
    extended_price  numeric not null,
    implied_units   numeric,
    by_weight       boolean not null default false
);

create index july_invoice_import_sku_idx on july_invoice_import (sku);
create index july_invoice_import_week_idx on july_invoice_import (week);;
