
CREATE TABLE invoices (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_id        UUID REFERENCES vendors(id) ON DELETE SET NULL,
  invoice_number   TEXT NOT NULL,
  account_number   TEXT,
  order_number     TEXT,
  purchase_order   TEXT,
  invoice_date     DATE NOT NULL,
  order_date       DATE,
  due_date         DATE,
  shipped_date     DATE,
  payment_terms    TEXT DEFAULT 'NET 30 DAYS',
  month            INTEGER CHECK (month BETWEEN 1 AND 12),
  year             INTEGER,
  week_number      INTEGER CHECK (week_number BETWEEN 1 AND 4),
  subtotal         NUMERIC(12,2) DEFAULT 0,
  discount         NUMERIC(12,2) DEFAULT 0,
  tax              NUMERIC(12,2) DEFAULT 0,
  total            NUMERIC(12,2) DEFAULT 0,
  driver_name      TEXT,
  route_number     TEXT,
  stop_number      TEXT,
  status           TEXT DEFAULT 'received' CHECK (status IN ('received','verified','paid','disputed')),
  notes            TEXT,
  created_at       TIMESTAMPTZ DEFAULT NOW(),
  updated_at       TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invoices_vendor      ON invoices(vendor_id);
CREATE INDEX idx_invoices_date        ON invoices(invoice_date);
CREATE INDEX idx_invoices_month_year  ON invoices(year, month);
CREATE INDEX idx_invoices_status      ON invoices(status);

-- Seed: US Foods Invoice #2312098 already applied to dashboard
INSERT INTO invoices (
  vendor_id, invoice_number, account_number, order_number, purchase_order,
  invoice_date, order_date, due_date, payment_terms,
  month, year, week_number, subtotal, discount, total,
  route_number, stop_number, status, notes
)
SELECT
  v.id, '2312098', '41736679', '377897', NULL,
  '2026-04-30', '2026-04-29', '2026-05-30', 'NET 30 DAYS',
  5, 2026, 1, 19633.63, 215.97, 19417.66,
  '4422', '6', 'received',
  'US Foods Week 1 May 2026 — Dry $6,233.82 | Refrigerated $5,596.91 | Frozen $7,802.90'
FROM vendors v WHERE v.vendor_code = 'USFOODS';

-- Seed: Multi-Flow Invoice #861848
INSERT INTO invoices (
  vendor_id, invoice_number, account_number, purchase_order,
  invoice_date, due_date, payment_terms,
  month, year, week_number, subtotal, discount, total,
  route_number, status, notes
)
SELECT
  v.id, '861848', 'MF207260', '002671',
  '2026-05-04', '2026-07-03', 'NET60',
  5, 2026, 1, 1821.70, 0, 1821.70,
  'R044', 'received',
  'Multi-Flow Industries Week 1 May 2026 — Beverages'
FROM vendors v WHERE v.vendor_code = 'MULTIFLOW';

-- Seed: Multi-Flow Invoice #864172
INSERT INTO invoices (
  vendor_id, invoice_number, account_number, purchase_order,
  invoice_date, due_date, payment_terms,
  month, year, week_number, subtotal, discount, total,
  route_number, status
)
SELECT
  v.id, '864172', 'MF207260', '002671',
  '2026-05-05', '2026-07-04', 'NET60',
  5, 2026, 1, 304.20, 0, 304.20,
  'R044', 'received'
FROM vendors v WHERE v.vendor_code = 'MULTIFLOW';

-- Seed: Multi-Flow Invoice #864236
INSERT INTO invoices (
  vendor_id, invoice_number, account_number, purchase_order,
  invoice_date, due_date, payment_terms,
  month, year, week_number, subtotal, discount, total,
  route_number, status
)
SELECT
  v.id, '864236', 'MF207260', '002671',
  '2026-05-11', '2026-07-10', 'NET60',
  5, 2026, 2, 87.40, 0, 87.40,
  'R044', 'received'
FROM vendors v WHERE v.vendor_code = 'MULTIFLOW';
;
