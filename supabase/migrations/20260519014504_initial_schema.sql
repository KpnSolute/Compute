-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ============================================
-- AUTH & PROFILES
-- ============================================

CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  name TEXT,
  role TEXT NOT NULL DEFAULT 'staff' CHECK (role IN ('manager', 'staff', 'sudo')),
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile" ON profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Anyone can insert profiles" ON profiles FOR INSERT WITH CHECK (true);

-- ============================================
-- INVENTORY
-- ============================================

CREATE TABLE IF NOT EXISTS categories (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  color TEXT DEFAULT '#6B7280',
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_items (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  sku TEXT,
  qr_code TEXT,
  name TEXT NOT NULL,
  description TEXT,
  category_id UUID REFERENCES categories(id),
  price DECIMAL(10,2) DEFAULT 0,
  par_level INTEGER DEFAULT 0,
  unit TEXT DEFAULT 'each',
  on_hand INTEGER DEFAULT 0,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS inventory_transactions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('received', 'issued', 'adjustment')),
  quantity INTEGER NOT NULL,
  unit_price DECIMAL(10,2),
  transaction_date TIMESTAMPTZ DEFAULT NOW(),
  notes TEXT,
  created_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS weekly_counts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL,
  year INTEGER NOT NULL,
  quantity_on_hand INTEGER NOT NULL,
  recorded_by UUID REFERENCES profiles(id),
  recorded_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(item_id, week_number, year)
);

CREATE TABLE IF NOT EXISTS suppliers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  account_number TEXT,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventory_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE weekly_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read categories" ON categories FOR SELECT USING (true);
CREATE POLICY "Public read inventory_items" ON inventory_items FOR SELECT USING (true);
CREATE POLICY "Public read inventory_transactions" ON inventory_transactions FOR SELECT USING (true);
CREATE POLICY "Public read weekly_counts" ON weekly_counts FOR SELECT USING (true);
CREATE POLICY "Public read suppliers" ON suppliers FOR SELECT USING (true);
CREATE POLICY "Auth insert inventory_items" ON inventory_items FOR INSERT WITH CHECK (auth.role() = 'authenticated');
CREATE POLICY "Auth update inventory_items" ON inventory_items FOR UPDATE USING (auth.role() = 'authenticated');
CREATE POLICY "Auth insert transactions" ON inventory_transactions FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- MENU CYCLE
-- ============================================

CREATE TABLE IF NOT EXISTS menu_cycles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS menu_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cycle_id UUID REFERENCES menu_cycles(id) ON DELETE CASCADE,
  week_number INTEGER NOT NULL CHECK (week_number BETWEEN 1 AND 4),
  day_of_week TEXT NOT NULL CHECK (day_of_week IN ('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday')),
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast','lunch','dinner','brunch')),
  items TEXT,
  sides TEXT,
  is_vegetarian BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(cycle_id, week_number, day_of_week, meal_type)
);

ALTER TABLE menu_cycles ENABLE ROW LEVEL SECURITY;
ALTER TABLE menu_entries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read menu_cycles" ON menu_cycles FOR SELECT USING (true);
CREATE POLICY "Public read menu_entries" ON menu_entries FOR SELECT USING (true);
CREATE POLICY "Auth manage menu" ON menu_entries FOR ALL USING (auth.role() = 'authenticated');

-- ============================================
-- ALERTS
-- ============================================

CREATE TABLE IF NOT EXISTS reorder_alerts (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  threshold INTEGER NOT NULL,
  triggered_at TIMESTAMPTZ DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES profiles(id),
  notes TEXT
);

ALTER TABLE reorder_alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read alerts" ON reorder_alerts FOR SELECT USING (true);
CREATE POLICY "Auth manage alerts" ON reorder_alerts FOR ALL USING (auth.role() = 'authenticated');

-- ============================================
-- EMAIL
-- ============================================

CREATE TABLE IF NOT EXISTS email_templates (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  trigger_type TEXT DEFAULT 'manual' CHECK (trigger_type IN ('manual', 'low_stock', 'weekly_report')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS email_log (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'failed')),
  sent_at TIMESTAMPTZ,
  template_id UUID REFERENCES email_templates(id),
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE email_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE email_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read email_templates" ON email_templates FOR SELECT USING (true);
CREATE POLICY "Auth manage email" ON email_templates FOR ALL USING (auth.role() = 'authenticated');
CREATE POLICY "Public read email_log" ON email_log FOR SELECT USING (true);
CREATE POLICY "Auth insert email_log" ON email_log FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- DOCUMENTS
-- ============================================

CREATE TABLE IF NOT EXISTS documents (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('inventory', 'menu', 'report', 'invoice')),
  format TEXT NOT NULL CHECK (format IN ('xlsx', 'pptx', 'docx', 'pdf')),
  file_path TEXT,
  generated_by UUID REFERENCES profiles(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read documents" ON documents FOR SELECT USING (true);
CREATE POLICY "Auth insert documents" ON documents FOR INSERT WITH CHECK (auth.role() = 'authenticated');

-- ============================================
-- QR CODES
-- ============================================

CREATE TABLE IF NOT EXISTS qr_codes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  item_id UUID REFERENCES inventory_items(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  code_type TEXT DEFAULT 'qr' CHECK (code_type IN ('qr', 'barcode')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(item_id, code)
);

ALTER TABLE qr_codes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read qr_codes" ON qr_codes FOR SELECT USING (true);

-- ============================================
-- DEFAULT CATEGORIES
-- ============================================

INSERT INTO categories (name, color, sort_order) VALUES
  ('Dairy', '#0D9488', 1),
  ('Protein & Meat', '#B91C1C', 2),
  ('Produce & Fresh', '#15803D', 3),
  ('Beverages', '#2563EB', 4),
  ('Dry Goods', '#92400E', 5),
  ('Frozen Foods', '#0369A1', 6),
  ('Cereal', '#B45309', 7),
  ('Snacks', '#7C3AED', 8),
  ('Supplies', '#6B7280', 9);

-- ============================================
-- DEFAULT MENU CYCLE
-- ============================================

INSERT INTO menu_cycles (name, start_date, active) VALUES
  ('28-Day Cycle', '2026-01-01', true);

-- ============================================
-- UPDATED_AT TRIGGER
-- ============================================

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER inventory_items_updated_at BEFORE UPDATE ON inventory_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER menu_entries_updated_at BEFORE UPDATE ON menu_entries
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

CREATE TRIGGER email_templates_updated_at BEFORE UPDATE ON email_templates
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();;
