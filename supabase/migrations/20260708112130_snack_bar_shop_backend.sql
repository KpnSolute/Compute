-- Snack Bar shop backend: product catalog + stock, per-transaction buyer
-- ("entity": student or staff) tracking, and per-entity-type tax/discount
-- rates. Revenue from these transactions feeds Cost Manager's
-- snack_bar_revenue auto_source (backend/routes/cost.py::_snack_bar_revenue).

create table snack_bar_products (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  price numeric(10,2) not null default 0,
  stock_qty int not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table snack_bar_products enable row level security;
create policy snack_bar_products_read_all on snack_bar_products for select using (true);

create table snack_bar_entity_rates (
  entity_type text primary key check (entity_type in ('student','staff')),
  tax_pct numeric(5,2) not null default 0,
  discount_pct numeric(5,2) not null default 0,
  updated_by uuid references user_profiles(id),
  updated_at timestamptz not null default now()
);
alter table snack_bar_entity_rates enable row level security;
create policy snack_bar_entity_rates_read_all on snack_bar_entity_rates for select using (true);
insert into snack_bar_entity_rates (entity_type) values ('student'), ('staff');

create table snack_bar_transactions (
  id uuid primary key default gen_random_uuid(),
  entity_type text not null check (entity_type in ('student','staff')),
  entity_name text not null,
  subtotal numeric(10,2) not null default 0,
  discount_amount numeric(10,2) not null default 0,
  tax_amount numeric(10,2) not null default 0,
  total_amount numeric(10,2) not null default 0,
  business_date date not null,
  recorded_by uuid references user_profiles(id),
  created_at timestamptz not null default now()
);
alter table snack_bar_transactions enable row level security;
create policy snack_bar_transactions_read_all on snack_bar_transactions for select using (true);

create table snack_bar_transaction_items (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references snack_bar_transactions(id) on delete cascade,
  product_id uuid references snack_bar_products(id) on delete set null,
  product_name text not null,
  unit_price numeric(10,2) not null,
  qty int not null,
  line_total numeric(10,2) not null
);
alter table snack_bar_transaction_items enable row level security;
create policy snack_bar_transaction_items_read_all on snack_bar_transaction_items for select using (true);
;
