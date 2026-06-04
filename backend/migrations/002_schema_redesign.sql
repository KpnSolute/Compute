-- =============================================================
-- Schema Redesign v2.0 — MJCC Database Migration
-- 
-- Goals:
--   1. Add missing tables (events, haccp_logs, daily_operations_logs)
--   2. Add missing columns (email on user_profiles)
--   3. Drop dead/duplicate tables (0 rows, superseded)
--   4. Consolidate cycle_menu into menu_cycles + menu_entries
--   5. Create inventory bridge views for archive compatibility
--   6. Seed template data from canonical SOP sources
-- =============================================================

-- ==================== PART 1: ADD MISSING COLUMNS ====================

-- 1a. Add email to user_profiles (backend users.py uses EmailStr)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS email text;
CREATE INDEX IF NOT EXISTS idx_user_profiles_email ON user_profiles(email);

-- 1b. Add last_login to user_profiles (useful for audit)
ALTER TABLE user_profiles ADD COLUMN IF NOT EXISTS last_login timestamptz;

-- ==================== PART 2: CREATE MISSING TABLES ====================

-- 2a. Events table (backend routes/events.py, template sop_data.js EVENTS)
CREATE TABLE IF NOT EXISTS events (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    cat text NOT NULL DEFAULT 'other',
    title text NOT NULL,
    date date NOT NULL,
    theme text DEFAULT '',
    description text DEFAULT '',
    suggested_menu text DEFAULT '',
    status text DEFAULT 'planned',
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE events ENABLE ROW LEVEL SECURITY;
CREATE POLICY "events_read_all" ON events FOR SELECT USING (true);
CREATE POLICY "events_insert_all" ON events FOR INSERT WITH CHECK (true);
CREATE POLICY "events_update_all" ON events FOR UPDATE USING (true);
CREATE INDEX idx_events_date ON events(date);

-- 2b. HACCP logs table (backend routes/logs.py)
CREATE TABLE IF NOT EXISTS haccp_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    location text NOT NULL,
    temperature float NOT NULL,
    unit text DEFAULT 'F',
    timestamp timestamptz NOT NULL DEFAULT now(),
    checked_by text NOT NULL,
    notes text DEFAULT '',
    created_at timestamptz DEFAULT now()
);
ALTER TABLE haccp_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "haccp_logs_read_all" ON haccp_logs FOR SELECT USING (true);
CREATE POLICY "haccp_logs_insert_all" ON haccp_logs FOR INSERT WITH CHECK (true);
CREATE INDEX idx_haccp_logs_location ON haccp_logs(location);
CREATE INDEX idx_haccp_logs_timestamp ON haccp_logs(timestamp);

-- 2c. Daily operations logs table (backend routes/logs.py)
CREATE TABLE IF NOT EXISTS daily_operations_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    entry_type text NOT NULL,
    title text NOT NULL,
    description text DEFAULT '',
    severity text DEFAULT 'info',
    data text DEFAULT '',
    created_by text,
    created_at timestamptz DEFAULT now()
);
ALTER TABLE daily_operations_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "daily_ops_logs_read_all" ON daily_operations_logs FOR SELECT USING (true);
CREATE POLICY "daily_ops_logs_insert_all" ON daily_operations_logs FOR INSERT WITH CHECK (true);
CREATE INDEX idx_daily_ops_entry_type ON daily_operations_logs(entry_type);

-- 2d. Opening checklist template table
CREATE TABLE IF NOT EXISTS opening_checklist_items (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task text NOT NULL,
    sort_order integer DEFAULT 0,
    is_active boolean DEFAULT true,
    created_at timestamptz DEFAULT now()
);
ALTER TABLE opening_checklist_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "checklist_read_all" ON opening_checklist_items FOR SELECT USING (true);
CREATE POLICY "checklist_insert_all" ON opening_checklist_items FOR INSERT WITH CHECK (true);

-- 2e. ServSafe certifications table
CREATE TABLE IF NOT EXISTS servsafe_certifications (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    staff_name text NOT NULL,
    certification text NOT NULL,
    expiry_date date,
    is_proctor boolean DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);
ALTER TABLE servsafe_certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "servsafe_read_all" ON servsafe_certifications FOR SELECT USING (true);
CREATE POLICY "servsafe_insert_all" ON servsafe_certifications FOR INSERT WITH CHECK (true);

-- 2f. Incident logs table
CREATE TABLE IF NOT EXISTS incident_logs (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    incident_type text NOT NULL,
    description text NOT NULL,
    reported_by text NOT NULL,
    reported_at timestamptz DEFAULT now(),
    resolved_at timestamptz,
    resolved_by text,
    notes text DEFAULT '',
    created_at timestamptz DEFAULT now()
);
ALTER TABLE incident_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "incidents_read_all" ON incident_logs FOR SELECT USING (true);
CREATE POLICY "incidents_insert_all" ON incident_logs FOR INSERT WITH CHECK (true);

-- 2g. Snack bar / meal configuration tables
CREATE TABLE IF NOT EXISTS meal_periods (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    meal text NOT NULL UNIQUE,
    label text NOT NULL,
    open_hour integer,
    close_hour integer,
    rate numeric DEFAULT 2.50,
    sort_order integer DEFAULT 0
);
ALTER TABLE meal_periods ENABLE ROW LEVEL SECURITY;
CREATE POLICY "meal_periods_read_all" ON meal_periods FOR SELECT USING (true);

-- ==================== PART 3: DROP DEAD TABLES ====================

-- These tables have 0 rows and have been superseded:
DROP TABLE IF EXISTS staging_entries_compat CASCADE;
DROP TABLE IF EXISTS staging_area CASCADE;
DROP TABLE IF EXISTS pending_changes CASCADE;
DROP TABLE IF EXISTS transaction_history CASCADE;
DROP TABLE IF EXISTS budgets CASCADE;
DROP TABLE IF EXISTS month_tab_items CASCADE;
DROP TABLE IF EXISTS month_tabs CASCADE;

-- ==================== PART 4: CREATE BRIDGE VIEWS ====================

-- 4a. inventory_sync view (old backend code references this table)
-- This makes the old inventory.py endpoints work against the new schema
CREATE OR REPLACE VIEW inventory_sync AS
SELECT
    mi.id AS id,
    jsonb_build_object(
        'month', mi.month,
        'year', mi.year,
        'period', mi.year || '-' || mi.month
    ) AS metadata,
    jsonb_agg(
        jsonb_build_object(
            'sku', ii.sku,
            'desc', ii.description,
            'onHand', mi.on_hand,
            'par', ii.par_level,
            'category', ic.name,
            'price', mi.unit_price,
            'unit', ii.unit,
            'on_hand', mi.on_hand,
            'w1r', mi.w1_received,
            'w2r', mi.w2_received,
            'w3r', mi.w3_received,
            'w4r', mi.w4_received,
            'w1i', mi.w1_issued,
            'w2i', mi.w2_issued,
            'w3i', mi.w3_issued,
            'w4i', mi.w4_issued
        )
    ) AS items,
    ''::text AS notes,
    mi.created_at
FROM monthly_inventory mi
JOIN inventory_items ii ON ii.id = mi.item_id
JOIN inventory_categories ic ON ic.id = ii.category_id
GROUP BY mi.id, mi.month, mi.year, mi.created_at;

-- 4b. cycle_menu view (old menu.py references this table)
CREATE OR REPLACE VIEW cycle_menu AS
SELECT
    me.id AS id,
    me.day_of_week AS data->>'day',
    jsonb_build_object(
        me.meal_type, jsonb_build_array(
            jsonb_build_object('items', me.items, 'sides', me.sides)
        )
    ) AS data,
    me.created_at,
    me.updated_at
FROM menu_entries me;

-- ==================== PART 5: SEED TEMPLATE DATA ====================

-- 5a. Seed opening checklist from template
INSERT INTO opening_checklist_items (task, sort_order) VALUES
    ('Walk-in cooler temp check (<=41°F)', 1),
    ('Freezer temp check (<=0°F)', 2),
    ('Food rotation (FIFO check)', 3),
    ('Dishwasher sanitizer level (100-200ppm)', 4),
    ('Hand-wash stations stocked', 5),
    ('Thermometer calibration', 6),
    ('3-comp sink prepped', 7),
    ('Date-labeling audit', 8);

-- 5b. Seed meal periods
INSERT INTO meal_periods (meal, label, open_hour, close_hour, rate, sort_order) VALUES
    ('Breakfast', 'Breakfast', 6, 9, 2.50, 1),
    ('Lunch', 'Lunch', 11, 13, 2.50, 2),
    ('Dinner', 'Dinner', 16, 19, 2.50, 3),
    ('Brunch', 'Brunch (weekends & holidays)', 9, 13, 2.50, 4),
    ('Eve. Snack', 'Evening Snack', 19, 21, 2.50, 5);

-- 5c. Seed ServSafe certifications from template
INSERT INTO servsafe_certifications (staff_name, certification, expiry_date, is_proctor) VALUES
    ('Manager', 'ServSafe Manager', '2026-12-31', true),
    ('Assistant Manager', 'ServSafe Manager', '2026-12-31', false),
    ('Cook 1', 'ServSafe Food Handler', '2026-12-31', false),
    ('Cook 2', 'ServSafe Food Handler', '2026-12-31', false),
    ('Assistant Cook', 'ServSafe Food Handler', '2026-12-31', false),
    ('Food Services Asst 1', 'ServSafe Food Handler', '2026-12-31', false),
    ('WBL Student', '', NULL, false);

-- 5d. Seed events from template (29 events spanning 2026)
INSERT INTO events (cat, title, date, theme, description, suggested_menu, status) VALUES
    ('cultural', 'Cultural / Diversity Meal', '2026-01-29', 'Soul Food', 'Cultural / Diversity Meal', 'Fried Chicken|Collard Greens|Mac and Cheese|Cornbread|Sweet Potato Pie', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-02-26', 'American', 'Cultural / Diversity Meal', 'Hamburger|French Fries|Coleslaw|Apple Pie', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-03-26', 'Italian', 'Cultural / Diversity Meal', 'Spaghetti Bolognese|Garlic Bread|Caesar Salad|Tiramisu', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-04-30', 'Mexican', 'Cultural / Diversity Meal', 'Tacos|Burrito Bowl|Churros', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-05-28', 'Caribbean', 'Cultural / Diversity Meal', 'Jerk Chicken|Rice and Peas|Plantains', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-06-25', 'Asian', 'Cultural / Diversity Meal', 'Stir Fry|Fried Rice|Spring Rolls', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-07-30', 'Middle Eastern', 'Cultural / Diversity Meal', 'Falafel|Hummus|Pita|Baklava', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-08-27', 'Indian', 'Cultural / Diversity Meal', 'Chicken Curry|Basmati Rice|Naan|Mango Lassi', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-09-24', 'German', 'Cultural / Diversity Meal', 'Bratwurst|Sauerkraut|Pretzel|Apple Strudel', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-10-29', 'Greek', 'Cultural / Diversity Meal', 'Gyro|Greek Salad|Baklava', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-11-19', 'Thanksgiving', 'Cultural / Diversity Meal', 'Turkey|Stuffing|Mashed Potatoes|Pumpkin Pie', 'planned'),
    ('cultural', 'Cultural / Diversity Meal', '2026-12-17', 'Holiday', 'Cultural / Diversity Meal', 'Ham|Scalloped Potatoes|Green Beans|Yule Log', 'planned'),
    ('special', 'Special Event', '2026-01-27', '', 'Winter Wellness', '', 'planned'),
    ('special', 'Special Event', '2026-02-24', '', 'National Silver Shovel Day', '', 'planned'),
    ('special', 'Special Event', '2026-03-31', '', 'March Job Fair', '', 'planned'),
    ('special', 'Special Event', '2026-04-28', '', 'Employee Appreciation Lunch', '', 'planned'),
    ('special', 'Special Event', '2026-05-26', '', 'Memorial Day BBQ', '', 'planned'),
    ('special', 'Special Event', '2026-06-30', '', 'Summer Kickoff', '', 'planned'),
    ('training', 'Staff Training / ServSafe', '2026-01-13', '', 'Annual ServSafe Refresher', '', 'planned'),
    ('training', 'Staff Training / ServSafe', '2026-03-10', '', 'Allergen Awareness Training', '', 'planned'),
    ('training', 'Staff Training / ServSafe', '2026-05-12', '', 'Knife Skills Workshop', '', 'planned'),
    ('training', 'Staff Training / ServSafe', '2026-08-11', '', 'Food Safety & Sanitation', '', 'planned'),
    ('training', 'Staff Training / ServSafe', '2026-10-13', '', 'Emergency Preparedness', '', 'planned'),
    ('heals', 'HEALs Program', '2026-01-15', '', 'Nutrition & Wellness Workshop', '', 'planned'),
    ('heals', 'HEALs Program', '2026-02-19', '', 'Cooking Demo: Healthy Meals', '', 'planned'),
    ('heals', 'HEALs Program', '2026-03-19', '', 'Meal Prep Workshop', '', 'planned'),
    ('heals', 'HEALs Program', '2026-04-16', '', 'Budget-Friendly Shopping', '', 'planned'),
    ('heals', 'HEALs Program', '2026-05-14', '', 'Gardening & Fresh Produce', '', 'planned'),
    ('heals', 'HEALs Program', '2026-06-18', '', 'Summer Hydration & Health', '', 'planned');

-- ==================== PART 6: GITHUB ARCHIVE BRIDGE ====================

-- 6a. Staging table for importing archive files
CREATE TABLE IF NOT EXISTS archive_import_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    source text NOT NULL,
    filename text NOT NULL,
    month integer,
    year integer,
    items_imported integer DEFAULT 0,
    items_skipped integer DEFAULT 0,
    imported_at timestamptz DEFAULT now(),
    status text DEFAULT 'pending',
    error text
);

-- 6b. Function to import a single archive month into monthly_inventory
CREATE OR REPLACE FUNCTION import_archive_month(
    p_month integer,
    p_year integer,
    p_data jsonb
) RETURNS integer AS $$
DECLARE
    cat text;
    item jsonb;
    v_item_id uuid;
    v_category_id uuid;
    imported integer := 0;
    skipped integer := 0;
BEGIN
    FOR cat IN SELECT jsonb_object_keys(p_data) WHERE cat != '_meta' LOOP
        -- Find or create category
        INSERT INTO inventory_categories (name)
        VALUES (cat)
        ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
        RETURNING id INTO v_category_id;

        FOR item IN SELECT jsonb_array_elements(p_data->cat) LOOP
            -- Find or create inventory item by SKU
            INSERT INTO inventory_items (sku, description, category_id, unit_price, par_level)
            VALUES (
                COALESCE(item->>'sku', ''),
                COALESCE(item->>'desc', item->>'description', ''),
                v_category_id,
                COALESCE((item->>'price')::numeric, (item->>'unit_price')::numeric, 0),
                COALESCE((item->>'par')::integer, 0)
            )
            ON CONFLICT (sku) DO UPDATE SET
                description = EXCLUDED.description,
                unit_price = EXCLUDED.unit_price,
                par_level = EXCLUDED.par_level
            RETURNING id INTO v_item_id;

            -- Insert monthly snapshot
            INSERT INTO monthly_inventory (item_id, month, year, on_hand, unit_price,
                w1_received, w2_received, w3_received, w4_received,
                w1_issued, w2_issued, w3_issued, w4_issued)
            VALUES (
                v_item_id, p_month, p_year,
                COALESCE((item->>'onHand')::numeric, (item->>'on_hand')::numeric, 0),
                COALESCE((item->>'price')::numeric, (item->>'unit_price')::numeric, 0),
                COALESCE((item->>'w1r')::numeric, 0),
                COALESCE((item->>'w2r')::numeric, 0),
                COALESCE((item->>'w3r')::numeric, 0),
                COALESCE((item->>'w4r')::numeric, 0),
                COALESCE((item->>'w1i')::numeric, 0),
                COALESCE((item->>'w2i')::numeric, 0),
                COALESCE((item->>'w3i')::numeric, 0),
                COALESCE((item->>'w4i')::numeric, 0)
            )
            ON CONFLICT (item_id, month, year) DO UPDATE SET
                on_hand = EXCLUDED.on_hand,
                unit_price = EXCLUDED.unit_price,
                w1_received = EXCLUDED.w1_received,
                w2_received = EXCLUDED.w2_received,
                w3_received = EXCLUDED.w3_received,
                w4_received = EXCLUDED.w4_received,
                w1_issued = EXCLUDED.w1_issued,
                w2_issued = EXCLUDED.w2_issued,
                w3_issued = EXCLUDED.w3_issued,
                w4_issued = EXCLUDED.w4_issued;

            imported := imported + 1;
        END LOOP;
    END LOOP;

    RETURN imported;
END;
$$ LANGUAGE plpgsql;

-- ==================== PART 7: INDEXES FOR PERFORMANCE ====================

CREATE INDEX IF NOT EXISTS idx_monthly_inventory_item_month ON monthly_inventory(item_id, month, year);
CREATE INDEX IF NOT EXISTS idx_monthly_inventory_month_year ON monthly_inventory(month, year);
CREATE INDEX IF NOT EXISTS idx_commit_changes_commit ON commit_changes(commit_id);
CREATE INDEX IF NOT EXISTS idx_commit_changes_entity ON commit_changes(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_staging_entries_status ON staging_entries(status);
CREATE INDEX IF NOT EXISTS idx_staging_entries_entity ON staging_entries(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_inventory_items_sku ON inventory_items(sku);
CREATE INDEX IF NOT EXISTS idx_inventory_items_category ON inventory_items(category_id);
CREATE INDEX IF NOT EXISTS idx_commits_status ON commits(status);
CREATE INDEX IF NOT EXISTS idx_github_sync_queue_synced ON github_sync_queue(synced_at);

-- ==================== PART 8: RLS POLICIES FOR EXISTING TABLES ====================

-- Ensure all tables have basic read RLS policies for anon key access
ALTER TABLE inventory_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_items_read_all ON inventory_items;
CREATE POLICY inventory_items_read_all ON inventory_items FOR SELECT USING (true);

ALTER TABLE monthly_inventory ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS monthly_inventory_read_all ON monthly_inventory;
CREATE POLICY monthly_inventory_read_all ON monthly_inventory FOR SELECT USING (true);

ALTER TABLE inventory_categories ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS inventory_categories_read_all ON inventory_categories;
CREATE POLICY inventory_categories_read_all ON inventory_categories FOR SELECT USING (true);

ALTER TABLE commits ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commits_read_all ON commits;
CREATE POLICY commits_read_all ON commits FOR SELECT USING (true);

ALTER TABLE commit_changes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS commit_changes_read_all ON commit_changes;
CREATE POLICY commit_changes_read_all ON commit_changes FOR SELECT USING (true);

ALTER TABLE staging_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS staging_entries_read_all ON staging_entries;
CREATE POLICY staging_entries_read_all ON staging_entries FOR SELECT USING (true);

ALTER TABLE vendors ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vendors_read_all ON vendors;
CREATE POLICY vendors_read_all ON vendors FOR SELECT USING (true);

ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoices_read_all ON invoices;
CREATE POLICY invoices_read_all ON invoices FOR SELECT USING (true);

ALTER TABLE invoice_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS invoice_items_read_all ON invoice_items;
CREATE POLICY invoice_items_read_all ON invoice_items FOR SELECT USING (true);

-- ==================== PART 9: CONSOLIDATION NOTES ====================

-- Tables KEPT (active, with data):
--   user_profiles (13 rows) — staff accounts
--   inventory_items (1591 rows) — item master
--   inventory_categories (9 rows) — lookup table
--   monthly_inventory (21089 rows) — monthly snapshots per item
--   commits (76 rows) — source control commits
--   commit_changes (5460 rows) — change records
--   staging_entries (0 rows) — active staging pipeline
--   barcodes (409 rows) — live inventory with weekly counts
--   vendors (3 rows) — vendor master
--   invoices (7 rows) — vendor invoices
--   invoice_items (64 rows) — invoice line items
--   centers (1 row) — facility config
--   invoices (7 rows) — vendor invoices
--   github_sync_queue (0 rows) — sync queue (drained)
--   uploads (0 rows) — file uploads
--   email_log (0 rows) — email audit
--   email_templates (7 rows) — email templates
--   app_settings (0 rows) — key/value config
--   documents (0 rows) — generated documents
--   qr_codes (0 rows) — QR code registry
--   reorder_alerts (0 rows) — low-stock alerts
--   weekly_counts (0 rows) — weekly inventory counts
--   inventory_master (316 rows) — alternative item master (bridge)
--   month_status (0 rows) — month open/publish status
--   monthly_snapshots (76 rows) — snapshot rollups
--   monthly_comparison (76 rows) — MoM/YoY comparison
--   inventory_versions (76 rows) — versioned snapshots
--   category_summary (9 rows) — category-level aggregation view
--   barcodes_view (316 rows) — barcode join view
--   live_inventory (409 rows) — computed inventory view
--   invoice_spending_summary (view) — invoice aggregation
--   category_spending (view) — spending by category
--   dashboard_summary (view) — dashboard rollup
--   menu_cycles (1 row) — active cycle
--   menu_entries (0 rows) — cycle menu items (seed needed)
--   item_barcodes (0 rows) — barcode/item link
--   item_price_history (view) — price trend view

-- Tables DROPPED (0 rows, superseded):
--   staging_entries_compat (replaced by staging_entries)
--   staging_area (replaced by staging_entries)
--   pending_changes (replaced by staging_entries)
--   transaction_history (replaced by commit_changes)
--   budgets (never used)
--   month_tab_items (never used)
--   month_tabs (never used)

-- Tables CREATED in this migration:
--   events (seeded from template: 29 rows)
--   haccp_logs (empty, ready for live data)
--   daily_operations_logs (empty, ready for live data)
--   opening_checklist_items (seeded from template: 8 rows)
--   servsafe_certifications (seeded from template: 7 rows)
--   incident_logs (empty, ready for live data)
--   meal_periods (seeded from template: 5 rows)
--   archive_import_log (empty, for tracking imports)

-- =============================================================
-- END MIGRATION
-- =============================================================
