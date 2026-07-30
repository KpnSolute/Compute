
-- Auto-update updated_at on vendors, inventory_items, monthly_inventory
CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_vendors_updated
  BEFORE UPDATE ON vendors
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_inv_items_updated
  BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_monthly_inv_updated
  BEFORE UPDATE ON monthly_inventory
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE TRIGGER trg_invoices_updated
  BEFORE UPDATE ON invoices
  FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- Enable Row Level Security on all tables (allow all for now — tighten per auth later)
ALTER TABLE vendors             ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices            ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoice_items       ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_inventory   ENABLE ROW LEVEL SECURITY;
ALTER TABLE monthly_snapshots   ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_sync      ENABLE ROW LEVEL SECURITY;

-- Open policies (anon key can read/write everything — tighten when adding user auth)
DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'vendors','invoices','invoice_items',
    'inventory_categories','inventory_items',
    'monthly_inventory','monthly_snapshots','inventory_sync'
  ]
  LOOP
    EXECUTE format('CREATE POLICY "allow_all" ON %I FOR ALL TO anon, authenticated USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
;
