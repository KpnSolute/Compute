# MJCC API Reference

**Local:** `http://localhost:8000`  
**Production:** `https://mjcc-managements.onrender.com`  
**Auth header:** `Authorization: Bearer <token>` (all endpoints except `POST /api/auth/login`)  
**Content-Type:** `application/json` (except file upload which uses `multipart/form-data`)

---

## Data Model Clarifications

### `on_hand` vs ending balance
- `on_hand` in `monthly_inventory` is the **opening balance** for the period — the count carried forward from the prior month's rollover.
- **Ending balance (current stock)** = `on_hand + sum(w_received) − sum(w_issued)`. The rollover function uses this formula to seed the next month's opening balance.
- `GET /api/inventory` returns `onHand` (opening balance). The frontend computes the running total from the week columns.

### Par level is global
- `par_level` lives in `inventory_items` and is **shared across all periods**.
- Changing par from any month's edit affects all months' display.
- Par changes must go through `dispatch_item_update` (operation `item_update`), not `dispatch_inventory_save`.

### Month indexing
- **DB stores months 0-indexed** (0 = January, 11 = December) in `monthly_inventory`.
- **API accepts and returns 1-indexed** (1 = January, 12 = December).
- Conversion: `db_month = api_month − 1`.

### Month status states
- `open` — editable; writes accepted.
- `published` — read-only after rollover. Writes to published periods return `403`.

### Staging dedup
- `POST /api/staging` deduplicates by `(entity_id, field_name, submitted_by, status=pending)`. If a matching pending entry exists for the same submitter it is **updated in-place** rather than inserting a duplicate.

### Staging entity_id convention (v2.6.0)
| Operation | `entity_id` format |
|---|---|
| `inventory_save` | `{sku}-{month_1indexed}-{year}` |
| `inventory_week_update` | `W{week}-{received\|issued}-{month}-{year}` |
| batch compact | `batch-compact-{month}-{year}` |
| `item_update` / `item_delete` | `{sku}` |
| `menu_save` | `{day_of_week}` |
| `event_create` | event title slug or UUID |
| `haccp_save` / `daily_log_save` | ISO timestamp or compound key |

---

## Authentication — `/api/auth`

### `POST /api/auth/login`
Two login modes. No auth header required.

**JWT mode (admin/manager):**
```json
{ "access_token": "<supabase_jwt>" }
```

**PIN mode (staff only):**
```json
{ "username": "jdoe", "pin": "1234" }
```

**Response `200`:**
```json
{
  "access_token": "string",
  "user": {
    "id": "uuid",
    "username": "string",
    "display_name": "string",
    "last_name": "string",
    "role": "admin | manager | staff",
    "active": true,
    "email": "string (JWT mode only — absent in PIN response)"
  }
}
```
- PIN mode token is `pin_<user_id>` (a pseudo-token, not a signed JWT).
- PIN login is restricted to `role = staff`; attempting PIN login as admin/manager returns `401`.

**Errors:**
- `400` — neither `access_token` nor `username+pin` provided.
- `401` — invalid/expired token, unknown credentials, inactive account, or non-staff attempting PIN login.

---

### `GET /api/auth/me`
Returns current user from the bearer token. Accepts both JWT and `pin_` tokens.

**Response `200`:**
```json
{
  "id": "uuid",
  "username": "string",
  "display_name": "string",
  "last_name": "string",
  "role": "admin | manager | staff",
  "active": true
}
```
**`401`** — missing, invalid, or expired token.

---

### `POST /api/auth/logout`
Signals session end. Requires `Authorization: Bearer <token>` header. Frontend must discard the token.

**Response `200`:** `{ "message": "Successfully logged out" }`  
**`400`** — no token provided in header.

---

## Users — `/api/users`
> All endpoints require **admin** role JWT token.

### `GET /api/users`
| Query Param | Type | Default | Description |
|---|---|---|---|
| `active_only` | bool | false | Return only active users |

**Response `200`:**
```json
{
  "count": 13,
  "users": [
    {
      "id": "uuid",
      "username": "string",
      "email": "string",
      "display_name": "string",
      "last_name": "string",
      "role": "admin | manager | staff",
      "active": true,
      "created_at": "ISO 8601",
      "updated_at": "ISO 8601"
    }
  ]
}
```

---

### `GET /api/users/{user_id}`
**Response `200`:** Single user object (same shape as above).  
**`404`** if not found.

---

### `POST /api/users`
**Body:**
```json
{
  "username": "string (3–50 chars, required)",
  "email": "valid email (required)",
  "display_name": "string (required)",
  "last_name": "string (optional)",
  "role": "admin | manager | staff (default: staff)",
  "pin": "numeric string (optional, staff login)"
}
```
> `user_profiles` has **no `password` column**. Auth is Supabase Auth (JWT) for admin/manager; PIN for staff. Never send `password` to this endpoint.

**Response `201`:** Created user object.  
**`400`** if username or email already exists.

---

### `PUT /api/users/{user_id}`
All fields optional. Only provided fields are updated.

**Body:**
```json
{
  "display_name": "string",
  "last_name": "string",
  "role": "admin | manager | staff",
  "pin": "numeric string",
  "active": true
}
```
**Response `200`:** Updated user object.

---

### `DELETE /api/users/{user_id}`
Soft-delete — sets `active = false`. Does not remove the record.  
**Response `204`** No content.  
**`400`** if trying to disable your own account.

---

## Inventory — `/api/inventory`

### `GET /api/inventory`
Auth: any valid token (JWT or `pin_`).

| Query Param | Type | Default | Description |
|---|---|---|---|
| `month` | int | latest | Calendar month, 1-indexed (1–12) |
| `year` | int | latest | 4-digit year |

If neither `month` nor `year` is provided, returns the most recent period in the DB.

**Response `200`:**
```json
{
  "id": "2026-06",
  "items": [
    {
      "sku": "string",
      "desc": "string",
      "category": "string",
      "price": 0.00,
      "par": 0,
      "onHand": 0,
      "unit": "each",
      "w1r": 0, "w2r": 0, "w3r": 0, "w4r": 0,
      "w1i": 0, "w2i": 0, "w3i": 0, "w4i": 0
    }
  ],
  "metadata": { "month": 6, "year": 2026, "period": "2026-06" },
  "notes": "string",
  "created_at": "ISO 8601"
}
```
- `onHand` = opening balance (DB `on_hand`). Ending balance = `onHand + sum(w_r) − sum(w_i)`.
- Items sorted by SKU ascending.

**Errors:** `400` bad month, `401` auth, `404` no inventory, `500` DB error.

---

### `POST /api/inventory`
Auth: any valid token. Save a full inventory batch. Upserts `inventory_items` by SKU and `monthly_inventory` by `item_id+month+year`.

**Body:**
```json
{
  "items": [
    {
      "sku": "string (required)",
      "desc": "string (required)",
      "category": "Dry Goods",
      "price": 1.50,
      "par": 10,
      "onHand": 8,
      "unit": "each",
      "w1r": 0, "w2r": 0, "w3r": 0, "w4r": 0,
      "w1i": 0, "w2i": 0, "w3i": 0, "w4i": 0
    }
  ],
  "metadata": { "month": 6, "year": 2026 },
  "notes": "string (optional)"
}
```
- `metadata.month` and `metadata.year` supply the period (1-indexed). Defaults to current month/year if omitted.
- `par` is **optional** — omitting it does NOT zero the global `par_level`. Only send `par` when intentionally changing it.
- Weekly columns are only written when explicitly provided; omitting them preserves existing week data.
- Unknown categories resolve to `"New Items"` for manager review instead of failing.

**Response `201`:** Full inventory snapshot (same shape as GET).  
**Errors:** `400` empty items or negative values, `401` auth, `500` DB error.

---

### `GET /api/inventory/history`
Auth: any valid token.

| Query Param | Type | Default |
|---|---|---|
| `limit` | int (1–100) | 10 |

**Response `200`:** Array of inventory snapshot objects (same shape as GET single), ordered by year/month descending.

---

### `GET /api/inventory/reorders`
Auth: any valid token. Returns items where `on_hand < par_level` in the latest period, sorted by shortage (largest first).

**Response `200`:**
```json
[
  {
    "sku": "string",
    "desc": "string",
    "category": "string",
    "onHand": 0,
    "par": 10,
    "short": 10
  }
]
```
- `short` = `par − onHand` (units needed to reach par).
- Only items with `par > 0` are included.

---

### `GET /api/inventory/period-status`
Auth: any valid token. Compares the real-world current month to the latest inventory period in the DB.

**Response `200`:**
```json
{
  "current_month": 5,
  "current_year": 2026,
  "latest_month": 4,
  "latest_year": 2026,
  "next_month": 5,
  "next_year": 2026,
  "needs_rollover": true,
  "current_label": "June 2026",
  "latest_label": "May 2026",
  "next_label": "June 2026"
}
```
- All month values are **0-indexed** (0 = January) to match `monthly_inventory` and the frontend JS convention.
- `needs_rollover` is `true` when the real-world month is newer than the latest DB period.
- `latest_month`, `latest_year`, `next_month`, `next_year` are `null` if no inventory data exists.

---

### `POST /api/inventory/rollover`
Auth: **manager or admin** (role check enforced; staff returns `403`).

Calls the `perform_rollover()` Supabase SECURITY DEFINER RPC. Opens the next month, copies each item's ending balance (`on_hand + received − issued`) as the new month's opening `on_hand`, and publishes (read-locks) the old month.

**Body:**
```json
{ "message": "string (optional commit message)" }
```

**Response `200`:**
```json
{ "ok": true, "result": "<rpc_return_value>" }
```
**Errors:** `400` no period to roll from, `403` insufficient role, `500` RPC error.

---

## Menu — `/api/menu`

### `GET /api/menu/{day}`
`day` = day-of-week string, e.g. `Monday`, `Tuesday`.

**Response `200`:**
```json
{
  "day": "Monday",
  "meals": {
    "breakfast": { "items": ["Eggs", "Toast"], "sides": ["Juice"] },
    "lunch": { "items": ["Chicken"], "sides": ["Rice"] }
  }
}
```

---

### `POST /api/menu/{day}`
**Body:**
```json
{
  "meals": {
    "breakfast": { "items": ["string"], "sides": ["string"] },
    "lunch": { "items": ["string"], "sides": ["string"] },
    "dinner": { "items": ["string"], "sides": ["string"] }
  }
}
```
**Response `200`:** Saved menu for the day.

---

## Events — `/api/events`

### `GET /api/events`
Auth: any valid token. Returns all events ordered by `date` ascending.

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "title": "string",
    "date": "YYYY-MM-DD",
    "cat": "string",
    "theme": "string",
    "description": "string",
    "suggested_menu": "string",
    "status": "string",
    "created_at": "ISO 8601",
    "updated_at": "ISO 8601"
  }
]
```

---

### `POST /api/events`
Auth: any valid token.

**Body:**
```json
{
  "title": "string (required)",
  "date": "YYYY-MM-DD (required)",
  "cat": "string (required)",
  "theme": "string (optional)",
  "description": "string (optional)",
  "suggested_menu": "string (optional)"
}
```
> Column is `cat`, not `category`.

**Response `200`:** Created event object.  
**`500`** if DB insert fails.

---

## Logs — `/api/logs`

### `GET /api/logs/haccp`
Auth: any valid token.

| Query Param | Type | Default |
|---|---|---|
| `limit` | int (1–500) | 50 |
| `location` | string | — |

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "location": "Walk-in Cooler",
    "temperature": 38.5,
    "unit": "F",
    "timestamp": "ISO 8601",
    "checked_by": "string",
    "notes": "string",
    "created_at": "ISO 8601"
  }
]
```
Ordered by `timestamp` descending.

---

### `POST /api/logs/haccp`
Auth: any valid token.

**Body:**
```json
{
  "location": "string (required, 1–100 chars)",
  "temperature": 38.5,
  "unit": "F | C",
  "timestamp": "ISO 8601 (required)",
  "checked_by": "string (required)",
  "notes": "string (optional)"
}
```
- `temperature` validated: −50 to 150.
- `timestamp` must be valid ISO 8601 (Z or offset).

**Response `201`:** Created HACCP log entry.

---

### `GET /api/logs/daily`
Auth: any valid token.

| Query Param | Type | Default |
|---|---|---|
| `limit` | int (1–500) | 50 |
| `entry_type` | string | — |
| `severity` | string | — |

**Response `200`:**
```json
[
  {
    "id": "uuid",
    "entry_type": "string",
    "title": "string",
    "description": "string",
    "severity": "debug | info | warning | error",
    "created_by": "uuid",
    "created_at": "ISO 8601",
    "data": "string"
  }
]
```
Ordered by `created_at` descending.

---

### `POST /api/logs/daily`
Auth: any valid token. `created_by` is set server-side from the auth token.

**Body:**
```json
{
  "entry_type": "string (required, 1–50 chars)",
  "title": "string (required, 1–200 chars)",
  "description": "string (optional)",
  "severity": "debug | info | warning | error (default: info)",
  "data": "string (optional)"
}
```
**Response `201`:** Created daily log entry.

---

### `GET /api/logs/compliance`
Auth: any valid token.

**Response `200`:**
```json
{
  "status": "ok | warning",
  "haccp_logs_count": 10,
  "recent_errors": 2,
  "last_haccp_check": "ISO 8601",
  "recent_haccp_logs": [],
  "recent_error_logs": []
}
```
- `status` = `"warning"` if any error-severity daily logs exist in the last 10; otherwise `"ok"`.
- Returns the 10 most recent HACCP entries and up to 5 in each summary array.

---

## Reference Data — `/api`

### `GET /api/opening-checklist`
Active opening checklist items ordered by `sort_order`.

**Response `200`:** `[{ "id", "task", "sort_order", "is_active", "created_at" }]`

---

### `GET /api/servsafe`
All ServSafe certifications ordered by staff name.

**Response `200`:** `[{ "id", "staff_name", "certification", "expiry_date", "is_proctor", "created_at", "updated_at" }]`

---

### `GET /api/meal-periods`
Meal period definitions ordered by `sort_order`.

**Response `200`:** `[{ "id", "meal", "label", "open_hour", "close_hour", "rate", "sort_order" }]`

---

### `GET /api/incidents`
| Query Param | Type | Default |
|---|---|---|
| `limit` | int (1–500) | 50 |
| `type` | string | — |

**Response `200`:** `[{ "id", "incident_type", "description", "reported_by", "notes", "reported_at", "resolved_at", "resolved_by", "created_at" }]`

---

### `POST /api/incidents`
**Body:**
```json
{
  "incident_type": "string (required)",
  "description": "string (required)",
  "reported_by": "string (required)",
  "notes": "string (optional)"
}
```
**Response `201`:** Created incident.

---

### `GET /api/invoices`
| Query Param | Type | Default |
|---|---|---|
| `month` | int | — |
| `year` | int | — |

**Response `200`:** Invoice array with `vendor_name` joined from `vendors` table.

---

### `GET /api/invoices/{id}/items`
Line items for a specific invoice.

**Response `200`:** `[{ "id", "invoice_id", "sku", "description", "category", "quantity_ordered", "quantity_shipped", "unit_price", "extended_price", ... }]`

---

### `GET /api/inventory-categories`
All inventory categories ordered by `sort_order`.

**Response `200`:** `[{ "id", "name", "sort_order", ... }]`

---

### `GET /api/dashboard/stats`
**Response `200`:**
```json
{
  "total_value": 12450.00,
  "total_items": 342,
  "low_stock": 7,
  "pending_staging": 3,
  "recent_activity": [
    {
      "who": "string",
      "role": "string",
      "what": "committed",
      "detail": "commit message",
      "when": "ISO 8601"
    }
  ]
}
```

---

### `GET /api/archives`
Monthly snapshot index ordered by year/month descending.

**Response `200`:** `[{ "month", "year", "grand_total", "item_count" }]`

---

### `GET /api/archives/{year}/{month}`
Full snapshot detail for a specific period.

**Response `200`:** Full `monthly_snapshots` row including `category_totals` (jsonb), `data` (jsonb), week totals.  
**`404`** if not found.

---

## Source Control — `/api`

### `GET /api/staging`
Auth: any valid token.  
- **Staff** see only their own pending entries.
- **Admin/manager** see all pending entries.

| Query Param | Type | Description |
|---|---|---|
| `entity_type` | string | Filter: `inventory \| menu \| user \| compliance \| event \| ops` |

**Response `200`:**
```json
[
  {
    "entry_id": "uuid",
    "entity_type": "string",
    "entity_id": "string",
    "field_name": "string",
    "old_value_text": "string",
    "new_value_text": "string",
    "change_type": "string",
    "operation": "string",
    "full_payload": {},
    "metadata": {},
    "status": "pending",
    "submitted_by": "uuid",
    "submitter_name": "string",
    "submitter_role": "string",
    "review_note": "string",
    "created_at": "ISO 8601",
    "expires_at": "ISO 8601"
  }
]
```

---

### `POST /api/staging`
Auth: any valid token. Submit a change for manager review.  
Deduplicates: if the same submitter already has a pending entry for `(entity_id, field_name)`, the existing entry is updated in-place.

**Body:**
```json
{
  "entity_type": "inventory | menu | user | compliance | event | ops (required)",
  "entity_id": "string (required — see entity_id convention above)",
  "field_name": "string (required)",
  "old_value": "string (optional)",
  "new_value": "string (default: empty string)",
  "change_type": "string (required)",
  "summary": "string (optional, human-readable description)",
  "operation": "inventory_save | inventory_week_update | item_update | item_delete | menu_save | event_create | haccp_save | daily_log_save | user_create | user_update (optional)",
  "full_payload": {},
  "metadata": {}
}
```
**Response `201`:** Created (or updated dedup) staging entry row.  
**`422`** if `entity_type` is not in the allowed set.

---

### `DELETE /api/staging/{entry_id}`
Auth: **admin or manager** only. Rejects a pending entry — sets `status = rejected`.

| Query Param | Type | Description |
|---|---|---|
| `review_note` | string | Optional rejection reason |

**Response `204`** No content.  
**`403`** insufficient role. **`404`** entry not found or already processed.

---

### `GET /api/commits`
Auth: any valid token. Returns commit history ordered by `github_synced_at` (falling back to `merged_at`, then `created_at`) descending.

| Query Param | Type | Default |
|---|---|---|
| `limit` | int | 50 |
| `offset` | int | 0 |

**Response `200`:**
```json
[
  {
    "commit_id": "uuid",
    "message": "string",
    "author_id": "uuid",
    "author_name": "string",
    "submitter_role": "string",
    "status": "merged",
    "branch": "main",
    "created_at": "ISO 8601",
    "merged_at": "ISO 8601",
    "github_sha": "string",
    "github_synced_at": "ISO 8601",
    "change_count": 5
  }
]
```

---

### `POST /api/commits`
Auth: **admin or manager** only. Approves a set of staging entries: replays operations to live tables, creates commit record, enqueues GitHub sync.

**Body:**
```json
{
  "staging_ids": ["uuid", "uuid"],
  "message": "string",
  "author_id": "uuid"
}
```
- `staging_ids` must not be empty (`422` if empty).
- All replay operations run before errors are checked (partial failure is possible — no rollback).
- Staging entries are marked `merged` (not `approved`) to satisfy the DB check constraint.

**Response `201`:**
```json
{
  "commit_id": "uuid",
  "message": "string",
  "status": "merged",
  "branch": "main",
  "merged_at": "ISO 8601",
  "change_count": 5,
  "replayed": 3
}
```
**Errors:** `403` insufficient role, `422` empty `staging_ids`, `500` replay failure (detail includes which operations failed and which applied without rollback).

---

## AI Data Entry — `/api/data-entry`

### `POST /api/data-entry/upload`
Upload a file for AI extraction, staging, and preview.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | Yes | CSV, Excel (.xlsx), PDF, or TSV. Max 10 MB. |
| `hint` | string | — | Operation hint: `inventory \| events \| haccp \| menu \| log` |
| `month` | int | — | Target month (1–12). Defaults to current month. |
| `year` | int | — | Target year. Defaults to current year. |

**Response `201`:**
```json
{
  "batch_id": "uuid",
  "staged_count": 12,
  "operations": ["inventory_save"],
  "file": "upload.csv",
  "month": 6,
  "year": 2026
}
```

---

### `GET /api/data-entry/preview/{batch_id}`
Row-level diff for a staged batch — shows before/after against live DB for each staged row.

**Response `200`:**
```json
[
  {
    "table": "monthly_inventory",
    "operation": "inventory_save",
    "summary": "12 items for 6/2026",
    "rows": [
      {
        "sku": "DRY-001",
        "status": "update | new",
        "before": { "onHand": 10, "price": 1.50 },
        "after": { "onHand": 8, "price": 1.50 },
        "changes": ["onHand"]
      }
    ]
  }
]
```

---

### `GET /api/data-entry/settings`
Current AI provider and model configuration from `app_settings`.

**Response `200`:**
```json
{
  "provider": "groq | ollama",
  "model": "string"
}
```

---

### `PUT /api/data-entry/settings`
Update AI provider/model config. Writes to `app_settings` table.

**Body:**
```json
{
  "provider": "groq | ollama",
  "model": "string"
}
```
**Response `200`:** `{ "provider": "string", "model": "string" }`

---

## Error Responses

All errors return `{ "detail": "message string" }`.

| Status | Meaning |
|---|---|
| `400` | Bad request / validation failure / duplicate username or email |
| `401` | Missing, invalid, or expired token |
| `403` | Insufficient role (admin/manager-only endpoint) |
| `404` | Resource not found |
| `413` | File too large (10 MB limit on upload) |
| `422` | Unprocessable — extraction failed, entity_type invalid, or empty staging_ids |
| `500` | Server error or database error |

---

## Operation Types (staging dispatch registry)

These are the valid `operation` values. The dispatch registry in `backend/staging/dispatch.py` maps each to a handler function.

| Operation | Entity Type | Dispatch Function | Description |
|---|---|---|---|
| `inventory_save` | `inventory` | `dispatch_inventory_save` | Upsert items + monthly `on_hand` for a full period |
| `inventory_week_update` | `inventory` | `dispatch_inventory_week` | Write a single weekly column (`w{1-4}_{received\|issued}`) without touching `on_hand` |
| `item_update` | `inventory` | `dispatch_item_update` | Edit item metadata: desc, category, price, **par**, unit, active, SKU rename |
| `item_delete` | `inventory` | `dispatch_item_delete` | Soft delete (default) or hard delete (`hard: true` in payload) by SKU |
| `menu_save` | `menu` | `dispatch_menu_save` | Replace all meal slots for a day-of-week in the active menu cycle |
| `event_create` | `event` | `dispatch_event_create` | Insert event; idempotent on re-commit via `staging_entry_id` |
| `haccp_save` | `compliance` | `dispatch_haccp_save` | Insert HACCP log; idempotent on re-commit via `staging_entry_id` |
| `daily_log_save` | `ops` | `dispatch_daily_log_save` | Insert daily operations log; idempotent on re-commit |
| `user_create` | `user` | `dispatch_user_create` | Create user profile (no `password` column — auth is Supabase Auth or PIN) |
| `user_update` | `user` | `dispatch_user_update` | Update user profile fields by `user_id` |

---

## Live Database (Supabase MJCCv1)

**Project ref:** `mgvyylvmkxhhataavqjz` · **Region:** `us-west-1`

Key tables the API reads/writes:

| Table | Used by |
|---|---|
| `user_profiles` | auth, users |
| `inventory_items` | inventory (item catalog + global `par_level`) |
| `monthly_inventory` | inventory (period counts, 0-indexed month) |
| `inventory_categories` | inventory, data |
| `live_inventory` | reorders view (joined from barcodes) |
| `menu_entries`, `menu_cycles` | menu |
| `events` | events |
| `haccp_logs` | logs/haccp |
| `daily_operations_logs` | logs/daily |
| `staging_entries` | sourcectrl/staging |
| `commits`, `commit_changes` | sourcectrl/commits |
| `github_sync_queue` | commit flow (operations: `push_inventory`, `push_archive_snapshot`, `push_invoice`, `push_menu`, `push_items_catalog`) |
| `invoices`, `invoice_items`, `vendors` | data/invoices |
| `monthly_snapshots` | data/archives |
| `opening_checklist_items` | data/opening-checklist |
| `servsafe_certifications` | data/servsafe |
| `meal_periods` | data/meal-periods |
| `incident_logs` | data/incidents |
| `barcodes` | dashboard stats (total_items) |
| `app_settings` | data-entry/settings (AI config) |
