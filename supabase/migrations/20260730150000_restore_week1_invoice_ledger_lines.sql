-- Restore four Week 1 movements missing from the ledger while the monthly
-- quantities and invoice source rows already agree.

BEGIN;

INSERT INTO public.import_batches (
  batch_id, source_file, source_hash, source_type, direction, month, year,
  week_number, invoice_number, item_count, status, metadata
) VALUES (
  'c5e2d3a4-8f71-4f9e-9e45-3a4f5b6c7d81', 'July2026W1 Invoice 1736605',
  'invoice-1736605-week1-reconciliation-v1', 'invoice', 'received', 6, 2026,
  1, '1736605', 4, 'merged', '{"reconciliation":"missing_week1_ledger_lines"}'::jsonb
);

WITH audit AS (
  INSERT INTO public.staging_entries (
    submitted_by, reviewed_by, status, source, file_ref, batch_id,
    entity_type, entity_id, field_name, change_type, metadata, operation, full_payload
  ) VALUES (
    'd3d7cf98-4f34-4a71-9ded-e343701c026b',
    'd3d7cf98-4f34-4a71-9ded-e343701c026b',
    'merged', 'invoice_reconciliation', 'July2026W1 Invoice 1736605', 'c5e2d3a4-8f71-4f9e-9e45-3a4f5b6c7d81',
    'inventory', 'batch-moninv-7-2026', 'inventory_week_update', 'import',
    '{"reason":"restore four invoice lines missing from Week 1 movement ledger","invoice_number":"1736605","invoice_id":"4d1578ce-2fb0-4a2b-8370-48f31b549452"}'::jsonb,
    'inventory_week_update',
    '{"month":7,"year":2026,"week":1,"invoice_number":"1736605","items":[{"sku":"2328193","quantity":6},{"sku":"2809291","quantity":4},{"sku":"4218103","quantity":1},{"sku":"7536303","quantity":1}]}'::jsonb
  )
  RETURNING entry_id, batch_id
), ins AS (
  INSERT INTO public.inventory_transactions (
    item_id, sku, month, year, week_number, txn_type, quantity, unit_price,
    source_file, invoice_number, batch_id, staging_entry_id, txn_date,
    created_by, adjustment_reason, metadata
  )
  SELECT v.item_id, v.sku, 6, 2026, 1, 'received', v.quantity, v.unit_price,
    'July2026W1 Invoice 1736605', '1736605', audit.batch_id, audit.entry_id,
    '2026-07-01'::date, 'd3d7cf98-4f34-4a71-9ded-e343701c026b',
    'Invoice line was present in invoice_items/monthly_inventory but missing from Week 1 movement ledger',
    jsonb_build_object('invoice_id', '4d1578ce-2fb0-4a2b-8370-48f31b549452', 'reconciliation', 'missing_week1_ledger_line')
  FROM audit
  CROSS JOIN (VALUES
    ('d1f41881-4df8-43bf-835f-09254eb1b947'::uuid, '2328193', 6::numeric, 35.17::numeric),
    ('355bc4b9-f8be-40f1-9347-7ae3e50221f2'::uuid, '2809291', 4::numeric, 21.22::numeric),
    ('3092522a-ee71-4388-9e14-e7a09be199fa'::uuid, '4218103', 1::numeric, 27.17::numeric),
    ('bd206802-8ba1-43fc-8da2-89108804ec8d'::uuid, '7536303', 1::numeric, 35.90::numeric)
  ) v(item_id, sku, quantity, unit_price)
  RETURNING txn_id
)
SELECT count(*) AS inserted_ledger_rows FROM ins;

COMMIT;
