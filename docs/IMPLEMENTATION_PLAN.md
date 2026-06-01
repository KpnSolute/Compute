# MJCC Portal — Implementation Plan v2

**Stack:** Flask + Jinja2 · Supabase (live data) · GitHub (primary memory / archive)  
**Guiding principle:** GitHub is the source of truth. Supabase is the live operational
database. Everything that matters eventually lives in GitHub as files.

---

## 1. The two-layer storage model

```
GITHUB (primary memory)          SUPABASE (live operational)
─────────────────────────        ──────────────────────────────
data/
  inventory/
    YYYY-MM.json   ← full        monthly_inventory   ← editable
    items.json     ← catalog     inventory_items     ← catalog
  menu/
    cycle.json     ← 28-day      (no menu table yet)
  archives/
    invoices/
      YYYY-MM-DD.json
    snapshots/
      YYYY-MM.json ← month end
commits/
  log.json         ← DAG index
```

**Write order for every change:**
1. Write to Supabase (immediate, user sees it)
2. Write to GitHub (async, 1-2 seconds later)

**If GitHub fails:**
- Show banner: "GitHub is unavailable — changes saved to Supabase only.
  Sync will resume automatically."
- Keep retrying in background (3 attempts, 30s apart)
- Changes are NOT lost — Supabase holds them until sync succeeds
- Manual "Sync now" button in sourcectrl/connectors

**If Supabase fails:**
- Show error, block the save — do not write to GitHub without Supabase
- Data integrity requires both to agree

---

## 2. Exact data structures (from offline app)

### Item object (matches existing offline app exactly)
```json
{
  "id": "i42",
  "sku": "3011520",
  "desc": "MILK WHOLE 1% GALLON",
  "price": 3.50,
  "onHand": 18,
  "par": 24,
  "w1i": 6,  "w2i": 6,  "w3i": 5,  "w4i": 0,
  "w1r": 20, "w2r": 0,  "w3r": 0,  "w4r": 0
}
```

### INV structure (exactly as offline app)
```json
{
  "Dairy":         [ ...items ],
  "Cereal":        [ ...items ],
  "Beverages":     [ ...items ],
  "Snacks":        [ ...items ],
  "Dry Goods":     [ ...items ],
  "Produce & Fresh": [ ...items ],
  "Protein & Meat":  [ ...items ],
  "Frozen Foods":    [ ...items ],
  "Supplies":        [ ...items ]
}
```

Category colors (exact hex from offline app):
```
Dairy           #0D9488
Cereal          #B45309
Beverages       #2563EB
Snacks          #7C3AED
Dry Goods       #92400E
Produce & Fresh #15803D
Protein & Meat  #B91C1C
Frozen Foods    #0369A1
Supplies        #6B7280
```

### GitHub inventory file: `data/inventory/YYYY-MM.json`
```json
{
  "_meta": {
    "month": 4,
    "year": 2026,
    "month_name": "May",
    "generated_at": "2026-05-31T14:23:11Z",
    "commit_id": "uuid-from-supabase",
    "github_sha": null
  },
  "Dairy": [
    {
      "sku": "3011520",
      "desc": "MILK WHOLE 1% GALLON",
      "price": 3.50,
      "onHand": 18,
      "par": 24,
      "w1i": 6, "w2i": 6, "w3i": 5, "w4i": 0,
      "w1r": 20, "w2r": 0, "w3r": 0, "w4r": 0
    }
  ]
}
```
Items sorted alphabetically by `desc` within each category.
Categories in fixed order (Dairy, Cereal, Beverages, Snacks, Dry Goods,
Produce & Fresh, Protein & Meat, Frozen Foods, Supplies).
This makes `git diff` output human-readable.

### GitHub snapshot (month-end archive): `data/archives/snapshots/YYYY-MM.json`
Same as inventory file but immutable — written once at month close, never changed.
This is what the History tab shows.

### GitHub items catalog: `data/inventory/items.json`
Master list of all items ever (active + inactive), with full metadata:
```json
[
  {
    "sku": "3011520",
    "desc": "MILK WHOLE 1% GALLON",
    "category": "Dairy",
    "price": 3.50,
    "par": 24,
    "active": true
  }
]
```

### GitHub commit log: `data/commits/log.json`
Index of all commits (appended on every push):
```json
[
  {
    "commit_id": "uuid",
    "github_sha": "abc123",
    "message": "wk2 delivery applied",
    "author": "J. Smith",
    "branch": "main",
    "ts": "2026-05-31T14:23:11Z",
    "changes": 14
  }
]
```

---

## 3. Role model

| Role      | Level | Auto-commit | Staging  |
|-----------|-------|-------------|----------|
| staff     | 10    | No          | Required |
| assistant | 20    | Yes         | Bypassed |
| manager   | 30    | Yes         | Bypassed |
| admin     | 40    | Yes         | Bypassed |

All roles ≥ 20 auto-commit directly. Staff go through staging.

---

## 4. URL structure

```
/                                ← login
/logout

/mjcc/admin/portal               ← tool selector
/mjcc/staff/portal               ← staff hub

/mjcc/admin/inventory/editor     ← main spreadsheet (mirrors offline app exactly)
/mjcc/admin/inventory/entry      ← invoice parse + excel import
/mjcc/admin/inventory/reports    ← printable monthly report
/mjcc/admin/inventory/items      ← item catalog CRUD
/mjcc/admin/inventory/barcodes   ← barcode gallery + print
/mjcc/admin/inventory/sourcectrl ← commit list + staging queue (scoped to inventory)

/mjcc/admin/menu/calendar        ← 28-day cycle grid
/mjcc/admin/menu/create          ← add/edit meals
/mjcc/admin/menu/compose         ← export PowerPoint / print
/mjcc/admin/menu/sourcectrl      ← menu change history
/mjcc/admin/menu/automation      ← email workflows

/mjcc/admin/users/manage         ← user CRUD
/mjcc/admin/users/policies       ← role permissions
/mjcc/admin/users/security       ← login history, active sessions
/mjcc/admin/users/sourcectrl     ← user change history

/mjcc/admin/sourcectrl/view      ← global cross-tool commit list
/mjcc/admin/sourcectrl/actions   ← push panel, branch mgmt
/mjcc/admin/sourcectrl/connectors ← GitHub token, repo, sync status
/mjcc/admin/sourcectrl/requests  ← pending staging entries
/mjcc/admin/sourcectrl/logs      ← audit log
/mjcc/admin/sourcectrl/permissions ← branch protection rules

/mjcc/admin/archives/invoices    ← browse data/archives/invoices/ in GitHub
/mjcc/admin/archives/snapshots   ← browse data/archives/snapshots/ in GitHub
/mjcc/admin/archives/menus       ← browse data/menu/ history in GitHub
/mjcc/admin/archives/timeline    ← visual month-over-month from commit log

/mjcc/staff/inventory            ← read-only table + commit modal
/mjcc/staff/sourcectrl           ← own commits only
/mjcc/staff/barcodes             ← barcode scanner + gallery
```

---

## 5. Flask project structure

```
backend/
  main.py                    ← app factory, registers blueprints, before_request hook
  config.py                  ← env vars including GITHUB_*
  rbac.py                    ← ROLES, AUTO_COMMIT_ROLES, decorators
  response.py
  validation.py
  calculators.py             ← iTotal, grandTotal, catTotal, wkTotal (mirrors offline app)
  ai_parser.py               ← invoice AI parsing (Groq/Gemini/Ollama)
  supabase_client.py
  github_sync.py             ← ALL GitHub API operations (see §6)

  routes/                    ← API endpoints only
    auth.py                  ← /api/auth/*
    inventory.py             ← /api/inventory/*
    users.py                 ← /api/users/*
    settings.py              ← /api/settings/*
    github.py                ← /api/github/*

  views/                     ← Jinja2 page routes (return render_template)
    admin/
      portal.py
      inventory.py
      menu.py
      users.py
      sourcectrl.py
      archives.py
    staff/
      portal.py
      inventory.py
      sourcectrl.py
      barcodes.py

frontend/
  templates/
    base.html                ← <html><head> shell, FA icons, CSS vars
    nav_base.html            ← extends base, vertical navbar
    tool_base.html           ← extends nav_base, tool header + breadcrumb

    login.html               ← extends base (no nav)

    admin/
      portal.html
      inventory/
        editor.html          ← the main table — mirrors offline app renderInv()
        entry.html
        reports.html
        items.html
        barcodes.html
        sourcectrl.html
      menu/
        calendar.html
        create.html
        compose.html
        sourcectrl.html
        automation.html
      users/
        manage.html
        policies.html
        security.html
        sourcectrl.html
      sourcectrl/
        view.html
        actions.html
        connectors.html
        requests.html
        logs.html
        permissions.html
      archives/
        invoices.html
        snapshots.html
        menus.html
        timeline.html

    staff/
      portal.html
      inventory.html
      sourcectrl.html
      barcodes.html

    errors/
      403.html
      404.html
      github_down.html       ← shown when GitHub is unreachable

  static/
    js/
      api.js                 ← fetch() helpers
      components.js          ← $money, itemCalc, etc.
      inventory_table.js     ← the dynamic table logic (extracted from offline app)
    css/
      main.css
```

---

## 6. `github_sync.py` — full spec

This module owns every GitHub API call. Nothing else touches GitHub.

### Env vars required
```
GITHUB_TOKEN       ghp_...  (PAT, repo scope)
GITHUB_REPO        KpnWorld/MJCC
GITHUB_BRANCH      main
```

### Core functions

```python
def is_available() -> bool
    """Quick HEAD request to api.github.com. Returns True if reachable."""

def get_file_sha(path: str) -> str | None
    """GET /repos/{repo}/contents/{path} → return sha field, or None if file missing."""

def put_file(path: str, content: str, message: str, author_name: str,
             current_sha: str | None = None) -> str
    """
    Create or update a file.
    content is a plain string — this function handles base64.
    Returns the new commit SHA.
    Raises GitHubDownError if unreachable.
    Raises GitHubAPIError on 4xx/5xx.
    """

def push_inventory_snapshot(month: int, year: int, inv_data: dict,
                             commit_id: str, author_name: str,
                             message: str) -> str
    """
    Writes data/inventory/YYYY-MM.json.
    inv_data is the INV dict (category → list of items).
    Returns GitHub SHA.
    """

def push_archive_snapshot(month: int, year: int, inv_data: dict) -> str
    """
    Writes data/archives/snapshots/YYYY-MM.json (immutable month-end record).
    Only called from rollover. Never overwrites if file already exists.
    """

def push_items_catalog(items: list) -> str
    """Writes data/inventory/items.json (master item list)."""

def append_commit_log(entry: dict) -> str
    """
    Reads data/commits/log.json, appends entry, writes back.
    entry = {commit_id, github_sha, message, author, branch, ts, changes}
    """

def push_invoice_archive(date_str: str, invoice_text: str,
                          matches: list) -> str
    """Writes data/archives/invoices/YYYY-MM-DD-{hash}.json"""

def list_files(path: str) -> list[dict]
    """
    GET /repos/{repo}/contents/{path}
    Returns list of {name, path, sha, size, download_url}.
    Used by archives pages to browse GitHub directories.
    """

def get_file_content(path: str) -> str
    """
    GET /repos/{repo}/contents/{path} → decode base64 → return string.
    Used by archives pages to read historical files.
    """
```

### Error handling
```python
class GitHubDownError(Exception):
    """GitHub API is unreachable (network, DNS, or service outage)."""

class GitHubAPIError(Exception):
    """GitHub returned 4xx or 5xx."""
```

When `GitHubDownError` is raised anywhere in a request:
- Log the error
- Store a `github_sync_pending = True` flag in the Supabase record
- Return the HTTP response to the user normally (Supabase write already succeeded)
- Frontend detects `github_sync_pending: true` in the API response and shows
  the warning banner

### Retry queue
A simple Supabase table `github_sync_queue`:
```sql
CREATE TABLE github_sync_queue (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation   TEXT NOT NULL,   -- 'push_inventory' | 'append_log' | etc.
  payload     JSONB NOT NULL,
  attempts    INT DEFAULT 0,
  last_error  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  synced_at   TIMESTAMPTZ
);
```
A background thread (started in `main.py`) checks this table every 60s
and retries pending operations. Max 5 attempts then marks as failed.

---

## 7. Inventory table — exact operation

The editor page (`/mjcc/admin/inventory/editor`) replicates the offline app's
`renderInv()` behavior exactly, but server-rendered with Jinja + dynamic JS updates.

### Page load
1. Flask route fetches `monthly_inventory` from Supabase for selected month/year
2. Transforms to INV format (category → items)
3. Passes to Jinja template as `inv_data` JSON
4. Template renders the full table server-side on first load
5. JS takes over for cell edits (no full page reload)

### Table structure per category section
```
[●] Category Name    N items    $total    [▲/▼]
────────────────────────────────────────────────────────────────────────
Description | SKU | On Hand | Price | Par | W1↓ W2↓ W3↓ W4↓ | W1↑ W2↑ W3↑ W4↑ | Total | [✕]
```
- `↓` = issued (purple)
- `↑` = received (green)
- Row is green-tinted if any received this week
- Row is amber-tinted if on_hand < par
- Row is red-tinted if on_hand ≤ 0 and par > 0
- Click section header → collapse/expand (persisted in sessionStorage)
- `+ Add item` button at bottom of each category
- `✕` button removes item (manager+ only)

### Cell edit flow (role ≥ 20 / auto-commit)
```
user changes a cell value
  → JS onchange fires
  → POST /api/inventory/commits/stage {item_id, field, value, month, year, week}
  → server: role ≥ 20 → auto-commit → push_all_staging RPC
  → server: github_sync.push_inventory_snapshot() in background thread
  → response: {ok: true, commit_id: "...", auto_committed: true}
  → JS: update cell in DOM (no re-render needed)
  → JS: if response.github_sync_pending → show GitHub warning banner
```

### Cell edit flow (staff → staging)
```
user clicks "Commit a Change" button
  → modal opens: item search, field, old value, new value, week, note
  → POST /api/inventory/commits/stage {item_id, field, value, ...}
  → response: {ok: true, status: "pending"}
  → modal closes, toast: "Submitted — awaiting manager approval"
```

### Calculations (mirrors offline app exactly)
```js
iTotal(it)  = max(0, it.onHand + (w1r+w2r+w3r+w4r) - (w1i+w2i+w3i+w4i)) * it.price
catTotal(c) = sum of iTotal for all items in category
grandTotal  = sum of catTotal for all categories
wkNTotal    = sum of it.wNr * it.price for all items
```

---

## 8. API routes (complete)

### Auth
```
POST /api/auth/login
GET  /api/auth/me
POST /api/auth/logout
```

### Inventory (Supabase)
```
GET  /api/inventory/now
GET  /api/inventory/current-month
GET  /api/inventory/summary?month=&year=
GET  /api/inventory/items?month=&year=
GET  /api/inventory/items/<id>
POST /api/inventory/items
PATCH /api/inventory/items/<id>
DELETE /api/inventory/items/<id>
GET  /api/inventory/categories
POST /api/inventory/publish
POST /api/inventory/rollover
POST /api/inventory/snapshot
```

### Commits / source control
```
POST  /api/inventory/commits/stage            ← staff→staging; ≥20→auto-commit
GET   /api/inventory/commits/staged           ← manager+
POST  /api/inventory/commits/staged/<id>/merge
POST  /api/inventory/commits/staged/<id>/reject
DELETE /api/inventory/commits/staged/<id>
POST  /api/inventory/commits/push             ← push all staged
GET   /api/inventory/commits                  ← all roles
GET   /api/inventory/commits/<id>
GET   /api/inventory/commits/<id>/diff
POST  /api/inventory/commits/<id>/revert      ← manager+
```

### Invoice
```
POST /api/inventory/parse-invoice
POST /api/inventory/apply-invoice
```

### Barcodes
```
GET  /api/inventory/barcodes
POST /api/inventory/barcodes/export
```

### Users
```
GET    /api/users
POST   /api/users
PATCH  /api/users/<id>
DELETE /api/users/<id>
PATCH  /api/users/<id>/pin
```

### GitHub
```
GET  /api/github/status              ← {connected, repo, last_sync, pending_count}
POST /api/github/sync                ← manual force-sync
GET  /api/github/files?path=         ← browse GitHub directory (for archives)
GET  /api/github/file?path=          ← get file content (for archives viewer)
GET  /api/github/commits             ← read data/commits/log.json
```

### Settings
```
GET   /api/settings
PATCH /api/settings
```

---

## 9. Navbar — context-aware items per tool dir

Rendered server-side. Items injected via `g.nav_items` in `before_request`.

### At `/mjcc/admin/portal` (top level)
```
fa-boxes-stacked   Inventory
fa-utensils        Menu
fa-users           Users
fa-code-branch     Source Control
fa-box-archive     Archives
```

### Inside `/mjcc/admin/inventory/*`
```
fa-table           Editor
fa-file-import     Data Entry
fa-chart-bar       Reports
fa-list            Items
fa-barcode         Barcodes
fa-code-branch     Source Control
```

### Inside `/mjcc/admin/menu/*`
```
fa-plus            New Meal
fa-calendar        Calendar
fa-print           Compose
fa-code-branch     Source Control
fa-robot           Automation
```

### Inside `/mjcc/admin/users/*`
```
fa-user-gear       Manage
fa-shield          Policies
fa-lock            Security
fa-code-branch     Source Control
```

### Inside `/mjcc/admin/sourcectrl/*`
```
fa-timeline        View
fa-upload          Actions
fa-plug            Connectors
fa-code-pull-request  Requests
fa-scroll          Logs
fa-key             Permissions
```

### Inside `/mjcc/admin/archives/*`
```
fa-file-invoice    Invoices
fa-camera          Snapshots
fa-bowl-food       Menus
fa-clock-rotate-left  Timeline
```

### Staff `/mjcc/staff/*`
```
fa-boxes-stacked   Inventory
fa-code-branch     Source Control
fa-barcode         Barcodes
```

---

## 10. Source control page — what it shows

No graphs. Tables only.

### Commit list (all roles, filtered by tool context)
```
Hash     Message                    Author    Branch  When       Files
a1b2c3   wk2 delivery applied       J. Smith  main    2h ago     1
d4e5f6   updated on-hand counts     M. Garcia main    yesterday  3
```
Click row → expands inline diff:
```
  CHICKEN BREAST (8873029)   w2r: 14 → 16
  MILK 1GAL (3011520)        w3i:  8 → 9
```
"Open in GitHub" link on each row (links to the actual GitHub commit).

### Staging queue (manager+ only, shown above commit list)
```
Item                  Field   Old  New   Submitted by  In queue
CHICKEN BREAST        w2r     14   16    J. Smith      3h
RICE 25LB             w3i      2    3    T. Jones      1h
```
Row actions: Merge, Reject.
Top bar: message input + "Push All" button.

### GitHub sync status banner (shown when pending)
```
⚠ GitHub sync pending — 2 changes not yet mirrored.
   GitHub has been unreachable since 2:14 PM. [Retry now]
```

---

## 11. Archives pages

Archives pages **read directly from GitHub** via `/api/github/files` and
`/api/github/file`. They do not query Supabase.

### `/mjcc/admin/archives/invoices`
Lists files in `data/archives/invoices/`.
Shows: filename, date, size, link to view JSON content.

### `/mjcc/admin/archives/snapshots`
Lists files in `data/archives/snapshots/`.
Each snapshot is a full INV export. View button opens a read-only
inventory table identical to the editor (same template, `editable=false`).

### `/mjcc/admin/archives/timeline`
Reads `data/commits/log.json` and renders a table:
month-over-month grand total, total changes, most active user.

---

## 12. Build order

### Phase 1 — Core infrastructure
1. `backend/config.py` — add GITHUB_* vars
2. `backend/rbac.py` — AUTO_COMMIT_ROLES = {assistant, manager, admin}
3. `backend/github_sync.py` — full module with error handling + retry queue
4. Supabase migration: `github_sync_queue` table
5. Supabase migration: `commits.github_sha TEXT` column

### Phase 2 — Flask shell
6. `backend/main.py` — app factory, blueprint registration, before_request
7. `frontend/templates/base.html`
8. `frontend/templates/nav_base.html`
9. `frontend/templates/tool_base.html`
10. `frontend/templates/login.html`
11. `backend/views/admin/portal.py` + `templates/admin/portal.html`
12. `backend/views/staff/portal.py` + `templates/staff/portal.html`
13. `frontend/templates/errors/github_down.html`

### Phase 3 — Inventory tool (highest priority)
14. `frontend/static/js/inventory_table.js` — extracted from offline app,
    adapted to use API instead of localStorage
15. `backend/views/admin/inventory.py` (all 6 routes)
16. `templates/admin/inventory/editor.html` — server-render first load,
    JS takes over for edits
17. `templates/admin/inventory/entry.html` — invoice + excel import
18. `templates/admin/inventory/reports.html`
19. `templates/admin/inventory/items.html`
20. `templates/admin/inventory/barcodes.html`
21. `templates/admin/inventory/sourcectrl.html`
22. `backend/routes/inventory.py` — update /commits/stage auto-commit logic
23. `backend/routes/github.py`

### Phase 4 — Source control global + staff
24. `backend/views/admin/sourcectrl.py` (all 6 sub-pages)
25. All sourcectrl templates
26. `backend/views/staff/*` (inventory, sourcectrl, barcodes)
27. Staff templates

### Phase 5 — Users + settings
28. `backend/views/admin/users.py` + templates
29. Settings page

### Phase 6 — Archives
30. `backend/views/admin/archives.py` + all 4 templates
    (these are read-only GitHub file browsers, straightforward)

### Phase 7 — Menu tool
31. Menu templates (calendar, create, compose, sourcectrl, automation)
    Note: menu data model decision needed before building (see open questions)

---

## 13. Open questions (decide before building)

1. **Menu data model** — does the 28-day cycle live in a new Supabase
   table, or only in `data/menu/cycle.json` on GitHub? GitHub-only is
   simpler to start. Supabase adds edit history and concurrent editing.

2. **GitHub sync failure retry** — the retry queue approach above works,
   but needs a decision: if GitHub is down for >24h, do we show the user
   a diff of "unsynced changes" so they know what's missing?

3. **Branch strategy** — is `main` always live, or do we want month
   branches like `archive/2026-05` that never get merged? Month branches
   make the archive structure cleaner but complicate the commit log.

4. **Staff inventory view** — read-only table matching the editor exactly,
   or a simplified single-week view? The offline app shows all 4 weeks
   even for read-only. Recommend keeping all 4 weeks for consistency.

5. **Menu automation SMTP** — env var or stored in `app_settings`?
   Recommend `app_settings` (stored in Supabase, editable in-app) with
   a fallback to env var if not set.
