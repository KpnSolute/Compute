# MJCC Data Reference — `DATA.md`

**Owner:** `mjcc-data` agent  
**Live DB:** Supabase MJCCv1 — project ref `mgvyylvmkxhhataavqjz` — region `us-west-1`  
**MCP access:** `mcp__claude_ai_Supabase__*` tools — always verify live schema before trusting this doc.  
**RULE:** Schema changes go through `mjcc-data` agent ONLY. API and UI agents request, data agent executes.

---

## Critical Invariants — Read Before Touching Anything

| Rule | Detail |
|---|---|
| `user_profiles` has **no `password` column** | Auth = Supabase Auth (JWT) for admin/manager; PIN for staff |
| `monthly_inventory.month` is **0-indexed** | 0=Jan … 11=Dec. API is 1-indexed. Convert: `db_month = api_month - 1` |
| `par_level` lives in `inventory_items` — **global** | One par level shared across all periods. Not per-month. |
| `monthly_inventory.on_hand` = **opening balance** | Ending balance = `on_hand + Σreceived - Σissued`. Rollover copies ending as next opening. |
| `staging_entries.status` check constraint | Only `'pending'`, `'merged'`, `'rejected'` — NOT `'approved'` |
| `github_sync_queue.operation` check constraint | Only `push_inventory`, `push_archive_snapshot`, `push_invoice`, `push_menu`, `push_items_catalog` |
| Published period = read-only | `month_status.status = 'published'` → reject all writes with 403 |

---

## Tables

### `user_profiles`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | Supabase Auth user ID |
| `username` | text unique | login handle |
| `display_name` | text | shown in UI |
| `last_name` | text | |
| `role` | text | `staff` / `assistant` / `manager` / `admin` |
| `pin` | text | 4-digit PIN for staff login |
| `active` | bool | soft-delete flag |
| `email` | text | Supabase Auth email |
| `created_at` | timestamptz | |
| `updated_at` | timestamptz | |

---

### `inventory_items`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `sku` | text unique | canonical item identifier |
| `description` | text | display name |
| `category_id` | uuid FK → `inventory_categories` | |
| `unit_price` | numeric | latest known price |
| `par_level` | int | **GLOBAL** — shared across all periods |
| `unit` | text | `each`, `case`, `lb`, etc. |
| `active` | bool | false = soft-deleted |
| `needs_review` | bool | true = new item in "New Items" bucket |
| `created_at` / `updated_at` | timestamptz | |

---

### `inventory_categories`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `name` | text | e.g. `Dry Goods`, `Protein & Meat`, `New Items` |
| `sort_order` | int | display order |

Known categories: Dairy · Cereal · Beverages · Snacks · Dry Goods · Produce & Fresh · Protein & Meat · Frozen Foods · Supplies · Bread · Condiments · **New Items** (review bucket)

---

### `monthly_inventory`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `item_id` | uuid FK → `inventory_items` | |
| `month` | int | **0-indexed** (0=Jan, 11=Dec) |
| `year` | int | 4-digit |
| `on_hand` | int | **opening balance** (carried from prior rollover) |
| `w1_received` / `w2_received` / `w3_received` / `w4_received` | int | weekly deliveries |
| `w1_issued` / `w2_issued` / `w3_issued` / `w4_issued` | int | weekly pulls |
| `unit_price` | numeric | period snapshot price |
| `created_at` / `updated_at` | timestamptz | |

**UNIQUE constraint:** `(item_id, month, year)` — one row per item per period.  
**Ending balance formula:** `MAX(0, on_hand + Σw*_received - Σw*_issued)`

---

### `month_status`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `month` | int | 0-indexed |
| `year` | int | |
| `status` | text | `open` (editable) or `published` (read-only after rollover) |

---

### `staging_entries`
| Column | Type | Notes |
|---|---|---|
| `entry_id` | uuid PK | |
| `entity_type` | text | `inventory` / `menu` / `user` / `compliance` / `event` / `ops` |
| `entity_id` | text | dedup key part (SKU-month-year, W*-dir-month-year, etc.) |
| `field_name` | text | dedup key part |
| `old_value_text` / `new_value_text` | text | human-readable diff |
| `change_type` | text | `update` / `create` / `delete` |
| `operation` | text | dispatch registry key |
| `full_payload` | jsonb | complete data for dispatch replay |
| `metadata` | jsonb | extra context |
| `status` | text | **`pending`** / `merged` / `rejected` ONLY |
| `submitted_by` | uuid FK → `user_profiles` | |
| `reviewed_by` | uuid FK → `user_profiles` | |
| `review_note` | text | rejection reason |
| `created_at` / `expires_at` | timestamptz | |

**Dedup:** `(entity_id, field_name, submitted_by, status='pending')` — one pending entry per submitter per entity-field.

---

### `commits`
| Column | Type | Notes |
|---|---|---|
| `commit_id` | uuid PK | |
| `message` | text | |
| `author_id` | uuid FK | |
| `status` | text | `merged` |
| `branch` | text | `main` |
| `created_at` / `merged_at` | timestamptz | |
| `merged_by` | uuid | |
| `github_sha` | text | filled by GitHub sync worker |
| `github_synced_at` | timestamptz | |
| `source` | text | `dashboard` |

---

### `commit_changes`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `commit_id` | uuid FK → `commits` | |
| `entity_type` / `entity_id` / `field_name` | text | |
| `old_value_text` / `new_value_text` | text | |
| `change_type` / `metadata` | | |

---

### `github_sync_queue`
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `operation` | text | CHECK: `push_inventory` / `push_archive_snapshot` / `push_invoice` / `push_menu` / `push_items_catalog` |
| `payload` | jsonb | |
| `commit_id` | uuid FK | |
| `attempts` | int | retry counter |

---

### `events`
Column `cat` (NOT `category`) — `title`, `date (YYYY-MM-DD)`, `cat`, `theme`, `description`, `suggested_menu`, `status`, `staging_entry_id`

---

### `menu_entries`
- `items` and `sides` are **TEXT columns storing JSON strings** — not jsonb arrays. Serialize with `json.dumps([])`.
- Keys: `cycle_id`, `week_number`, `day_of_week`, `meal_type`, `sort_order`

---

### `haccp_logs`
`location`, `temperature` (−50 to 150), `unit` (F/C), `timestamp` (ISO 8601), `checked_by`, `notes`, `staging_entry_id`

### `daily_operations_logs`
`entry_type`, `title`, `description`, `severity` (`debug/info/warning/error`), `data` (text), `created_by`, `staging_entry_id`

### `app_settings`
Key-value store. Keys include `ai_provider` (`groq`/`ollama`) and `ai_model`.

---

## RPCs

### `perform_rollover()`
- **SECURITY DEFINER** — runs as DB owner.
- Computes ending balance for each item in the latest open month.
- Inserts new `monthly_inventory` rows for next month with ending balances as `on_hand`.
- Sets current month `month_status.status = 'published'`.
- Opens next month with `status = 'open'`.
- Has CASE WHEN guards (idempotent-safe as of 2026-06 fix).

---

## SKU Indexing Convention

| Source | Format | Example |
|---|---|---|
| Vendor-assigned | Numeric or alphanumeric | `9422965`, `DRY-001` |
| Auto-generated (no vendor SKU) | `MJC-<base36>` | `MJC-LQ8K2P` |
| Batch compact staging entity_id | `batch-compact-{month1}-{year}` | `batch-compact-6-2026` |
| Inventory save entity_id | `{sku}-{month1indexed}-{year}` | `9422965-6-2026` |
| Weekly invoice entity_id | `W{week}-{dir}-{month}-{year}` | `W1-received-6-2026` |

---

## Dispatch Operations Reference

| Operation | Handler | Payload keys |
|---|---|---|
| `inventory_save` | `dispatch_inventory_save` | `month, year, items[{sku,desc,onHand,par,price,category}], notes` |
| `inventory_week_update` | `dispatch_inventory_week` | `month, year, week(1-4), direction(received\|issued), items[{sku,desc,qty}]` |
| `item_update` | `dispatch_item_update` | `sku, desc?, category?, price?, par?, unit?, active?, new_sku?` |
| `item_delete` | `dispatch_item_delete` | `sku, hard?(bool)` |
| `menu_save` | `dispatch_menu_save` | `day, data:{meal_type:[items]}` |
| `event_create` | `dispatch_event_create` | `title, date, cat, theme?, description?` |
| `haccp_save` | `dispatch_haccp_save` | `location, temperature, unit, timestamp, checked_by, notes?` |
| `daily_log_save` | `dispatch_daily_log_save` | `entry_type, title, description?, severity?, data?` |
| `user_create` | `dispatch_user_create` | `username, display_name, last_name?, role, pin?, active?, email?` |
| `user_update` | `dispatch_user_update` | `user_id, display_name?, last_name?, role?, pin?, active?` |

---

## Known Landmines

| Issue | Detail | Status |
|---|---|---|
| `par_level` global contamination | Monthly saves were writing `par=item.par` to `inventory_items`. Fixed 2026-06-12 — all dispatch paths now pass `par=None`. | Fixed |
| Published period writes | No guard existed before 2026-06-12. Now: 403 from `POST /api/staging`, dispatch functions, and `POST /api/inventory`. | Fixed |
| `month_status` indexing | DB month is 0-indexed; API and frontend send 1-indexed. Guards must convert: `db_month = api_month - 1`. | Known, handled |
| `perform_rollover` safe | Was missing CASE WHEN guards. Fixed in live DB 2026-06 (BUG-C). | Fixed |
| Stale May staging entry | Had `month:5` (published) entry stuck in queue. Cleared 2026-06-12. Root cause fixed by staging-time guard. | Fixed |
| `menu_entries.items/sides` | TEXT not jsonb — must be serialized strings, not raw arrays. | Documented |
| `staging_entries_status_check` | Constraint only allows `pending/merged/rejected`. Writing `approved` → 23514 error. | Documented |
