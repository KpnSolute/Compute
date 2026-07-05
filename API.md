# MJCC API Reference

**Local:** `http://localhost:8000`  
**Production:** `https://mjcc-managements.onrender.com`  
**Auth header:** `Authorization: Bearer <token>` (all endpoints except `POST /api/auth/login`)  
**Content-Type:** `application/json` (except file upload which uses `multipart/form-data`)

---

## Data Model Clarifications

### Opening vs ending balance
- `opening_oh` in `monthly_inventory` is the **opening quantity** for the period: the count carried forward from the prior month's ending quantity.
- **Ending quantity (current stock)** = `opening_oh + sum(w1-w3_received) - sum(w1-w3_pulled)`.
- Opening value carries from the prior month's `ending_value`; do not recalculate it with the new month `unit_price`.
- When workbook Review values are present, `opening_value`, `received_value`, `pulled_value`, and `ending_value` are the accounting source of truth.
- `GET /api/inventory` returns `onHand` (opening quantity), `closingQty` (ending quantity), and the audited value fields. The frontend should display these API/database values rather than recomputing value from local cache.

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
| `inventory_week_update` | `W{week}-{received\|issued}-{month}-{year}` (week 1-3 only; issued maps to pulled storage) |
| batch compact | `batch-compact-{month}-{year}` |
| `item_update` / `item_delete` | `{sku}` |
| `menu_save` | `{day_of_week}` (legacy `menu_entries` operation — retired from the API surface as of v4.27.0; the dispatch handler still exists but nothing stages this operation anymore) |
| `event_create` | event title slug or UUID |
| `haccp_save` / `daily_log_save` | ISO timestamp or compound key |

---

## Authentication — `/api/auth`

### `POST /api/auth/login`
Two login modes. No auth header required.

**JWT/password mode (any active Supabase Auth user):**
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
    "role": "staff | assistant | manager | admin | sudo",
    "active": true,
    "email": "string (JWT mode only — absent in PIN response)"
  }
}
```
- PIN mode returns a signed 12-hour staff JWT when `SUPABASE_JWT_SECRET` is configured; otherwise it falls back to legacy `pin_<user_id>`.
- PIN login is restricted to `role = staff`; attempting PIN login as a higher role returns `401`.
- JWT/password login accepts any active profile with a matching Supabase Auth user; returned role controls UI/API authorization after login.

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
  "role": "staff | assistant | manager | admin | sudo",
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
> User-management read endpoints require **admin or sudo**. User create/update/disable/password reset endpoints require **sudo**.

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
      "role": "staff | assistant | manager | admin | sudo",
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
  "email": "valid email (required for request validation; login email is derived from username)",
  "display_name": "string (required)",
  "last_name": "string (optional)",
  "role": "staff | assistant | manager | admin | sudo (default: staff)",
  "pin": "numeric string (optional, staff login)",
  "password": "string, 8+ chars (optional; sets Supabase Auth password)",
  "phone": "string",
  "job_title": "string",
  "bio": "string",
  "avatar_url": "string"
}
```
> `user_profiles` has **no `password` column**. `password` on this endpoint is sent only to Supabase Auth; profile rows store roles/profile fields plus staff PIN. Supabase Auth login email is derived from username (`username@mjc-cafeteria.com`, except `sudo@mjc.local`).

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
  "role": "staff | assistant | manager | admin | sudo",
  "pin": "numeric string",
  "active": true,
  "new_password": "string, 8+ chars (optional; resets Supabase Auth password)",
  "new_username": "string (optional; updates Supabase Auth login email too)",
  "phone": "string",
  "job_title": "string",
  "bio": "string",
  "avatar_url": "string"
}
```
**Response `200`:** Updated user object.

---

### `DELETE /api/users/{user_id}`
Soft-delete — sets `active = false`. Does not remove the record.  
**Response `204`** No content.  
**`400`** if trying to disable your own account.

---

### `GET /api/users/me`
Returns the current caller's full profile. Any valid active token.

### `PUT /api/users/me`
Self-service profile update for any active user. Cannot change role, username, email, or active status.

Staff users may update only contact fields through self-service: `{ "phone" }`. Staff profile photos use `POST /api/users/me/avatar`.
Assistant/manager/admin/sudo users may also update `{ "display_name", "last_name", "job_title", "bio" }`.

### `POST /api/users/me/avatar`
Uploads the current caller's profile image and saves `avatar_url`.

**Request:** `multipart/form-data` with `file`. Accepted types: JPEG, PNG, WebP, GIF. Max size: 2 MB.

**Response `200`:** Updated user object.

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
      "w1r": 0, "w2r": 0, "w3r": 0,
      "w1p": 0, "w2p": 0, "w3p": 0,
      "openingValue": 0.00,
      "receivedValue": 0.00,
      "pulledValue": 0.00,
      "endingValue": 0.00
    }
  ],
  "metadata": { "month": 6, "year": 2026, "period": "2026-06" },
  "notes": "string",
  "created_at": "ISO 8601"
}
```
- `onHand` = opening quantity (DB `opening_oh`). Ending quantity = `onHand + sum(w*r) - sum(w*p)`.
- `endingValue` is the audited DB value when present; fallback math is only for legacy rows without value controls.
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

## Menu — `/api/menu` (28-day cycle schema, v4.27.0)

Backed by `menu_items`, `menu_cycle_days` (28 rows, `cycle_day` 1-28), `menu_cycle_slots`,
`menu_suggestions`, and `app_settings` (`menu_cycle_anchor_date`). Auth: any valid token
unless noted. Cycle-day math: `cycle_day = ((date - anchor_date).days % 28) + 1`, using
`backend.periods.business_now().date()` for "today". Anchor date is always a Sunday = cycle day 1.

### `GET /api/menu/cycle/overview`
**Response `200`:** `{ anchor_date, today: { date, cycle_day }, days: [{ cycle_day, cycle_week, day_of_week, zone, morning_service, midday_service, evening_service, active }] }` (all 28 days).

---

### `GET /api/menu/cycle/day/{n}`
`n` = 1-28.

**Response `200`:** `{ cycle_day, cycle_week, day_of_week, zone, morning_service, midday_service, evening_service, slots: [{ record_id, meal_group, meal_period, service_order, slot_order, slot_name, item_id, item_name, active }] }` — slots ordered by `service_order`, `slot_order`.

**`400`** if `n` not in 1-28. **`404`** if the cycle day row doesn't exist.

---

### `GET /api/menu/today`
Same shape as `GET /api/menu/cycle/day/{n}` plus top-level `date` (ISO), resolved from the current business day's cycle day.

---

### `PUT /api/menu/slot/{record_id}`
**Body:** `{ "item_id": "string (optional)", "item_name": "string (optional)", "active": true }`
- If `item_name` given and no `item_id`: normalizes `item_key = name.strip().upper()`, looks up `menu_items` by `item_key`; creates a new item (`MENU-NNNN`, next sequential id) if not found.
- Sets `updated_by` from the caller's username/display name, `updated_at` = now.

**Response `200`:** Updated slot `{ record_id, meal_group, meal_period, service_order, slot_order, slot_name, item_id, item_name, active }`.
**`404`** unknown `record_id`. **`400`** no fields to update.

---

### `POST /api/menu/cycle/day/{n}/slots`
Add a custom slot to a cycle day.

**Body:** `{ "meal_group", "meal_period", "slot_name", "item_id" (optional), "item_name" (optional), "slot_order" (optional) }`
- `record_id` = `MJCC28-D{n:02d}-CUSTOM-{6 hex chars}`.
- `slot_order` defaults to `max(existing for day+meal_period) + 1`.

**Response `200`:** Created slot (same shape as `PUT /api/menu/slot/{record_id}`).

---

### `GET /api/menu/items?q=`
Up to 50 active `menu_items`, `ilike '%q%'` on name (all active items if `q` omitted), ordered by name.

**Response `200`:** `[{ "id", "name", "active" }]`

---

### `GET /api/menu/settings`
**Response `200`:** `{ "anchor_date": "YYYY-MM-DD" }`

### `PUT /api/menu/settings`
**Body:** `{ "anchor_date": "YYYY-MM-DD" }` — must parse as a date AND be a Sunday (`weekday() == 6`), else `400`.

**Response `200`:** `{ "anchor_date": "YYYY-MM-DD" }`

---

### `GET /api/menu/suggestions?status=`
List `menu_suggestions`, newest first. Optional `status` filter (`new | reviewed | applied | dismissed`).

### `PUT /api/menu/suggestions/{id}`
**Body:** `{ "status": "new | reviewed | applied | dismissed" }`
**`400`** invalid status. **`404`** not found.

---

### `GET /api/menu/{day}` (legacy compat)
`day` = short weekday key (`Mon`...`Sun`). Declared after the literal routes above so those match first.

Resolves the cycle day for the requested weekday **within the current cycle week** (today's cycle week, not necessarily today's weekday), groups active slots' item names by `meal_period`.

**Response `200`:** `{ "id": "Monday-key-as-given", "data": { "<meal_period>": ["item name", ...] }, "sides": { "<meal_period>": [] }, "day_of_week": "Monday" }`

### `POST /api/menu/{day}` — **retired**
Returns `410` `{ "detail": "Use PUT /api/menu/slot/{record_id}" }`. The old `menu_entries` write path no longer exists.

---

## Public Menu — `/api/public/menu` (v4.27.0, no auth)

Read-only cycle menu data for external consumers (e.g. lunchvoice.com). GET routes have **no bearer auth** — menu data is public. Requires CORS origin allowlist to include the consuming site (`CORS_ORIGINS` env var on Render).

### `GET /api/public/menu/today`
**Response `200`:** `{ date, cycle_day, cycle_week, day_of_week, meals: { "<meal_period>": [{ slot_name, item_name }] } }` (active slots only).

### `GET /api/public/menu/date/{iso_date}`
Same shape for an arbitrary date. **`400`** if `iso_date` isn't `YYYY-MM-DD`.

### `GET /api/public/menu/cycle`
**Response `200`:** `{ anchor_date, days: [{ cycle_day, day_of_week, meals: {...} }] }` for all 28 days — built from one slots query + one items query.
Optional `?include_stats=true` adds a `feedback` array to each day: rows from `menu_feedback_summary` matching that `cycle_day`, sorted by `response_count` desc then `avg_rating` desc. Costs one extra table read; stats are attached per-day, not merged into a specific slot because LunchVoice's slot enum does not yet map cleanly onto MJCC `meal_period`/`slot_name`.

### `GET /api/public/menu/stats`
Aggregated LunchVoice feedback ratings, read from `menu_feedback_summary`.
**Query:** `?limit=` optional, default 10, valid range 1-100. Controls the size of `top_meals`.
**Response `200`:** `{ "rows": [{ id, cycle_day, slot, dish_name, avg_rating, response_count, updated_at }, ...], "top_meals": [...] }` — both sorted by `response_count` desc then `avg_rating` desc; `top_meals` is `rows` truncated to `limit`.

### `POST /api/public/menu/suggestions`
Requires header `X-Api-Key` matching env `MENU_API_KEY`.
**`503`** if `MENU_API_KEY` unset server-side. **`403`** if the header doesn't match.

**Body:** `{ "suggested_item": "string, required, max 200", "cycle_day": 1-28 (optional), "meal_period": "string (optional)", "slot_name": "string (optional)", "notes": "string, max 1000 (optional)", "submitted_by": "string (optional)", "source": "string (optional, default lunchvoice)" }`

**Response `200`:** `{ "id": "uuid" }`

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
Current AI stack configuration joined from `ai_stack_config` + `ai_provider_keys` + `ai_providers`.

**Response `200`:**
```json
{
  "current": { "provider": "groq", "model": "string", "key_id": "uuid|null", "is_vision": false, "ollama_url": null },
  "providers": [ { "provider": "groq", "label": "Groq", "description": "...", "has_key": true, "default_url": null, "sort_order": 1 } ],
  "keys": [ { "id": "uuid", "provider": "groq", "label": "string", "is_active": true, "is_default": false, "has_key": true, "model_override": null, "base_url": null, "updated_at": "ISO" } ],
  "vision_models": ["model-id"],
  "ai_enabled": true
}
```

---

### `PUT /api/data-entry/settings`
Update AI provider/model config. Writes to `ai_stack_config` table. (Legacy; prefer `POST /api/data-entry/ai-stack`.)

**Body:** `{ "provider": "groq", "model": "string", "ollama_url": "string|null" }`  
**Response `200`:** `{ "ok": true, "config": { "provider": "string", "model": "string" } }`

---

### `GET /api/data-entry/models?provider=<id>`
Live model discovery for a provider. Falls back to static list. Manager+ required.

**Response `200`:**
```json
{ "provider": "groq", "models": [ { "id": "llama-3.3-70b-versatile", "label": "...", "vision": false } ] }
```

---

### `POST /api/data-entry/ai-keys`
Create a named key entry in `ai_provider_keys`. Sudo only.

**Body:** `{ "provider": "groq", "label": "string", "api_key": "...", "base_url": null, "model_override": null, "set_active": false, "notes": null }`  
**Response `200`:** `{ "id": "uuid", "provider": "...", "label": "...", "is_active": false, "has_key": true, "updated_at": "ISO" }`

---

### `PATCH /api/data-entry/ai-keys/{key_id}`
Update a key entry by UUID. Sudo only. Setting `is_active: true` deactivates sibling keys for the same provider.

**Body:** `{ "label": null, "api_key": null, "base_url": null, "model_override": null, "is_active": null, "notes": null }`  
**Response `200`:** `{ "id": "uuid", "is_active": bool, "has_key": bool, "updated_at": "ISO" }`

---

### `DELETE /api/data-entry/ai-keys/{key_id}`
Delete a key entry. Sudo only. Returns `409` if it is the only active key for its provider.

**Response `200`:** `{ "ok": true }`

---

### `POST /api/data-entry/ai-stack`
Set the active AI stack (provider + key + model). Manager+ required. Upserts `ai_stack_config` where `name='default'`.

**Body:** `{ "provider": "groq", "key_id": "uuid", "model": "string", "vision_capable": false }`  
**Response `200`:** the upserted `ai_stack_config` row.

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
| `inventory_save` | `inventory` | `dispatch_inventory_save` | Upsert items + monthly `opening_oh`, W1-W3 movement fields, and audited value controls for a full period |
| `inventory_week_update` | `inventory` | `dispatch_inventory_week` | Write a single W1-W3 weekly movement (`received` or user-facing `issued`, stored as `pulled`) without touching opening quantity |
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
| `menu_items`, `menu_cycle_days`, `menu_cycle_slots`, `menu_suggestions` | menu, public/menu (28-day cycle schema, v4.27.0) |
| `menu_feedback_summary` | public/menu `/stats` + `/cycle?include_stats` (written by LunchVoice, read-only here) |
| `menu_entries`, `menu_cycles` | legacy — no longer read/written by the API (kept only for the unreferenced `dispatch_menu_save` handler) |
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
| `app_settings` | AI tools config (`ai_tools_config` key) |
| `ai_providers` | data-entry/settings (provider metadata) |
| `ai_provider_keys` | data-entry/ai-keys CRUD |
| `ai_stack_config` | data-entry/settings, data-entry/ai-stack |
