# MJCC API Foundation Refactor — Migration Notes

## Overview

This refactor standardizes the MJCC backend on the `inventory_items` + `monthly_inventory` model as the single source of truth, introduces a git-style staff→manager staging pipeline, adds month lifecycle management (open → published), centralizes RBAC, and hardens the API for frontend consumption.

## What Was Consolidated

| Old Table(s)          | New Table             | Action                                                             |
| --------------------- | --------------------- | ------------------------------------------------------------------ |
| `inventory_master`    | —                     | Renamed to `inventory_master_deprecated`                           |
| `barcodes`            | `item_barcodes`       | Renamed to `barcodes_deprecated`; data migrated to `item_barcodes` |
| `staging_area`        | `pending_submissions` | Renamed to `staging_area_deprecated`                               |
| `pending_changes`     | `pending_submissions` | Renamed to `pending_changes_deprecated`                            |
| `transaction_history` | `audit_log`           | Renamed to `transaction_history_deprecated`                        |

**New tables created:**

- `item_barcodes` — canonical barcode mapping (one primary barcode per active item)
- `audit_log` — append-only audit trail for all inventory mutations
- `month_status` — month lifecycle tracking (open → published)
- `pending_submissions` — staff push → manager review/commit pipeline

## Deprecated Tables (renamed, NOT dropped)

All deprecated tables are renamed with `_deprecated` suffix. They still exist with their data. After the cutover period, they can be dropped once all systems are confirmed working:

- `inventory_master_deprecated`
- `barcodes_deprecated`
- `staging_area_deprecated`
- `pending_changes_deprecated`
- `transaction_history_deprecated`

Backup tables are created as `*_backup_20260528` before any data migration.

## Migration Order (Cutover)

### Phase 1: Apply Schema Migrations

Run migrations in this order:

1. `20260528_schema_consolidation.sql` — backup, item_barcodes, audit_log, deprecate old tables
2. `20260528_month_lifecycle.sql` — month_status, pending_submissions, publish/commit RPCs
3. `20260528_barcode_backfill.sql` — generate barcodes for items without one
4. **(Deploy new backend code here)**
5. `20260528_rls_lockdown.sql` — drop permissive policies, lock to service_role

### Phase 2: Deploy Backend

- Deploy the refactored Flask API
- Verify all endpoints work with service_role client
- Test the staging pipeline: staff submit → manager approve → data appears in monthly_inventory
- Test publish: open month → publish → month becomes read-only → next month opens with rollover
- Test barcode: each active item has exactly one barcode; regeneration creates a new one

### Phase 3: Lock Down

- Run `20260528_rls_lockdown.sql` last
- Verify that direct anon/authenticated access to inventory tables is denied
- Verify the app still works through Flask (which uses service_role)

## Key Backend Changes

### New Files

- `backend/rbac.py` — centralized RBAC with bcrypt PIN support
- `backend/response.py` — consistent API response envelope

### Modified Files

- `backend/supabase_client.py` — always uses service_role key
- `backend/config.py` — production SECRET_KEY must be set (no fallback)
- `backend/auth_middleware.py` — thin re-export wrapper around rbac.py
- `backend/validation.py` — new schemas for staging, publish, item CRUD
- `backend/routes/auth.py` — bcrypt PIN verification, consistent envelope
- `backend/routes/inventory.py` — 28 endpoints with full staging/publish workflow
- `backend/routes/users.py` — consistent RBAC, service_role, bcrypt PIN hashing
- `backend/main.py` — config hardening
- `backend/requirements.txt` — added bcrypt

## Data Integrity Notes

- **Historical data is immutable.** Past months (with snapshots) are marked `published` and all write endpoints reject edits to them.
- **Only the current open month is writable.** Staff pushes are validated against the open month.
- **Barcode generation is deterministic** based on SKU or item UUID. Re-running the backfill creates no duplicates.
- **UNIQUE constraint on `(item_id, month, year)`** in `monthly_inventory` ensures no duplicate rows per item per month.
- **UNIQUE constraint on `barcode`** in `item_barcodes` ensures no duplicate barcodes.
- **Partial unique index on `item_barcodes`** ensures only one primary barcode per active item.

## API Response Envelope

All endpoints now return a consistent envelope:

```json
{
  "data": <response_data>,
  "error": null,
  "meta": { "page": 1, "per_page": 50, "total": 100, ... }
}
```

Error responses:

```json
{
  "data": null,
  "error": "Error message",
  "errors": { "field": "validation error" }
}
```

## Role-Based Access Control

| Role          | Permissions                                                                                   |
| ------------- | --------------------------------------------------------------------------------------------- |
| **staff**     | Submit weekly counts to pending queue, read own data, read current month                      |
| **manager**   | Review/approve/reject pending submissions, edit item catalog, publish months, create versions |
| **admin**     | Everything manager can + user management                                                      |
| **corporate** | Read-only across all data                                                                     |
