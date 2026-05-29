# MJCC Architecture — Full System Design

> Git-for-Foodservice: Inventory management with commit trees, staging pipelines,
> role-based dashboards, barcode/QR tracking, and import/export analytics.

---

## 1. System Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                    Browser (Alpine.js + Tailwind v4)             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────────────┐ │
│  │ Inventory │  │  Source  │  │ Barcodes │  │  Uploads/Files  │ │
│  │  Dashboard│  │ Control  │  │ Gallery  │  │    Gallery      │ │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └───────┬────────┘ │
│       └──────────────┴─────────────┴────────────────┘          │
│                          │ fetch()                             │
└──────────────────────────┼──────────────────────────────────────┘
                           │ session cookie / Bearer token
┌──────────────────────────┼──────────────────────────────────────┐
│                  Flask API (backend/)                            │
│  ┌──────────┐ ┌─────────┐ ┌───────┐ ┌────────┐ ┌──────────┐   │
│  │ auth_bp  │ │inventory│ │users  │ │ files  │ │settings  │   │
│  │ /api/auth│ │_bp      │ │_bp    │ │_bp     │ │_bp       │   │
│  │          │ │/api/... │ │/api/..│ │/api/...│ │/api/...  │   │
│  └──────────┘ └─────────┘ └───────┘ └────────┘ └──────────┘   │
│     rbac.py    validation.py   calculators.py  ai_parser.py     │
│     supabase_client.py (service_role only)                      │
└──────────────────────────┼──────────────────────────────────────┘
                           │ service_role key
┌──────────────────────────┼──────────────────────────────────────┐
│                    Supabase (Postgres)                           │
│  Core:  inventory_items, monthly_inventory, month_status        │
│         inventory_categories, item_barcodes, audit_log          │
│  New:   commits, commit_changes, staging_entries                │
│         uploads, app_settings                                   │
│  Views: dashboard_summary                                        │
│  RPCs:  merge_commit, revert_to_commit, cleanup_staging         │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Role Model (4 Tiers)

| Role | Level | Permissions |
|------|-------|-------------|
| **Staff** | 10 | View inventory (read-only week-by-week), submit to staging area (needs manager merge), view own commit history, scan QR/barcode |
| **Assistant** | 20 | Everything staff + **bypass staging** (submissions auto-merge as commits), edit other users' staged entries |
| **Manager** | 30 | Everything assistant + merge/reject staged entries, push all staged as single commit, revert commits, manage items (CRUD), publish months, manage versions, parse/apply invoices, view commit tree, reports + activity stats, barcode gallery export |
| **Admin** | 40 | Everything manager + user management (CRUD), app settings (AI keys, config), view all commit graphs |

Role `corporate` (read-only) is **deprecated** — replaced by staff read-only view.

---

## 3. Navigation (GitHub-Style Sidebar)

### Staff Sidebar
```
┌─────────────────────────────────────┐
│  ☰ MJCC Inventory                   │
│─────────────────────────────────────│
│  📦 Inventory          ← Current /active│
│  📷 QR Portal          ← Coming soon │
│  🏷️ Barcodes           ← Gallery    │
│  🔄 Source Control     ← Commits    │
│  📁 Files              ← Uploads    │
│  ─────────────────────────────────── │
│  👤 Staff Name          │  Logout   │
└─────────────────────────────────────┘
```

### Admin/Manager Sidebar
```
┌─────────────────────────────────────┐
│  ☰ MJCC Inventory                   │
│─────────────────────────────────────│
│  📦 Inventory          ← Full CRUD │
│  🔄 Source Control     ← Tree/graph│
│  📊 Reports            ← Stats     │
│  👥 Users              ← Mgmt     │
│  🏷️ Barcodes           ← Gallery   │
│  ⚙️ Settings           ← Config   │
│  📁 Files              ← Uploads   │
│  ─────────────────────────────────── │
│  👤 Admin Name           │  Logout  │
└─────────────────────────────────────┘
```

---

## 4. Commit System (Replaces Staging Pipeline)

### Concepts

| Old Name | New Name | Description |
|----------|----------|-------------|
| `pending_submissions` | `staging_entries` | Temp queue, 15-day TTL |
| `POST /submit` | `POST /commits/stage` | Submit to staging |
| `POST /approve` | `POST /staged/<id>/merge` | Merge one entry |
| `POST /reject` | `POST /staged/<id>/reject` | Reject one entry |
| — | `POST /commits/push` | Push ALL staged as one commit |
| — | `commits` table | Permanent tree of all merges |
| — | `commit_changes` table | Per-commit field changes |
| — | `POST /commits/<id>/revert` | Revert to previous state |

### Data Flow

```
Staff / Assistant
     │
     │ POST /commits/stage { item, week, field, value, action }
     ▼
┌──────────────────────┐
│   staging_entries    │  ← 15-day TTL (auto-expires)
│   status: 'pending'  │
└──────────┬───────────┘
           │
           ├── [staff]: stays pending until manager acts
           ├── [assistant]: auto-calls POST /commits/push → immediate commit
           │
           ▼  Manager
┌─────────────────────────────────────┐
│  Review → Merge Individual         │
│        → Push ALL (single commit)  │
│        → Reject                    │
└────────────────┬────────────────────┘
                 ▼
┌─────────────────────────────────────┐
│  ┌─────────┐                        │
│  │ commit  │ ← commit_id, parent_ids│
│  │         │    message, author,    │
│  │         │    status, branch      │
│  └────┬────┘                        │
│       ▼                             │
│  ┌──────────────┐                   │
│  │commit_changes│ ← item, week,    │
│  │              │    field, old/new,│
│  │              │    action(pull/enter)│
│  └──────────────┘                   │
│       ▼                             │
│  ┌────────────────────┐             │
│  │ monthly_inventory  │ ← updated  │
│  │ (atomic via RPC)   │             │
│  └────────────────────┘             │
│       ▼                             │
│  ┌────────────────────┐             │
│  │inventory_versions  │ ← snapshot │
│  │ (linked to commit) │             │
│  └────────────────────┘             │
└─────────────────────────────────────┘
```

### Commit Tree (DAG)

Each merge/push creates a node. Parent pointers form a directed acyclic graph:

```
root (captures initial state, created on first push)
  │
  ├── commit A "wk1 chicken count"
  │     │
  │     ├── commit B "wk2 oil delivery"
  │     │     │
  │     │     └── commit C "wk3 rice count" ← main branch
  │     │
  │     └── commit D "wk1 correction" ← side branch
  │           │
  │           └── commit E "merge D→main" (parents: C, D)
  │
  └── commit F "wk4 produce" ← another branch
```

- Linear history by default (single parent)
- Branching via alternative parent_id
- Merge commits have 2+ parents
- The tree is stored as `parent_ids UUID[]` in the `commits` table

---

## 5. Data Model

### New Tables

#### `commits`
| Column | Type | Description |
|--------|------|-------------|
| commit_id | UUID PK | Auto-generated |
| parent_ids | UUID[] | Array of parent commit IDs (supports branching/merging) |
| message | TEXT | Human-readable description |
| author_id | UUID FK → user_profiles | Who created this commit |
| status | TEXT | `merged` or `reverted` |
| branch | TEXT | Default `main` |
| created_at | TIMESTAMPTZ | Creation time |
| merged_at | TIMESTAMPTZ | When merged |
| merged_by | UUID FK → user_profiles | Who approved/merged |

#### `commit_changes`
| Column | Type | Description |
|--------|------|-------------|
| change_id | UUID PK | Auto-generated |
| commit_id | UUID FK → commits | Parent commit (CASCADE delete) |
| item_id | UUID FK → inventory_items | Item changed |
| month | INT | 0-11 |
| year | INT | 2020-2030 |
| week_number | INT | 1-4 |
| field | TEXT | `received` or `issued` |
| action | TEXT | `pull` (import) or `enter` (export) |
| old_value | NUMERIC | Value before change |
| new_value | NUMERIC | Value after change |

#### `staging_entries` (replaces `pending_submissions`)
| Column | Type | Description |
|--------|------|-------------|
| entry_id | UUID PK | Auto-generated |
| item_id | UUID FK → inventory_items | Item |
| month, year, week_number | INT | Target period |
| field | TEXT | `received` or `issued` |
| action | TEXT | `pull` or `enter` |
| submitted_value | NUMERIC | Proposed new value |
| previous_value | NUMERIC | Current value at submission time |
| status | TEXT | `pending`, `merged`, `rejected` |
| submitted_by | UUID FK → user_profiles | Who submitted |
| reviewed_by | UUID FK → user_profiles | Who reviewed (nullable) |
| review_note | TEXT | Manager's note |
| created_at | TIMESTAMPTZ | Submission time |
| expires_at | TIMESTAMPTZ | `created_at + 15 days` |
| reviewed_at | TIMESTAMPTZ | When reviewed |

#### `uploads`
| Column | Type | Description |
|--------|------|-------------|
| upload_id | UUID PK | Auto-generated |
| file_name | TEXT | Original filename |
| file_type | TEXT | `invoice_pdf`, `delivery_photo`, `receipt`, `other` |
| file_size | INT | Bytes |
| storage_path | TEXT | Storage location |
| uploaded_by | UUID FK → user_profiles | Who uploaded |
| commit_id | UUID FK → commits | Optional link to commit |
| created_at | TIMESTAMPTZ | Upload time |

#### `app_settings`
| Column | Type | Description |
|--------|------|-------------|
| setting_key | TEXT PK | Setting name |
| setting_value | JSONB | Setting value (supports any type) |
| updated_by | UUID FK → user_profiles | Last editor |
| updated_at | TIMESTAMPTZ | Last update |

### Modified Tables

#### `user_profiles`
Add: `last_name TEXT`
Expand role check: `CHECK (role IN ('admin', 'manager', 'assistant', 'staff'))`
_(`corporate` removed — staff read-only replaces it)_

#### `inventory_versions`
Add: `commit_id UUID FK → commits` (nullable link to the commit that triggered this snapshot)

### Existing Tables (unchanged)
- `inventory_items` — master catalog
- `monthly_inventory` — monthly data per item
- `month_status` — month lifecycle (open → published)
- `inventory_categories` — category definitions
- `item_barcodes` — barcode mappings
- `audit_log` — append-only audit trail
- `monthly_snapshots` — frozen monthly records

### RPC Functions
| RPC | Description |
|-----|-------------|
| `merge_single_staging(p_entry_id, p_reviewed_by, p_review_note)` | Merge one staging entry + audit log + update monthly_inventory |
| `push_all_staging(p_reviewed_by, p_message, p_branch)` | Push ALL pending staging as single commit + create tree node + snapshot |
| `revert_to_commit(p_target_commit_id, p_reverted_by)` | Revert inventory to state at given commit (creates new revert commit) |
| `cleanup_expired_staging()` | Delete staging entries where expires_at < now() |

---

## 6. API Structure

### Auth Blueprint `/api/auth`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/auth/login` | Public | Two flows: staff (username+PIN) / admin (username+password) |
| GET | `/api/auth/me` | Session | Returns user profile |
| POST | `/api/auth/logout` | Session | Clears session |

### Inventory Blueprint `/api/inventory`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/inventory/current-month` | All | Current open month info |
| GET | `/api/inventory/months/<m>/<y>` | All | Full month inventory |
| GET | `/api/inventory/months/<m>/<y>/weeks/<w>` | All | Single week |
| GET | `/api/inventory/items` | All | Paginated item catalog |
| GET | `/api/inventory/items/<id>` | All | Single item |
| POST | `/api/inventory/items` | Manager+ | Create item |
| PATCH | `/api/inventory/items/<id>` | Manager+ | Update item |
| DELETE | `/api/inventory/items/<id>` | Manager+ | Soft-delete item |
| GET | `/api/inventory/summary` | All | Dashboard summary |
| GET | `/api/inventory/categories` | All | Category list |
| GET | `/api/inventory/history` | All | Monthly snapshots |
| POST | `/api/inventory/publish` | Manager+ | Publish month |

### Commit Endpoints (replaces staging pipeline)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/inventory/commits/stage` | Staff+ | Submit to staging (staff→pending, assistant→auto-merge) |
| GET | `/api/inventory/commits/staged` | Manager+ | List pending staging entries |
| GET | `/api/inventory/commits/staged/<id>` | Manager+ | Single staging entry |
| PATCH | `/api/inventory/commits/staged/<id>` | Manager+ | Revise staging entry |
| DELETE | `/api/inventory/commits/staged/<id>` | Manager+ | Delete staging entry |
| POST | `/api/inventory/commits/staged/<id>/merge` | Manager+ | Merge single entry |
| POST | `/api/inventory/commits/staged/<id>/reject` | Manager+ | Reject single entry |
| POST | `/api/inventory/commits/push` | Manager+ | Push ALL staged as one commit |
| GET | `/api/inventory/commits` | All | List commits (paginated, tree data) |
| GET | `/api/inventory/commits/<id>` | All | Single commit + changes |
| GET | `/api/inventory/commits/<id>/diff` | All | Diff of changes |
| POST | `/api/inventory/commits/<id>/revert` | Manager+ | Revert to this commit |
| GET | `/api/inventory/commits/tree` | All | Full DAG tree data (for graph viz) |
| GET | `/api/inventory/state` | Manager+ | Inventory state at specific commit (?commit_id=) |

### Invoice Endpoints
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/inventory/parse-invoice` | Manager+ | AI-parse invoice text |
| POST | `/api/inventory/apply-invoice` | Manager+ | Apply parsed matches |

### Versions
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/inventory/versions` | All | List snapshots |
| GET | `/api/inventory/versions/<id>` | All | Get snapshot |
| POST | `/api/inventory/versions` | Manager+ | Create snapshot (manual) |
| POST | `/api/inventory/versions/<id>/restore` | Manager+ | Restore snapshot |

### Activity / Import-Export
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/inventory/activity` | All | Activity feed (commit history with changes) |
| GET | `/api/inventory/activity/stats` | Manager+ | Aggregated import/export stats |

### Barcodes
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/inventory/items/<id>/barcode` | All | Get item barcode |
| POST | `/api/inventory/items/<id>/barcode/regenerate` | Manager+ | Regenerate barcode |
| GET | `/api/barcodes` | All | List all barcodes for gallery |
| POST | `/api/barcodes/export` | Manager+ | Export selected barcodes as PDF/JPEG |

### Users Blueprint `/api/users`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/users` | Admin | List users |
| POST | `/api/users` | Admin | Create user |
| PATCH | `/api/users/<id>` | Admin | Update user (incl. last_name, role) |
| DELETE | `/api/users/<id>` | Admin | Delete user |

### Files Blueprint `/api/files` (coming soon)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/api/files/upload` | Manager+ | Upload file |
| GET | `/api/files` | All | List files |
| GET | `/api/files/<id>` | All | Download file |
| DELETE | `/api/files/<id>` | Manager+ | Delete file |

### Settings Blueprint `/api/settings`
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/api/settings` | Admin | Get all settings |
| PATCH | `/api/settings` | Admin | Update settings |

---

## 7. Page Structure (Frontend)

| Route | Page | Roles | Components |
|-------|------|-------|------------|
| `/login` | Login page | All | PIN form, password form, role toggle |
| `/inventory` | Inventory | All | Week stepper, item table (staff=read-only, manager+=CRUD), submit modal, item edit modal |
| `/source-control` | Source Control | All | Commit graph (D3.js), staging list (manager+), commit detail, diff view, merge/push/reject buttons |
| `/reports` | Reports | Manager+ | Month selector, summary, category breakdown, reorder alerts, activity stats (import/export charts) |
| `/users` | User Mgmt | Admin | User table, create/edit/delete modals, role selector |
| `/barcodes` | Barcode Gallery | All | Grid of barcode cards, select/export, format picker (PDF/JPEG), quantity input |
| `/settings` | Settings | Admin | AI provider/key config, branch management, system info |
| `/files` | Uploads Gallery | All | Grid of uploaded files, upload button, filter by type (coming soon) |
| `/qr-portal` | QR Portal | All | Placeholder: "Coming soon — install the MJCC mobile app" |

### Shared Components (Alpine Stores)
| Store | Purpose |
|-------|---------|
| `Alpine.store('api')` | All API calls (existing, expand for new endpoints) |
| `Alpine.store('toast')` | Toast notifications |
| `Alpine.store('confirm')` | Confirmation dialog |
| `Alpine.store('modal')` | Generic modal |
| `Alpine.store('sidebar')` | Sidebar state (active page, collapsed) |
| `Alpine.store('auth')` | User + role info |

### Magic Helpers (existing, extend)
| Magic | Purpose |
|-------|---------|
| `$money(n)` | Format currency |
| `$number(n)` | Format integer |
| `$datetime(iso)` | Format date |
| `$monthName(m)` | Month name from index |
| `$timeAgo(iso)` | Relative time ("2h ago") |

### Commit Modal (shared)
```
┌─── Commit Change ──────────────────────────┐
│ Item:  [autocomplete dropdown ▼] [+ New]   │
│ SKU:   [_________]  or scan barcode        │
│ Week:  [1] [2] [3] [4]                     │
│ Field: [received] / [issued]               │
│ Action:[Pull (import)] [Enter (export)]    │
│ Value: [___]                               │
│────────────────────────────────────────────│
│ Staging area: 3 pending changes            │
│  ○ w2 Chicken Breast   +12 units  [✕]     │
│  ○ w3 Cooking Oil       -2 units  [✕]     │
│  ○ w4 Rice             +20 units  [✕]     │
│────────────────────────────────────────────│
│ [Cancel]                    [Submit All]   │
└────────────────────────────────────────────┘
```

### Commit Graph Component
```
┌─── Commit History ─────────────────────────┐
│ ○ root  "Initial state"    2h ago   main   │
│ │                                           │
│ ● 3f2a  "wk1 chicken"      1h ago   main   │
│ │                                           │
│ ● ab1c  "wk2 oil delivery" 45m ago  main   │
│ │\                                          │
│ │ ○ 9x7z  "wk1 correction"  30m ago  fix   │
│ │                                           │
│ ● 8d3f  "merge fix→main"   20m ago  main   │
│   (parents: ab1c, 9x7z)                    │
│                                            │
│ [Revert to here] [Download state]          │
└────────────────────────────────────────────┘
```

---

## 8. Import/Export Tracking

### Data Model
Import/Export activity is derived from `commit_changes`:
- `action='pull'` → Import (item received into inventory)
- `action='enter'` → Export (item issued/removed from inventory)

### Activity Stats Endpoint
```
GET /api/inventory/activity/stats?from=2026-01&to=2026-05&item_id=xyz&category=xyz
```

Returns:
```json
{
  "total_imports": 1520,
  "total_exports": 1340,
  "net_change": 180,
  "by_item": [
    { "item_id": "...", "name": "Chicken Breast", "imports": 200, "exports": 180, "net": 20 }
  ],
  "by_category": [
    { "category": "Meat", "imports": 500, "exports": 450 }
  ],
  "by_month": [
    { "month": 0, "year": 2026, "imports": 300, "exports": 280 }
  ],
  "top_imported": [ ... ],
  "top_exported": [ ... ]
}
```

### Powered By
This is the data backbone for:
- QR scans (mobile app) → creates `commit_changes` with `action='pull'`
- Barcode scans → creates `commit_changes` with `action='enter'`
- Manual entry → creates `commit_changes` with user-specified action

---

## 9. Barcode Gallery

### UI Flow
1. Page loads → `GET /api/barcodes` → list all items with barcodes
2. Displayed as grid of cards:
   ```
   ┌─────────────┐  ┌─────────────┐
   │ ☐           │  │ ☑           │
   │ [barcode]   │  │ [barcode]   │
   │ Chicken Br. │  │ Cooking Oil │
   │ SKU: CHK001 │  │ SKU: OIL002 │
   │ Qty: 1      │  │ Qty: 3      │
   └─────────────┘  └─────────────┘
   ```
3. Select cards → click "Download Selected"
4. Popup: choose format (PDF / JPEG), enter quantity per label
5. Generate: Frontend uses JsBarcode + canvas to render, then:
   - JPEG: `canvas.toDataURL('image/jpeg')` → download
   - PDF: use browser print-to-PDF or jsPDF

### Backend
- `GET /api/barcodes` — returns all items with their primary barcode data
- `POST /api/barcodes/export` — (optional server-side generation)

---

## 10. Implementation Order

### Phase 1 — DB Migrations (mjcc-db)
1. Create `commits` table
2. Create `commit_changes` table
3. Create `staging_entries` table (replaces `pending_submissions`)
4. Create `uploads` table
5. Create `app_settings` table
6. Modify `user_profiles`: add `last_name`, expand role enum
7. Modify `inventory_versions`: add `commit_id` FK
8. Create RPCs: `merge_single_staging`, `push_all_staging`, `revert_to_commit`, `cleanup_expired_staging`
9. Migrate any existing `pending_submissions` data to `staging_entries`

### Phase 2 — Backend Refactor (mjcc-backend)
1. Update `rbac.py`: add assistant role, update decorators
2. Update `validation.py`: new schemas for commit endpoints
3. Rename staging endpoints in `inventory.py` to commit endpoints
4. Add new endpoints: push, tree, diff, state, revert, activity/stats
5. Create `routes/files.py` (coming soon stubs)
6. Create `routes/settings.py`
7. Update `routes/users.py`: add last_name, assistant role
8. Update `routes/auth.py`: handle assistant role
9. Update `main.py`: register new blueprints
10. Wire `merge_single_staging` and `push_all_staging` RPCs

### Phase 3 — Frontend Rebuild (mjcc-frontend)
1. Fix toast/confirm/modal → Alpine stores
2. Create sidebar layout (Alpine.store('sidebar') + persistent nav)
3. Create page router (hash-based or path-based)
4. Rewrite `inventory` page: role-gated read-only vs CRUD
5. Create `source-control` page: commit graph + staging list + merge/push
6. Create `barcodes` page: gallery grid with select/export
7. Create `reports` page: summary + activity stats
8. Create `settings` page: admin config
9. Create `files` page: upload gallery (coming soon)
10. Create `users` page: user management (migrate from admin_dashboard.html)
11. Update `staff_dashboard.html` → redirect to `/inventory`
12. Update `login.html` → redirect to `/inventory` instead of `/dashboard`
13. Create commit modal component
14. Create commit graph visualization (HTML/CSS or D3.js)

### Phase 4 — Verification (linter + judge)
1. Ruff check backend
2. Review frontend patterns
3. End-to-end flow testing
4. Judge evaluation
