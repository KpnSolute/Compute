# MJCC Inventory System — API Reference (v1)

**Base URL:** `/api/v1`
**Format:** JSON request/response unless noted (file upload/download are multipart/binary)
**Auth:** Bearer token (JWT from Supabase) or Flask session cookie
**Last updated:** 2026-05-25

> This document covers the **v1 engine routes only.**
> For legacy routes (`/api/auth`, `/api/users`, `/api/inventory`) see `API_DOCUMENTATION.md`.
> For the database schema these routes read/write, see `structure/DATABASE_REFERENCE.md`.

---

## Implementation Status Key

| Badge | Meaning |
|---|---|
| `[LIVE]` | Route is built and running |
| `[PLANNED]` | Spec-defined, not yet built — contract is locked |
| `[IMPLIED]` | Not in spec but logically required for the pipeline to work |

---

## Table of Contents

1. [Authentication](#1-authentication)
2. [Common Response Formats](#2-common-response-formats)
3. [Role Requirements Summary](#3-role-requirements-summary)
4. [Spreadsheet Pipeline](#4-spreadsheet-pipeline)
   - [Upload XLSX → Staging](#41-post-apiv1spreadsheetupload--planned)
   - [Preview Stage Diff](#42-get-apiv1stagingstage_id--implied)
   - [Merge Stage → Inventory](#43-post-apiv1spreadsheetmergestage_id--planned)
   - [Reject Stage](#44-patch-apiv1stagingstage_id--implied)
   - [List Staging Batches](#45-get-apiv1staging--implied)
   - [Download Inventory as XLSX](#46-get-apiv1spreadsheetdownloadcenter_id--planned)
5. [Scanner Pipeline](#5-scanner-pipeline)
   - [Record a Scan](#51-post-apiv1scannerscan--planned)
6. [Analytics Pipeline](#6-analytics-pipeline)
   - [Timeline Query](#61-get-apiv1analyticstimeline--planned)
7. [Inventory Master (Read)](#7-inventory-master-read)
   - [List Items](#71-get-apiv1inventory--implied)
8. [Error Reference](#8-error-reference)
9. [Rate Limiting](#9-rate-limiting)
10. [Implementation Checklist](#10-implementation-checklist)

---

## 1. Authentication

### How It Works

Every v1 route resolves the caller through `backend/auth_middleware.py → resolve_user()`.

Two auth paths are supported:

**Path A — Flask Session (browser users)**
- Set automatically by `POST /api/auth/login` (legacy)
- Cookie `session` is sent with every request
- No extra header needed

**Path B — Bearer Token (API clients, scanners)**
- Admin/manager login returns `access_token` in the login response
- Pass on every request:
  ```
  Authorization: Bearer <access_token>
  ```
- The middleware validates the JWT against Supabase Auth, then looks up the `user_profiles` row

**Staff (PIN-only users)** cannot use Bearer token auth. They authenticate via the session login flow. If you are building a scanner device for staff, it must maintain a session cookie.

### What `resolve_user()` Returns

```json
{
  "id":           "uuid",
  "username":     "string",
  "display_name": "string",
  "role":         "admin | manager | staff | corporate",
  "access_token": "string (only present when auth was via Bearer)"
}
```

If neither a valid session nor a valid Bearer token is found, the route returns `401`.

---

## 2. Common Response Formats

### Success

```json
{ ...payload fields... }
```
HTTP status varies by route (200, 201).

### Validation Error (400)

```json
{
  "errors": {
    "field_name": "error message"
  }
}
```

### Auth Error (401)

```json
{ "error": "Not authenticated" }
```

### Permission Error (403)

```json
{ "error": "Insufficient role" }
```

### Not Found (404)

```json
{ "error": "Not found" }
```

### Server Error (500)

```json
{ "error": "Internal server error" }
```
For merge failures, the full transaction is rolled back before this is returned. No partial state is ever written.

---

## 3. Role Requirements Summary

| Route | staff | manager | admin | corporate |
|---|---|---|---|---|
| `POST /api/v1/spreadsheet/upload` | ✓ | ✓ | ✓ | — |
| `GET /api/v1/staging` | own only | ✓ | ✓ | ✓ (read) |
| `GET /api/v1/staging/<id>` | own only | ✓ | ✓ | ✓ (read) |
| `POST /api/v1/spreadsheet/merge/<id>` | — | ✓ | ✓ | — |
| `PATCH /api/v1/staging/<id>` (reject) | — | ✓ | ✓ | — |
| `GET /api/v1/spreadsheet/download/<center_id>` | — | ✓ | ✓ | ✓ |
| `POST /api/v1/scanner/scan` | ✓ | ✓ | ✓ | — |
| `GET /api/v1/analytics/timeline` | — | ✓ | ✓ | ✓ |
| `GET /api/v1/inventory` | ✓ | ✓ | ✓ | ✓ |

---

## 4. Spreadsheet Pipeline

The full lifecycle of an XLSX batch:

```
Upload → [staging_area: pending]
           │
    Manager previews diff
           │
    ┌──────┴──────┐
  Merge         Reject
    │               │
[inventory_master  [staging_area: rejected]
  updated]
[transaction_history
  appended]
[staging_area: approved]
```

---

### 4.1 `POST /api/v1/spreadsheet/upload` — `[PLANNED]`

**Purpose:** Ingest an `.xlsx` file. Parse it into a structured JSON array and save it to `staging_area` as a `pending` batch.

**Auth:** Any authenticated user (staff, manager, admin)
**Content-Type:** `multipart/form-data`

#### Request Fields

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | file | YES | The `.xlsx` file. Must have columns: `barcode`, `quantity`, `item_name` |
| `center_id` | string (uuid) | NO | Defaults to `'00000000-0000-0000-0000-000000000001'` (MJCC) |
| `source` | string | NO | `xlsx_upload`, `manual`, `scanner_batch`. Default: `xlsx_upload` |
| `notes` | string | NO | Optional description of this batch |

#### Expected XLSX Column Format

The parser expects these column headers (case-insensitive):

| Column | Type | Required | Notes |
|---|---|---|---|
| `barcode` | string | YES | Must match a barcode in `inventory_master` |
| `quantity` | number | YES | Positive = receive, negative = issue |
| `item_name` | string | NO | Used when inserting new items |

Unknown columns are ignored. Rows with missing `barcode` or non-numeric `quantity` are skipped and counted in `skipped`.

#### Response `201 Created`

```json
{
  "stage_id":     "uuid",
  "center_id":    "uuid",
  "status":       "pending",
  "row_count":    42,
  "skipped":      2,
  "submitted_by": "uuid",
  "created_at":   "2026-05-25T14:00:00Z"
}
```

#### Errors

| Code | Condition |
|---|---|
| 400 | No file attached, wrong MIME type, or unreadable XLSX |
| 400 | Zero valid rows parsed |
| 401 | Not authenticated |
| 500 | Database insert failed |

#### Implementation Notes

- Use `pandas.read_excel()` + `openpyxl` engine to parse.
- Do NOT immediately apply quantities to `inventory_master`. The entire point of staging is manager review.
- Store parsed rows as JSONB in `staging_area.proposed_rows`:
  ```json
  [
    { "barcode": "10075500", "quantity": 12, "item_name": "Chicken Breast 40lb" },
    { "barcode": "10083200", "quantity": -3, "item_name": "Milk 1gal" }
  ]
  ```
- Set `submitted_by = auth.uid()` from the resolved user.

---

### 4.2 `GET /api/v1/staging/<stage_id>` — `[IMPLIED]`

**Purpose:** Fetch a single staging batch and compute the **diff** — what the inventory would look like if this stage were merged.

**Auth:** manager, admin (full access); staff (own batches only)

#### Response `200 OK`

```json
{
  "id":            "uuid",
  "center_id":     "uuid",
  "status":        "pending",
  "source":        "xlsx_upload",
  "notes":         "Week 2 US Foods delivery",
  "submitted_by":  "uuid",
  "created_at":    "2026-05-25T14:00:00Z",
  "row_count":     42,
  "diff": [
    {
      "barcode":        "10075500",
      "item_name":      "Chicken Breast 40lb",
      "current_qty":    24,
      "proposed_change": 12,
      "resulting_qty":  36,
      "is_new_item":    false,
      "would_go_negative": false
    },
    {
      "barcode":        "NEWITEM001",
      "item_name":      "Turkey Burger 10lb",
      "current_qty":    null,
      "proposed_change": 5,
      "resulting_qty":  5,
      "is_new_item":    true,
      "would_go_negative": false
    }
  ],
  "warnings": [
    "2 rows skipped during upload (missing barcode or invalid quantity)"
  ]
}
```

**Diff calculation logic:**
1. Fetch `proposed_rows` from `staging_area`
2. Query `inventory_master` for all barcodes in `proposed_rows`
3. For each row: `resulting_qty = current_qty + proposed_change`
4. Flag `would_go_negative = true` if `resulting_qty < 0`
5. Flag `is_new_item = true` if barcode not found in `inventory_master`

#### Errors

| Code | Condition |
|---|---|
| 401 | Not authenticated |
| 403 | Staff trying to view another user's stage |
| 404 | Stage not found |

---

### 4.3 `POST /api/v1/spreadsheet/merge/<stage_id>` — `[PLANNED]`

**Purpose:** Approve and execute a staging batch. Atomically updates `inventory_master`, logs every change to `transaction_history`, and closes the stage.

**Auth:** manager or admin only
**Content-Type:** `application/json` (body optional)

#### Request Body (optional)

```json
{
  "notes": "Approved after physical count verification"
}
```

#### How It Works

This route calls the `execute_stage_merge(stage_id, user_id)` PostgreSQL RPC. Everything happens inside a single database transaction. If any row would violate `quantity >= 0`, the entire transaction rolls back and the stage remains `pending`.

See `DATABASE_REFERENCE.md § 9.1` for the exact RPC logic.

#### Response `200 OK`

```json
{
  "stage_id":   "uuid",
  "applied":    42,
  "skipped":    0,
  "status":     "approved",
  "reviewed_by": "uuid",
  "reviewed_at": "2026-05-25T14:32:00Z"
}
```

#### Errors

| Code | Condition |
|---|---|
| 400 | Stage is not in `pending` status (already approved or rejected) |
| 401 | Not authenticated |
| 403 | Role is `staff` or `corporate` |
| 404 | Stage not found |
| 500 | A quantity would go below zero — full rollback. Error message will name the offending barcode. |
| 500 | Any other DB failure — full rollback |

#### Error body on negative-quantity violation

```json
{
  "error": "Barcode 10083200 quantity would go below zero (current: 3, delta: -5)"
}
```

---

### 4.4 `PATCH /api/v1/staging/<stage_id>` — `[IMPLIED]`

**Purpose:** Reject a pending stage without merging it.

**Auth:** manager or admin only
**Content-Type:** `application/json`

#### Request Body

```json
{
  "notes": "Quantities don't match the delivery receipt"
}
```

#### Response `200 OK`

```json
{
  "stage_id":    "uuid",
  "status":      "rejected",
  "reviewed_by": "uuid",
  "reviewed_at": "2026-05-25T14:10:00Z",
  "notes":       "Quantities don't match the delivery receipt"
}
```

#### Errors

| Code | Condition |
|---|---|
| 400 | Stage is not `pending` |
| 401 | Not authenticated |
| 403 | Insufficient role |
| 404 | Stage not found |

---

### 4.5 `GET /api/v1/staging` — `[IMPLIED]`

**Purpose:** List staging batches. Staff see their own; managers/admins see all for the center.

**Auth:** All authenticated users

#### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `status` | string | — | Filter: `pending`, `approved`, `rejected` |
| `center_id` | uuid | MJCC default | Target center |
| `page` | int | 1 | Pagination page |
| `per_page` | int | 20 | Max 100 |

#### Response `200 OK`

```json
{
  "items": [
    {
      "id":           "uuid",
      "center_id":    "uuid",
      "status":       "pending",
      "source":       "xlsx_upload",
      "row_count":    42,
      "submitted_by": "uuid",
      "created_at":   "2026-05-25T14:00:00Z",
      "reviewed_at":  null
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total_count": 3,
    "total_pages": 1,
    "has_next": false,
    "has_prev": false
  }
}
```

---

### 4.6 `GET /api/v1/spreadsheet/download/<center_id>` — `[PLANNED]`

**Purpose:** Export the current `inventory_master` state for a center as a downloadable `.xlsx` file, built in memory.

**Auth:** manager, admin, corporate

#### Path Parameter

| Param | Description |
|---|---|
| `center_id` | UUID of the center. Use `00000000-0000-0000-0000-000000000001` for MJCC. |

#### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `active_only` | bool | `true` | If `true`, exclude rows where `active = false` |
| `category` | string | — | Filter to a single category |

#### Response `200 OK`

**Content-Type:** `application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`
**Content-Disposition:** `attachment; filename="MJCC_inventory_2026-05-25.xlsx"`

Binary `.xlsx` file stream. The file is constructed in memory using `pandas` + `openpyxl` — never written to disk.

#### XLSX Column Layout

| Column | Source |
|---|---|
| Barcode | `inventory_master.barcode` |
| Item Name | `inventory_master.item_name` |
| SKU | `inventory_master.sku` |
| Category | `inventory_master.category` |
| Unit | `inventory_master.unit` |
| Unit Price | `inventory_master.unit_price` |
| Par Level | `inventory_master.par_level` |
| Quantity On Hand | `inventory_master.quantity` |
| Active | `inventory_master.active` |
| Last Updated | `inventory_master.updated_at` |

#### Errors

| Code | Condition |
|---|---|
| 401 | Not authenticated |
| 403 | Role is `staff` |
| 404 | Center not found |
| 500 | File generation failed |

#### Implementation Notes

```python
# Skeleton
import io
import pandas as pd
from flask import send_file

df = pd.DataFrame(rows)
buf = io.BytesIO()
df.to_excel(buf, index=False, engine='openpyxl')
buf.seek(0)
return send_file(buf, mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                 as_attachment=True, download_name=f'MJCC_inventory_{date}.xlsx')
```

---

## 5. Scanner Pipeline

The scanner route is designed for real-time hardware (barcode scanners, tablets on the floor). It **bypasses staging** and writes directly to `inventory_master`.

**Latency constraint:** This route must respond in under 200ms. Do not call AI parsing, XLSX libraries, or any external HTTP service inside this handler.

---

### 5.1 `POST /api/v1/scanner/scan` — `[PLANNED]`

**Purpose:** Record a single scan event. Immediately updates `inventory_master.quantity` and appends one row to `transaction_history`.

**Auth:** Any authenticated user (staff, manager, admin)
**Content-Type:** `application/json`

#### Request Body

```json
{
  "barcode":   "10075500",
  "action":    "in",
  "quantity":  6,
  "center_id": "00000000-0000-0000-0000-000000000001"
}
```

| Field | Type | Required | Description |
|---|---|---|---|
| `barcode` | string | YES | Must match a barcode in `inventory_master` |
| `action` | string | YES | `"in"` (receive) or `"out"` (issue) |
| `quantity` | number | YES | Positive integer. The direction is set by `action`. |
| `center_id` | uuid | NO | Defaults to MJCC center |

**Note:** `quantity` is always positive. The `action` field determines the sign. The backend computes `delta = +quantity` for `in` and `delta = -quantity` for `out`.

#### Response `200 OK`

```json
{
  "barcode":        "10075500",
  "item_name":      "Chicken Breast 40lb",
  "action":         "in",
  "quantity_change": 6,
  "quantity_before": 24,
  "quantity_after":  30,
  "transaction_id": "uuid",
  "timestamp":      "2026-05-25T14:45:00Z"
}
```

#### Errors

| Code | Condition |
|---|---|
| 400 | Missing or invalid `barcode`, `action`, or `quantity` |
| 400 | `action` is `"out"` and `quantity` would drop stock below 0 |
| 401 | Not authenticated |
| 404 | Barcode not found in `inventory_master` for this center |
| 500 | DB write failed |

#### Error body on negative-quantity violation

```json
{
  "error": "Cannot issue 6 units of barcode 10075500 — only 3 in stock"
}
```

#### Database Operations (in this exact order)

```sql
-- 1. Lock and fetch current quantity
SELECT quantity FROM inventory_master
WHERE center_id = $center_id AND barcode = $barcode
FOR UPDATE;

-- 2. Validate the resulting quantity
-- If action='out' and (quantity - delta) < 0: return 400

-- 3. Update inventory_master
UPDATE inventory_master
SET quantity = quantity + $delta, updated_at = now()
WHERE center_id = $center_id AND barcode = $barcode;

-- 4. Append to transaction_history
INSERT INTO transaction_history
  (center_id, barcode, item_name, action, quantity_change, quantity_after, performed_by)
VALUES
  ($center_id, $barcode, $item_name, $txn_action, $delta, $new_qty, $user_id);
```

Where `$txn_action` maps:
- `action = 'in'` → `transaction_history.action = 'scan_in'`
- `action = 'out'` → `transaction_history.action = 'scan_out'`

---

## 6. Analytics Pipeline

### 6.1 `GET /api/v1/analytics/timeline` — `[PLANNED]`

**Purpose:** Aggregate transaction history into a time-series chart payload. **All aggregation happens in PostgreSQL using `DATE_TRUNC()`. Row-level data is never pulled into Python memory.**

**Auth:** manager, admin, corporate

#### Query Parameters

| Param | Type | Required | Description |
|---|---|---|---|
| `period` | string | YES | `day`, `week`, or `month` |
| `center_id` | uuid | NO | Defaults to MJCC center |
| `start_date` | date | NO | ISO 8601. Default: 30 days ago |
| `end_date` | date | NO | ISO 8601. Default: today |
| `action` | string | NO | Filter: `scan_in`, `scan_out`, `merge`, `adjustment`, `rollover` |
| `barcode` | string | NO | Filter to a single item |

#### Response `200 OK`

```json
{
  "period":     "week",
  "center_id":  "uuid",
  "start_date": "2026-04-01",
  "end_date":   "2026-05-25",
  "series": [
    {
      "period_start": "2026-04-07T00:00:00Z",
      "total_in":     142.0,
      "total_out":    -87.0,
      "net_change":   55.0,
      "transaction_count": 18
    },
    {
      "period_start": "2026-04-14T00:00:00Z",
      "total_in":     210.0,
      "total_out":    -95.0,
      "net_change":   115.0,
      "transaction_count": 24
    }
  ]
}
```

`total_in` = sum of positive `quantity_change` values in the period
`total_out` = sum of negative `quantity_change` values in the period (reported as negative)
`net_change` = `total_in + total_out`

#### SQL Pattern (must use this — do not pull rows into Python)

```sql
SELECT
  DATE_TRUNC($period, created_at) AS period_start,
  SUM(CASE WHEN quantity_change > 0 THEN quantity_change ELSE 0 END) AS total_in,
  SUM(CASE WHEN quantity_change < 0 THEN quantity_change ELSE 0 END) AS total_out,
  SUM(quantity_change) AS net_change,
  COUNT(*) AS transaction_count
FROM transaction_history
WHERE center_id = $center_id
  AND created_at BETWEEN $start_date AND $end_date
  [AND action = $action]     -- optional filter
  [AND barcode = $barcode]   -- optional filter
GROUP BY DATE_TRUNC($period, created_at)
ORDER BY period_start ASC;
```

#### Errors

| Code | Condition |
|---|---|
| 400 | Invalid `period` value |
| 400 | `start_date` after `end_date` |
| 401 | Not authenticated |
| 403 | Role is `staff` |

---

## 7. Inventory Master (Read)

### 7.1 `GET /api/v1/inventory` — `[IMPLIED]`

**Purpose:** List items from `inventory_master` with optional filtering and pagination. This is the v1 replacement for `GET /api/inventory/items`.

**Auth:** Any authenticated user

#### Query Parameters

| Param | Type | Default | Description |
|---|---|---|---|
| `center_id` | uuid | MJCC default | Target center |
| `category` | string | — | Filter by category |
| `active_only` | bool | `true` | Exclude inactive items |
| `low_stock` | bool | `false` | If `true`, return only items where `quantity < par_level` |
| `search` | string | — | Text search on `item_name` or `barcode` |
| `page` | int | 1 | |
| `per_page` | int | 50 | Max 100 |

#### Response `200 OK`

```json
{
  "items": [
    {
      "id":         "uuid",
      "barcode":    "10075500",
      "item_name":  "Chicken Breast 40lb",
      "sku":        "SRF-CHK-40",
      "category":   "Meat & Poultry",
      "unit":       "CS",
      "unit_price": 48.50,
      "par_level":  10,
      "quantity":   24,
      "active":     true,
      "updated_at": "2026-05-24T09:12:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total_count": 316,
    "total_pages": 7,
    "has_next": true,
    "has_prev": false
  }
}
```

---

## 8. Error Reference

### HTTP Status Codes

| Code | Meaning | When it Occurs |
|---|---|---|
| `200` | OK | Successful read or update |
| `201` | Created | Successful resource creation (upload, new item) |
| `400` | Bad Request | Missing required field, invalid type, business rule violation (negative stock) |
| `401` | Unauthorized | No session, missing/expired Bearer token |
| `403` | Forbidden | Valid auth but role is insufficient for this operation |
| `404` | Not Found | Resource (stage, barcode, center) does not exist |
| `500` | Server Error | Unhandled exception, DB failure, merge rollback |

### Business Rule Errors (400)

These are expected, recoverable errors — not server bugs. Always check the `error` field text.

| Scenario | Example error |
|---|---|
| Scan-out would go negative | `"Cannot issue 6 units of barcode 10075500 — only 3 in stock"` |
| Merge would go negative | `"Barcode 10083200 quantity would go below zero (current: 3, delta: -5)"` |
| Stage not pending | `"Stage abc123 is not pending (current status: approved)"` |
| Invalid action field | `"action must be 'in' or 'out'"` |
| XLSX has no valid rows | `"No valid rows could be parsed from the uploaded file"` |

---

## 9. Rate Limiting

Inherited from the Flask app config:

| Setting | Default | Env Variable |
|---|---|---|
| General limit | `100 per hour` per IP | `RATELIMIT_DEFAULT` |
| Storage backend | In-memory | `REDIS_URL` (set to Redis URL in production) |

**Scanner route exception:** The scanner endpoint (`POST /api/v1/scanner/scan`) should be exempt from or have a higher rate limit (e.g. `1000 per hour`) since it is called by hardware on a tight loop. Configure this in `main.py` using `@limiter.limit("1000/hour")` on that specific route.

---

## 10. Implementation Checklist

Use this when building out the v1 blueprint. Suggested file: `backend/routes/v1/`.

```
backend/
  routes/
    v1/
      __init__.py          ← register all blueprints, prefix /api/v1
      spreadsheet.py       ← upload, merge, download routes
      scanner.py           ← scan route
      analytics.py         ← timeline route
      staging.py           ← list, get, patch (reject) staging routes
      inventory.py         ← read-only inventory_master routes
```

### Dependencies to add to `requirements.txt`

```
pandas>=2.2.0
openpyxl>=3.1.0
```

### Route Registration Order

```python
# backend/main.py additions
from backend.routes.v1 import v1_bp
app.register_blueprint(v1_bp)   # prefix /api/v1 set in v1/__init__.py
```

### Status Tracker

| Route | File | Status |
|---|---|---|
| `POST /api/v1/spreadsheet/upload` | `spreadsheet.py` | Not started |
| `GET /api/v1/staging` | `staging.py` | Not started |
| `GET /api/v1/staging/<id>` | `staging.py` | Not started |
| `POST /api/v1/spreadsheet/merge/<id>` | `spreadsheet.py` | RPC ready, route not built |
| `PATCH /api/v1/staging/<id>` | `staging.py` | Not started |
| `GET /api/v1/spreadsheet/download/<center_id>` | `spreadsheet.py` | Not started |
| `POST /api/v1/scanner/scan` | `scanner.py` | Not started |
| `GET /api/v1/analytics/timeline` | `analytics.py` | Not started |
| `GET /api/v1/inventory` | `inventory.py` | Not started |
