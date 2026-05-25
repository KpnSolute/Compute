# MJCC Inventory Management System — Structure Reference

**Version:** v1.0.4
**Last Updated:** 2026-05-25
**Audience:** IT developers and AI agents

---

## Section 1 — Project Overview

**Name:** MJCC Inventory Management System
**Full Name:** Miami Job Corps Cafeteria Inventory Management System

**Purpose:** Track monthly cafeteria inventory for Miami Job Corps. The system processes US Foods and Multi-Flow vendor invoices, manages per-item quantity tracking across weekly periods, and generates monthly financial reports and snapshots.

**Inventory Categories (9 total):**

| # | Category |
|---|---|
| 1 | Dairy |
| 2 | Cereal |
| 3 | Beverages |
| 4 | Snacks |
| 5 | Dry Goods |
| 6 | Produce & Fresh |
| 7 | Protein & Meat |
| 8 | Frozen Foods |
| 9 | Supplies |

**Current Version:** v1.0.4

---

## Section 2 — Tech Stack

### Backend

| Component | Technology |
|---|---|
| Language | Python 3.12 |
| Web Framework | Flask with Blueprints |
| Database | Supabase (PostgreSQL 17) |
| DB Project ID | mgvyylvmkxhhataavqjz |
| DB Region | us-west-1 |
| Auth | Supabase Auth + Flask sessions + PIN-based staff login |
| Rate Limiting | Flask-Limiter |
| WSGI Server | Gunicorn (4 workers) |

### AI Integration

| Provider | Config |
|---|---|
| Default | OllamaFreeAPI |
| Alternative | Groq (set `AI_PROVIDER=groq` + `GROQ_API_KEY`) |

### Frontend

- Vanilla HTML/CSS/JS SPA
- No framework — zero JS dependencies
- Prettier for code formatting

### Tooling & Quality

| Tool | Purpose |
|---|---|
| pytest | Testing |
| ruff (E, F, I, N, W) | Python linting |
| Prettier | HTML/CSS/JS/JSON/MD formatting |

### Deployment

| Component | Technology |
|---|---|
| Platform | Azure App Service (Linux, Docker) |
| Container Registry | Azure Container Registry — mjccacr.azurecr.io |
| CI/CD | GitHub Actions |
| Base Image | python:3.12-slim |
| Region | westus2 |

### Key Python Packages

```
flask
flask-cors
flask-limiter
supabase
ollamafreeapi
python-dotenv
gunicorn
groq
PyJWT
pandas
openpyxl
```

---

## Section 3 — Architecture

### Overview: Two Parallel Data Planes

The system operates two coexisting data planes. They must never be collapsed into one. Both are active simultaneously.

---

### ENGINE PLANE (New Spec — Living Spreadsheet)

The engine plane is the forward-looking architecture. It is center-aware, spec-compliant, and built for multi-tenancy.

| Sheet | Table | Purpose |
|---|---|---|
| Sheet 1 | `inventory_master` | Live finalized state, center-aware, single source of truth |
| Sheet 2 | `staging_area` | Draft batches pending manager approval |
| Sheet 3 | `transaction_history` | Immutable append-only audit ledger |

- The `centers` table anchors multi-tenancy. Every engine table references `center_id`.
- Atomic merge is performed via the `execute_stage_merge()` PostgreSQL RPC.

---

### LEGACY PLANE (Original System — Still Active)

The legacy plane powers the current Flask dashboard. It must not be dropped.

| Table | Purpose |
|---|---|
| `inventory_items` | Item catalog |
| `inventory_categories` | Category definitions |
| `monthly_inventory` | Per-item monthly quantity cells |
| `monthly_snapshots` | Month-end financial snapshots |
| `barcodes` | Denormalized flat-sheet registry |
| `invoices` | Invoice headers |
| `invoice_items` | Invoice line items |
| `vendors` | Vendor records |

---

### Data Flow Diagram

```
STAFF UPLOAD FLOW:
  Staff
    → Upload XLSX
    → staging_area (status=pending)
    → Manager reviews diff (current vs proposed)
    → POST /api/v1/spreadsheet/merge/<stage_id>
    → execute_stage_merge() RPC (atomic)
    → inventory_master quantities updated
    → transaction_history row appended per item
    → staging_area.status = approved

SCANNER FLOW:
  Staff Scanner
    → POST /api/v1/scanner/scan
    → Direct write to inventory_master (service role)
    → transaction_history row appended
    → Response <200ms

CORPORATE READ FLOW:
  Corporate User
    → GET /api/v1/analytics/timeline
    → Read-only aggregation from transaction_history
    → No writes permitted anywhere
```

---

## Section 4 — Development Rules & Conventions

### Code Rules

- No inline comments unless absolutely necessary
- Follow existing patterns in the codebase
- Use Flask Blueprints for route organization
- Keep backend logic in Python modules (`backend/calculators.py`, etc.)
- Keep frontend as an HTML presentation layer only
- Do not add new JS frameworks or libraries
- All schema changes must be tracked and applied via Supabase migrations
- Never hardcode generated IDs in migrations
- Every fix or change MUST be logged in `structure/DIARY.md`

### Month Indexing — CRITICAL

This is the most dangerous inconsistency in the system. Read carefully.

| Table / Context | Indexing | Range | Example |
|---|---|---|---|
| `monthly_inventory` | 0-indexed | 0–11 | January = 0, December = 11 |
| `monthly_snapshots` | 0-indexed | 0–11 | January = 0, December = 11 |
| `invoices` | 1-indexed | 1–12 | January = 1, December = 12 |
| `budgets` | 1-indexed | 1–12 | January = 1, December = 12 |
| `month_tabs` | 1-indexed | 1–12 | January = 1, December = 12 |

**NEVER join `invoices` to `monthly_inventory` on the `month` column directly without converting.**

### Tooling Commands

| Command | Action |
|---|---|
| `bash run.sh` | Start server (kills port 5000 first, activates venv) |
| `pytest` | Run test suite |
| `ruff check .` | Lint Python code |
| `ruff format .` | Format Python code |
| `npm run format` | Format HTML/CSS/JS/JSON/MD with Prettier |
| `npm run format:check` | Check formatting without writing changes |

### Versioning

- Sequential: `1.0.0` → `1.0.1` → `1.0.2`, etc.
- Tag every release
- Push tags with `--follow-tags`

---

## Section 5 — Role Definitions & Access Matrix

### Role Storage

Roles are stored in `user_profiles.role`. All Row Level Security (RLS) policies check `user_profiles` by `auth.uid()`.

### Role Definitions

| Role | Description |
|---|---|
| `admin` | Full access. Can create and modify any user (admin, manager, or staff). |
| `manager` | Primary inventory controller for their center. Can create staff accounts, assign/change PINs, activate or deactivate staff. Cannot create admin or manager accounts. |
| `staff` | Can submit staging batches and scan items. Cannot modify `inventory_master` directly. Uses PIN login only — no Supabase Auth account required. |
| `corporate` | Global read-only across all centers. Can view Adaptive Screening reports and analytics. No writes anywhere. |

### Authentication Flows

**Staff (PIN Login):**
- Username + PIN
- PIN compared against `user_profiles.pin`
- No JWT issued
- Session cookie only
- Scanner devices for staff must maintain session cookies

**Admin / Manager (Password Login):**
- Username + Password
- Supabase Auth `sign_in_with_password`
- Email convention: `{username}@mjc-cafeteria.com`
- Sudo user: `sudo@mjc.local`
- Returns JWT access_token + session

### Table Access Matrix

Legend: S=SELECT, I=INSERT, U=UPDATE, D=DELETE, — =No access

| Table | admin | manager | staff | corporate | anon |
|---|---|---|---|---|---|
| centers | SIUD | S | S | S | — |
| inventory_master | SIUD | SIUD | S | S | — |
| staging_area | SIUD | SIUD | SI (own rows) | S | — |
| transaction_history | SI | SI | SI | S | — (NO UPDATE/DELETE for anyone) |
| user_profiles | SIUD | SI (staff rows only) | S (own) | — | — |
| barcodes | SIUD | SIUD | SIUD | — | S |
| inventory_items | SIUD | SIUD | SIUD | — | S |
| monthly_inventory | SIUD | SIUD | SIUD | — | S |
| monthly_snapshots | SIUD | SIUD | SIUD | — | S |
| invoices | SIUD | SIUD | SIUD | — | S |
| invoice_items | SIUD | SIUD | SIUD | — | S |
| vendors | SIUD | SIUD | SIUD | — | S |
| inventory_categories | SIUD | SIUD | SIUD | — | S |
| pending_changes | SIUD | SIUD | SI (own) | — | — |
| budgets | SIUD | SIUD | — | — | S |
| documents | SIUD | SIUD | — | — | S |
| email_templates | SIUD | SIUD | — | — | S |
| email_log | SIUD | SIUD | — | — | S |
| menu_cycles | SIUD | SIUD | — | — | S |
| menu_entries | SIUD | SIUD | — | — | S |
| reorder_alerts | SIUD | SIUD | — | — | S |
| qr_codes | SIUD | SIUD | — | — | S |

**Note on `transaction_history`:** UPDATE and DELETE are blocked by trigger for ALL roles including service_role. There are no UPDATE or DELETE RLS policies because the trigger fires before RLS can permit them.

---

## Section 5A — Adaptive Screening: Calculation Engine

**File:** `backend/calculators.py`
**System name:** Adaptive Screening

Adaptive Screening is the analytics layer of the MJCC Inventory System. It surfaces items that need manager or corporate attention by comparing the current month against the prior month across four dimensions: stock levels, consumption demand, receiving volume, and price.

---

### Row-Level Calculations (per item, per month)

These functions operate on a single item dict sourced from the `dashboard_summary` view.

| Function | Formula | Notes |
|---|---|---|
| `ending_quantity(item)` | `max(0, on_hand + Σ(w1r..w4r) − Σ(w1i..w4i))` | Never goes below zero |
| `item_total(item)` | `ending_quantity × unit_price` | Dollar value of ending stock |
| `issued_rate(item)` | `Σ(issued) / active_weeks` | Weekly consumption rate. `active_weeks` = weeks where any issued or received > 0. If no activity: 0. |
| `received_rate(item)` | `Σ(received) / active_weeks` | Weekly receiving rate, same denominator as issued_rate |
| `weeks_of_supply(item)` | `ending_quantity / issued_rate` | How many weeks of stock remain. Returns `null` if issued_rate is 0 (no demand data) |
| `consumption_cost(item)` | `Σ(issued) × unit_price` | Dollar value consumed this month |
| `receive_cost(item)` | `Σ(received) × unit_price` | Dollar value received this month |
| `suggested_par(item, safety_weeks=2)` | `round(issued_rate × safety_weeks)` | Adaptive par level based on actual demand with a 2-week buffer |

**Why `active_weeks` instead of 4?**
Not every item has data for all four weeks (deliveries vary, partial months). Dividing by 4 when only 2 weeks of data exist would halve the rate and distort forecasts. `active_weeks` corrects for this.

**Why `ending_quantity` for par comparison, not `on_hand`?**
`on_hand` is the opening balance at the start of the month. Comparing it to `par_level` mid-month is misleading — you need to know where you'll end up after all receipts and issues. The previous `reorder_alerts` function used `on_hand`; this has been fixed to use `ending_quantity`.

---

### Monthly Aggregate Calculations

These functions operate on a list of items for a given month/year.

| Function | Output |
|---|---|
| `grand_total(items)` | Sum of `item_total` across all items |
| `week_value(items, N)` | Sum of `wN_received × unit_price` — dollar value of that week's deliveries |
| `total_consumption_cost(items)` | Sum of `consumption_cost` — total dollar value consumed |
| `total_receive_cost(items)` | Sum of `receive_cost` — total dollar value received |
| `category_breakdown(items)` | Per-category: total value, item count, total issued, total received, consumption_cost, receive_cost |
| `reorder_alerts(items)` | Items where `ending_quantity < par_level` (par_level > 0). Returns ending_qty, par_level, weeks_of_supply, unit_price per item. |

`dashboard_summary()` runs all of the above and returns a single dict used by `GET /api/inventory/summary`.

---

### Rollover Calculation

`rollover(items)` runs at month-end. For each item:
- New `on_hand` = `ending_quantity` of the closing month
- All weekly fields (`w1_received` .. `w4_issued`) reset to 0

This becomes the opening state for the next month's `monthly_inventory` rows.

---

### Adaptive Screening Report

`adaptive_screening(current_items, prior_items, demand_threshold_pct=25.0, low_supply_weeks=2.0)`

Compares current month vs prior month and returns a ranked list of flagged items. Items with multiple triggers appear first.

#### Trigger Conditions

| Trigger | Condition | Count Field |
|---|---|---|
| `below_par` | `ending_qty < par_level` (and par_level > 0) | `below_par` |
| `demand_spike` | `issued_rate` rose > `demand_threshold_pct`% vs prior month | `demand_changes` |
| `demand_drop` | `issued_rate` fell > `demand_threshold_pct`% vs prior month | `demand_changes` |
| `price_change` | `unit_price` changed from prior month (any direction) | `price_changes` |
| `low_supply` | `weeks_of_supply < low_supply_weeks` | `low_supply` |

Default thresholds: demand change > 25%, low supply < 2 weeks. Both are overridable per API call.

#### Output Shape

```
{
  "summary": {
    "total_items": int,
    "flagged_items": int,
    "below_par": int,
    "demand_changes": int,
    "price_changes": int,
    "low_supply": int
  },
  "flags": [
    {
      "item_id": uuid,
      "barcode": string,
      "description": string,
      "category": string,
      "reasons": ["below_par", "demand_spike", "price_change", "low_supply"],
      "current": { ...item_metrics... },
      "prior": { ...item_metrics or null if new item... },
      "deltas": {
        "demand_change_pct": float,
        "price_change": float,
        "price_change_pct": float
      }
    }
  ]
}
```

Flags are sorted by number of reasons descending — items flagged on 3+ dimensions appear first.

#### What Managers See vs Corporate

Both roles see the same report. The difference is context:
- **Manager** uses it to action items: place orders, adjust par levels, investigate price changes with their vendor rep
- **Corporate** uses it for oversight: confirming centers are managing stock correctly, identifying spending anomalies across locations

---

### `item_metrics()` — Full Row Payload

Returns all row-level metrics for one item in a single dict. Used internally by `adaptive_screening()` and directly by `GET /api/v1/analytics/demand`.

```
{
  "ending_qty": float,
  "item_total": float,
  "total_issued": float,
  "total_received": float,
  "issued_rate": float,
  "received_rate": float,
  "weeks_of_supply": float | null,
  "consumption_cost": float,
  "receive_cost": float,
  "suggested_par": int,
  "unit_price": float,
  "par_level": float,
  "on_hand": float
}
```

---

## Section 6 — Complete Database Schema

**Supabase Project:** mgvyylvmkxhhataavqjz
**PostgreSQL Version:** 17
**Schema:** public
**Auth Schema:** auth

**Totals:** 26 tables, 8 views, 7 functions, 10 triggers

---

### ENGINE TABLES

These tables are spec-compliant, center-aware, and have strict RLS. They form the new data plane.

---

#### `centers`

**Purpose:** Multi-tenancy anchor. Every engine table belongs to a center. Currently contains one row (MJCC).
**Row Count:** 1
**Seeded UUID:** `00000000-0000-0000-0000-000000000001`

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK, DEFAULT gen_random_uuid() |
| name | text | NOT NULL |
| code | text | UNIQUE (value: MJCC) |
| address | text | |
| city | text | |
| state | text | |
| created_at | timestamptz | DEFAULT now() |

**RLS:** Authenticated users can SELECT. Admin only for INSERT/UPDATE/DELETE.

---

#### `inventory_master`

**Purpose:** Sheet 1. Single source of truth for current quantities per center. One row = one unique item (barcode) at one center.
**Row Count:** 316 rows (seeded from barcodes)

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| center_id | uuid | NOT NULL, FK → centers |
| barcode | text | NOT NULL |
| item_name | text | NOT NULL |
| sku | text | |
| category | text | |
| unit | text | DEFAULT 'CS' |
| unit_price | numeric | DEFAULT 0 |
| par_level | integer | DEFAULT 0 |
| quantity | numeric | NOT NULL, DEFAULT 0 |
| active | boolean | DEFAULT true |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Constraints:**
- UNIQUE(center_id, barcode)
- CHECK quantity >= 0

**Indexes:**
- PK on `id`
- UNIQUE on `(center_id, barcode)`

**RLS Policies:**
- `im_staff_select` — staff can SELECT
- `im_manager_all` — admin/manager ALL
- `im_corporate_select` — corporate can SELECT

**Write Rules:**
- Staff cannot write directly to this table
- Scanner endpoint uses service role for direct writes
- Batch writes go through `execute_stage_merge()` RPC only

---

#### `staging_area`

**Purpose:** Sheet 2. Draft batches (XLSX uploads, manual entries, scanner aggregations) awaiting manager approval. Conceptually like a pull request — proposed changes that must be reviewed before applying.
**Row Count:** 0 (ready)

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| center_id | uuid | NOT NULL, FK → centers |
| proposed_rows | jsonb | NOT NULL, DEFAULT '[]' |
| status | text | NOT NULL, DEFAULT 'pending', CHECK IN (pending, approved, rejected) |
| source | text | DEFAULT 'manual' |
| submitted_by | uuid | FK → auth.users |
| reviewed_by | uuid | FK → auth.users |
| notes | text | |
| created_at | timestamptz | |
| reviewed_at | timestamptz | |

**`proposed_rows` Element Schema:**
```json
{
  "barcode": "string",
  "quantity": "number (positive=receive, negative=issue)",
  "item_name": "string (optional)"
}
```

**State Machine:**
- `pending` → `approved` (via `execute_stage_merge()` RPC)
- `pending` → `rejected` (via manager PATCH)
- Cannot change status after `approved` or `rejected`

**RLS Policies:**
- `staging_corporate_select` — corporate can SELECT
- `staging_manager_all` — admin/manager ALL
- `staging_staff_insert` — staff can INSERT own rows only
- `staging_staff_select_own` — staff can SELECT own rows only

---

#### `transaction_history`

**Purpose:** Sheet 3. Immutable append-only audit ledger. Every quantity change to `inventory_master` must produce one row here.
**Row Count:** 0 (ready)

**IMMUTABILITY RULE:** Triggers `txn_history_no_update` and `txn_history_no_delete` throw a PostgreSQL exception on any UPDATE or DELETE. This applies to ALL roles including service_role. The trigger cannot be bypassed without dropping it entirely.

| Column | Type | Constraints / Notes |
|---|---|---|
| id | uuid | PK |
| center_id | uuid | NOT NULL, FK → centers |
| barcode | text | NOT NULL |
| item_name | text | |
| action | text | NOT NULL, CHECK IN (scan_in, scan_out, merge, adjustment, rollover) |
| quantity_change | numeric | NOT NULL — DELTA only (+50 = received 50, -10 = issued 10) |
| quantity_after | numeric | Snapshot of quantity after the change was applied |
| stage_id | uuid | FK → staging_area — set only when action=merge |
| performed_by | uuid | FK → auth.users |
| created_at | timestamptz | DEFAULT now() |

**Note:** There is intentionally NO `updated_at` column. This is by design to reinforce immutability.

**RLS Policies:**
- `txn_corporate_select` — corporate can SELECT
- `txn_manager_select` — manager can SELECT
- `txn_manager_insert` — manager can INSERT
- `txn_staff_insert` — staff can INSERT
- `txn_staff_select` — staff can SELECT
- No UPDATE or DELETE policies exist (blocked by trigger)

---

### LEGACY INVENTORY TABLES

These tables power the current Flask dashboard. They are active and must not be dropped. Both planes coexist.

---

#### `inventory_categories`

**Row Count:** 9 rows

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | NOT NULL, UNIQUE |
| color | text | DEFAULT '#888888' |
| icon | text | |
| sort_order | integer | DEFAULT 0 |

---

#### `inventory_items`

**Row Count:** 316 rows

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| sku | text | |
| barcode_id | text | UNIQUE (links to barcodes.barcode_id) |
| description | text | NOT NULL |
| category_id | uuid | FK → inventory_categories |
| vendor_id | uuid | FK → vendors |
| unit_price | numeric | DEFAULT 0 |
| par_level | integer | DEFAULT 0 |
| unit | text | DEFAULT 'CS' |
| active | boolean | DEFAULT true |
| on_hand | numeric | DEFAULT 0 |
| created_at | timestamptz | |
| updated_at | timestamptz | Auto-set by trigger |

**Indexes:** `barcode_id` (btree), `category_id` (btree), `sku` (btree), `description` (GIN full-text)

---

#### `monthly_inventory`

**Purpose:** Monthly cell storage. One row per item per month/year. Core data store for the Flask dashboard.
**Row Count:** 5,147 rows

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| item_id | uuid | NOT NULL, FK → inventory_items |
| month | integer | NOT NULL, CHECK 0–11 **(0-INDEXED: 0=Jan, 11=Dec)** |
| year | integer | NOT NULL |
| on_hand | numeric | DEFAULT 0 |
| w1_received | numeric | DEFAULT 0 |
| w2_received | numeric | DEFAULT 0 |
| w3_received | numeric | DEFAULT 0 |
| w4_received | numeric | DEFAULT 0 |
| w1_issued | numeric | DEFAULT 0 |
| w2_issued | numeric | DEFAULT 0 |
| w3_issued | numeric | DEFAULT 0 |
| w4_issued | numeric | DEFAULT 0 |
| unit_price | numeric | DEFAULT 0 |
| created_at | timestamptz | |
| updated_at | timestamptz | Auto-set by trigger |

**Unique Constraint:** `(item_id, month, year)`

**Ending Quantity Formula:**
```
ending_qty = MAX(0, on_hand + w1_received + w2_received + w3_received + w4_received
                         - w1_issued - w2_issued - w3_issued - w4_issued)
```

**Indexes:** `(year, month)` (btree), `item_id` (btree)

---

#### `monthly_snapshots`

**Row Count:** 76 rows

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| month | integer | NOT NULL, CHECK 0–11 **(0-INDEXED)** |
| year | integer | NOT NULL |
| grand_total | numeric | DEFAULT 0 |
| starting_total | numeric | DEFAULT 0 |
| wk1_total | numeric | DEFAULT 0 |
| wk2_total | numeric | DEFAULT 0 |
| wk3_total | numeric | DEFAULT 0 |
| wk4_total | numeric | DEFAULT 0 |
| category_totals | jsonb | DEFAULT '{}' |
| item_count | integer | DEFAULT 0 |
| reorder_count | integer | DEFAULT 0 |
| preset | boolean | DEFAULT false |
| data | jsonb | |
| saved_at | timestamptz | |
| saved_by | uuid | FK → auth.users |

**Unique Constraint:** `(month, year)`

---

#### `barcodes`

**Purpose:** Denormalized flat-sheet registry. Used by `live_inventory` and `category_summary` views. This is the original "spreadsheet in a table" design.
**Row Count:** 316 rows

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| barcode_id | text | NOT NULL, UNIQUE |
| sku | text | |
| category | text | NOT NULL |
| description | text | NOT NULL |
| unit_price | numeric | DEFAULT 0 |
| par_level | integer | DEFAULT 0 |
| on_hand | numeric | DEFAULT 0 |
| barcode_type | text | DEFAULT 'CODE128', CHECK IN (CODE128, QR, EAN13, UPC) |
| is_active | boolean | DEFAULT true |
| item_ref | text | |
| w1r | numeric | DEFAULT 0 (week 1 received) |
| w2r | numeric | DEFAULT 0 (week 2 received) |
| w3r | numeric | DEFAULT 0 (week 3 received) |
| w4r | numeric | DEFAULT 0 (week 4 received) |
| w1i | numeric | DEFAULT 0 (week 1 issued) |
| w2i | numeric | DEFAULT 0 (week 2 issued) |
| w3i | numeric | DEFAULT 0 (week 3 issued) |
| w4i | numeric | DEFAULT 0 (week 4 issued) |
| created_at | timestamptz | |
| updated_at | timestamptz | Auto-set by trigger |

**Indexes:** `barcode_id` (btree+unique), `category` (btree), `sku` (btree), `description` (GIN full-text)

---

#### `weekly_counts`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| item_id | uuid | FK → inventory_items |
| week_number | integer | NOT NULL (1–4) |
| year | integer | NOT NULL |
| quantity_on_hand | integer | NOT NULL |
| recorded_by | uuid | FK → auth.users |
| recorded_at | timestamptz | |

**Unique Constraint:** `(item_id, week_number, year)`

---

#### `inventory_transactions`

**Purpose:** LEGACY table, distinct from `transaction_history`. Not currently in active use.
**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| item_id | uuid | FK → inventory_items |
| type | text | NOT NULL, CHECK IN (received, issued, adjustment) |
| quantity | integer | NOT NULL — NOT a delta, this is the final quantity |
| unit_price | numeric | |
| transaction_date | timestamptz | |
| notes | text | |
| created_by | uuid | FK → auth.users |
| created_at | timestamptz | |

---

#### `reorder_alerts`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| item_id | uuid | FK → inventory_items |
| threshold | integer | NOT NULL |
| triggered_at | timestamptz | |
| resolved_at | timestamptz | |
| resolved_by | uuid | FK → auth.users |
| notes | text | |

---

### INVOICE & VENDOR TABLES

---

#### `vendors`

**Row Count:** 3

| Column | Type |
|---|---|
| id | uuid PK |
| name | text NOT NULL |
| vendor_code | text |
| address | text |
| city | text |
| state | text |
| zip | text |
| phone | text |
| email | text |
| account_number | text |
| created_at | timestamptz |
| updated_at | timestamptz (trigger) |

---

#### `invoices`

**Row Count:** 5

**MONTH INDEXING WARNING:** `invoices.month` is **1-indexed** (1=Jan, 12=Dec). `monthly_inventory.month` is **0-indexed** (0=Jan, 11=Dec). Never join these two tables on the `month` column directly without converting.

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| vendor_id | uuid | FK → vendors |
| invoice_number | text | NOT NULL |
| account_number | text | |
| order_number | text | |
| purchase_order | text | |
| invoice_date | date | NOT NULL |
| order_date | date | |
| due_date | date | |
| shipped_date | date | |
| payment_terms | text | DEFAULT 'NET 30 DAYS' |
| month | integer | CHECK 1–12 **(1-INDEXED)** |
| year | integer | |
| week_number | integer | CHECK 1–4 |
| subtotal | numeric | DEFAULT 0 |
| discount | numeric | DEFAULT 0 |
| tax | numeric | DEFAULT 0 |
| total | numeric | DEFAULT 0 |
| vizient_discount | numeric | DEFAULT 0 |
| net_total | numeric | DEFAULT 0 |
| driver_name | text | |
| route_number | text | |
| stop_number | text | |
| status | text | DEFAULT 'received', CHECK IN (received, verified, paid, disputed) |
| notes | text | |
| applied_by | uuid | FK → auth.users |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**Indexes:** `invoice_date` (btree), `(year, month)` (btree), `vendor_id` (btree), `status` (btree)

---

#### `invoice_items`

**Row Count:** 36

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| invoice_id | uuid | NOT NULL, FK → invoices |
| sku | text | |
| description | text | |
| category | text | |
| label | text | |
| pack_size | text | |
| unit | text | DEFAULT 'CS' |
| quantity_ordered | numeric | DEFAULT 0 |
| quantity_shipped | numeric | DEFAULT 0 |
| quantity_adjusted | numeric | DEFAULT 0 |
| unit_price | numeric | DEFAULT 0 |
| extended_price | numeric | DEFAULT 0 |
| pricing_unit | text | |
| weight | numeric | |
| lot_numbers | text[] | |
| notes | text | |
| created_at | timestamptz | |

**Indexes:** `invoice_id` (btree), `sku` (btree), `category` (btree), `description` (GIN full-text)

---

### USER & AUTH TABLES

---

#### `user_profiles`

**Purpose:** Application-level user data extending `auth.users`.
**Row Count:** 11

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK — same UUID as auth.users.id |
| username | text | NOT NULL, UNIQUE |
| display_name | text | |
| role | text | NOT NULL, DEFAULT 'staff', CHECK IN (admin, manager, staff, corporate) |
| pin | text | 4-digit PIN, stored as text, used for staff PIN login |
| active | boolean | NOT NULL, DEFAULT true |
| created_at | timestamptz | |
| updated_at | timestamptz | |

**RLS Policies:**
- `users_read_own_profile` — SELECT where id = auth.uid()
- `admin_manage_profiles` — ALL for admin/manager

---

#### `pending_changes`

**Purpose:** Field-level change requests. Staff proposes an edit to a specific field; manager approves or declines. Different from `staging_area` which handles batch quantity changes.
**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| barcode_id | text | NOT NULL |
| field | text | NOT NULL |
| old_value | text | |
| new_value | text | NOT NULL |
| status | text | NOT NULL, DEFAULT 'pending', CHECK IN (pending, approved, declined) |
| note | text | |
| created_by | uuid | FK → auth.users |
| reviewed_by | uuid | FK → auth.users |
| created_at | timestamptz | |
| reviewed_at | timestamptz | |

---

### SUPPORTING TABLES

---

#### `budgets`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| month | integer | CHECK 1–12 **(1-INDEXED)** |
| year | integer | |
| category | text | |
| amount | numeric | |
| notes | text | |

**Unique Constraint:** `(month, year, category)`

---

#### `month_tabs`

**Row Count:** 1

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| label | text | |
| month | integer | CHECK 1–12 **(1-INDEXED)** |
| year | integer | |
| sort_order | integer | |

**Unique Constraint:** `(month, year)`

---

#### `month_tab_items`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| tab_id | uuid | FK → month_tabs |
| barcode_id | text | |
| sku | text | |
| category | text | |
| description | text | |
| unit_price | numeric | |
| par_level | numeric | |
| on_hand | numeric | |
| w1r | numeric | |
| w2r | numeric | |
| w3r | numeric | |
| w4r | numeric | |
| created_at | timestamptz | |

**Unique Constraint:** `(tab_id, barcode_id)`

---

#### `menu_cycles`

**Row Count:** 1

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | |
| start_date | date | |
| end_date | date | |
| active | boolean | |
| created_at | timestamptz | |

---

#### `menu_entries`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| cycle_id | uuid | FK → menu_cycles |
| week_number | integer | CHECK 1–4 |
| day_of_week | text | CHECK IN (Monday, Tuesday, Wednesday, Thursday, Friday, Saturday, Sunday) |
| meal_type | text | CHECK IN (breakfast, lunch, dinner, brunch) |
| items | text | |
| sides | text | |
| is_vegetarian | boolean | |
| sort_order | integer | |

**Unique Constraint:** `(cycle_id, week_number, day_of_week, meal_type)`

---

#### `qr_codes`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| item_id | uuid | FK → inventory_items |
| code | text | |
| code_type | text | CHECK IN (qr, barcode) |
| created_at | timestamptz | |

---

#### `documents`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | |
| type | text | CHECK IN (inventory, menu, report, invoice) |
| format | text | CHECK IN (xlsx, pptx, docx, pdf) |
| file_path | text | |
| generated_by | uuid | FK → auth.users |
| created_at | timestamptz | |

---

#### `email_templates`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| name | text | |
| subject | text | |
| body | text | |
| trigger_type | text | CHECK IN (manual, low_stock, weekly_report) |
| created_at | timestamptz | |
| updated_at | timestamptz | |

---

#### `email_log`

**Row Count:** 0

| Column | Type | Constraints |
|---|---|---|
| id | uuid | PK |
| recipient | text | |
| subject | text | |
| status | text | CHECK IN (pending, sent, failed) |
| sent_at | timestamptz | |
| template_id | uuid | FK → email_templates |
| error_message | text | |
| created_at | timestamptz | |

---

### VIEWS

Do not INSERT or UPDATE through views. They are read-only.

---

#### `dashboard_summary` ⭐ PRIMARY VIEW

**Used by:** Flask `GET /api/inventory/summary` and `GET /api/inventory/items`
**Source:** `monthly_inventory` JOIN `inventory_items` JOIN `inventory_categories`

**Key Computed Columns:**

| Column | Formula |
|---|---|
| `ending_qty` | `MAX(0, on_hand + w1r + w2r + w3r + w4r - w1i - w2i - w3i - w4i)` |
| `item_total` | `ending_qty * unit_price` |
| `w1_value` | `w1_received * unit_price` |
| `w2_value` | `w2_received * unit_price` |
| `w3_value` | `w3_received * unit_price` |
| `w4_value` | `w4_received * unit_price` |
| `needs_reorder` | `(on_hand < par_level AND par_level > 0)` |

---

#### `live_inventory`

**Source:** `barcodes` (active rows only)

**Computed columns:** `total_issued`, `total_received`, `ending_on_hand`, `order_qty`, `inventory_total`, `sub_total`

---

#### `category_summary`

**Source:** `barcodes` grouped by category

**Returns:** `item_count`, `total_on_hand`, `sub_total_value`, `ending_value`, `reorder_count`, `total_to_order`

---

#### `barcodes_view`

**Source:** `barcodes` JOIN `inventory_items` JOIN `inventory_categories`

**Adds:** category color and `item_id` to barcode rows

---

#### `monthly_comparison`

**Source:** `monthly_snapshots` with window functions

**Returns MoM and YoY deltas:** `mom_delta`, `mom_pct`, `yoy_delta`, `yoy_pct`

---

#### `invoice_spending_summary`

**Source:** `invoices` JOIN `vendors`, grouped by period/vendor

---

#### `category_spending`

**Source:** `invoice_items` JOIN `invoices`, grouped by month/category

---

#### `item_price_history`

**Source:** `invoice_items` JOIN `invoices` JOIN `vendors`, ordered by SKU then `invoice_date` DESC

---

### FUNCTIONS & RPCs

---

#### `execute_stage_merge(p_stage_id uuid, p_performed_by uuid) → jsonb`

**Security:** SECURITY DEFINER
**Called by:** `POST /api/v1/spreadsheet/merge/<stage_id>`
**Authorization:** Manager or admin role enforced in Flask before calling this function.

**Execution Steps (all-or-nothing atomic transaction):**
1. `SELECT FOR UPDATE` locks the `staging_area` row
2. Validates `status = 'pending'` — throws exception if not
3. Loops over the `proposed_rows` JSONB array
4. For each row: `SELECT FOR UPDATE` on `inventory_master`, then UPSERT
5. Enforces `quantity >= 0` — throws exception naming the barcode if the delta would go negative
6. Inserts one row to `transaction_history` per item processed
7. Sets `staging_area.status = 'approved'`, sets `reviewed_by` and `reviewed_at`

**Returns:** `{stage_id, applied, skipped}`

**On failure:** Full transaction rollback. Stage remains in `pending` status.

---

#### `block_txn_history_mutation() → trigger`

**Security:** SECURITY DEFINER
**Attached to:** `transaction_history` on BEFORE UPDATE and BEFORE DELETE

**Throws:** `'transaction_history is append-only — UPDATE and DELETE are not permitted'`

Cannot be bypassed by any role, including service_role, without dropping the trigger entirely.

---

#### `touch_updated_at() / update_updated_at() → trigger`

**Security:** SECURITY INVOKER
**Purpose:** Auto-sets `updated_at = NOW()` on UPDATE

**Attached to:** `barcodes`, `inventory_items`, `invoices`, `monthly_inventory`, `vendors`, `email_templates`, `menu_entries`

---

#### `profiles_touch_updated_at() → trigger`

Same as `touch_updated_at()` but specifically for `user_profiles`.

---

#### `mjc_login(p_username, p_pin_hash) → jsonb`

**Status:** Legacy function. References a dropped table (`mjc_users`). Not called anywhere in the codebase. Safe to ignore but do not remove without audit.

---

#### `rls_auto_enable() → event_trigger`

**Purpose:** Automatically enables RLS on any new table created in the public schema. Prevents accidental open tables.

---

### TRIGGERS

| Trigger Name | Table | Event | Function |
|---|---|---|---|
| `trg_barcodes_updated` | barcodes | BEFORE UPDATE | touch_updated_at() |
| `inventory_items_updated_at` | inventory_items | BEFORE UPDATE | update_updated_at() |
| `trg_inv_items_updated` | inventory_items | BEFORE UPDATE | touch_updated_at() |
| `trg_invoices_updated` | invoices | BEFORE UPDATE | touch_updated_at() |
| `email_templates_updated_at` | email_templates | BEFORE UPDATE | update_updated_at() |
| `menu_entries_updated_at` | menu_entries | BEFORE UPDATE | update_updated_at() |
| `trg_monthly_inv_updated` | monthly_inventory | BEFORE UPDATE | touch_updated_at() |
| `trg_vendors_updated` | vendors | BEFORE UPDATE | touch_updated_at() |
| `txn_history_no_update` | transaction_history | BEFORE UPDATE | block_txn_history_mutation() |
| `txn_history_no_delete` | transaction_history | BEFORE DELETE | block_txn_history_mutation() |

**Note:** `inventory_items` has TWO `updated_at` triggers (`inventory_items_updated_at` and `trg_inv_items_updated`). This is a harmless duplicate from migration history. Both fire on UPDATE but produce the same result.

---

### KEY INDEXES

| Table | Indexed Columns | Type |
|---|---|---|
| barcodes | barcode_id | btree + unique |
| barcodes | category | btree |
| barcodes | sku | btree |
| barcodes | description | GIN full-text |
| inventory_items | barcode_id | btree |
| inventory_items | category_id | btree |
| inventory_items | sku | btree |
| inventory_items | description | GIN full-text |
| inventory_items | on_hand | btree |
| invoice_items | invoice_id | btree |
| invoice_items | sku | btree |
| invoice_items | category | btree |
| invoice_items | description | GIN full-text |
| invoices | invoice_date | btree |
| invoices | (year, month) | btree |
| invoices | vendor_id | btree |
| invoices | status | btree |
| monthly_inventory | (year, month) | btree |
| monthly_inventory | item_id | btree |
| monthly_snapshots | (year, month) | btree |
| inventory_master | (center_id, barcode) | unique |

**Missing indexes to add before production analytics go live:**
- `transaction_history(center_id, created_at)`
- `staging_area(center_id, status)`

---

### FOREIGN KEY MAP

```
auth.users
  → user_profiles.id (1:1 relationship)
  → monthly_snapshots.saved_by
  → staging_area.submitted_by
  → staging_area.reviewed_by
  → transaction_history.performed_by
  → inventory_transactions.created_by
  → weekly_counts.recorded_by
  → pending_changes.created_by
  → pending_changes.reviewed_by
  → reorder_alerts.resolved_by
  → documents.generated_by
  → invoices.applied_by

centers
  → inventory_master.center_id
  → staging_area.center_id
  → transaction_history.center_id

staging_area
  → transaction_history.stage_id (set for action=merge only)

inventory_categories
  → inventory_items.category_id

vendors
  → inventory_items.vendor_id
  → invoices.vendor_id

inventory_items
  → monthly_inventory.item_id
  → inventory_transactions.item_id
  → weekly_counts.item_id
  → reorder_alerts.item_id
  → qr_codes.item_id

invoices
  → invoice_items.invoice_id

email_templates
  → email_log.template_id

month_tabs
  → month_tab_items.tab_id
```

---

### KNOWN ISSUES

| # | Issue | Severity | Notes |
|---|---|---|---|
| 1 | Duplicate triggers on `inventory_items` | LOW | Harmless but wasteful. Both `inventory_items_updated_at` and `trg_inv_items_updated` fire on UPDATE. |
| 2 | Month indexing inconsistency | MEDIUM | `invoices.month` is 1-indexed; `monthly_inventory.month` is 0-indexed. Documented above. Never join directly. |
| 3 | `mjc_login` references dropped table | LOW | Not called anywhere. Safe to ignore. |
| 4 | Legacy tables RLS is open | MEDIUM | Any authenticated user can write to legacy tables. Acceptable for single-tenant. Tighten if expanding to multi-center. |
| 5 | `inventory_items.on_hand` and `barcodes.on_hand` may diverge | MEDIUM | Ground truth is `inventory_master.quantity`. Legacy `on_hand` fields are not authoritative. |
| 6 | No indexes on `transaction_history` beyond PK | LOW | Add `(center_id, created_at)` before analytics go live. |
| 7 | `pending_changes` and `month_tabs` RLS reads `raw_user_meta_data` | MEDIUM | Inconsistent with engine tables which read `user_profiles`. Should be unified to use `user_profiles` for all RLS. |

---

## Section 7 — Azure Deployment

### Platform Summary

| Component | Value |
|---|---|
| Platform | Azure App Service (Linux, Docker) |
| Database | Supabase (external managed, connected via HTTPS) |
| CI/CD | GitHub Actions |
| Container Image Base | python:3.12-slim |
| WSGI Server | Gunicorn (4 workers) |

### Azure Resources

| Resource | Name | Details |
|---|---|---|
| Resource Group | mjcc-rg | Location: westus2 |
| Container Registry | mjccacr | mjccacr.azurecr.io, Basic SKU, admin enabled |
| App Service Plan | mjcc-plan | Linux, B2 recommended |
| App Service | mjcc-api | Docker container deployment |
| Key Vault | mjcc-vault | Optional, recommended for production secrets |

### App Service Plan Tiers

| Tier | Cost | Specs | Recommended Use |
|---|---|---|---|
| B1 | ~$13/mo | 1 vCPU, 1.75GB RAM | Development |
| B2 | ~$26/mo | 2 vCPU, 3.5GB RAM | Production (recommended) |
| P1v3 | ~$75/mo | 2 vCPU, 8GB RAM | High traffic, auto-scale |

### Region Selection

**westus2** is the closest Azure region to Supabase **us-west-1** (AWS Oregon). Expected latency between App Service and Supabase: 5–20ms.

---

### One-Time Setup CLI Commands

```bash
az login

az group create --name mjcc-rg --location westus2

az acr create \
  --resource-group mjcc-rg \
  --name mjccacr \
  --sku Basic \
  --admin-enabled true

az appservice plan create \
  --name mjcc-plan \
  --resource-group mjcc-rg \
  --is-linux \
  --sku B2

az webapp create \
  --resource-group mjcc-rg \
  --plan mjcc-plan \
  --name mjcc-api \
  --deployment-container-image-name mjccacr.azurecr.io/mjcc-app:latest
```

### Grant App Service Pull Access to ACR

```bash
PRINCIPAL_ID=$(az webapp identity assign \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --query principalId \
  --output tsv)

ACR_ID=$(az acr show --name mjccacr --query id --output tsv)

az role assignment create \
  --assignee $PRINCIPAL_ID \
  --scope $ACR_ID \
  --role AcrPull
```

---

### Environment Variables

Set as Azure App Settings. Do NOT include in the Docker image or `.env` file.

| Variable | Required | Value / Notes |
|---|---|---|
| `FLASK_ENV` | Required | `production` |
| `SECRET_KEY` | Required | Generate: `python -c "import secrets; print(secrets.token_hex(32))"` |
| `SUPABASE_URL` | Required | Your Supabase project URL |
| `SUPABASE_ANON_KEY` | Required | Supabase anon/public key |
| `SUPABASE_SERVICE_KEY` | Required | Supabase service role key |
| `CORS_ORIGINS` | Required | Your Azure domain e.g. `https://mjcc-api.azurewebsites.net` |
| `WEBSITES_PORT` | Required | `5000` — CRITICAL: Azure needs this to route to the container |
| `AI_PROVIDER` | Optional | `ollama` (default) or `groq` |
| `GROQ_API_KEY` | Optional | Required if `AI_PROVIDER=groq` |
| `GROQ_MODEL` | Optional | Groq model name |
| `AI_MODEL` | Optional | Model override |
| `RATELIMIT_DEFAULT` | Optional | e.g. `100/hour` |
| `REDIS_URL` | Optional | Required for distributed rate limiting with multiple instances |
| `LOG_LEVEL` | Optional | e.g. `INFO` or `DEBUG` |

**CORS:** Change from `*` to the actual domain in production.

**`SESSION_COOKIE_SECURE`** is automatically set to `true` when `FLASK_ENV=production`.

### Enforce HTTPS

```bash
az webapp update \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --https-only true
```

---

### GitHub Actions CI/CD Workflow

**File:** `.github/workflows/deploy.yml`
**Trigger:** Push to `main` branch

**Steps:**
1. Checkout code
2. Setup Docker Buildx
3. Login to Azure Container Registry
4. Docker build and push (tagged with `latest` + git SHA)
5. Azure login
6. Deploy to App Service (`webapps-deploy`)

**Required GitHub Secrets:**

| Secret | Source |
|---|---|
| `ACR_USERNAME` | ACR admin username |
| `ACR_PASSWORD` | ACR admin password |
| `AZURE_CREDENTIALS` | Service principal JSON (see below) |

**Generate `AZURE_CREDENTIALS`:**

```bash
az ad sp create-for-rbac \
  --name "mjcc-github-deploy" \
  --role contributor \
  --scopes /subscriptions/SUBID/resourceGroups/mjcc-rg \
  --sdk-auth
```

---

### Scaling

**Vertical (upgrade plan tier):**
```bash
az appservice plan update --sku P1v3
```

**Horizontal (multiple instances):**
```bash
az webapp scale --number-of-workers 2
```
Note: Requires `REDIS_URL` for distributed rate limiting when running multiple instances.

**Auto-scale:** Available on P-tier plans only.

---

### Rollback

Each image is tagged with the git SHA at build time.

```bash
az webapp config container set \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --docker-custom-image-name mjccacr.azurecr.io/mjcc-app:<PREVIOUS_SHA>
```

---

### Logs

```bash
az webapp log tail --resource-group mjcc-rg --name mjcc-api
```

---

### Health Check

Built into the Dockerfile: `curl localhost:5000/` every 30 seconds.

Also configure in Azure Portal: App Service → Health check → Path: `/`

---

### Outbound IPs (for Supabase allow-list)

```bash
az webapp show \
  --resource-group mjcc-rg \
  --name mjcc-api \
  --query outboundIpAddresses
```

---

### Deployment Checklist

#### Pre-Deploy (one-time)

- [ ] `.env` is gitignored
- [ ] Secrets are in App Settings, not in the image
- [ ] Fresh `SECRET_KEY` generated
- [ ] `FLASK_ENV=production`
- [ ] `WEBSITES_PORT=5000`
- [ ] `CORS_ORIGINS` locked to actual domain
- [ ] `SESSION_COOKIE_SECURE=true` (auto when `FLASK_ENV=production`)
- [ ] Docker build runs cleanly
- [ ] Health check responds at `/`
- [ ] GitHub secrets configured (`ACR_USERNAME`, `ACR_PASSWORD`, `AZURE_CREDENTIALS`)
- [ ] HTTPS-only enforced

#### Every Deploy (automated via GitHub Actions)

- [ ] `pytest` passes
- [ ] `ruff check .` passes
- [ ] Push to `main` triggers Actions workflow
- [ ] SHA-tagged image appears in ACR
- [ ] App Service updated to new image

#### Post-Deploy (manual verification)

- [ ] Login page loads
- [ ] Staff PIN login works
- [ ] Admin password login works
- [ ] Dashboard data loads correctly
- [ ] Check logs for errors

---

## Section 8 — Change Log

| Date | Version | Changes |
|---|---|---|
| 2026-05-25 | — | Added engine plane tables (`centers`, `inventory_master`, `staging_area`, `transaction_history`), `execute_stage_merge` RPC, `block_txn_history_mutation` trigger, `corporate` role, Azure deployment documentation. Consolidated DATABASE_REFERENCE, API_REFERENCE, and DEPLOYMENT docs into STRUCTURE.md + API.md. |
| 2026-05-23 | v1.0.4 | Created `structure/` folder. Refactored `ai_parser.py` for Gemini+Groq dual provider. Removed `architect/` directory. Added `groq` to requirements. Updated `.env`. Added `.gitignore`. Added versioning rules. Added `pytest` + `tests/`. Added `ruff` + `pyproject.toml`. Added Prettier + npm scripts. Updated `STACK.md` and `RULES.md`. Fixed missing groq dependency. Created `run.sh`. Updated `npm start`. Replaced Gemini with OllamaFreeAPI. Made Groq client lazy-initialized. Removed image parsing. Fixed `DevelopmentConfig` `FLASK_DEBUG`. Fixed `run.sh` server-ready wait. Added `DIARY.md` logging rule. |
