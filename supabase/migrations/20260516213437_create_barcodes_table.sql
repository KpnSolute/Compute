
-- Barcode registry: maps every barcode string to its inventory item
-- Used by scanner (USB, Bluetooth, camera) to look up items
CREATE TABLE barcodes (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  barcode_id   TEXT        NOT NULL UNIQUE,   -- the scannable code (SKU or MJCxxx)
  sku          TEXT,                           -- original vendor SKU if present
  category     TEXT        NOT NULL,
  description  TEXT        NOT NULL,
  unit_price   NUMERIC(10,4) DEFAULT 0,
  par_level    INTEGER       DEFAULT 0,
  on_hand      NUMERIC(10,2) DEFAULT 0,
  w1r          NUMERIC(10,2) DEFAULT 0,        -- week 1 received (current month)
  barcode_type TEXT        DEFAULT 'CODE128'   CHECK (barcode_type IN ('CODE128','QR','EAN13','UPC')),
  is_active    BOOLEAN     DEFAULT TRUE,
  item_ref     TEXT,                           -- matches JS INV item id for sync
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  updated_at   TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_barcodes_barcode_id ON barcodes(barcode_id);
CREATE INDEX idx_barcodes_sku        ON barcodes(sku);
CREATE INDEX idx_barcodes_category   ON barcodes(category);
CREATE INDEX idx_barcodes_fts ON barcodes
  USING gin(to_tsvector('english', description));

-- Auto-update timestamp
CREATE TRIGGER trg_barcodes_updated
  BEFORE UPDATE ON barcodes
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- RLS
ALTER TABLE barcodes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "barcodes_read_public"
  ON barcodes FOR SELECT TO anon, authenticated USING (true);

CREATE POLICY "barcodes_write_auth"
  ON barcodes FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "barcodes_update_auth"
  ON barcodes FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "barcodes_delete_auth"
  ON barcodes FOR DELETE TO authenticated
  USING (auth.uid() IS NOT NULL);
;
