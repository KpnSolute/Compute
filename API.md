# MJCC Inventory Management System — API Reference

**Version:** v1.0.4
**Last Updated:** 2026-05-25
**Audience:** IT developers and AI agents

**Status Badges:**
- `[LIVE]` — Built and running in the current Flask application
- `[PLANNED]` — Spec-defined, not yet built
- `[IMPLIED]` — Logically required, not yet built

---

## Section 1 — Authentication

### Middleware: `resolve_user()`

**File:** `backend/auth_middleware.py`

`resolve_user()` handles two parallel authentication paths. Every protected route calls this function.

---

### Path A — Flask Session (Browser Users)

Set by `POST /api/auth/login`. The session cookie is sent automatically by the browser on subsequent requests. No extra headers required.

---

### Path B — Bearer Token (API Clients, Scanners)

```
Header: Authorization: Bearer <access_token>
```

Admin and manager logins return an `access_token` in the response body. The middleware validates the JWT against Supabase Auth, then looks up the corresponding `user_profiles` row.

**Important:** Staff (PIN-only) cannot use Bearer token authentication. Staff must use session-based login. Scanner devices operated by staff must maintain session cookies.

---

### `resolve_user()` Return Value

```json
{
  "id": "uuid",
  "username": "string",
  "display_name": "string",
  "role": "admin | manager | staff | corporate",
  "access_token": "string (only present when Bearer auth was used)"
}
```

---

## Section 2 — Common Response Formats

### Success

HTTP 200 or 201 with JSON payload.

### Error Formats

| HTTP Status | Body Format | Meaning |
|---|---|---|
| 400 | `{"errors": {"field_name": "message"}}` | Validation error, invalid field, or business rule violation |
| 401 | `{"error": "Not authenticated"}` | No session, missing or expired token |
| 403 | `{"error": "Insufficient role"}` | Valid auth but role does not permit this action |
| 404 | `{"error": "Not found"}` | Resource not found |
| 500 | `{"error": "Internal server error"}` | Unhandled exception, DB failure, or merge rollback |

### HTTP Status Code Reference

| Code | Meaning |
|---|---|
| 200 | Successful read or update |
| 201 | Resource created |
| 400 | Bad request, invalid field, or business rule violation (e.g. negative stock) |
| 401 | No session or missing/expired token |
| 403 | Valid auth but insufficient role |
| 404 | Resource not found |
| 500 | Unhandled exception, DB failure, or merge rollback (fully rolled back before returning) |

### Business Rule 400 Errors

These are expected responses, not bugs. They indicate the request was valid but violated a business constraint.

| Scenario | Error Message |
|---|---|
| Scan-out results in negative stock | `"Cannot issue 6 units of barcode 10075500 — only 3 in stock"` |
| Merge delta results in negative stock | `"Barcode 10083200 quantity would go below zero (current: 3, delta: -5)"` |
| Merge attempted on non-pending stage | `"Stage abc123 is not pending (current status: approved)"` |

### Rate Limiting

- Default: 100 requests/hour per IP (configurable via `RATELIMIT_DEFAULT` env var)
- Scanner endpoint should be exempt or set to 1000/hour separately
- In production with multiple App Service instances, set `REDIS_URL` for distributed rate limiting

### Security Headers

Added by Flask to all responses:

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
X-XSS-Protection: 1; mode=block
Strict-Transport-Security: (production only)
```

---

## Section 3 — Legacy Routes (LIVE)

These routes are built, running, and powering the current Flask dashboard.

**Base paths:** `/api/auth`, `/api/users`, `/api/inventory`

---

### AUTH ROUTES — `/api/auth`

---

#### `POST /api/auth/login` `[LIVE]`

**Auth required:** None

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| username | string | Yes | |
| type | string | Yes | `"staff"` or `"admin"` |
| pin | string | Staff only | 4-digit PIN |
| password | string | Admin/Manager only | Account password |

**Staff Flow:**
- PIN compared against `user_profiles.pin`
- Sets Flask session cookie
- No JWT issued

**Admin/Manager Flow:**
- Calls Supabase `sign_in_with_password` with `{username}@mjc-cafeteria.com`
- Sets Flask session cookie
- Returns `access_token` in response

**Response 200:**
```json
{
  "ok": true,
  "user": {
    "username": "string",
    "display_name": "string",
    "role": "string"
  },
  "access_token": "string (admin/manager only)"
}
```

**Errors:**
- `400` — Missing required fields
- `401` — Wrong credentials
- `403` — Account disabled

---

#### `GET /api/auth/me` `[LIVE]`

**Auth required:** Session

**Response 200:**
```json
{
  "authenticated": true,
  "user": {
    "username": "string",
    "display_name": "string",
    "role": "string"
  }
}
```

**Response 401:**
```json
{"authenticated": false}
```

---

#### `POST /api/auth/logout` `[LIVE]`

**Auth required:** Session

Clears the Flask session.

**Response 200:**
```json
{"ok": true}
```

---

### USER MANAGEMENT ROUTES — `/api/users`

---

#### `GET /api/users` `[LIVE]`

**Auth required:** admin or manager

Returns all user profiles ordered by `created_at`.

**Response 200:**
```json
[
  {
    "id": "uuid",
    "username": "string",
    "display_name": "string",
    "role": "string",
    "active": true,
    "created_at": "timestamptz"
  }
]
```

---

#### `POST /api/users` `[LIVE]`

**Auth required:** admin only

Creates a Supabase Auth user, then inserts a `user_profiles` row.

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| email | string | Yes | |
| password | string | Yes | |
| username | string | Yes | |
| display_name | string | No | |
| role | string | No | `admin`, `manager`, `staff` |
| pin | string | No | 4-digit PIN for staff |

**Response 201:**
```json
{
  "id": "uuid",
  "username": "string",
  "display_name": "string",
  "role": "string",
  "pin": "string",
  "active": true
}
```

**Errors:**
- `400` — Missing required fields
- `400` — Invalid role value
- `400` — Supabase Auth failure

---

#### `PATCH /api/users/<user_id>` `[LIVE]`

**Auth required:** admin only

Updates a user profile. Only the following fields are allowed in the body.

**Request Body (any subset):**

| Field | Type |
|---|---|
| display_name | string |
| role | string |
| active | boolean |
| pin | string |

**Response 200:** Updated `user_profiles` row

**Errors:**
- `400` — No valid fields provided
- `400` — Invalid role value
- `404` — User not found

---

### INVENTORY ROUTES — `/api/inventory` `[LIVE]`

All routes require authentication (any role). Price and par level updates require admin or manager.

---

#### `GET /api/inventory/summary` `[LIVE]`

**Auth required:** Any authenticated user

**Query Parameters:**

| Param | Type | Required | Notes |
|---|---|---|---|
| month | int | Yes | 0-indexed (0=Jan, 11=Dec) |
| year | int | Yes | |

Fetches `dashboard_summary` view for the given month/year. Fetches the prior month snapshot for `starting_total`. Runs `calculators.dashboard_summary()`.

**Response 200:**
```json
{
  "grand_total": 0.00,
  "starting_total": 0.00,
  "wk1_total": 0.00,
  "wk2_total": 0.00,
  "wk3_total": 0.00,
  "wk4_total": 0.00,
  "total_items": 0,
  "reorder_count": 0,
  "category_breakdown": {},
  "reorder_alerts": [],
  "data_source": "LIVE_SUPABASE"
}
```

---

#### `GET /api/inventory/items` `[LIVE]`

**Auth required:** Any authenticated user

**Query Parameters:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| month | int | Yes | — | 0-indexed |
| year | int | Yes | — | |
| category | string | No | — | Filter by category name |
| page | int | No | 1 | |
| per_page | int | No | 50 | Max 100 |

Returns paginated rows from the `dashboard_summary` view.

**Response 200:**
```json
{
  "items": [],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total_count": 0,
    "total_pages": 0,
    "has_next": false,
    "has_prev": false
  }
}
```

---

#### `PATCH /api/inventory/items/<item_id>` `[LIVE]`

**Auth required:** Any authenticated user (price/par restricted to admin/manager)

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| field | string | Yes | See valid fields below |
| value | number | Yes | |
| month | int | Yes | 0-indexed |
| year | int | Yes | |

**Valid field values:**

| Field | Target Table | Role Required |
|---|---|---|
| `onHand` / `on_hand` | monthly_inventory | Any |
| `w1i` / `w1_issued` | monthly_inventory | Any |
| `w2i` / `w2_issued` | monthly_inventory | Any |
| `w3i` / `w3_issued` | monthly_inventory | Any |
| `w4i` / `w4_issued` | monthly_inventory | Any |
| `w1r` / `w1_received` | monthly_inventory | Any |
| `w2r` / `w2_received` | monthly_inventory | Any |
| `w3r` / `w3_received` | monthly_inventory | Any |
| `w4r` / `w4_received` | monthly_inventory | Any |
| `price` | inventory_items | admin/manager |
| `par` / `par_level` | inventory_items | admin/manager |

**Response 200:**
```json
{
  "item_total": 0.00,
  "ending_qty": 0
}
```

---

#### `POST /api/inventory/save-snapshot` `[LIVE]`

**Auth required:** Any authenticated user

**Request Body:**

| Field | Type | Required |
|---|---|---|
| month | int | Yes (0-indexed) |
| year | int | Yes |

Calculates totals from `dashboard_summary`, upserts to `monthly_snapshots`.

**Response 200:**
```json
{
  "month": 0,
  "year": 2026,
  "grand_total": 0.00,
  "starting_total": 0.00,
  "wk1_total": 0.00,
  "wk2_total": 0.00,
  "wk3_total": 0.00,
  "wk4_total": 0.00,
  "saved_by": null
}
```

---

#### `POST /api/inventory/rollover` `[LIVE]`

**Auth required:** admin or manager

**Request Body:**

| Field | Type | Required |
|---|---|---|
| from_month | int | Yes (0-indexed) |
| from_year | int | Yes |

Saves a snapshot for `from_month`, then creates `monthly_inventory` rows for the next month with `on_hand = ending_qty`. All weekly fields (`w1r`, `w2r`, etc.) are reset to 0.

**Response 200:**
```json
{
  "next_month": 1,
  "next_year": 2026,
  "starting_total": 0.00
}
```

---

#### `GET /api/inventory/history` `[LIVE]`

**Auth required:** Any authenticated user

Returns all `monthly_snapshots` ordered by year DESC, month DESC.

**Response 200:**
```json
[
  {
    "month": 0,
    "year": 2026,
    "grand_total": 0.00,
    "starting_total": 0.00,
    "wk1_total": 0.00,
    "wk2_total": 0.00,
    "wk3_total": 0.00,
    "wk4_total": 0.00,
    "saved_by": null
  }
]
```

---

#### `GET /api/inventory/categories` `[LIVE]`

**Auth required:** Any authenticated user

Returns all `inventory_categories` with item counts.

**Response 200:**
```json
[
  {
    "id": "uuid",
    "name": "string",
    "display_name": "string",
    "color": "#888888",
    "inventory_items": {"count": 0}
  }
]
```

---

#### `POST /api/inventory/parse-invoice` `[LIVE]`

**Auth required:** admin or manager

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| text | string | Yes | Raw invoice text |
| month | int | Yes | 0-indexed |
| year | int | Yes | |

Calls `ai_parser.parse_invoice_text(catalog_items, invoice_text)` using OllamaFreeAPI (default) or Groq (if `AI_PROVIDER=groq`).

**Response 200:**
```json
{
  "matches": [
    {
      "itemId": "string",
      "matchedDesc": "string",
      "qty": 0,
      "unitPrice": 0.00
    }
  ]
}
```

---

#### `POST /api/inventory/apply-invoice` `[LIVE]`

**Auth required:** admin or manager

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| matches | array | Yes | Array of match objects |
| week_field | string | Yes | `"w1r"`, `"w2r"`, `"w3r"`, or `"w4r"` |
| month | int | Yes | 0-indexed |
| year | int | Yes | |

**Match object:**
```json
{
  "itemId": "string",
  "qty": 0
}
```

Applies parsed invoice quantities to `monthly_inventory`. Skips items where `itemId` is `null`, `"NEW"`, or `qty <= 0`.

**Response 200:**
```json
{
  "applied": [
    {"item_id": "string", "qty": 0, "field": "w1r"}
  ],
  "skipped": []
}
```

---

### PAGE ROUTES (HTML)

| Route | Description | Auth |
|---|---|---|
| `GET /` | Login page. Redirects to `/dashboard` if session is active. | None |
| `GET /dashboard` | Staff or admin dashboard (role-based HTML file). | Session |
| `GET /inventory_dashboard.html` | Inventory dashboard page. | Session |
| `GET /static/<path>` | Frontend static files. | None |

---

## Section 4 — V1 Engine Routes

**Base path:** `/api/v1`

These routes implement the engine plane (Living Spreadsheet architecture) and are not yet built unless otherwise noted.

### Role Matrix for V1 Routes

| Route | staff | manager | admin | corporate |
|---|---|---|---|---|
| `POST /api/v1/spreadsheet/upload` | Yes | Yes | Yes | No |
| `GET /api/v1/staging` | Own batches only | Yes | Yes | Read-only |
| `GET /api/v1/staging/<id>` | Own batches only | Yes | Yes | Read-only |
| `POST /api/v1/spreadsheet/merge/<id>` | No | Yes | Yes | No |
| `PATCH /api/v1/staging/<id>` | No | Yes | Yes | No |
| `GET /api/v1/spreadsheet/download/<center_id>` | No | Yes | Yes | Yes |
| `POST /api/v1/scanner/scan` | Yes | Yes | Yes | No |
| `GET /api/v1/analytics/timeline` | No | Yes | Yes | Yes |
| `GET /api/v1/inventory` | Yes | Yes | Yes | Yes |

---

### SPREADSHEET PIPELINE

---

#### `POST /api/v1/spreadsheet/upload` `[PLANNED]`

**Content-Type:** `multipart/form-data`
**Auth required:** Any authenticated user

**Form Fields:**

| Field | Type | Required | Notes |
|---|---|---|---|
| file | file | Yes | `.xlsx` files only |
| center_id | uuid | No | Defaults to MJCC: `00000000-0000-0000-0000-000000000001` |
| source | string | No | `xlsx_upload`, `manual`, or `scanner_batch` |
| notes | string | No | Optional description |

**XLSX Required Columns (case-insensitive):**

| Column | Required | Notes |
|---|---|---|
| barcode | Yes | |
| quantity | Yes | Positive = receive, Negative = issue |
| item_name | No | Optional |

**Behavior:**
- Parse XLSX with `pandas.read_excel()` + `openpyxl`
- Store as `proposed_rows` JSONB in `staging_area` with `status=pending`
- **Do NOT apply to `inventory_master`** — staging only, no side effects

**Response 201:**
```json
{
  "stage_id": "uuid",
  "center_id": "uuid",
  "status": "pending",
  "row_count": 0,
  "skipped": 0,
  "submitted_by": "uuid",
  "created_at": "timestamptz"
}
```

**Errors:**
- `400` — No file provided, wrong file type, or unreadable file
- `400` — Zero valid rows parsed after processing
- `401` — Not authenticated
- `500` — DB insert failed

---

#### `GET /api/v1/staging` `[IMPLIED]`

**Auth required:** Any authenticated user (staff see own batches only; managers see all)

**Query Parameters:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| status | string | No | — | `pending`, `approved`, or `rejected` |
| center_id | uuid | No | — | Filter by center |
| page | int | No | 1 | |
| per_page | int | No | 20 | Max 100 |

**Response 200:**
```json
{
  "items": [
    {
      "id": "uuid",
      "center_id": "uuid",
      "status": "pending",
      "source": "xlsx_upload",
      "row_count": 0,
      "submitted_by": "uuid",
      "created_at": "timestamptz",
      "reviewed_at": null
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total_count": 0,
    "total_pages": 0,
    "has_next": false,
    "has_prev": false
  }
}
```

---

#### `GET /api/v1/staging/<stage_id>` `[IMPLIED]`

**Auth required:** Manager/admin full access; staff can only view own batches

Returns stage metadata plus a computed diff of current quantities versus proposed quantities.

**Diff Logic:**
1. Fetch `proposed_rows` from `staging_area`
2. Query `inventory_master` for matching barcodes
3. Compute `resulting_qty = current_qty + proposed_change`
4. Flag any rows that would go negative
5. Flag any rows for items not yet in `inventory_master` (new items)

**Response 200:**
```json
{
  "id": "uuid",
  "center_id": "uuid",
  "status": "pending",
  "source": "xlsx_upload",
  "notes": "string",
  "submitted_by": "uuid",
  "created_at": "timestamptz",
  "row_count": 0,
  "diff": [
    {
      "barcode": "string",
      "item_name": "string",
      "current_qty": 0,
      "proposed_change": 0,
      "resulting_qty": 0,
      "is_new_item": false,
      "would_go_negative": false
    }
  ],
  "warnings": ["N rows skipped during upload..."]
}
```

**Errors:**
- `401` — Not authenticated
- `403` — Staff attempting to view another user's batch
- `404` — Stage not found

---

#### `POST /api/v1/spreadsheet/merge/<stage_id>` `[PLANNED]`

**Auth required:** manager or admin only
**Content-Type:** `application/json` (body optional)

**Request Body (optional):**
```json
{"notes": "string"}
```

**Behavior:**
- Calls `execute_stage_merge(stage_id, user_id)` PostgreSQL RPC
- All-or-nothing transaction: if any row would go below zero, the entire operation rolls back
- Stage remains in `pending` status on rollback
- Error response names the specific barcode that caused the failure

**Response 200:**
```json
{
  "stage_id": "uuid",
  "applied": 0,
  "skipped": 0,
  "status": "approved",
  "reviewed_by": "uuid",
  "reviewed_at": "timestamptz"
}
```

**Errors:**
- `400` — Stage is not in `pending` status
- `401` — Not authenticated
- `403` — Insufficient role (staff or corporate)
- `404` — Stage not found
- `500` — Quantity violation (message includes the offending barcode)
- `500` — Any other DB failure (full rollback guaranteed)

---

#### `PATCH /api/v1/staging/<stage_id>` `[IMPLIED]`

**Auth required:** manager or admin only

**Request Body:**
```json
{"notes": "string"}
```

Sets `status=rejected`, records `reviewed_by` and `reviewed_at`.

**Response 200:**
```json
{
  "stage_id": "uuid",
  "status": "rejected",
  "reviewed_by": "uuid",
  "reviewed_at": "timestamptz",
  "notes": "string"
}
```

**Errors:**
- `400` — Stage is not in `pending` status
- `401` — Not authenticated
- `403` — Insufficient role
- `404` — Stage not found

---

#### `GET /api/v1/spreadsheet/download/<center_id>` `[PLANNED]`

**Auth required:** manager, admin, or corporate (staff NOT permitted)

**Path Parameter:**

| Param | Notes |
|---|---|
| center_id | Use `00000000-0000-0000-0000-000000000001` for MJCC |

**Query Parameters:**

| Param | Type | Default | Notes |
|---|---|---|---|
| active_only | boolean | true | Filter to active items only |
| category | string | — | Filter by category |

**Response:** Binary `.xlsx` file stream

```
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="MJCC_inventory_YYYY-MM-DD.xlsx"
```

**XLSX Columns:**

| Column |
|---|
| Barcode |
| Item Name |
| SKU |
| Category |
| Unit |
| Unit Price |
| Par Level |
| Quantity On Hand |
| Active |
| Last Updated |

**Implementation Note:** File is built in memory with pandas + openpyxl. Never written to disk.

```python
buf = io.BytesIO()
df.to_excel(buf, index=False, engine='openpyxl')
buf.seek(0)
return send_file(
    buf,
    mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    as_attachment=True,
    download_name=f'MJCC_inventory_{date.today()}.xlsx'
)
```

**Errors:**
- `401` — Not authenticated
- `403` — Staff attempting access
- `404` — Center not found
- `500` — File generation failure

---

### SCANNER PIPELINE

---

#### `POST /api/v1/scanner/scan` `[PLANNED]`

**LATENCY CONSTRAINT:** Must respond in under 200ms. No AI calls, no XLSX libraries, and no external HTTP calls inside this handler.

**Auth required:** Any authenticated user (not corporate)
**Content-Type:** `application/json`

**Request Body:**

| Field | Type | Required | Notes |
|---|---|---|---|
| barcode | string | Yes | |
| action | string | Yes | `"in"` or `"out"` |
| quantity | number | Yes | Always positive — direction set by `action` field |
| center_id | uuid | No | Defaults to MJCC: `00000000-0000-0000-0000-000000000001` |

**Direction Logic:**
- `action="in"` → `delta = +quantity` (receiving stock)
- `action="out"` → `delta = -quantity` (issuing stock)

**DB Operations (executed in this order):**
1. `SELECT quantity FROM inventory_master WHERE center_id=$c AND barcode=$b FOR UPDATE`
2. Validate: if `action=out` and `current_qty + delta < 0` → return 400
3. `UPDATE inventory_master SET quantity = quantity + delta, updated_at = now()`
4. `INSERT INTO transaction_history (center_id, barcode, item_name, action, quantity_change, quantity_after, performed_by)`
   - `action` column value: `scan_in` or `scan_out`

**Response 200:**
```json
{
  "barcode": "string",
  "item_name": "string",
  "action": "in",
  "quantity_change": 0,
  "quantity_before": 0,
  "quantity_after": 0,
  "transaction_id": "uuid",
  "timestamp": "timestamptz"
}
```

**Error 400 (negative stock):**
```json
{"error": "Cannot issue 6 units of barcode 10075500 — only 3 in stock"}
```

**All Errors:**
- `400` — Missing or invalid fields
- `400` — Would result in negative stock (message names the barcode)
- `401` — Not authenticated
- `404` — Barcode not found in `inventory_master` for this center
- `500` — DB failure

---

### ANALYTICS PIPELINE

---

#### `GET /api/v1/analytics/timeline` `[PLANNED]`

**Auth required:** manager, admin, or corporate (staff NOT permitted)

**CONSTRAINT:** All aggregation must happen in PostgreSQL using `DATE_TRUNC()`. Never pull raw rows into Python for aggregation.

**Query Parameters:**

| Param | Type | Required | Default | Notes |
|---|---|---|---|---|
| period | string | Yes | — | `day`, `week`, or `month` |
| center_id | uuid | No | MJCC | |
| start_date | string | No | 30 days ago | ISO 8601 format |
| end_date | string | No | today | ISO 8601 format |
| action | string | No | — | Filter: `scan_in`, `scan_out`, `merge`, `adjustment`, `rollover` |
| barcode | string | No | — | Filter to a single barcode |

**Required SQL Pattern (must use this exact pattern):**
```sql
SELECT
  DATE_TRUNC($period, created_at) AS period_start,
  SUM(CASE WHEN quantity_change > 0 THEN quantity_change ELSE 0 END) AS total_in,
  SUM(CASE WHEN quantity_change < 0 THEN quantity_change ELSE 0 END) AS total_out,
  SUM(quantity_change) AS net_change,
  COUNT(*) AS transaction_count
FROM transaction_history
WHERE
  center_id = $c
  AND created_at BETWEEN $start AND $end
  [AND action = $a]
  [AND barcode = $b]
GROUP BY DATE_TRUNC($period, created_at)
ORDER BY period_start ASC
```

**Response 200:**
```json
{
  "period": "month",
  "center_id": "uuid",
  "start_date": "2026-04-25",
  "end_date": "2026-05-25",
  "series": [
    {
      "period_start": "2026-05-01T00:00:00Z",
      "total_in": 150,
      "total_out": -75,
      "net_change": 75,
      "transaction_count": 12
    }
  ]
}
```

**Note:** `total_out` values are negative (they represent the sum of negative `quantity_change` values from `transaction_history`).

**Errors:**
- `400` — Invalid period value (not `day`, `week`, or `month`)
- `400` — `start_date` is after `end_date`
- `401` — Not authenticated
- `403` — Staff attempting access

---

### INVENTORY MASTER READ

---

#### `GET /api/v1/inventory` `[IMPLIED]`

**Auth required:** Any authenticated user

**Query Parameters:**

| Param | Type | Default | Notes |
|---|---|---|---|
| center_id | uuid | MJCC | |
| category | string | — | Filter by category |
| active_only | boolean | true | Filter to active items only |
| low_stock | boolean | false | Returns only items where `quantity < par_level` |
| search | string | — | Full-text search on `item_name` or `barcode` |
| page | int | 1 | |
| per_page | int | 50 | Max 100 |

**Response 200:**
```json
{
  "items": [
    {
      "id": "uuid",
      "barcode": "string",
      "item_name": "string",
      "sku": "string",
      "category": "string",
      "unit": "CS",
      "unit_price": 0.00,
      "par_level": 0,
      "quantity": 0,
      "active": true,
      "updated_at": "timestamptz"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 50,
    "total_count": 0,
    "total_pages": 0,
    "has_next": false,
    "has_prev": false
  }
}
```

---

## Section 5 — Implementation Guide for V1 Routes

### Suggested File Structure

```
backend/
  routes/
    v1/
      __init__.py       — Register all v1 blueprints, prefix /api/v1
      spreadsheet.py    — upload, merge, download routes
      scanner.py        — scan route
      analytics.py      — timeline route
      staging.py        — list, get, patch routes
      inventory.py      — read-only inventory_master routes
```

### Dependencies to Add to `requirements.txt`

```
pandas>=2.2.0
openpyxl>=3.1.0
```

### Register Blueprint in `backend/main.py`

```python
from backend.routes.v1 import v1_bp
app.register_blueprint(v1_bp)
```

---

### Build Status

| Route | File | Status |
|---|---|---|
| `POST /api/v1/spreadsheet/upload` | `spreadsheet.py` | Not started |
| `GET /api/v1/staging` | `staging.py` | Not started |
| `GET /api/v1/staging/<id>` | `staging.py` | Not started |
| `POST /api/v1/spreadsheet/merge/<id>` | `spreadsheet.py` | RPC ready in DB, route not built |
| `PATCH /api/v1/staging/<id>` | `staging.py` | Not started |
| `GET /api/v1/spreadsheet/download/<center_id>` | `spreadsheet.py` | Not started |
| `POST /api/v1/scanner/scan` | `scanner.py` | Not started |
| `GET /api/v1/analytics/timeline` | `analytics.py` | Not started |
| `GET /api/v1/inventory` | `inventory.py` | Not started |

**Note:** The `execute_stage_merge()` PostgreSQL RPC that backs the merge route is fully deployed and tested in the database. Building the Flask route is the only remaining step for that endpoint.
