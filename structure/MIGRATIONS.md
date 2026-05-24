# Supabase Migrations

## Current Schema
Tables live in the `public` schema on Supabase project `mgvyylvmkxhhataavqjz`.

### Key Tables
- `user_profiles` — user accounts with role/pin
- `inventory_categories` — 9 categories (Dairy, Cereal, etc.)
- `inventory_items` — SKU catalog with pricing
- `monthly_inventory` — monthly per-item quantities
- `monthly_snapshots` — saved monthly totals
- `invoices` — applied invoice records
- `barcodes` — barcode registry

### Views
- `dashboard_summary` — main data view joining inventory + categories
- `barcodes_view` — barcodes with item/category info

### Functions
- `update_updated_at()` — trigger for updated_at timestamp

## Migration Notes
- Schema DDL in `architect/supabase_schema.sql` (archived during restructure)
- Month numbering uses 0-11 (JS convention)
- All migrations managed via manual SQL on Supabase dashboard
