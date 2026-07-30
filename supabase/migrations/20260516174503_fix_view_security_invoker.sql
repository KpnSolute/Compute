
-- Drop and recreate all three views with SECURITY INVOKER
-- so they respect RLS policies of the querying user, not the view creator.

DROP VIEW IF EXISTS invoice_spending_summary;
DROP VIEW IF EXISTS category_spending;
DROP VIEW IF EXISTS item_price_history;

-- Invoice spending summary: total spend per vendor per month/week
CREATE VIEW invoice_spending_summary
WITH (security_invoker = true)
AS
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
JOIN vendors v ON v.id = i.vendor_id
GROUP BY i.year, i.month, i.week_number, v.name, v.vendor_code
ORDER BY i.year DESC, i.month DESC, i.week_number, v.name;

-- Category spending: spend breakdown by food category per month
CREATE VIEW category_spending
WITH (security_invoker = true)
AS
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

-- Item price history: price trends per SKU across all invoices
CREATE VIEW item_price_history
WITH (security_invoker = true)
AS
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
JOIN invoices inv ON inv.id  = ii.invoice_id
JOIN vendors  v   ON v.id   = inv.vendor_id
WHERE ii.sku IS NOT NULL
ORDER BY ii.sku, inv.invoice_date DESC;
;
