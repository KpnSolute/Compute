
CREATE TABLE inventory_categories (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name       TEXT NOT NULL UNIQUE,
  color      TEXT DEFAULT '#888888',
  icon       TEXT,
  sort_order INTEGER DEFAULT 0
);

INSERT INTO inventory_categories (name, color, icon, sort_order) VALUES
  ('Dairy',            '#0D9488', '🧀', 1),
  ('Cereal',           '#B45309', '🌾', 2),
  ('Beverages',        '#2563EB', '🍹', 3),
  ('Snacks',           '#7C3AED', '🍪', 4),
  ('Dry Goods',        '#92400E', '📦', 5),
  ('Produce & Fresh',  '#15803D', '🥦', 6),
  ('Protein & Meat',   '#B91C1C', '🥩', 7),
  ('Frozen Foods',     '#0369A1', '❄️', 8),
  ('Supplies',         '#6B7280', '🧤', 9);

CREATE TABLE inventory_items (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sku           TEXT,
  barcode_id    TEXT UNIQUE,
  description   TEXT NOT NULL,
  category_id   UUID REFERENCES inventory_categories(id) ON DELETE SET NULL,
  vendor_id     UUID REFERENCES vendors(id) ON DELETE SET NULL,
  unit_price    NUMERIC(10,4) DEFAULT 0,
  par_level     INTEGER DEFAULT 0,
  unit          TEXT DEFAULT 'CS',
  active        BOOLEAN DEFAULT TRUE,
  created_at    TIMESTAMPTZ DEFAULT NOW(),
  updated_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitems_cat    ON inventory_items(category_id);
CREATE INDEX idx_invitems_sku    ON inventory_items(sku);
CREATE INDEX idx_invitems_bc     ON inventory_items(barcode_id);
CREATE INDEX idx_invitems_fts    ON inventory_items USING gin(to_tsvector('english', description));

CREATE TABLE monthly_inventory (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id      UUID NOT NULL REFERENCES inventory_items(id) ON DELETE CASCADE,
  month        INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year         INTEGER NOT NULL,
  on_hand      NUMERIC(10,2) DEFAULT 0,
  w1_received  NUMERIC(10,2) DEFAULT 0,
  w2_received  NUMERIC(10,2) DEFAULT 0,
  w3_received  NUMERIC(10,2) DEFAULT 0,
  w4_received  NUMERIC(10,2) DEFAULT 0,
  w1_issued    NUMERIC(10,2) DEFAULT 0,
  w2_issued    NUMERIC(10,2) DEFAULT 0,
  w3_issued    NUMERIC(10,2) DEFAULT 0,
  w4_issued    NUMERIC(10,2) DEFAULT 0,
  unit_price   NUMERIC(10,4) DEFAULT 0,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (item_id, month, year)
);

CREATE INDEX idx_monthly_item    ON monthly_inventory(item_id);
CREATE INDEX idx_monthly_yr_mo   ON monthly_inventory(year, month);
;
