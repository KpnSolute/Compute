# Agent Deployment Plan — MJCC Refactor (Day 1)

> Start: **Tomorrow morning** — all agents run concurrently where possible.
> Git push: One commit at end of each phase (3 commits total).

---

## Orchestration Flow

```
@operator ─────────────────────────────────────────────┐
  │                                                      │
  ├─ Phase 1: spawn @mjcc-db    → DB migrations         │
  │       then: spawn @supa       → apply to live        │
  │       then: spawn @gitgod     → commit & push        │
  │                                                      │
  ├─ Phase 2: spawn @mjcc-backend → API refactor         │
  │       then: spawn @gitgod     → commit & push        │
  │                                                      │
  ├─ Phase 3: spawn @mjcc-frontend → UI rebuild          │
  │       then: spawn @gitgod     → commit & push        │
  │                                                      │
  └─ Phase 4: spawn @linter       → code review          │
              spawn @judge        → final evaluation      │
```

---

## Phase 1: DB Migrations

### Agent: @mjcc-db

**Read before starting:**

- `docs/ARCHITECTURE.md` — Data Model section (§5), RPC table
- `docs/MIGRATION_NOTES.md` — existing schema context
- `docs/API_DOCUMENTATION.md` — current endpoint contracts

**Create migration files in `supabase/migrations/`:**

#### File 1: `20260529_commits_system.sql`

- `commits` table
- `commit_changes` table
- `staging_entries` table (replaces `pending_submissions`)
- Indexes: `idx_staging_expires ON staging_entries(expires_at) WHERE status = 'pending'`
- Indexes: `idx_commits_author ON commits(author_id)`
- Indexes: `idx_commit_changes_commit ON commit_changes(commit_id)`
- Indexes: `idx_commit_changes_item ON commit_changes(item_id, month, year)`
- RLS: allow authenticated read, service_role write

#### File 2: `20260529_supporting_tables.sql`

- `uploads` table (with RLS)
- `app_settings` table (admin-only RLS)
- Modify `user_profiles`: `ALTER TABLE ADD COLUMN last_name TEXT`
- Modify `user_profiles`: update CHECK constraint to include `'assistant'`
- Modify `inventory_versions`: `ALTER TABLE ADD COLUMN commit_id UUID REFERENCES commits(commit_id)`

#### File 3: `20260529_rpc_functions.sql`

- `merge_single_staging(p_entry_id UUID, p_reviewed_by UUID, p_review_note TEXT DEFAULT NULL)` — validates, updates monthly_inventory, creates commit + commit_changes, creates inventory_version, writes audit_log, deletes staging entry
- `push_all_staging(p_reviewed_by UUID, p_message TEXT, p_branch TEXT DEFAULT 'main')` — collects all pending staging, creates single commit with all changes, atomically applies to monthly_inventory, creates inventory_version, deletes all staging entries
- `revert_to_commit(p_target_commit_id UUID, p_reverted_by UUID)` — creates a new commit that reverses changes, restores inventory to target state
- `cleanup_expired_staging()` — `DELETE FROM staging_entries WHERE expires_at < now() AND status = 'pending'`

#### Data Migration

- Copy existing `pending_submissions` → `staging_entries` (add computed `expires_at = created_at + 15 days`)

### Dependencies: None

### Output: 3 migration files ready for review

### Agent: @supa

- Apply migrations to live Supabase project
- Verify tables created correctly
- Test RPC functions with direct SQL

### Agent: @gitgod

- `git add supabase/migrations/`
- `git commit -m "1.1.0"` (minor bump for new schema)
- `git push origin main`

---

## Phase 2: Backend Refactor

### Agent: @mjcc-backend

**Read before starting:**

- `docs/ARCHITECTURE.md` — Role Model (§2), API Structure (§6)
- `backend/rbac.py` — current role definitions
- `backend/routes/inventory.py` — current 28 endpoints
- `backend/validation.py` — current schemas

**Order of changes:**

#### 2a. Update RBAC

- Add `'assistant'` to role constants
- Update decorators: `@require_assistant` (level ≥20)
- Update `resolve_user()` to recognize assistant role
- Auto-merge behavior: when assistant calls `POST /commits/stage`, redirect to `push_all_staging`

#### 2b. Update Validation

- Add schemas for new endpoints:
  - `COMMIT_STAGE_SCHEMA` (item_id, month, year, week, field, action, value)
  - `COMMIT_PUSH_SCHEMA` (message, branch)
  - `COMMIT_REVERT_SCHEMA` (message)
  - `BARCODE_EXPORT_SCHEMA` (item_ids[], format, quantity)
  - `SETTINGS_UPDATE_SCHEMA` (key, value)
  - `ACTIVITY_FILTER_SCHEMA` (from, to, item_id, category)

#### 2c. Refactor inventory.py

- Rename endpoint paths:
  - `POST /submit` → `POST /commits/stage`
  - `GET /pending` → `GET /commits/staged`
  - `GET /pending/<id>` → `GET /commits/staged/<id>`
  - `PATCH /pending/<id>` → `PATCH /commits/staged/<id>`
  - `POST /pending/<id>/approve` → `POST /commits/staged/<id>/merge`
  - `POST /pending/<id>/reject` → `POST /commits/staged/<id>/reject`
- Add new endpoints:
  - `POST /commits/push` — push all staged
  - `GET /commits` — list commits with tree structure
  - `GET /commits/<id>` — get commit + changes
  - `GET /commits/<id>/diff` — diff view
  - `POST /commits/<id>/revert` — revert to commit
  - `GET /commits/tree` — full tree data for graph
  - `DELETE /commits/staged/<id>` — delete staging entry
  - `GET /state` — inventory state at commit
  - `GET /activity` — activity feed
  - `GET /activity/stats` — import/export stats
- Update barcode endpoints:
  - `GET /api/barcodes` — list all barcodes
  - `POST /api/barcodes/export` — export selected

#### 2d. Create routes/files.py

- Blueprint `files_bp` at `/api/files`
- Stub endpoints (return 501 Not Implemented with "Coming soon" message):
  - `POST /upload`
  - `GET /`
  - `GET /<id>`
  - `DELETE /<id>`
- Register in `main.py`

#### 2e. Create routes/settings.py

- Blueprint `settings_bp` at `/api/settings`
- `GET /` — return all settings from `app_settings` table
- `PATCH /` — update settings (admin only)
- Seed default settings on first access (AI_PROVIDER, AI_MODEL, AI_API_KEY)
- Register in `main.py`

#### 2f. Update routes/users.py

- Add `last_name` field to create/update
- Add `assistant` to role dropdown
- Add dedicated `PATCH /users/<id>/pin` endpoint for PIN-only reset

#### 2g. Update routes/auth.py

- Handle assistant role in login response
- Ensure assistant gets session with correct role

#### 2h. Update main.py

- Register `files_bp` and `settings_bp`
- Add `/inventory`, `/source-control`, `/reports`, `/users`, `/barcodes`, `/settings`, `/files`, `/qr-portal` static routes (serve placeholder HTML or the SPA shell)

#### 2i. Update calculators.py if needed

- Add activity stats calculator (aggregate from commit_changes)

### Dependencies: Phase 1 (DB schema must exist)

### Output: All backend files modified

### Agent: @gitgod

- `git add backend/`
- `git commit -m "1.1.1"`
- `git push origin main`

---

## Phase 3: Frontend Rebuild

### Agent: @mjcc-frontend

**Read before starting:**

- `docs/ARCHITECTURE.md` — Navigation (§3), Page Structure (§7), Components

  - `docs/API_DOCUMENTATION.md` — endpoint contracts

**Order of changes:**

#### 3a. Refactor api.js

- Rename methods to match new endpoint paths:
  - `submitPending()` → `stageCommit()`
  - `getPending()` → `getStaged()`
  - `approvePending()` → `mergeStaged()`
  - `rejectPending()` → `rejectStaged()`
  - `revisePending()` → `reviseStaged()`
- Add new methods:
  - `pushCommits(message, branch)`
  - `getCommits(month, year, page)`
  - `getCommit(id)`
  - `getCommitDiff(id)`
  - `getCommitTree()`
  - `revertCommit(id)`
  - `getInventoryState(commitId)`
  - `getActivity(from, to)`
  - `getActivityStats(filters)`
  - `getBarcodes()`
  - `exportBarcodes(itemIds, format, quantity)`
  - `getSettings()`
  - `updateSettings(key, value)`
  - `getFiles()`
  - `uploadFile(file)`
  - `deleteFile(id)`

#### 3b. Create toast/confirm/modal stores (fix current bug)

- `Alpine.store('toast', { show(msg, type), hide() })`
- `Alpine.store('confirm', { show(msg, onConfirm), hide() })`
- `Alpine.store('modal', { show(component, data), hide() })`

#### 3c. Create sidebar store

- `Alpine.store('sidebar', { active, items, collapsed, toggle() })`
- Items populated based on auth role
- Active page drives which content is shown

#### 3d. Build app shell (single HTML entry point)

- `frontend/index.html` remains as login
- Create `frontend/app.html` as the SPA shell:
  - Sidebar (left, fixed)
  - Content area (right, scrollable)
  - Toast/confirm/modal overlays
  - Inline page router (shows/hides sections based on sidebar selection)
  - Auth guard: redirect to `/login` if not authenticated

OR simpler approach:

- Keep individual pages but with consistent sidebar layout
- Each page includes the sidebar component
- Sidebar is an Alpine component that reads from store

Choice: **Single-page app at `/app` with hash routing**. All pages are sections within one HTML file, shown/hidden based on hash.

#### 3e. Build page sections

**Page: Inventory** (`#inventory`)

- Week stepper (1-4)
- Item table with columns: SKU, Description, Category, On Hand, Wk Received, Wk Issued, Ending Qty, Unit Price, Total, Reorder Status
- Staff: read-only table (no edit) + "Commit Change" button at top
- Manager+: editable cells → click opens commit modal
- Summary bar at top (grand total, reorder count)
- Filter by category

**Page: Source Control** (`#source-control`)

- Manager+ tab:
  - Staging area (top section): list of pending entries with item, week, field, old→new value, submitter, time remaining (TTL countdown)
  - Actions: Revise, Merge Individual, Reject, Push All (with message input)
  - Commit tree (bottom section): visual graph of commits
- Staff tab:
  - Own commits only
  - List view with status (staged / merged / rejected)
  - Staging entries with TTL countdown
- Commit graph: HTML/CSS tree (column layout, nodes connected by lines, color-coded by status)
  - Each node: commit ID (short), message, author, timestamp, branch
  - Click → detail view: list of changes, diff view (old→new)
  - Actions on hover: "Revert to here" (manager+), "Download state"

**Page: Reports** (`#reports`)

- Month selector
- Summary card: grand total, starting total, weekly totals
- Category breakdown chart (horizontal bars with CSS)
- Reorder alerts table
- Import/Export stats:
  - Date range picker
  - Summary: Total Imports, Total Exports, Net Change
  - Top imported items table
  - Top exported items table
  - By-month breakdown (bar chart with CSS)

**Page: Users** (`#users`)

- Migrate from `admin_dashboard.html`
- User table: Name (display_name, last_name), Username, Role (badge), Active, Created
- Actions: Edit, Reset PIN, Delete
- Add User modal: username, display_name, last_name, password, PIN, role (staff/assistant/manager/admin)
- Edit User modal: same fields + active toggle
- Reset PIN modal: simplified edit for PIN only

**Page: Barcodes** (`#barcodes`)

- Search/filter bar (by item name, SKU, category)
- Grid of cards (responsive: 3-4 columns)
- Each card: checkbox, JsBarcode rendered barcode, item name, SKU
- "Download Selected" button → popup:
  - Format: [PDF] [JPEG]
  - Quantity per label: [___]
  - [Download] [Cancel]
- "Print All" button (opens browser print dialog with only barcode cards visible)

**Page: Settings** (`#settings`, admin only)

- AI Provider: dropdown (Ollama/Groq/Gemini)
- AI Model: text input
- AI API Key: password input (masked)
- Branch management: list branches, create branch, switch default
- System info: DB size, version numbers

**Page: Files** (`#files`, coming soon)

- Upload zone (drag & drop placeholder)
- Gallery grid: file cards with type icon, filename, uploader, date
- Filter by type tab bar (All / Invoices / Photos / Receipts)
- Empty state: "Files and uploads coming soon."

**Page: QR Portal** (`#qr-portal`)

- Centered card: "📷 MJCC QR Portal"
- Subtitle: "Coming soon — install the MJCC mobile app for barcode scanning and inventory tracking on the go."
- Download buttons (placeholder): [App Store] [Google Play]

#### 3f. Create shared components

**Commit Modal** (`commit-modal.js` or inline in app.html)

- Item autocomplete (search items by name/SKU)
- Week selector (1-4 tabs)
- Field selector: received / issued
- Action selector: Pull (import) / Enter (export) with icons/colors
- Value input (number)
- Pending changes summary at bottom (list of items in staging with remove button)
- "Submit" button → `POST /commits/stage`
- "Submit All" → submit all pending changes at once

**Barcode Card** (reusable template)

- Renders barcode with JsBarcode
- Shows item name, SKU
- Checkbox for selection
- Quantity input (for export)

**Commit Graph** (inline HTML/CSS)

- Vertical timeline
- Nodes as circles (filled=merged, outlined=reverted, dashed=pending)
- Lines connecting parent→child
- Branch labels (colored pill badges)
- Cluster commits with no children as "latest"

#### 3g. Update login page

- `frontend/index.html` already works, just update redirect to `/app` instead of `/dashboard`

#### 3h. Deprecate old pages

- Keep `dashboard.html`, `admin_dashboard.html`, `staff_dashboard.html`, `pull_sheet.html` but add banner: "This page has moved. Redirecting to /app..."
- Create simple redirect JS

### Dependencies: Phase 2 (API endpoints must exist)

### Output: All frontend files modified/created

### Agent: @gitgod

- `git add frontend/`
- `git commit -m "1.1.2"`
- `git push origin main`

---

## Phase 4: Verification

### Agent: @linter

- `ruff check backend/ tests/`
- Prettier check (if configured): `prettier --check '**/*.{html,css,js,json,md}'`
- Manual review: check that:
  - All imports are clean
  - No dead code paths
  - New endpoints match ARCHITECTURE.md spec
  - Frontend components follow Alpine.js patterns
  - No hardcoded secrets

### Agent: @judge

- Run full evaluation of the complete system
- Check:
  - Auth flow (staff PIN, admin password, assistant auto-merge)
  - Commit pipeline (stage → merge/push → tree → revert)
  - Role enforcement (staff can't bypass staging)
  - Data integrity (atomic RPCs, audit logging)
  - Frontend-store integration (toast/confirm/modal)
- Report any issues found

---

## Communication Protocol

| Agent          | Reports To | Consults              | Handoff               |
| -------------- | ---------- | --------------------- | --------------------- |
| @mjcc-db       | @operator  | @supa for live apply  | Migration files ready |
| @mjcc-backend  | @operator  | @mjcc-db for schema   | API endpoints ready   |
| @mjcc-frontend | @operator  | @mjcc-backend for API | Pages ready           |
| @linter        | @operator  | —                     | Quality report        |
| @judge         | @operator  | —                     | Evaluation report     |
| @gitgod        | @operator  | —                     | Commits pushed        |

---

## File Manifest

### New Files

```
supabase/migrations/20260529_commits_system.sql
supabase/migrations/20260529_supporting_tables.sql
supabase/migrations/20260529_rpc_functions.sql
backend/routes/files.py
backend/routes/settings.py
frontend/app.html                          (SPA shell)
frontend/static/js/stores.js               (toast, confirm, modal, sidebar stores)
```

### Modified Files

```
backend/rbac.py                            (add assistant role)
backend/validation.py                      (add new schemas)
backend/routes/inventory.py                (rename endpoints, add new ones)
backend/routes/auth.py                     (assistant handling)
backend/routes/users.py                    (last_name, assistant role)
backend/main.py                            (new blueprints, new static routes)
frontend/static/js/api.js                  (rename methods, add new)
frontend/static/js/components.js           (add $timeAgo, update as needed)
frontend/index.html                        (update redirect)
```

### Deprecated (keep with redirect)

```
frontend/dashboard.html
frontend/admin_dashboard.html
frontend/staff_dashboard.html
frontend/pull_sheet.html
```
