# MJCC API Reference

**Local:** `http://localhost:8000`  
**Production:** `https://mjcc-managements.onrender.com`  
**Auth header:** `Authorization: Bearer <token>` (all endpoints except `/api/auth/login`)  
**Content-Type:** `application/json` (except file upload which uses `multipart/form-data`)

---

## Authentication — `/api/auth`

### `POST /api/auth/login`
Two login modes. No auth header required.

**JWT mode (admin/manager):**
```json
{ "access_token": "<supabase_jwt>" }
```

**PIN mode (staff):**
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
    "active": true
  }
}
```

---

### `GET /api/auth/me`
Returns current user from the bearer token.

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

---

### `POST /api/auth/logout`
Signals session end. Frontend should discard the token.

**Response `200`:** `{ "message": "Successfully logged out" }`

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
| Query Param | Type | Default | Description |
|---|---|---|---|
| `month` | int | current | Calendar month (1–12) |
| `year` | int | current | 4-digit year |

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

---

### `POST /api/inventory`
Save a full inventory batch. Upserts `inventory_items` by SKU and `monthly_inventory` by `item_id+month+year`.

**Body:**
```json
{
  "month": 6,
  "year": 2026,
  "notes": "string",
  "items": [
    {
      "sku": "string",
      "desc": "string",
      "category": "Dry Goods",
      "price": 1.50,
      "par": 10,
      "onHand": 8,
      "unit": "each",
      "w1r": 0, "w2r": 0, "w3r": 0, "w4r": 0,
      "w1i": 0, "w2i": 0, "w3i": 0, "w4i": 0
    }
  ]
}
```
**Response `201`:** Full inventory snapshot (same as GET).

---

### `GET /api/inventory/history`
| Query Param | Type | Default |
|---|---|---|
| `limit` | int (1–100) | 10 |

**Response `200`:** Array of inventory snapshot objects.

---

### `GET /api/inventory/reorders`
Items where `on_hand < par_level` from the `live_inventory` view.

**Response `200`:**
```json
[{ "sku": "string", "description": "string", "category": "string", "on_hand": 0, "par_level": 0 }]
```

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
All events ordered by date ascending.

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
> ⚠️ Column is `cat`, not `category`.

**Response `200`:** Created event object.

---

## Logs — `/api/logs`

### `GET /api/logs/haccp`
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

---

### `POST /api/logs/haccp`
**Body:**
```json
{
  "location": "string (required)",
  "temperature": 38.5,
  "unit": "F | C",
  "timestamp": "ISO 8601 (required)",
  "checked_by": "string (required)",
  "notes": "string (optional)"
}
```
**Response `201`:** Created HACCP log entry.

---

### `GET /api/logs/daily`
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

---

### `POST /api/logs/daily`
**Body:**
```json
{
  "entry_type": "string (required)",
  "title": "string (required)",
  "description": "string (optional)",
  "severity": "debug | info | warning | error (default: info)",
  "data": "string (optional)"
}
```
**Response `201`:** Created daily log entry.

---

### `GET /api/logs/compliance`
Summary of recent HACCP checks and error-level daily logs.

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
Pending staged changes.

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
Submit a change for review.

**Body:**
```json
{
  "entity_type": "inventory | menu | user | compliance | event | ops",
  "entity_id": "string",
  "field_name": "string",
  "old_value": "string (optional)",
  "new_value": "string",
  "change_type": "string",
  "operation": "inventory_save | menu_save | event_create | haccp_save | daily_log | user_create | user_update (optional)",
  "full_payload": {},
  "metadata": {}
}
```
**Response `201`:** Created staging entry.

---

### `DELETE /api/staging/{entry_id}`
Reject a pending staging entry. Sets status to `rejected`.

| Query Param | Type | Description |
|---|---|---|
| `review_note` | string | Optional rejection reason |

**Response `204`** No content.

---

### `GET /api/commits`
Commit history with author info and change counts.

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
Approve a set of staging entries: replays operations to live tables, creates commit record, enqueues GitHub sync.

**Body:**
```json
{
  "staging_ids": ["uuid", "uuid"],
  "message": "string",
  "author_id": "uuid"
}
```

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

---

## AI Data Entry — `/api/data-entry`

### `POST /api/data-entry/upload`
Upload a file for AI extraction, staging, and preview.

**Request:** `multipart/form-data`

| Field | Type | Required | Description |
|---|---|---|---|
| `file` | File | ✅ | CSV, Excel (.xlsx), PDF, or TSV. Max 10 MB. |
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
| `403` | Insufficient role (admin-only endpoint accessed by non-admin) |
| `404` | Resource not found |
| `413` | File too large (10 MB limit on upload) |
| `422` | Unprocessable — extraction failed or entity_type invalid |
| `500` | Server error or database error |

---

## Operation Types (staging & dispatch)

| Operation | Entity Type | Description |
|---|---|---|
| `inventory_save` | `inventory` | Upsert inventory items + monthly counts |
| `menu_save` | `menu` | Save meal slots for a day-of-week |
| `event_create` | `event` | Create a new event |
| `haccp_save` | `compliance` | Record HACCP temperature check |
| `daily_log` | `ops` | Record daily operations log |
| `user_create` | `user` | Create user profile |
| `user_update` | `user` | Update user profile |

---

## Live Database (Supabase MJCCv1)

**Project ref:** `mgvyylvmkxhhataavqjz` · **Region:** `us-west-1`

Key tables the API reads/writes:

| Table | Used by |
|---|---|
| `user_profiles` | auth, users |
| `inventory_items` | inventory (item catalog) |
| `monthly_inventory` | inventory (period counts) |
| `inventory_categories` | inventory, data |
| `live_inventory` | inventory/reorders, dashboard (view over `barcodes`) |
| `menu_entries`, `menu_cycles` | menu |
| `events` | events |
| `haccp_logs` | logs/haccp |
| `daily_operations_logs` | logs/daily |
| `staging_entries` | sourcectrl/staging |
| `commits`, `commit_changes` | sourcectrl/commits |
| `github_sync_queue` | commit flow |
| `invoices`, `invoice_items`, `vendors` | data/invoices |
| `monthly_snapshots` | data/archives |
| `opening_checklist_items` | data/opening-checklist |
| `servsafe_certifications` | data/servsafe |
| `meal_periods` | data/meal-periods |
| `incident_logs` | data/incidents |
| `barcodes` | dashboard stats (total_items) |
| `app_settings` | data-entry/settings (AI config) |
