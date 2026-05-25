# MJCC Inventory System — Complete Database Reference

**Platform:** Supabase (PostgreSQL 17) | **Schema:** `public` | **Auth schema:** `auth`
**Project:** `mgvyylvmkxhhataavqjz` | **Region:** `us-west-1`
**Last updated:** 2026-05-25

> **For AI agents and IT developers.** This document is the single source of truth for the database.
> Do not infer schema from Flask code — always refer here first.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Role Definitions & Access Matrix](#2-role-definitions--access-matrix)
3. [Core Engine Tables (Living Spreadsheet)](#3-core-engine-tables-living-spreadsheet)
4. [Legacy Inventory Tables](#4-legacy-inventory-tables)
5. [Invoice & Vendor Tables](#5-invoice--vendor-tables)
6. [User & Auth Tables](#6-user--auth-tables)
7. [Supporting Tables](#7-supporting-tables)
8. [Views](#8-views)
9. [Functions & RPCs](#9-functions--rpcs)
10. [Triggers](#10-triggers)
11. [Indexes](#11-indexes)
12. [Foreign Key Map](#12-foreign-key-map)
13. [RLS Policy Summary](#13-rls-policy-summary)
14. [Data Conventions](#14-data-conventions)
15. [Known Issues & Notes](#15-known-issues--notes)

---

## 1. Architecture Overview

The system operates as a **virtualized spreadsheet engine**, not a standard CRUD app.

```
┌─────────────────────────────────────────────────────────────┐
│                    CONCEPTUAL LAYERS                         │
│                                                             │
│  Sheet 1 → inventory_master     (live finalized state)      │
│  Sheet 2 → staging_area         (drafts / pending batches)  │
│  Sheet 3 → transaction_history  (immutable audit ledger)    │
│                                                             │
│  Legacy Sheet → barcodes + inventory_items + monthly_inventory │
│                 (original single-sheet design, still active) │
└─────────────────────────────────────────────────────────────┘

┌──────────┐    POST /api/v1/spreadsheet/upload
│  Staff   │ ──────────────────────────────────────► staging_area (pending)
└──────────┘                                              │
                                                          │ POST /api/v1/spreadsheet/merge
┌──────────┐                                              ▼
│ Manager  │ ──────── execute_stage_merge() RPC ──► inventory_master (UPSERT)
└──────────┘                                         + transaction_history (INSERT)

┌──────────┐    POST /api/v1/scanner/scan
│  Staff   │ ──────────────────────────────────────► inventory_master (direct UPDATE)
│ (scanner)│                                         + transaction_history (INSERT)
└──────────┘

┌───────────┐   GET /api/v1/analytics/timeline
│ Corporate │ ──────────────────────────────────────► transaction_history (aggregate)
└───────────┘
```

**Two parallel data planes exist:**
- **Engine plane** (`centers` → `inventory_master` / `staging_area` / `transaction_history`): the new spec-compliant system.
- **Legacy plane** (`inventory_items` / `monthly_inventory` / `barcodes`): original system, still powering the Flask dashboard. Do not delete.

---

## 2. Role Definitions & Access Matrix

### 2.1 Application Roles

Roles are stored in `user_profiles.role`. All role checks in RLS policies query `user_profiles` by `auth.uid()`.

| Role | Who | Description |
|---|---|---|
| `admin` | System administrator | Full access everywhere. Can create/modify users. |
| `manager` | Cafeteria manager | Read/write inventory and invoices. Cannot create users. |
| `staff` | Kitchen/floor staff | Can submit staging batches and scan items. Cannot modify `inventory_master` directly. |
| `corporate` | HQ observer | Global read-only across all centers. No writes anywhere. |

### 2.2 Table Access Matrix

`S` = SELECT, `I` = INSERT, `U` = UPDATE, `D` = DELETE, `—` = no access

| Table | admin | manager | staff | corporate | anon |
|---|---|---|---|---|---|
| `centers` | SIUD | S | S | S | — |
| `inventory_master` | SIUD | SIUD | S | S | — |
| `staging_area` | SIUD | SIUD | SI (own rows) | S | — |
| `transaction_history` | SI | SI | SI | S | — |
| `user_profiles` | SIUD | S (own) | S (own) | — | — |
| `barcodes` | SIUD | SIUD | SIUD | — | S |
| `inventory_items` | SIUD | SIUD | SIUD | — | S |
| `monthly_inventory` | SIUD | SIUD | SIUD | — | S |
| `monthly_snapshots` | SIUD | SIUD | SIUD | — | S |
| `invoices` | SIUD | SIUD | SIUD | — | S |
| `invoice_items` | SIUD | SIUD | SIUD | — | S |
| `vendors` | SIUD | SIUD | SIUD | — | S |
| `inventory_categories` | SIUD | SIUD | SIUD | — | S |
| `pending_changes` | SIUD | SIUD | SI (own) | — | — |
| `budgets` | SIUD | SIUD | — | — | — |
| `documents` | SI | SI | — | — | S |
| `email_templates` | SIUD | SIUD | — | — | S |
| `email_log` | SI | SI | — | — | S |
| `menu_cycles` | SIUD | SIUD | — | — | S |
| `menu_entries` | SIUD | SIUD | — | — | S |
| `reorder_alerts` | SIUD | SIUD | — | — | S |
| `qr_codes` | SI | SI | — | — | S |
| `transaction_history` | NO UPDATE, NO DELETE (trigger-enforced) ||||| |

> **Note:** `transaction_history` has database-level triggers that throw an exception on any UPDATE or DELETE attempt, regardless of role. This cannot be bypassed via SQL.

---

## 3. Core Engine Tables (Living Spreadsheet)

These three tables implement the spec. They are center-aware and have strict RLS.

---

### 3.1 `centers`

**Purpose:** Multi-tenancy anchor. Every engine table row belongs to a center. Currently one row (MJCC).

**Rows:** 1

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `name` | `text` | NO | — | Full center name |
| `code` | `text` | YES | — | Short code, e.g. `MJCC`. UNIQUE |
| `address` | `text` | YES | — | Street address |
| `city` | `text` | YES | — | City |
| `state` | `text` | YES | — | State abbreviation |
| `created_at` | `timestamptz` | YES | `now()` | |

**Constraints:**
- `PK`: `id`
- `UNIQUE`: `code`

**Seeded data:**
```
id   = '00000000-0000-0000-0000-000000000001'
name = 'Miami Job Corps Cafeteria'
code = 'MJCC'
```

**RLS Policies:**
- `centers_select_authenticated` — SELECT for any authenticated user
- `centers_admin_write` — ALL for role `admin`

---

### 3.2 `inventory_master`

**Purpose:** Sheet 1. The single source of truth for current item quantities per center. One row = one unique item (identified by barcode) at one center.

**Rows:** 316 (seeded from `barcodes`)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `center_id` | `uuid` | NO | — | FK → `centers.id` |
| `barcode` | `text` | NO | — | The item's barcode string. Cell address within the center. |
| `item_name` | `text` | NO | — | Human-readable description |
| `sku` | `text` | YES | — | Vendor SKU |
| `category` | `text` | YES | — | Category label |
| `unit` | `text` | YES | `'CS'` | Unit of measure (CS, EA, LB, etc.) |
| `unit_price` | `numeric` | YES | `0` | Price per unit |
| `par_level` | `integer` | YES | `0` | Minimum desired quantity |
| `quantity` | `numeric` | NO | `0` | **Current on-hand quantity. Cannot go below 0.** |
| `active` | `boolean` | YES | `true` | Soft-delete flag |
| `created_at` | `timestamptz` | YES | `now()` | |
| `updated_at` | `timestamptz` | YES | `now()` | |

**Constraints:**
- `PK`: `id`
- `UNIQUE`: `(center_id, barcode)` — enforces the spreadsheet cell model
- `CHECK`: `quantity >= 0` — the database will reject any update that drops quantity below zero

**Indexes:**
- `inventory_master_pkey` on `id`
- `inventory_master_center_id_barcode_key` on `(center_id, barcode)`

**RLS Policies:**
- `im_staff_select` — SELECT for role `staff`
- `im_manager_all` — ALL for roles `admin`, `manager`
- `im_corporate_select` — SELECT for role `corporate`

**Write rules for API developers:**
- Staff CANNOT write to this table directly. They submit to `staging_area`.
- Scanner endpoint (POST /api/v1/scanner/scan) writes directly via admin client (service role) bypassing RLS, then logs to `transaction_history`.
- Merge RPC (`execute_stage_merge`) is the only approved batch-write path.

---

### 3.3 `staging_area`

**Purpose:** Sheet 2. Draft batches (from XLSX uploads, manual entry, or scanner aggregation) waiting for manager approval. Analogous to a pull request.

**Rows:** 0 (empty, ready)

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `center_id` | `uuid` | NO | — | FK → `centers.id` |
| `proposed_rows` | `jsonb` | NO | `'[]'` | Array of `{barcode, quantity, item_name}` objects |
| `status` | `text` | NO | `'pending'` | Enum: `pending`, `approved`, `rejected` |
| `source` | `text` | YES | `'manual'` | Origin: `xlsx_upload`, `manual`, `scanner_batch` |
| `submitted_by` | `uuid` | YES | — | FK → `auth.users.id` |
| `reviewed_by` | `uuid` | YES | — | FK → `auth.users.id`. Set on approve/reject. |
| `notes` | `text` | YES | — | Optional notes from submitter or reviewer |
| `created_at` | `timestamptz` | YES | `now()` | |
| `reviewed_at` | `timestamptz` | YES | — | Timestamp of approval or rejection |

**Constraints:**
- `PK`: `id`
- `CHECK status`: must be one of `pending`, `approved`, `rejected`
- `NOT NULL`: `id`, `center_id`, `proposed_rows`, `status`

**`proposed_rows` JSON schema (each element):**
```json
{
  "barcode":   "string (required)",
  "quantity":  "number (required, positive = receive, negative = issue)",
  "item_name": "string (optional)"
}
```

**RLS Policies:**
- `staging_corporate_select` — SELECT for role `corporate`
- `staging_manager_all` — ALL for roles `admin`, `manager`
- `staging_staff_insert` — INSERT for role `staff` where `submitted_by = auth.uid()`
- `staging_staff_select_own` — SELECT for role `staff` where `submitted_by = auth.uid()`

**State machine:**
```
[created] → pending → approved  (via execute_stage_merge RPC)
                    → rejected  (via PATCH from manager)
```
Once `approved` or `rejected`, the status must not change. The merge RPC enforces `status = 'pending'` before executing.

---

### 3.4 `transaction_history`

**Purpose:** Sheet 3. Immutable append-only ledger. Every quantity change to `inventory_master` must produce a row here. Used for timeline analytics and auditing.

**Rows:** 0 (empty, ready)

**IMMUTABILITY RULE: This table has database-level triggers (`txn_history_no_update`, `txn_history_no_delete`) that throw a PostgreSQL exception on any UPDATE or DELETE. This applies to all roles including `service_role`. There are no exceptions.**

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | Primary key |
| `center_id` | `uuid` | NO | — | FK → `centers.id` |
| `barcode` | `text` | NO | — | Barcode of the affected item |
| `item_name` | `text` | YES | — | Name at time of transaction |
| `action` | `text` | NO | — | Enum: `scan_in`, `scan_out`, `merge`, `adjustment`, `rollover` |
| `quantity_change` | `numeric` | NO | — | **Delta only.** Positive = stock added, negative = stock removed. NOT the final quantity. |
| `quantity_after` | `numeric` | YES | — | Snapshot of quantity in `inventory_master` after the change |
| `stage_id` | `uuid` | YES | — | FK → `staging_area.id`. Only set for `action = 'merge'`. |
| `performed_by` | `uuid` | YES | — | FK → `auth.users.id` |
| `created_at` | `timestamptz` | YES | `now()` | Append time. No `updated_at` by design. |

**Constraints:**
- `PK`: `id`
- `CHECK action`: must be one of `scan_in`, `scan_out`, `merge`, `adjustment`, `rollover`
- `NOT NULL`: `id`, `center_id`, `barcode`, `action`, `quantity_change`

**Action meanings:**
| Action | Trigger | quantity_change sign |
|---|---|---|
| `scan_in` | Scanner scan with `action: 'in'` | Positive |
| `scan_out` | Scanner scan with `action: 'out'` | Negative |
| `merge` | Stage approval via RPC | Positive or negative |
| `adjustment` | Manual admin correction | Either |
| `rollover` | Month rollover operation | Typically 0 (carry-forward) |

**RLS Policies:**
- `txn_corporate_select` — SELECT for role `corporate`
- `txn_manager_select` — SELECT for roles `admin`, `manager`
- `txn_manager_insert` — INSERT for roles `admin`, `manager`
- `txn_staff_insert` — INSERT for role `staff` (scanner use)
- `txn_staff_select` — SELECT for role `staff`
- No UPDATE or DELETE policies exist. Triggers enforce immutability at the DB level.

---

## 4. Legacy Inventory Tables

These tables power the existing Flask dashboard. They remain active and must not be dropped or modified without updating the Flask routes and views.

---

### 4.1 `inventory_categories`

**Purpose:** Reference table for the 9 product categories.

**Rows:** 9

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `name` | `text` | NO | — | Category name. UNIQUE. |
| `color` | `text` | YES | `'#888888'` | Hex color for UI display |
| `icon` | `text` | YES | — | Icon identifier |
| `sort_order` | `integer` | YES | `0` | Display sort order |

**Constraints:** `PK: id`, `UNIQUE: name`

---

### 4.2 `inventory_items`

**Purpose:** Master item catalog. 316 items. Linked to categories and vendors. Used by `monthly_inventory` and `dashboard_summary` view.

**Rows:** 316

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `sku` | `text` | YES | — | Vendor SKU |
| `barcode_id` | `text` | YES | — | Barcode string. UNIQUE. Links to `barcodes.barcode_id`. |
| `description` | `text` | NO | — | Item name |
| `category_id` | `uuid` | YES | — | FK → `inventory_categories.id` |
| `vendor_id` | `uuid` | YES | — | FK → `vendors.id` |
| `unit_price` | `numeric` | YES | `0` | Price per unit |
| `par_level` | `integer` | YES | `0` | Reorder threshold |
| `unit` | `text` | YES | `'CS'` | Unit of measure |
| `active` | `boolean` | YES | `true` | Soft-delete |
| `on_hand` | `numeric` | YES | `0` | Current on-hand (legacy field, prefer `inventory_master.quantity`) |
| `created_at` | `timestamptz` | YES | `now()` | |
| `updated_at` | `timestamptz` | YES | `now()` | Auto-set by trigger |

**Constraints:** `PK: id`, `UNIQUE: barcode_id`
**Triggers:** `inventory_items_updated_at`, `trg_inv_items_updated` → auto-set `updated_at`
**Indexes:** `barcode_id`, `category_id`, `sku`, full-text on `description`

---

### 4.3 `monthly_inventory`

**Purpose:** Monthly cell storage. One row per item per month/year. Tracks 4 weeks of received and issued quantities. This is the primary data store for the Flask dashboard.

**Rows:** 5,147

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `item_id` | `uuid` | NO | — | FK → `inventory_items.id` |
| `month` | `integer` | NO | — | 0-indexed (0=Jan, 11=Dec). CHECK: 0–11 |
| `year` | `integer` | NO | — | e.g. 2026 |
| `on_hand` | `numeric` | YES | `0` | Starting on-hand for this month |
| `w1_received` | `numeric` | YES | `0` | Week 1 received |
| `w2_received` | `numeric` | YES | `0` | Week 2 received |
| `w3_received` | `numeric` | YES | `0` | Week 3 received |
| `w4_received` | `numeric` | YES | `0` | Week 4 received |
| `w1_issued` | `numeric` | YES | `0` | Week 1 issued |
| `w2_issued` | `numeric` | YES | `0` | Week 2 issued |
| `w3_issued` | `numeric` | YES | `0` | Week 3 issued |
| `w4_issued` | `numeric` | YES | `0` | Week 4 issued |
| `unit_price` | `numeric` | YES | `0` | Price snapshot for this month |
| `created_at` | `timestamptz` | YES | `now()` | |
| `updated_at` | `timestamptz` | YES | `now()` | Auto-set by trigger |

**Constraints:**
- `PK: id`
- `UNIQUE: (item_id, month, year)` — one row per item per period
- `CHECK: month >= 0 AND month <= 11`

**Ending quantity formula (computed in views/calculators):**
```
ending_qty = MAX(0, on_hand + w1r + w2r + w3r + w4r - w1i - w2i - w3i - w4i)
```

**Indexes:** `(year, month)`, `item_id`

---

### 4.4 `monthly_snapshots`

**Purpose:** Point-in-time financial snapshots saved at month-end. Used for history view and rollover calculations.

**Rows:** 76

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `month` | `integer` | NO | — | 0-indexed, CHECK 0–11 |
| `year` | `integer` | NO | — | |
| `grand_total` | `numeric` | YES | `0` | Total inventory value at month-end |
| `starting_total` | `numeric` | YES | `0` | Grand total from prior month |
| `wk1_total` | `numeric` | YES | `0` | Week 1 received value |
| `wk2_total` | `numeric` | YES | `0` | Week 2 received value |
| `wk3_total` | `numeric` | YES | `0` | Week 3 received value |
| `wk4_total` | `numeric` | YES | `0` | Week 4 received value |
| `category_totals` | `jsonb` | YES | `{}` | Per-category breakdown |
| `item_count` | `integer` | YES | `0` | Total active items |
| `reorder_count` | `integer` | YES | `0` | Items below par |
| `preset` | `boolean` | YES | `false` | Flag for pre-configured snapshots |
| `data` | `jsonb` | YES | — | Raw snapshot payload |
| `saved_at` | `timestamptz` | YES | `now()` | |
| `saved_by` | `uuid` | YES | — | FK → `auth.users.id` |

**Constraints:** `PK: id`, `UNIQUE: (month, year)`

---

### 4.5 `barcodes`

**Purpose:** Barcode registry with embedded weekly quantity columns. This is a denormalized flat-sheet representation — the original "spreadsheet in a table" design. Still used by `live_inventory` and `category_summary` views.

**Rows:** 316

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | `gen_random_uuid()` | PK |
| `barcode_id` | `text` | NO | — | The barcode string. UNIQUE. |
| `sku` | `text` | YES | — | |
| `category` | `text` | NO | — | Category name (denormalized) |
| `description` | `text` | NO | — | Item name |
| `unit_price` | `numeric` | YES | `0` | |
| `par_level` | `integer` | YES | `0` | |
| `on_hand` | `numeric` | YES | `0` | |
| `barcode_type` | `text` | YES | `'CODE128'` | CHECK: `CODE128`, `QR`, `EAN13`, `UPC` |
| `is_active` | `boolean` | YES | `true` | |
| `item_ref` | `text` | YES | — | Cross-reference field |
| `w1r`, `w2r`, `w3r`, `w4r` | `numeric` | YES | `0` | Weeks 1–4 received |
| `w1i`, `w2i`, `w3i`, `w4i` | `numeric` | YES | `0` | Weeks 1–4 issued |
| `created_at` | `timestamptz` | YES | `now()` | |
| `updated_at` | `timestamptz` | YES | `now()` | Auto-set by trigger |

**Constraints:** `PK: id`, `UNIQUE: barcode_id`
**Indexes:** `barcode_id`, `category`, `sku`, full-text GIN on `description`

---

### 4.6 `weekly_counts`

**Purpose:** Point-in-time weekly physical count records. Currently empty but schema is in place.

**Rows:** 0

| Column | Type | Nullable | Default |
|---|---|---|---|
| `id` | `uuid` | NO | `uuid_generate_v4()` |
| `item_id` | `uuid` | YES | — | FK → `inventory_items.id` |
| `week_number` | `integer` | NO | — | 1–4 |
| `year` | `integer` | NO | — | |
| `quantity_on_hand` | `integer` | NO | — | Physically counted quantity |
| `recorded_by` | `uuid` | YES | — | FK → `auth.users.id` |
| `recorded_at` | `timestamptz` | YES | `now()` | |

**Constraints:** `PK: id`, `UNIQUE: (item_id, week_number, year)`

---

### 4.7 `inventory_transactions`

**Purpose:** Legacy transaction log for `inventory_items`. Different from `transaction_history` — this is the old schema, currently empty. Do not confuse the two.

**Rows:** 0

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | PK |
| `item_id` | `uuid` | YES | FK → `inventory_items.id` |
| `type` | `text` | NO | CHECK: `received`, `issued`, `adjustment` |
| `quantity` | `integer` | NO | Final quantity (not delta) |
| `unit_price` | `numeric` | YES | |
| `transaction_date` | `timestamptz` | YES | |
| `notes` | `text` | YES | |
| `created_by` | `uuid` | YES | FK → `auth.users.id` |
| `created_at` | `timestamptz` | YES | |

---

### 4.8 `reorder_alerts`

**Purpose:** Tracks when items fall below par level. Currently empty.

**Rows:** 0

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `item_id` | `uuid` | FK → `inventory_items.id` |
| `threshold` | `integer` | Par level at time of alert |
| `triggered_at` | `timestamptz` | |
| `resolved_at` | `timestamptz` | Null if still open |
| `resolved_by` | `uuid` | FK → `auth.users.id` |
| `notes` | `text` | |

---

## 5. Invoice & Vendor Tables

---

### 5.1 `vendors`

**Purpose:** Supplier master list (US Foods, Multi-Flow, etc.)

**Rows:** 3

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | PK |
| `name` | `text` | NO | Vendor full name |
| `vendor_code` | `text` | YES | Short code |
| `address` | `text` | YES | |
| `city` | `text` | YES | |
| `state` | `text` | YES | |
| `zip` | `text` | YES | |
| `phone` | `text` | YES | |
| `email` | `text` | YES | |
| `account_number` | `text` | YES | MJCC account with this vendor |
| `created_at`, `updated_at` | `timestamptz` | YES | Auto-updated by trigger |

---

### 5.2 `invoices`

**Purpose:** Invoice header records. One row per invoice received.

**Rows:** 5

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | PK |
| `vendor_id` | `uuid` | YES | FK → `vendors.id` |
| `invoice_number` | `text` | NO | |
| `account_number` | `text` | YES | |
| `order_number` | `text` | YES | |
| `purchase_order` | `text` | YES | |
| `invoice_date` | `date` | NO | |
| `order_date`, `due_date`, `shipped_date` | `date` | YES | |
| `payment_terms` | `text` | YES | Default: `'NET 30 DAYS'` |
| `month` | `integer` | YES | 1–12 (note: 1-indexed, unlike `monthly_inventory`) |
| `year` | `integer` | YES | |
| `week_number` | `integer` | YES | CHECK: 1–4 |
| `subtotal`, `discount`, `tax`, `total` | `numeric` | YES | Default `0` |
| `vizient_discount`, `net_total` | `numeric` | YES | Default `0` |
| `driver_name`, `route_number`, `stop_number` | `text` | YES | |
| `status` | `text` | YES | CHECK: `received`, `verified`, `paid`, `disputed`. Default: `received` |
| `notes` | `text` | YES | |
| `applied_by` | `uuid` | YES | FK → `auth.users.id` |
| `created_at`, `updated_at` | `timestamptz` | YES | |

> **Month indexing inconsistency:** `invoices.month` is 1-indexed (1=January). `monthly_inventory.month` is 0-indexed (0=January). Always check which table you are joining against.

---

### 5.3 `invoice_items`

**Purpose:** Line items within an invoice. One row per product line.

**Rows:** 36

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | `uuid` | NO | PK |
| `invoice_id` | `uuid` | NO | FK → `invoices.id` |
| `sku` | `text` | YES | |
| `description` | `text` | NO | |
| `category` | `text` | YES | |
| `label` | `text` | YES | |
| `pack_size` | `text` | YES | |
| `unit` | `text` | YES | Default: `'CS'` |
| `quantity_ordered`, `quantity_shipped`, `quantity_adjusted` | `numeric` | YES | Default `0` |
| `unit_price`, `extended_price` | `numeric` | YES | Default `0` |
| `pricing_unit` | `text` | YES | |
| `weight` | `numeric` | YES | |
| `lot_numbers` | `text[]` | YES | Array of lot numbers |
| `notes` | `text` | YES | |
| `created_at` | `timestamptz` | YES | |

**Indexes:** `invoice_id`, `sku`, `category`, full-text GIN on `description`

---

## 6. User & Auth Tables

---

### 6.1 `user_profiles`

**Purpose:** Application-level user data. All auth happens through Supabase `auth.users`. This table extends it with MJCC-specific fields.

**Rows:** 11

| Column | Type | Nullable | Default | Notes |
|---|---|---|---|---|
| `id` | `uuid` | NO | — | PK. Also FK → `auth.users.id`. Same UUID. |
| `username` | `text` | NO | — | Login handle. UNIQUE. Lowercase. |
| `display_name` | `text` | YES | — | Human-readable name for UI |
| `role` | `text` | NO | `'staff'` | CHECK: `admin`, `manager`, `staff`, `corporate` |
| `pin` | `text` | YES | — | 4-digit PIN for staff quick-login (stored as text, not hashed in current impl) |
| `active` | `boolean` | NO | `true` | Soft-disable flag |
| `created_at` | `timestamptz` | YES | `now()` | |
| `updated_at` | `timestamptz` | YES | `now()` | Auto-set by trigger |

**Constraints:** `PK: id`, `UNIQUE: username`

**Auth flow:**
- **Staff:** Username + PIN. PIN compared against `user_profiles.pin`. No Supabase Auth JWT issued.
- **Admin/Manager:** Username + Password. Verified via `supabase.auth.sign_in_with_password()`. Email convention: `{username}@mjc-cafeteria.com` (sudo user: `sudo@mjc.local`).

**RLS Policies:**
- `users_read_own_profile` — SELECT where `id = auth.uid()`
- `admin_manage_profiles` — ALL for roles `admin`, `manager`

---

### 6.2 `pending_changes`

**Purpose:** Field-level change requests (staff submits a proposed edit to a barcode field, manager approves/declines). Different from `staging_area` which handles batch quantity changes.

**Rows:** 0

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `barcode_id` | `text` | The barcode being changed |
| `field` | `text` | Column name being changed |
| `old_value` | `text` | Previous value |
| `new_value` | `text` | Proposed new value |
| `status` | `text` | CHECK: `pending`, `approved`, `declined` |
| `note` | `text` | Optional comment |
| `created_by` | `uuid` | FK → `auth.users.id` |
| `reviewed_by` | `uuid` | FK → `auth.users.id` |
| `created_at`, `reviewed_at` | `timestamptz` | |

---

## 7. Supporting Tables

---

### 7.1 `budgets`

**Purpose:** Monthly budget allocations by category. Empty, not yet wired to API.

**Rows:** 0

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `month` | `integer` | 1–12 (1-indexed) |
| `year` | `integer` | |
| `category` | `text` | |
| `amount` | `numeric` | Budget amount |
| `notes` | `text` | |

**Constraints:** `UNIQUE: (month, year, category)`

---

### 7.2 `month_tabs`

**Purpose:** Configures which months are active in the UI tab bar.

**Rows:** 1

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `label` | `text` | Display label |
| `month` | `integer` | 1–12 |
| `year` | `integer` | |
| `sort_order` | `integer` | |

**Constraints:** `UNIQUE: (month, year)`

---

### 7.3 `month_tab_items`

**Purpose:** Snapshot of barcode data pinned to a month tab. Effectively a saved state of the barcodes table for a specific period.

**Rows:** 0

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `tab_id` | `uuid` | FK → `month_tabs.id` |
| `barcode_id` | `text` | |
| `sku`, `category`, `description` | `text` | Snapshot values |
| `unit_price`, `par_level`, `on_hand` | `numeric` | |
| `w1r`, `w2r`, `w3r`, `w4r` | `numeric` | Weekly received |
| `created_at` | `timestamptz` | |

**Constraints:** `UNIQUE: (tab_id, barcode_id)`

---

### 7.4 `menu_cycles` / `menu_entries`

**Purpose:** Weekly meal planning. One cycle contains many entries (one per meal slot).

`menu_cycles` (1 row): `id`, `name`, `start_date`, `end_date`, `active`

`menu_entries` (0 rows): `cycle_id`, `week_number` (1–4), `day_of_week`, `meal_type` (breakfast/lunch/dinner/brunch), `items`, `sides`, `is_vegetarian`, `sort_order`

**Constraints on `menu_entries`:** `UNIQUE: (cycle_id, week_number, day_of_week, meal_type)`

---

### 7.5 `qr_codes`

**Purpose:** QR/barcode image records tied to inventory items. Currently empty.

**Rows:** 0

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `item_id` | `uuid` | FK → `inventory_items.id` |
| `code` | `text` | The encoded string |
| `code_type` | `text` | CHECK: `qr`, `barcode` |
| `created_at` | `timestamptz` | |

---

### 7.6 `documents`

**Purpose:** Log of generated files (XLSX reports, PDFs, etc.). Currently empty.

**Rows:** 0

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` | PK |
| `name` | `text` | File name |
| `type` | `text` | CHECK: `inventory`, `menu`, `report`, `invoice` |
| `format` | `text` | CHECK: `xlsx`, `pptx`, `docx`, `pdf` |
| `file_path` | `text` | Storage path |
| `generated_by` | `uuid` | FK → `auth.users.id` |
| `created_at` | `timestamptz` | |

---

### 7.7 `email_templates` / `email_log`

**Purpose:** Email notification system. Currently unused (0 rows).

`email_templates`: `name`, `subject`, `body`, `trigger_type` (CHECK: `manual`, `low_stock`, `weekly_report`)
`email_log`: `recipient`, `subject`, `status` (CHECK: `pending`, `sent`, `failed`), `template_id`, `sent_at`, `error_message`

---

## 8. Views

Views are read-only. Do not attempt to INSERT/UPDATE through them.

---

### 8.1 `dashboard_summary` ⭐ PRIMARY DASHBOARD VIEW

**Source:** `monthly_inventory` JOIN `inventory_items` JOIN `inventory_categories`
**Used by:** Flask `GET /api/inventory/summary`, `GET /api/inventory/items`

Returns all inventory data for a given month/year with computed ending quantities and item totals.

**Key computed columns:**
```sql
ending_qty  = MAX(0, on_hand + w1r + w2r + w3r + w4r - w1i - w2i - w3i - w4i)
item_total  = ending_qty * unit_price
w1_value    = w1_received * unit_price
needs_reorder = (on_hand < par_level AND par_level > 0)
```

**Query pattern:**
```sql
SELECT * FROM dashboard_summary WHERE month = $month AND year = $year;
```

---

### 8.2 `live_inventory`

**Source:** `barcodes` (where `is_active = true`)
**Purpose:** Full real-time state from the barcodes flat table including weekly columns and computed totals.

**Key computed columns:**
```sql
total_issued   = w1i + w2i + w3i + w4i
total_received = w1r + w2r + w3r + w4r
ending_on_hand = MAX(0, on_hand + total_received - total_issued)
order_qty      = MAX(0, par_level - ending_on_hand)
inventory_total = ROUND(ending_on_hand * unit_price, 2)
sub_total      = ROUND(on_hand * unit_price, 2)
```

---

### 8.3 `category_summary`

**Source:** `barcodes` (where `is_active = true`), grouped by `category`
**Purpose:** Category-level totals for dashboard widgets.

**Returns:** `category`, `item_count`, `total_on_hand`, `sub_total_value`, `ending_value`, `total_received_units`, `total_issued_units`, `reorder_count`, `total_to_order`

---

### 8.4 `barcodes_view`

**Source:** `barcodes` JOIN `inventory_items` JOIN `inventory_categories`
**Purpose:** Enriched barcode data with category color and the `inventory_items.id` as `item_id`.

---

### 8.5 `monthly_comparison`

**Source:** `monthly_snapshots` with window functions
**Purpose:** Month-over-month and year-over-year financial comparison.

**Returns:** `month`, `year`, `grand_total`, `prior_month_total`, `mom_delta`, `mom_pct`, `prior_year_total`, `yoy_delta`, `yoy_pct`

---

### 8.6 `invoice_spending_summary`

**Source:** `invoices` JOIN `vendors`
**Purpose:** Aggregated spending by vendor, period, and week.

---

### 8.7 `category_spending`

**Source:** `invoice_items` JOIN `invoices`
**Purpose:** Invoice spend broken down by category per month.

---

### 8.8 `item_price_history`

**Source:** `invoice_items` JOIN `invoices` JOIN `vendors`
**Purpose:** Price history for each SKU across all invoices, ordered by SKU then invoice date descending.

---

## 9. Functions & RPCs

---

### 9.1 `execute_stage_merge(p_stage_id uuid, p_performed_by uuid) → jsonb`

**Security:** `SECURITY DEFINER` (runs as the function owner, bypasses caller RLS)
**Called by:** `POST /api/v1/spreadsheet/merge/<stage_id>`
**Required role:** `manager` or `admin` (enforced in Flask before calling)

Executes an all-or-nothing atomic transaction:
1. `SELECT ... FOR UPDATE` locks the `staging_area` row
2. Validates `status = 'pending'`
3. Loops over `proposed_rows` JSONB array
4. For each row: `SELECT ... FOR UPDATE` on `inventory_master`, then UPSERT
5. Enforces `quantity >= 0` — throws exception if delta would go negative
6. Inserts one row to `transaction_history` per item
7. Sets `staging_area.status = 'approved'`

**Returns:**
```json
{ "stage_id": "uuid", "applied": 12, "skipped": 0 }
```

**Error behavior:** Any failure rolls back the entire transaction. The stage remains `pending`.

---

### 9.2 `block_txn_history_mutation() → trigger`

**Security:** `SECURITY DEFINER`
**Attached to:** `transaction_history` (BEFORE UPDATE, BEFORE DELETE)

Raises a PostgreSQL exception unconditionally:
```
transaction_history is append-only — UPDATE and DELETE are not permitted
```

This cannot be circumvented by any role, including `service_role`, without dropping the trigger.

---

### 9.3 `touch_updated_at() → trigger` / `update_updated_at() → trigger`

**Security:** `SECURITY INVOKER`
**Purpose:** Auto-sets `updated_at = NOW()` on UPDATE. Two copies exist with identical logic.
**Attached to:** `barcodes`, `inventory_items`, `invoices`, `monthly_inventory`, `vendors`, `email_templates`, `menu_entries`

---

### 9.4 `profiles_touch_updated_at() → trigger`

**Security:** `SECURITY INVOKER`
**Purpose:** Auto-sets `updated_at = NOW()` on `user_profiles`.

---

### 9.5 `mjc_login(p_username text, p_pin_hash text) → jsonb` *(legacy)*

**Security:** `SECURITY DEFINER`
**Status:** Legacy function referencing a now-removed `mjc_users` table. Not called by current Flask code. Safe to ignore; do not drop without confirming nothing references it.

---

### 9.6 `rls_auto_enable() → event_trigger`

**Security:** `SECURITY INVOKER`
**Purpose:** Event trigger that automatically enables RLS on any new table created in the `public` schema. Ensures no table is accidentally left unprotected.

---

## 10. Triggers

| Trigger Name | Table | Event | Timing | Function |
|---|---|---|---|---|
| `trg_barcodes_updated` | `barcodes` | UPDATE | BEFORE | `touch_updated_at()` |
| `inventory_items_updated_at` | `inventory_items` | UPDATE | BEFORE | `update_updated_at()` |
| `trg_inv_items_updated` | `inventory_items` | UPDATE | BEFORE | `touch_updated_at()` |
| `trg_invoices_updated` | `invoices` | UPDATE | BEFORE | `touch_updated_at()` |
| `email_templates_updated_at` | `email_templates` | UPDATE | BEFORE | `update_updated_at()` |
| `menu_entries_updated_at` | `menu_entries` | UPDATE | BEFORE | `update_updated_at()` |
| `trg_monthly_inv_updated` | `monthly_inventory` | UPDATE | BEFORE | `touch_updated_at()` |
| `trg_vendors_updated` | `vendors` | UPDATE | BEFORE | `touch_updated_at()` |
| `txn_history_no_update` | `transaction_history` | UPDATE | BEFORE | `block_txn_history_mutation()` |
| `txn_history_no_delete` | `transaction_history` | DELETE | BEFORE | `block_txn_history_mutation()` |

> **Note:** `inventory_items` has two `updated_at` triggers (`inventory_items_updated_at` and `trg_inv_items_updated`). Both fire on UPDATE and call identical logic. This is a known duplication from migration history — functionally harmless but should be cleaned up.

---

## 11. Indexes

| Table | Index Name | Columns | Type | Notes |
|---|---|---|---|---|
| `barcodes` | `idx_barcodes_barcode_id` | `barcode_id` | btree | |
| `barcodes` | `idx_barcodes_category` | `category` | btree | |
| `barcodes` | `idx_barcodes_sku` | `sku` | btree | |
| `barcodes` | `idx_barcodes_fts` | `description` | GIN | Full-text search |
| `inventory_items` | `idx_invitems_bc` | `barcode_id` | btree | |
| `inventory_items` | `idx_invitems_cat` | `category_id` | btree | |
| `inventory_items` | `idx_invitems_sku` | `sku` | btree | |
| `inventory_items` | `idx_invitems_fts` | `description` | GIN | Full-text search |
| `inventory_items` | `idx_inventory_items_name` | `description` | btree | |
| `inventory_items` | `idx_inventory_items_on_hand` | `on_hand` | btree | |
| `invoice_items` | `idx_inv_items_invoice` | `invoice_id` | btree | |
| `invoice_items` | `idx_inv_items_sku` | `sku` | btree | |
| `invoice_items` | `idx_inv_items_category` | `category` | btree | |
| `invoice_items` | `idx_inv_items_desc` | `description` | GIN | Full-text search |
| `invoices` | `idx_invoices_date` | `invoice_date` | btree | |
| `invoices` | `idx_invoices_month_year` | `(year, month)` | btree | |
| `invoices` | `idx_invoices_vendor` | `vendor_id` | btree | |
| `invoices` | `idx_invoices_status` | `status` | btree | |
| `monthly_inventory` | `idx_monthly_yr_mo` | `(year, month)` | btree | Primary query pattern |
| `monthly_inventory` | `idx_monthly_item` | `item_id` | btree | |
| `monthly_snapshots` | `idx_snapshots_yr_mo` | `(year, month)` | btree | |

> **Missing indexes (recommended additions):**
> - `inventory_master(center_id, barcode)` — covered by the UNIQUE constraint index
> - `transaction_history(center_id, created_at)` — add when analytics queries are built
> - `staging_area(center_id, status)` — add when queue polling is implemented

---

## 12. Foreign Key Map

```
auth.users
  ├── user_profiles.id                (1:1 extension)
  ├── monthly_snapshots.saved_by
  ├── staging_area.submitted_by
  ├── staging_area.reviewed_by
  ├── transaction_history.performed_by
  ├── inventory_transactions.created_by
  ├── weekly_counts.recorded_by
  ├── pending_changes.created_by
  ├── pending_changes.reviewed_by
  ├── reorder_alerts.resolved_by
  ├── documents.generated_by
  ├── invoices.applied_by
  └── qr_codes (no direct FK to auth.users)

centers
  ├── inventory_master.center_id
  ├── staging_area.center_id
  └── transaction_history.center_id

staging_area
  └── transaction_history.stage_id    (populated for action='merge')

inventory_categories
  └── inventory_items.category_id

vendors
  ├── inventory_items.vendor_id
  └── invoices.vendor_id

inventory_items
  ├── monthly_inventory.item_id
  ├── inventory_transactions.item_id
  ├── weekly_counts.item_id
  ├── reorder_alerts.item_id
  └── qr_codes.item_id

invoices
  └── invoice_items.invoice_id

email_templates
  └── email_log.template_id

month_tabs
  └── month_tab_items.tab_id
```

---

## 13. RLS Policy Summary

### Engine Tables (role-based, strict)

| Table | Policy | Cmd | Condition |
|---|---|---|---|
| `inventory_master` | `im_corporate_select` | SELECT | role = `corporate` |
| `inventory_master` | `im_manager_all` | ALL | role IN (`admin`, `manager`) |
| `inventory_master` | `im_staff_select` | SELECT | role = `staff` |
| `staging_area` | `staging_corporate_select` | SELECT | role = `corporate` |
| `staging_area` | `staging_manager_all` | ALL | role IN (`admin`, `manager`) |
| `staging_area` | `staging_staff_insert` | INSERT | role = `staff` AND `submitted_by = auth.uid()` |
| `staging_area` | `staging_staff_select_own` | SELECT | role = `staff` AND `submitted_by = auth.uid()` |
| `transaction_history` | `txn_corporate_select` | SELECT | role = `corporate` |
| `transaction_history` | `txn_manager_select` | SELECT | role IN (`admin`, `manager`) |
| `transaction_history` | `txn_manager_insert` | INSERT | role IN (`admin`, `manager`) |
| `transaction_history` | `txn_staff_insert` | INSERT | role = `staff` |
| `transaction_history` | `txn_staff_select` | SELECT | role = `staff` |

### Legacy Tables (broad, auth-only checks)

Most legacy tables use simple policies: `auth.uid() IS NOT NULL` for writes, `true` for reads (publicly readable to any anonymous or authenticated request). This is the original design and is intentional for the single-tenant dashboard. These tables do **not** do role-based filtering.

| Table | Read | Write |
|---|---|---|
| `barcodes` | Public (anon + auth) | Any authenticated user |
| `inventory_items` | Public | Any authenticated user |
| `monthly_inventory` | Public | Any authenticated user |
| `monthly_snapshots` | Public | Any authenticated user |
| `invoices`, `invoice_items` | Public | Any authenticated user |
| `vendors` | Public | Any authenticated user |
| `inventory_categories` | Public | Any authenticated user |

---

## 14. Data Conventions

### Month Indexing — CRITICAL
Two different conventions are used. Always check which table you are querying.

| Table | Convention | January | December |
|---|---|---|---|
| `monthly_inventory` | **0-indexed** | `0` | `11` |
| `monthly_snapshots` | **0-indexed** | `0` | `11` |
| `invoices` | **1-indexed** | `1` | `12` |
| `budgets` | **1-indexed** | `1` | `12` |
| `month_tabs` | **1-indexed** | `1` | `12` |

### Primary Keys
All PKs are `uuid` generated by `gen_random_uuid()` (PostgreSQL 17 built-in) or `extensions.uuid_generate_v4()` (older tables). Both produce valid UUIDs; prefer `gen_random_uuid()` in new migrations.

### Soft Deletes
Items are soft-deleted via `active = false` or `is_active = false`. No hard deletes on active data tables.

### Timestamps
All tables use `timestamptz` (timezone-aware). The database is in UTC. The app layer does not convert — display conversion happens in the browser.

### `service_role` Usage
The Flask backend uses the Supabase `service_role` key for admin operations (via `get_client(admin=True)`). This bypasses RLS entirely. Use it only for:
- User management routes
- Seeding and migration scripts
- The scanner endpoint (which needs to write to `inventory_master` as staff)

Use the anon/user JWT key (`get_client()`) for regular user-scoped reads.

---

## 15. Known Issues & Notes

| # | Issue | Table(s) | Severity | Notes |
|---|---|---|---|---|
| 1 | Duplicate `updated_at` triggers | `inventory_items` | Low | `inventory_items_updated_at` and `trg_inv_items_updated` both fire on UPDATE. Harmless but wasteful. |
| 2 | Month indexing inconsistency | `invoices` vs `monthly_inventory` | Medium | Documented above. Never join these two on `month` directly without converting. |
| 3 | `mjc_login` references a dropped table | — | Low | Legacy function, not called. Can be dropped safely when confirmed. |
| 4 | Legacy barcodes RLS is open | `barcodes`, `inventory_items` | Medium | Any authenticated user can write. Acceptable for single-center single-tenant use. Tighten if system expands. |
| 5 | `inventory_items.on_hand` and `barcodes.on_hand` may diverge | `inventory_items`, `barcodes` | Medium | Two `on_hand` fields exist in legacy tables. Ground truth for live state is `inventory_master.quantity`. |
| 6 | No indexes on `transaction_history` beyond PK | `transaction_history` | Low | Add `(center_id, created_at)` index before analytics queries are built. |
| 7 | `pending_changes` RLS reads `auth.users.raw_user_meta_data` for role | `pending_changes` | Medium | This is inconsistent with `inventory_master` which reads `user_profiles`. Should be unified. |
| 8 | `month_tabs` / `month_tab_items` RLS also reads `raw_user_meta_data` | `month_tabs`, `month_tab_items` | Low | Same inconsistency as #7. |
