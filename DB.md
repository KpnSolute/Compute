# MJCC Database Reference — `DB.md`

**Live DB:** Supabase `MJCCv1` — project ref `mgvyylvmkxhhataavqjz` — region `us-west-1`
**Access:** Supabase MCP tools / service-role key (backend only). Always verify live schema before trusting this doc.
**Status:** Inventory/source-control reset completed (2026-06-20). **40 domain tables, 0 backup tables in `public`, 6 views, 33 functions.**
**Governance:** `AGENTS.md` remains the project source of truth. This file is the live database reference.

> **Golden rule:** the frontend never writes data. All writes go through the FastAPI backend using the `service_role` key. The browser (`authenticated` role) has **read-only** access enforced by RLS. This is the "Option A / backend-mediated" architecture the whole system assumes.

---

## 0. Reset baseline — 2026-06-20

The production Supabase project was intentionally wiped clean of inventory, invoice, source-control, and period-history rows on 2026-06-20. The system is now a skeleton for rebuilding history through Data Entry.

**Inventory origin for rebuild:** April 2026 is the planned starting point for the rebuilt inventory history. Earlier records may be imported from historical spreadsheets/invoices for reference and reconstruction, but the clean operational baseline starts at April 2026.

**Tables confirmed empty after reset:** `inventory_items`, `item_barcodes`, `monthly_inventory`, `monthly_snapshots`, `invoices`, `invoice_items`, `month_periods`, `week_gross`, `sku_review_queue`, `staging_entries`, `pull_requests`, `commits`, `commit_changes`, `inventory_versions`, `github_sync_queue`, `month_status`, `week_status`.

**Tables intentionally preserved:** `user_profiles` (13), `app_settings` (10), `inventory_categories` (11), `vendors` (3), `events` (34), `menu_cycles` (1), `opening_checklist_items` (8), `servsafe_certifications` (7), `daily_operations_logs` (8), `ai_provider_keys` (2), `ai_stack_config` (1). Logins, roles, reference data, and AI configuration were not wiped.

**Backup cleanup:** `_backup_may2026_monthly_inv` and `_backup_may2026_snapshot` were dropped from `public`. No `_backup_may2026_*` public tables remain.

**Data Entry rebuild path:** inventory must be repopulated through Data Entry and Source Control, not direct table edits. Supported parser stack is deterministic first and AI-assisted only when enabled: CSV/TSV, Excel through `pandas` + `openpyxl`, PDF text extraction through `pdfplumber` then `pdfminer.six`, and scanned PDF/image OCR rendering through `PyMuPDF`/`Pillow`.

**AI access gate:** `app_settings.agent_config.min_role` is `manager`, so staff should not have AI tool access. Backend route code also needs deployment for the local `GET/POST /api/agent/automations` min-role guard to be active in production.

**AI provider baseline:** the active default AI stack is Google Gemini with a vision-capable `gemini-2.5-flash` model. Two Google keys have separate jobs and must not be collapsed into one config:
- `provider='google'`, label `MJCC Google AI Studio Language`: AI Studio/Gemini language and structured data extraction.
- `provider='google_cloud_vision'`, label `MJCC Google Cloud Vision OCR`: Google Cloud Vision OCR for scanned PDFs/images before invoice parsing.

**Data Entry extraction order:** digital/text PDFs are parsed locally first with `pdfplumber` / `pdfminer.six`. Scanned PDFs and images are rendered/read as images, sent to Google Cloud Vision OCR, parsed back through the deterministic invoice parser, and only then fall back to Gemini vision/legacy OCR when OCR text cannot produce line items. This keeps local PDF extraction working while using the Cloud API for picture reading.

---

## 1. Critical invariants — read before touching anything

| Rule | Detail |
|---|---|
| `monthly_inventory.on_hand` = **OPENING balance** | Ending = `on_hand + Σreceived − Σissued`. `perform_rollover` copies ending into next month's opening. Writers MUST store opening, never the computed closing. |
| `month` is **0-indexed** everywhere in the DB | `0`=Jan … `11`=Dec. CHECK enforces 0–11. The API is 1-indexed; convert at the boundary: `db_month = api_month − 1`. |
| Inventory weeks run **W1–W5** | 29–31 day months have a real week 5. `monthly_inventory` and `perform_rollover` both handle `w5_*`. |
| `par_level` lives in `inventory_items` — **global** | One par per item, shared across all periods. Not per-month. |
| Published period = **read-only, enforced by trigger** | `guard_closed_month_writes` rejects any write to a `published` month. To edit a closed month: set `month_status.status='open'`, edit, re-close. |
| `user_profiles` has **no password column** | Admin/manager auth = Supabase Auth (JWT) keyed by synthesized email; staff auth = `pin`. |
| Canonical inventory model | `inventory_items` (catalog) + `item_barcodes` (barcode map) + `monthly_inventory` (period fact). The old `barcodes` / `inventory_master` parallel stores were removed. |
| Upsert key for period data | `monthly_inventory (item_id, month, year)` — UNIQUE. Use this `on_conflict`. |

---

## 2. Conventions

- **Quantities/prices** default to `0` and are nullable on `monthly_inventory`, so a **partial upsert** (e.g. one week's receipts) writes only the columns you supply; the rest are preserved/defaulted.
- **`menu_entries.items` / `.sides`** are `text` holding JSON strings — `json.dumps` on write, `json.loads` on read.
- **Timestamps** are `timestamptz`; `created_at`/`updated_at` are auto-maintained by `touch_updated_at`-family triggers.
- **PKs** are `uuid DEFAULT gen_random_uuid()` unless noted (`month_status.id` is serial; `pull_requests.pr_number` is a bigint sequence).
- **RLS** is on for data tables: `service_role` = ALL, `authenticated` = SELECT only.

---

## 3. Canonical inventory model (the core)

```
inventory_categories ─┐
                      ├─< inventory_items >─┬─< monthly_inventory  (period fact: opening + W1..W5 received/issued)
vendors ──────────────┘                    ├─< item_barcodes      (barcode -> item map)
                                           └─< sku_review_queue   (unresolved parsed SKUs)
```

**Ending / value math (single source of truth):**
```
received = w1_received + w2_received + w3_received + w4_received + w5_received
issued   = w1_issued   + w2_issued   + w3_issued   + w4_issued   + w5_issued
ending   = GREATEST(0, on_hand + received − issued)      -- current stock
value    = ending * unit_price                            -- inventory value
reorder  = ending < par_level                             -- low stock (uses ending, not opening)
```
This is implemented identically in `perform_rollover`, the `live_inventory` view, the API read path, and the frontend.

---

## 4. Table reference (by domain)

Notation: **PK**, *FK→table*, `UQ`(unique). Common audit columns `created_at`/`updated_at` noted as `+ts`.

### 4.1 Identity & reference

**`inventory_items`** — item catalog (one row per item)
`id` PK · `sku` text NN `UQ` · `barcode_id` text `UQ` · `description` text NN · `category_id` *FK→inventory_categories* · `vendor_id` *FK→vendors* · `unit_price` num=0 · `par_level` int=0 · `unit` text='CS' · `active` bool=true · `sku_pending` bool · `needs_attention` bool · +ts

**`inventory_categories`** — `id` PK · `name` text NN `UQ` · `color` text='#888888' · `icon` text · `sort_order` int=0

**`vendors`** — `id` PK · `name` text NN · `vendor_code` text · address/city/state/zip/phone/email · `account_number` text · +ts

**`item_barcodes`** — barcode→item map (canonical). `id` PK · `item_id` *FK→inventory_items* NN · `barcode` text NN `UQ` · `type` text='CODE128' · `is_primary` bool=true · `created_at`

**`sku_review_queue`** — parsed SKUs awaiting human match. `id` PK · `parsed_sku` NN · `parsed_description` · `vendor_id` *FK→vendors* · `source_ref` · `qty`/`unit_price` · `suggested_item_id` *FK→inventory_items* · `status`='pending' · `resolution` · `resolved_item_id` *FK→inventory_items* · `resolved_by` *FK→user_profiles* · `resolved_at` · `created_at`

### 4.2 Inventory fact & period locking

**`monthly_inventory`** — per-item/per-month fact. `id` PK · `item_id` *FK→inventory_items* NN · `month` int NN (0–11) · `year` int NN · `on_hand` num=0 *(opening)* · `w1_received`..`w5_received` num=0 · `w1_issued`..`w5_issued` num=0 · `unit_price` num=0 · +ts · **UQ(item_id, month, year)**
Triggers: `guard_closed_month_writes`, `guard_locked_week_writes`, `touch_updated_at`, `trg_refresh_snapshot`.

**`month_status`** — inventory period lock. `id` serial PK · `month` int NN (0–11) · `year` int NN (2020–2040) · `status` text ∈ {`open`,`published`} · `opened_at` · `published_at` · `published_by` *FK→user_profiles* · **UQ(month, year)**

**`week_status`** — per-week lock. `id` PK · `month` NN · `year` NN · `week` int NN (1–5) · `status` ∈ {`open`,`locked`,`published`} · `locked_by` *FK→user_profiles* · `locked_at` · `created_at` · **UQ(month, year, week)**

**`monthly_snapshots`** — period rollup (computed). `id` PK · `month` NN · `year` NN · `grand_total` · `category_totals` jsonb · `item_count` · `reorder_count` · `preset` bool · `data` jsonb · `wk1_total`..`wk5_total` · `starting_total` · `saved_by` · `saved_at` · **UQ(month, year)**. Maintained by `trg_refresh_snapshot` / `refresh_monthly_snapshot`.

### 4.3 Purchasing (invoices) — separate period spine from inventory locking

**`month_periods`** — purchasing period summary. `id` PK · `month` NN · `year` NN · `status`='open' · `starting_balance` · `closing_balance` · `total_received` · `total_pulled` · `opened_at` · `published_at` · `notes` · **UQ(month, year)**

**`week_gross`** — per-week invoice aggregation. `id` PK · `month_period_id` *FK→month_periods* NN · `week_number` NN · `gross_received` · `vizient_discount` · `fuel_surcharge` · `net_received` · `invoice_count` · `notes` · `updated_at` · **UQ(month_period_id, week_number)**. Refreshed by `refresh_week_gross` via `trg_invoice_refresh_week`.

**`invoices`** — `id` PK · `vendor_id` *FK→vendors* · `invoice_number` NN · account/order/PO numbers · dates (invoice/order/due/shipped) · `payment_terms`='NET 30 DAYS' · `month`/`year`/`week_number` · `subtotal`/`discount`/`tax`/`total`/`vizient_discount`/`fuel_surcharge`/`net_total` · driver/route/stop · `status`='received' · `applied_by` · `week_gross_id` *FK→week_gross* · `month_period_id` *FK→month_periods* · +ts

**`invoice_items`** — `id` PK · `invoice_id` *FK→invoices* NN · `sku` · `description` NN · `category`='Uncategorized' · `label`/`pack_size`/`unit` · `quantity_ordered`/`shipped`/`adjusted` · `unit_price`/`extended_price`/`pricing_unit` · `weight` · `lot_numbers` text[] · `notes` · `created_at`

### 4.4 Source control (Git-style versioning over inventory)

Flow: **`staging_entries` → `pull_requests` → `commits` → `commit_changes`**, with `inventory_versions` (snapshots) and `github_sync_queue` (archive push).

**`staging_entries`** — pending changes. `entry_id` PK · `status` ∈ {`pending`,`merged`,`rejected`} · `submitted_by`/`reviewed_by` *FK→user_profiles* · `expires_at` (now+15d) · `source`/`file_ref`/`batch_id` · `entity_type`/`entity_id`/`field_name` · `old_value_text`/`new_value_text` · `change_type` · `metadata` jsonb · `operation` · `full_payload` jsonb · `pull_request_id` *FK→pull_requests*

**`pull_requests`** — `pr_id` PK · `pr_number` bigint NN `UQ` (seq) · `title` NN · `description` · `author_id` *FK→user_profiles* · `status` ∈ {`draft`,`open`,`merged`,`closed`} · `branch`='main' · `entity_scope`/`source`/`review_note` · `commit_id` *FK→commits* · +ts · `merged_at`/`merged_by` · `closed_at`/`closed_by`

**`commits`** — `commit_id` PK · `parent_ids` uuid[] · `message` NN · `author_id` *FK→user_profiles* · `status` ∈ {`merged`,`reverted`} · `branch`='main' · `merged_at`/`merged_by` · `month`/`year` · `source`='manual' (e.g. `rollover`, `manual`, archive import) · `file_ref`/`github_sha`/`github_synced_at` · `pull_request_id` *FK→pull_requests*

**`commit_changes`** — **dual-schema (phase-2 unify).** Carries BOTH a numeric item-level delta set (`item_id`,`month`,`year`,`week_number`,`field`,`old_value`,`new_value`,`action`) used by `perform_rollover` / `revert_to_commit`, AND a general text/entity audit set (`entity_type`,`entity_id`,`field_name`,`old_value_text`,`new_value_text`,`change_type`,`metadata`). `change_id` PK · `commit_id` *FK→commits* NN.

**`inventory_versions`** — `version_id` PK · `snapshot_data` jsonb NN · `summary_data` jsonb · `created_by` *FK→user_profiles* · `message` · `parent_version_id` *FK→self* · `month`/`year` NN · `commit_id` *FK→commits*

**`github_sync_queue`** — `id` PK · `operation` ∈ {`push_inventory`,`push_archive_snapshot`,`push_invoice`,`push_menu`,`push_items_catalog`} · `payload` jsonb NN · `commit_id` *FK→commits* · `attempts`=0 · `last_error` · `synced_at`

### 4.5 Compliance & operations

**`haccp_logs`** — `id` PK · `location` NN · `temperature` float NN · `unit`='F' · `timestamp` · `checked_by` NN · `notes` · `staging_entry_id` `UQ`
**`incident_logs`** — `id` PK · `incident_type` NN · `description` NN · `reported_by` NN · `reported_at` · `resolved_at`/`resolved_by` · `notes`
**`daily_operations_logs`** — `id` PK · `entry_type` NN · `title` NN · `description` · `severity`='info' · `data` text · `created_by` · `staging_entry_id` `UQ`
**`events`** — `id` PK · `cat` text NN='other' *(note: column is `cat`, not `category`)* · `title` NN · `date` NN · `theme`/`description`/`suggested_menu` · `status`='planned' · `staging_entry_id` `UQ` · +ts
**`opening_checklist_items`** — `id` PK · `task` NN · `sort_order` · `is_active` · `created_at`
**`servsafe_certifications`** — `id` PK · `staff_name` NN · `certification` NN · `expiry_date` · `is_proctor` · +ts

### 4.6 Menus & meals

**`menu_cycles`** — `id` PK · `name` NN · `start_date`/`end_date` · `active` · `created_at`
**`menu_entries`** — `id` PK · `cycle_id` *FK→menu_cycles* · `week_number` int NN · `day_of_week` NN · `meal_type` NN · `items` text(JSON) · `sides` text(JSON) · `is_vegetarian` · `sort_order` · +ts · **UQ(cycle_id, week_number, day_of_week, meal_type)**
**`meal_periods`** — `id` PK · `meal` NN `UQ` · `label` NN · `open_hour`/`close_hour` · `rate`=2.50 · `sort_order`

### 4.7 Auth & admin

**`user_profiles`** — `id` PK (= Supabase Auth uid) · `username` NN `UQ` · `display_name`/`last_name` · `role` ∈ {`staff`,`assistant`,`manager`,`admin`,`sudo`} · `pin` (staff) · `active` NN=true · `email` · `last_login` · phone/job_title/avatar_url/bio · +ts. **No password column.**
**`app_settings`** — `setting_key` PK · `setting_value` jsonb NN · `updated_by` · `updated_at`
**`audit_log`** — `id` PK · `table_name` NN · `record_id` · `action` NN · `old_values`/`new_values` jsonb · `performed_by` *FK→user_profiles* · `created_at`
**`centers`** — `id` PK · `name` NN · `code` `UQ` · address/city/state · `created_at`
**`api_keys`** — `id` PK · `provider` NN `UQ` · `api_key`/`base_url` · `is_active` · `updated_by`/`updated_at`

### 4.8 AI subsystem

**`ai_providers`** — `provider` PK · `label` NN · `description` · `has_key` · `default_url` · `sort_order`=99
**`ai_provider_keys`** — `id` PK · `provider` NN · `label` NN · `api_key`/`base_url` · `is_active` · `model_override` · `is_default` · `created_by` *FK→user_profiles* · +ts · **UQ(provider, label)**
**`ai_stack_config`** — `id` PK · `name` NN='default' `UQ` · `provider` NN · `key_id` *FK→ai_provider_keys* · `model` NN · `is_vision`/`vision_capable` · `ollama_url` · `updated_by`/`updated_at`
**`ai_usage_logs`** — `id` PK · `provider`/`model` NN · `operation` · `tokens_in`/`tokens_out`/`cost_usd`/`duration_ms` · `success` · `error_msg` · `called_by` · `created_at`
**`agent_conversations`** — `id` PK · `user_id` *FK→user_profiles* NN · `role` NN · `content` NN · `tool_name`/`tool_args`/`tool_result` · `created_at`
**`agent_usage`** — `id` PK · `user_id` *FK→user_profiles* NN · `created_at`
**`archive_import_log`** — `id` PK · `source` NN · `filename` NN · `month`/`year` · `items_imported`/`items_skipped` · `imported_at` · `status`='pending' · `error`

### 4.9 Public backup tables

No `_backup_may2026_*` backup tables remain in `public`. Historical safety snapshots still live in the dedicated backup schemas listed in Backups & rollback.

---

## 5. Views (6)

- **`live_inventory`** — current live stock for the **open period** (fallback latest) derived from `monthly_inventory` + `inventory_items` (+ primary barcode). Exposes `on_hand` (= **ending** stock), `opening_on_hand`, `w1r..w5r`, `w1i..w5i`, `total_received`, `total_issued`, `sub_total` (= ending × price), `order_qty`, `par_level`, `barcode_id`. **This is the dashboard's inventory source.** Used by the API.
- **`dashboard_summary`**, **`category_spending`**, **`category_summary`**, **`invoice_spending_summary`**, **`item_price_history`**, **`monthly_comparison`** — reporting views (read-only).

---

## 6. Functions (33) & triggers

**Period / inventory:** `perform_rollover` (carry ending→next opening, incl. W5; publishes from-month), `get_current_period`, `get_distinct_months`, `increment_inventory_field`, `refresh_monthly_snapshot` + `trg_refresh_snapshot`, `refresh_week_gross` + `trg_invoice_refresh_week`, `set_week_status`, `admin_merge_items` (merge two items → `monthly_inventory` + `item_barcodes`), `import_archive_month`, `resolve_invoice_sku`, `sku_add_alias`, `sku_review_resolve`.

**Guards (triggers on `monthly_inventory`):** `guard_closed_month_writes` (block writes to non-open months), `guard_locked_week_writes` (block writes to locked weeks — **note: bypasses `service_role`**, so it does not restrain the backend; see phase-2).

**Source control:** `merge_single_staging`, `execute_stage_merge`, `push_all_staging`, `reject_staging`, `cleanup_expired_staging`, `revert_to_commit`, `sc_open_pull_request`, `sc_attach_to_open_pr`, `sc_finalize_merge`, `sc_close_pull_request`, `sc_touch_updated_at`.

**Auth/util:** `mjc_login`, `rls_auto_enable`, `touch_updated_at`, `update_updated_at`, `profiles_touch_updated_at`, `touch_ai_provider_key`.

---

## 7. Access / RLS model

| Role | Inventory tables | How |
|---|---|---|
| `service_role` (backend) | full CRUD | bypasses RLS; all writes go here |
| `authenticated` (browser) | SELECT only | `authenticated_read` policy |
| `anon` | none | — |

The new API authenticates as `service_role`. Frontend reads directly; **never** writes.

---

## 8. Period lifecycle

1. **Open** — `month_status.status='open'`. Inventory writes (opening counts, weekly receipts/issues) allowed.
2. **Edit** — invoices (received) and exports/pulls (issued) update `monthly_inventory` week columns via partial upsert. Closing is always derived, never stored.
3. **Close / rollover** — `perform_rollover(from_month, from_year, by)`:
   - opens the next month, writes each item's ending as next month's `on_hand`,
   - records a `commits` row (`source='rollover'`) + `commit_changes`,
   - marks the from-month `published` (locked).
4. **Repair a closed month** — set `month_status.status='open'`, re-upload corrected invoices/pulls, re-close. (The guard blocks edits while published.)

---

## 9. Constraints quick-reference

- **Status enums:** `month_status` {open,published}; `week_status` {open,locked,published}; `staging_entries` {pending,merged,rejected}; `pull_requests` {draft,open,merged,closed}; `commits` {merged,reverted}; `user_profiles.role` {staff,assistant,manager,admin,sudo}.
- **Ranges:** `month` 0–11; `week` 1–5; `year` 2020–2040.
- **Key unique constraints:** `monthly_inventory(item_id,month,year)`, `inventory_items(sku)` & `(barcode_id)`, `item_barcodes(barcode)`, `month_status(month,year)`, `week_status(month,year,week)`, `month_periods(month,year)`, `week_gross(month_period_id,week_number)`, `monthly_snapshots(month,year)`, `menu_entries(cycle_id,week_number,day_of_week,meal_type)`, `user_profiles(username)`, `pull_requests(pr_number)`.

---

## 10. Migration ledger (`backend/migrations/`)

| # | What |
|---|---|
| `002_schema_redesign` | original normalized base (pre-existing) |
| `005_fix_rollover_include_week5` | `perform_rollover` now includes W5 in carry-forward |
| `006_fix_closed_month_guard_logic` | publish lock actually enforced (was a no-op) |
| `007_remove_dead_weight` | dropped 9 dead tables, 3 redundant views, 1 orphan fn; rewrote `admin_merge_items` |
| `008_unify_inventory_retire_barcode_dupes` | retired `barcodes` + `inventory_master`; migrated barcode maps to `item_barcodes`; rebuilt `live_inventory` on `monthly_inventory` |
| `009_drop_dead_inventory_items_on_hand` | dropped unmaintained `inventory_items.on_hand` |
| `010_snapshot_trigger_statement_level` | snapshot refresh is statement-level (transition tables), once per write statement instead of per row |
| `011_drop_stale_staging_functions` | dropped 4 stale/broken staging-merge SQL functions (referenced dropped tables / non-existent columns) |

---

## 11. Backups & rollback

- **Full pre-restructure snapshot:** schema **`bak_20260619`** (all 53 original tables, data).
- **Targeted pre-surgery snapshot:** schema **`bak_20260619b`** (barcode/inventory tables).
- **Restore a table:** `CREATE TABLE public.<t> AS TABLE bak_20260619.<t>;` then re-add constraints/indexes from migration 002 + git history.

---

## 12. Phase-2 backlog (do alongside the API rewrite; each changes a shape the API depends on)

1. **Unify `commit_changes`** to a single column model. Blocker: `revert_to_commit` depends on the numeric item-level columns — rework revert first.
2. **`guard_locked_week_writes` bypasses `service_role`** → week locks don't restrain the backend. Decide whether to enforce against the API (small guard change) or treat week-lock as UI-only.
3. **Snapshot trigger cost:** DONE (migration 010) — `trg_refresh_snapshot` is now
   statement-level via transition tables, refreshing each affected period once per
   write statement. The API also batches inventory writes into one statement.
4. **Period spines:** `month_status`/`week_status` (inventory locking) vs `month_periods`/`week_gross` (purchasing) are intentionally separate — revisit only if a single spine is wanted.
5. **GitHub archive payload depth:** rebuild `github_sync_queue` payloads when Source Control resumes so the data archive stores useful inventory snapshots/diffs, not only commit headers.
