
-- Monthly snapshots (history tab data)
CREATE TABLE monthly_snapshots (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  month           INTEGER NOT NULL CHECK (month BETWEEN 1 AND 12),
  year            INTEGER NOT NULL,
  grand_total     NUMERIC(12,2) DEFAULT 0,
  category_totals JSONB DEFAULT '{}',
  item_count      INTEGER DEFAULT 0,
  reorder_count   INTEGER DEFAULT 0,
  preset          BOOLEAN DEFAULT FALSE,
  data            JSONB,
  saved_at        TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (month, year)
);

CREATE INDEX idx_snapshots_yr_mo ON monthly_snapshots(year, month);

-- Dashboard real-time sync table
CREATE TABLE inventory_sync (
  id         INTEGER PRIMARY KEY,
  data       JSONB,
  synced_by  TEXT,
  synced_at  TIMESTAMPTZ DEFAULT NOW()
);

INSERT INTO inventory_sync (id) VALUES (1);

-- Spending summary view (invoice analytics)
CREATE VIEW invoice_spending_summary AS
SELECT
  i.year,
  i.month,
  i.week_number,
  v.name                          AS vendor_name,
  v.vendor_code,
  COUNT(DISTINCT i.id)            AS invoice_count,
  SUM(i.subtotal)                 AS subtotal,
  SUM(i.discount)                 AS total_discount,
  SUM(i.tax)                      AS total_tax,
  SUM(i.total)                    AS total_paid
FROM invoices i
JOIN vendors  v ON v.id = i.vendor_id
GROUP BY i.year, i.month, i.week_number, v.name, v.vendor_code
ORDER BY i.year DESC, i.month DESC, i.week_number, v.name;

-- Category spending view
CREATE VIEW category_spending AS
SELECT
  inv.year,
  inv.month,
  ii.category,
  SUM(ii.extended_price)          AS total_value,
  COUNT(*)                        AS line_items,
  SUM(ii.quantity_shipped)        AS units_received
FROM invoice_items ii
JOIN invoices inv ON inv.id = ii.invoice_id
WHERE ii.category IS NOT NULL
GROUP BY inv.year, inv.month, ii.category
ORDER BY inv.year DESC, inv.month DESC, total_value DESC;

-- Item price history view
CREATE VIEW item_price_history AS
SELECT
  ii.sku,
  ii.description,
  ii.category,
  ii.unit_price,
  ii.extended_price,
  ii.quantity_shipped,
  inv.invoice_number,
  inv.invoice_date,
  v.name AS vendor_name
FROM invoice_items ii
JOIN invoices  inv ON inv.id  = ii.invoice_id
JOIN vendors   v   ON v.id    = inv.vendor_id
WHERE ii.sku IS NOT NULL
ORDER BY ii.sku, inv.invoice_date DESC;
;
