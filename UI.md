# MJCC UI Reference

**Frontend:** Vite + React + TypeScript + Tailwind + hand-written design system (`index.css`)  
**Dev:** `cd frontend && npm run dev` → `http://localhost:5173`  
**API base:** `VITE_API_BASE=http://localhost:8000` (all data calls route through FastAPI)  
**Auth:** Supabase Auth for admin/manager · backend PIN for staff · token stored in `localStorage` key `mjc_backend_token`

---

## Table of Contents

1. [Design System](#1-design-system)
2. [Icons](#2-icons)
3. [Types & Constants](#3-types--constants)
4. [Lib Layer](#4-lib-layer)
5. [Login](#5-login)
6. [Portal Shell](#6-portal-shell)
7. [Feature Modules](#7-feature-modules)
   - [Dashboard](#71-dashboard-inline-in-portaltsx)
   - [Inventory](#72-inventoryview-inline-in-portaltsx)
   - [ComplianceHub (HACCP)](#73-compliancehub)
   - [DailyOps](#74-dailyops)
   - [EventsCalendar](#75-eventscalendar)
   - [CycleMenu](#76-cyclemenu)
   - [Forms](#77-forms)
   - [SnackBar](#78-snackbar)
   - [MonthlyInventory](#79-monthlyinventory)
   - [SourceControl](#710-sourcecontrol)
   - [Reports](#711-reports)
   - [Templates](#712-templates)
   - [Users](#713-usersview-inline-in-portaltsx)
   - [Archives](#714-archivesview-inline-in-portaltsx)

---

## 1. Design System

`index.css` ships a 711-line hand-written design system. Tailwind handles layout utilities; `index.css` owns branded tokens, auth layout, portal shell, and component classes. Do not introduce a third styling pattern.

### CSS Custom Properties

```css
/* Brand colors */
--navy: #0E2148          --navy-2: #1B3A6B       --navy-hover: #16335F
--navy-ink: #091633      --accent: #1E73E8        --accent-2: #1660C8
--accent-soft: #EFF5FE   --accent-chip: #DBEAFE   --accent-chip-ink: #1E40AF

/* Semantic */
--green: #059669         --green-bg: #F0FDF4      --green-chip: #DCFCE7
--green-ink: #166534     --amber: #D97706         --amber-bg: #FEF3C7
--amber-ink: #92400E     --red: #DC2626           --red-bg: #FEF2F2
--blue: #1D4ED8          --blue-bg: #EFF6FF

/* Surface & ink */
--bg: #F5F6F8            --surface: #FFFFFF       --surface-2: #F8FAFC
--line: #E2E8F0          --line-soft: #F1F5F9     --ink: #1E293B
--muted: #64748B         --faint: #94A3B8

/* Shape & type */
--radius: 10px           --radius-sm: 6px
--shadow: 0 1px 3px rgba(15,27,51,.08)
--shadow-lg: 0 24px 60px rgba(15,27,51,.28)
--font: 'Segoe UI', -apple-system, BlinkMacSystemFont, Roboto, Helvetica, Arial, sans-serif
--mono: 'Courier New', ui-monospace, SFMono-Regular, Menlo, monospace
```

### Key Component Classes

**Auth layout**

| Class | Purpose |
|---|---|
| `.auth` | 2-column login grid (`1.05fr .95fr`) |
| `.auth[data-layout="centered"]` | Single-column centered variant |
| `.auth-brand` | Left dark-navy panel with grid overlay |
| `.auth-card` | Right panel form card |
| `.auth-err` | Red inline error banner |
| `.seg` | 2-column segmented toggle (admin/staff tabs) |
| `.btn-auth` | Full-width navy submit button |
| `.btn-auth.accent` | Blue accent variant |
| `.pin-display` / `.pin-dot` | PIN indicator dots |
| `.keypad` / `.key` / `.key.fn` | Numeric PIN keypad |
| `@keyframes shake` | Horizontal shake on PIN error |

**Portal shell**

| Class | Purpose |
|---|---|
| `.portal` | Root grid: `248px` sidebar + `1fr` content, `54px` topbar + `1fr` body; `height: 100vh; overflow: hidden` |
| `.portal[data-density="compact"]` | Reduces base font to 12px |
| `.topbar` | Navy top bar, `height: 54px`, `z-index: 30` |
| `.tb-select` | Styled `<select>` in topbar (period picker) |
| `.inv-badge` | Green animated pulse badge |
| `.sidebar` | `248px` left nav panel |

**Fields & buttons**

| Class | Purpose |
|---|---|
| `.field` | Field wrapper (label + input + hint) |
| `.field.has-icon` | Field with leading icon |
| `.pw-toggle` | Password visibility toggle |
| `.check` | Checkbox + label row |
| `.row-between` | Flex spaced-between row |

### Category Colors (`CCOLOR`)

| Category | Hex |
|---|---|
| Dairy | `#0D9488` |
| Cereal | `#B45309` |
| Beverages | `#2563EB` |
| Snacks | `#7C3AED` |
| Dry Goods | `#92400E` |
| Produce & Fresh | `#15803D` |
| Protein & Meat | `#B91C1C` |
| Frozen Foods | `#0369A1` |
| Supplies | `#6B7280` |
| Bread | `#CA8A04` |
| Condiments | `#DB2777` |

---

## 2. Icons

All icons are in `frontend/src/lib/icons.tsx`. Import: `import { I, KpnMark } from '../lib/icons'`. Usage: `{I.grid()}` or `{I.box({ className: 'w-4 h-4' })}`.

All icons render a 24×24 SVG (`fill="none"`, `stroke="currentColor"`, `strokeWidth={2}`). All props from `React.SVGProps<SVGSVGElement>` are spread through.

**Available icons (50 total):**

`grid` `box` `calendar` `branch` `archive` `users` `settings` `qr` `dollar` `alert` `up` `down` `check` `checkCircle` `logout` `user` `lock` `eye` `eyeOff` `del` `plus` `edit` `search` `bell` `scan` `download` `clock` `trend` `shield` `cloud` `x` `refresh` `database` `thermo` `clipboard` `inbox` `flame` `snow` `droplet` `save` `printer` `chevL` `chevR` `coffee` `fileText` `checkSquare` `calCheck` `book` `award`

**`KpnMark` component:**
```tsx
<KpnMark size={52} />   // default size=52; height = size * 1.15
```
Custom branded globe/arc logo in blue tones (`#9DBEF0`, `#2E86F0`, `#BFD6F7`).

---

## 3. Types & Constants

Source: `frontend/src/lib/constants.ts`

### Core Types

```ts
export type Role = 'staff' | 'assistant' | 'manager' | 'admin';

export interface User {
  id: string;
  username: string;
  display_name: string;
  last_name: string;
  role: Role;
  active?: boolean;
  pin?: string | null;
  password?: string | null;  // not in DB; frontend-only field
  access_token?: string;
}
```

### Role Levels

```ts
ROLE_LEVEL = { staff: 10, assistant: 20, manager: 30, admin: 40 }
ROLE_LABEL  = { staff: 'Staff', assistant: 'Assistant', manager: 'Manager', admin: 'Administrator' }
```

### Navigation Structure (`NAV`)

6 groups, 17 items. `min` = minimum `ROLE_LEVEL` required to see/access.

| Group | Key | Label | Icon | Min |
|---|---|---|---|---|
| Overview | `dashboard` | Dashboard | `grid` | 10 |
| Data Entry | `inventory` | Inventory | `box` | 10 |
| Data Entry | `moninv` | Monthly Inventory | `fileText` | 20 |
| Data Entry | `mballot` | Meal Log | `users` | 10 |
| Data Entry | `foodreq` | Food Request | `inbox` | 10 |
| Data Entry | `barcodes` | Barcodes & Scan | `qr` | 10 *(placeholder)* |
| Logs | `haccp` | HACCP & Logs | `thermo` | 20 |
| Logs | `dailyops` | Daily Operations | `checkSquare` | 20 |
| Logs | `inspection` | Inspection Sheet | `clipboard` | 20 |
| Logs | `snackbar` | Snack Bar | `coffee` | 20 |
| Calendar | `events` | Events & Programs | `calCheck` | 10 |
| Calendar | `menu` | 28-Day Menu | `book` | 20 |
| Records | `sourcectrl` | Source Control | `branch` | 10 *(badge: pending count)* |
| Records | `reports` | Reports | `download` | 30 |
| Records | `archives` | Archives | `archive` | 20 |
| Administration | `users` | Users & Access | `users` | 40 |
| Administration | `settings` | Settings | `settings` | 40 *(placeholder)* |

### Other Exported Constants

```ts
MONTHS      // ['January', ..., 'December'] (indices 0–11)
DOW_FULL    // ['Sunday', ..., 'Saturday']
DOW_KEYS    // ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']
MEAL_COLS   // ['Breakfast', 'Lunch', 'Dinner']

COOKING_TEMPS  // 7-item FDA cooking temp reference: { temp, hold, foods }
TASTE_CODES    // [{ code: 'A'|'B'|'C'|'D', label, tint, bg }]
INSPECTION_Q   // 15-item string[] of inspection questions
FOODREQ_FIELDS // 13-item form field definitions: { k, label, type, col }
```

---

## 4. Lib Layer

### 4.1 `api.ts` — FastAPI client

Import: `import { api } from '../lib/api'`

All methods use the internal `req<T>()` helper which attaches `Authorization: Bearer <token>` from `getBackendToken()` and throws `ApiError` on non-2xx.

**Auth**

| Method | Endpoint | Notes |
|---|---|---|
| `api.login(body)` | `POST /api/auth/login` | `body: { username?, password?, pin?, access_token? }` → `{ user, token }` |
| `api.getMe()` | `GET /api/auth/me` | Returns current user |
| `api.logout()` | `POST /api/auth/logout` | Fire-and-forget |

**Users** *(admin only)*

| Method | Endpoint |
|---|---|
| `api.getUsers(activeOnly?)` | `GET /api/users[?active_only=true]` → `any[]` |
| `api.getUser(userId)` | `GET /api/users/:id` → `any` |
| `api.createUser(body)` | `POST /api/users` → `any` |
| `api.updateUser(userId, body)` | `PUT /api/users/:id` → `any` |
| `api.deleteUser(userId)` | `DELETE /api/users/:id` (soft-delete) |

**Inventory**

| Method | Endpoint |
|---|---|
| `api.getInventory(month?, year?)` | `GET /api/inventory[?month=&year=]` → `{ id, items, metadata, notes, created_at }` |
| `api.saveInventory(body)` | `POST /api/inventory` → inventory snapshot |
| `api.getInventoryHistory(limit?)` | `GET /api/inventory/history[?limit=]` → `any[]` |
| `api.getReorders()` | `GET /api/inventory/reorders` → `any[]` |
| `api.getInventoryCategories()` | `GET /api/inventory-categories` → `any[]` |

**Menu**

| Method | Endpoint |
|---|---|
| `api.getMenu(day)` | `GET /api/menu/:day` (day = capitalized e.g. `'Monday'`) |
| `api.saveMenu(day, body)` | `POST /api/menu/:day` |

**Events**

| Method | Endpoint |
|---|---|
| `api.getEvents()` | `GET /api/events` → `any[]` |
| `api.createEvent(body)` | `POST /api/events` → event object |

**Logs**

| Method | Endpoint |
|---|---|
| `api.getHaccpLogs(limit?, location?)` | `GET /api/logs/haccp[?limit=&location=]` |
| `api.saveHaccpLog(body)` | `POST /api/logs/haccp` |
| `api.getDailyLogs(limit?, entryType?)` | `GET /api/logs/daily[?limit=&entry_type=]` |
| `api.saveDailyLog(body)` | `POST /api/logs/daily` |
| `api.getCompliance()` | `GET /api/logs/compliance` |

**Source Control**

| Method | Endpoint |
|---|---|
| `api.getStaging(entityType?)` | `GET /api/staging[?entity_type=]` → `StagingEntry[]` |
| `api.submitStaging(body)` | `POST /api/staging` → `StagingEntry` |
| `api.stageChange(op, entityType, entityId, payload, summary)` | calls `submitStaging` → `POST /api/staging` |
| `api.rejectStaging(id, reviewNote?)` | `DELETE /api/staging/:id[?review_note=]` |
| `api.getCommits(limit=50, offset=0)` | `GET /api/commits?limit=&offset=` → `Commit[]` |
| `api.approveCommit(body)` | `POST /api/commits` → `Commit` |

**Reference Data**

| Method | Endpoint |
|---|---|
| `api.getOpeningChecklist()` | `GET /api/opening-checklist` |
| `api.getServSafe()` | `GET /api/servsafe` |
| `api.getMealPeriods()` | `GET /api/meal-periods` |
| `api.getIncidents(limit?, type?)` | `GET /api/incidents[?limit=&type=]` |
| `api.createIncident(body)` | `POST /api/incidents` |
| `api.getInvoices(month?, year?)` | `GET /api/invoices[?month=&year=]` |
| `api.getInvoiceItems(invoiceId)` | `GET /api/invoices/:id/items` |
| `api.getDashboardStats()` | `GET /api/dashboard/stats` |
| `api.getArchives()` | `GET /api/archives` |
| `api.getArchiveDetail(year, month)` | `GET /api/archives/:year/:month` |

**AI Data Entry**

| Method | Endpoint |
|---|---|
| `api.uploadDataEntry(file, hint)` | `POST /api/data-entry/upload` (multipart) → `{ batch_id, staged_count, operations, file, month, year }` |
| `api.getDataEntryPreview(batchId)` | `GET /api/data-entry/preview/:id` → diff rows |
| `api.getDataEntrySettings()` | `GET /api/data-entry/settings` |
| `api.updateDataEntrySettings(body)` | `PUT /api/data-entry/settings` |

**Exported interfaces:** `Commit`, `StagingEntry`, `SubmitStagingBody`, `ApproveCommitBody`, `EntityType`

---

### 4.2 `services.ts` — Data service layer (`DS`)

Import: `import DS from '../lib/services'`

In-memory cache with 30-second TTL. Async methods populate the cache; sync `sync*()` accessors return cached value or a safe default.

**Async methods (call `api.*`):**

| Method | Calls | Returns |
|---|---|---|
| `DS.events()` | `api.getEvents()` | `Promise<any[]>` |
| `DS.cycleMenu()` | `api.getMenu(day)` × 7 | `Promise<Record<string, any>>` |
| `DS.openingChecklist()` | `api.getOpeningChecklist()` | `Promise<any[]>` |
| `DS.mealSchedule()` | `api.getMealPeriods()` | `Promise<any[]>` |
| `DS.catMeta()` | `api.getInventoryCategories()` | `Promise<Record<string, any>>` |
| `DS.servsafe()` | `api.getServSafe()` | `Promise<any[]>` |
| `DS.snackHours()` | `api.getMealPeriods()` | `Promise<{day,open,close}[]>` |
| `DS.mealRates()` | `api.getMealPeriods()` | `Promise<{type,rate}[]>` |
| `DS.mealTypes()` | `api.getMealPeriods()` | `Promise<{key,label}[]>` |
| `DS.staged()` | `api.getStaging()` | `Promise<StagingEntry[]>` |
| `DS.commits()` | `api.getCommits()` | `Promise<Commit[]>` |
| `DS.invoices(period)` | `api.getInvoices()` | `Promise<any[]>` |

**Sync cache accessors (default if cold):**

`syncEvents()` · `syncCycleMenu()` · `syncStaged()` · `syncCommits()` · `syncOpeningChecklist()` · `syncMealSchedule()` · `syncServSafe()` · `syncCatMeta()` · `syncInvoices()` · `syncSnackHours()` · `syncMealRates()` · `syncMealTypes()`

**Export utilities:**

```ts
DS.toCSV(columns, rows)  // columns: { label, key?, get? }[] → CSV string
DS.download(filename, text, mime?)  // triggers browser file download
```

---

### 4.3 `supabase.ts` — Auth glue + local persistence

Import named functions: `import { realLogin, backendLogin, backendPinLogin, realLogout, ... } from '../lib/supabase'`

**Configuration:** Reads Supabase URL/key from `localStorage` keys `mjc_supa_url` / `mjc_supa_key`. Supabase session stored under `kpn_supa_auth`. Backend token under `mjc_backend_token`.

> The Supabase JS client is for Auth calls only. All data queries go through FastAPI.

**Auth functions (used by Login):**

| Function | What it does |
|---|---|
| `realLogin({ username, type, pin?, password? })` | Staff: fetch `user_profiles` + bcrypt PIN compare. Admin: `signInWithPassword(username@mjc-cafeteria.com, password)` |
| `backendLogin(accessToken)` | `POST /api/auth/login` with Supabase JWT → saves `mjc_backend_token` |
| `backendPinLogin(username, pin)` | `POST /api/auth/login` with PIN creds → saves `mjc_backend_token` |
| `realLogout()` | `supabase.auth.signOut()` + `clearBackendToken()` |
| `getBackendToken()` | Reads `mjc_backend_token` from localStorage |
| `isConnected()` | `true` if backend token is present |

**Local-first log persistence:**

| Function | What it does |
|---|---|
| `loadLog(key, fallback)` | Reads `mjc_log_<key>` from localStorage |
| `saveLogLocal(key, data)` | Writes `mjc_log_<key>` to localStorage |
| `saveLog(key, data, syncedBy?)` | Saves locally; if client available, upserts to `haccp_logs` table |
| `fetchLog(key)` | Tries `haccp_logs` table; falls back to localStorage |

**Inventory helpers (legacy direct-to-Supabase — still used by Portal.tsx):**

| Function | Notes |
|---|---|
| `fetchInventory()` | Queries `inventory_sync` table (fiction — may fail) |
| `pushInventory(inv, syncedBy?)` | Upserts to `inventory_sync` table (fiction) |
| `fetchProfiles()` | Queries `user_profiles` for user list |

**Pure math utilities:**

```ts
iTotal(item)          // (onHand + wRecvd - wIssued) * price
invToList(inv)        // flattens { [cat]: item[] } → [{ ...item, cat }]
grandTotal(inv)       // sum of iTotal for all items
catTotals(inv)        // [{ name, color, val, count }] sorted by val
reorders(inv)         // items where onHand < par && par > 0
fmtMoney(n)           // $X.XXM / $X.XK / $X.XX
fmtMoneyFull(n)       // $ + toLocaleString(2dp)
catColor(cat)         // hex from CCOLOR; fallback #1E73E8
```

---

## 5. Login

**File:** `frontend/src/components/Login.tsx`

```ts
interface LoginProps {
  onLogin: (user: User, remember: boolean) => void;
  layout?: 'split' | 'centered';  // default: 'split'
}
```

**Two modes (segmented toggle):**

| Mode | Flow |
|---|---|
| Admin / Manager | `realLogin({ username, type: 'admin', password })` → extract `access_token` → `backendLogin(token)` → `onLogin(user, remember)` |
| Staff PIN | PIN keypad (auto-submits on 4th digit after 160ms) → `backendPinLogin(username, pin)` → `onLogin(user, remember)` |

**State:** `mode`, `username`, `password`, `pin` (max 4 digits), `showPw`, `remember` (default `true`), `err`, `pinErr` (triggers shake animation, auto-clears at 420ms), `busy`

**UI sections:**
- Left panel (`auth-brand`): KpnMark logo, tagline, static stats (214 line items, 9 categories, 4 roles), v3.0 footer
- Right panel (`auth-card`): `/kpn-logo.png` (h=60), "Sign in to the console" heading, segmented mode tabs, error banner, form

---

## 6. Portal Shell

**File:** `frontend/src/components/Portal.tsx`

```ts
interface PortalProps {
  user: User;
  onLogout: () => void;
  density?: string;  // default: 'comfortable'
}
```

**State:** `active: string` (current nav key, default `'dashboard'`) · `period: [monthIndex, year]` (default `[4, 2026]`) · `stagedCount: number` (Source Control badge, fed by `SourceControl.onCountChange`)

**Topbar:** Logo + `"KpnCompute · MJCC Portal"` · `"LIVE · API Connected"` badge · month/year period pickers (years 2024–2026) · user avatar with initials dropdown (My profile, Sign out)

**Sidebar:** Nav items filtered by `lvl >= item.min`. Badges: `inventory` shows reorder count; `sourcectrl` shows `stagedCount`. Label override: `sourcectrl` → `"My Submissions"` when `lvl < 20`. Footer: `"KpnCompute · v3.0"`.

**Local-first banner:** Shown for `haccp`, `dailyops`, `mballot`, `inspection`, `foodreq`, `snackbar` — warns these modules save drafts locally and attempt API sync.

**Route → Component map:**

| `active` | Renders |
|---|---|
| `dashboard` | `<Dashboard>` (inline) |
| `inventory` | `<InventoryView>` (inline) |
| `haccp` | `<ComplianceHub user={user} />` |
| `dailyops` | `<DailyOps user={user} />` |
| `events` | `<EventsCalendar user={user} />` |
| `menu` | `<CycleMenu user={user} />` |
| `mballot` | `<MealLog user={user} />` |
| `inspection` | `<InspectionSheet user={user} />` |
| `foodreq` | `<FoodRequest user={user} />` |
| `snackbar` | `<SnackBar user={user} />` |
| `moninv` | `<MonthlyInventory user={user} period={period} />` |
| `sourcectrl` | `<SourceControl user={user} onCountChange={n => setStagedCount(n)} />` |
| `reports` | `<Reports user={user} period={period} />` |
| `users` | `<UsersView>` (inline) |
| `archives` | `<ArchivesView period={period}>` (inline) |
| unmatched / no access | `<PlaceholderPage pageKey={active} />` |

**Role access thresholds:**

| Feature | Min level | Min role |
|---|---|---|
| All nav items visible | 10 | Staff |
| `moninv`, `haccp`, `dailyops`, `inspection`, `snackbar`, `menu`, `archives` | 20 | Assistant |
| `reports` | 30 | Manager |
| `users`, `settings` | 40 | Admin |
| Inventory "Add item" button | 30 | Manager |
| Dashboard "New entry" quick action | 20 | Assistant |
| "Source Control" → "My Submissions" label | < 20 | Staff only |

**Global toast:** `window.toast(msg)` — shows `#toast` with `.show` class for 2600ms.

---

## 7. Feature Modules

### 7.1 Dashboard *(inline in Portal.tsx)*

Loaded for `active === 'dashboard'`. Calls `api.getMenu(day)` (today's day abbrev e.g. `'Mon'`) and `api.getEvents()` on mount.

**Cards:** 5 KPI stats (Inventory Value, Below Par, Meals Logged, Closing Value, Next Event) · Today's menu · Inventory value by category (bar) · Inventory alerts (chips, up to 12) · Meal log summary (from localStorage) · Monthly mini-summary · Upcoming events (up to 4) · Quick actions (role-filtered)

---

### 7.2 InventoryView *(inline in Portal.tsx)*

Calls `fetchInventory()` (via `useInventory()` hook → `supabase.ts`) on mount. Per-row edits are held in local `draft` state until staged.

**Table columns:** SKU · Description · Category · Unit Price · On Hand *(editable at lvl ≥ 10)* · Par *(editable)* · Status · Value · SourceCtrl *(Stage button)*

**Stage action:** `api.stageChange('inventory_save', 'inventory', sku, payload, message)` where payload = `{ month, year, notes, items: [{ sku, desc, onHand, par, category }] }`

**Role gating:** `canStage = lvl >= 10` (edit + stage) · `canAdd = lvl >= 30` (Add item button, no handler wired)

---

### 7.3 ComplianceHub

**File:** `frontend/src/components/ComplianceHub.tsx`  
**Props:** `{ user: User }`  
**Nav key:** `haccp`

Five HACCP sub-tabs (period-scoped, month/year navigation via `<MonthNav>`):

| Tab key | Label | Component | Status |
|---|---|---|---|
| `temp` | Temperature Log | `<TemperatureLog>` | Full |
| `sanit` | Sanitizer Log | `<SanitizerLog>` | Full |
| `machine` | Machine Temp | `<MachineLogPlaceholder>` | Placeholder |
| `cooling` | Cooling & Reheat | `<CoolingLogPlaceholder>` | Placeholder |
| `taste` | Taste Panel | `<TastePanel>` | Full |

**Persistence:** `useLog(key, initial)` hook — saves to localStorage via `saveLog()`, syncs to Supabase `haccp_logs` table. On save also calls `api.saveDailyLog({ entry_type: 'haccp', title: 'HACCP Log', data: JSON.stringify({ key, data }) })`.

**Temperature Log fields (per day row):** `am` (°F, flags bad if > limit) · `ami` (initials) · `pm` (°F) · `pmi` (initials) · `note` (action/comment) · Appliance selector (from `APPLIANCES` constant)

**Sanitizer Log fields (per day row):** `area` (area/corrective) · `am` (ppm, bad if < 150 or > 400) · `ami` · `pm` (ppm) · `pmi`

**Taste Panel fields (per item):** `product` (name) · `temp` (internal °F) · `code` (select from `TASTE_CODES`) · `notes`

**Role gating:** `canEdit = lvl >= 10`. When false: all inputs → read-only spans; Save/Add/Delete buttons hidden.

---

### 7.4 DailyOps

**File:** `frontend/src/components/DailyOps.tsx`  
**Props:** `{ user: User }`  
**Nav key:** `dailyops`

**API calls on mount:**
- `api.getDailyLogs(50, 'opening_checklist')`
- `api.getDailyLogs(50, 'meal_schedule')`

**On save:** `api.saveDailyLog({ entry_type: 'incident', title, description, severity: 'info' })` per incident.

**Layout (two-column grid, no tabs):**

| Card | Content |
|---|---|
| Morning opening checklist | Checkboxes + progress bar |
| Menu notes — 28-day cycle | `cycleDay` (1–28 number) + `notes` textarea |
| Today's meal schedule | Table: Meal, Hours, Lead monitor, Status pill |
| Incident log | Log of `{ type, detail, time }` entries |

**Incident form fields:** `iType` (select from `INCIDENT_TYPES`: Food safety · Equipment malfunction · Staff injury · Student conduct · Supply shortage · Fire/safety · Other) · `iDetail` (textarea, required before Log button enabled)

**Role gating:** `canEdit = lvl >= 10`. When false: checkboxes disabled; cycle/notes inputs disabled; incident form hidden; Save hidden.

---

### 7.5 EventsCalendar

**File:** `frontend/src/components/EventsCalendar.tsx`  
**Props:** `{ user: User }`  
**Nav key:** `events`

**API calls:** `api.getEvents()` on mount · `api.stageChange('event_create', 'event', ev.title, payload, message)` on new event submit (stages rather than direct-writes)

**State:** `events: CalendarEvent[]` · `cur: Date` (displayed month, init May 2026) · `cat: string` (filter, default `'all'`) · `selDay: string|null` · `adding: boolean`

**Layout:** Calendar grid (7-col, event dots) · Event list panel · Next cultural meal card · Monthly stats card (2×2 category counts) · ServSafe tracker card (5 hard-coded staff rows)

**Add Event modal fields:** `title` (required) · `cat` (select: cultural/special/training/heals/other, default cultural) · `date` (required) · `theme` (optional) · `desc` / notes (optional)

**Role gating:** `canEdit = lvl >= 20`. Add event + Delete buttons hidden when false.

**ServSafe tracker:** Static `SERVSAFE_STAFF` constant (5 entries). Expiry pill: Valid / `Xd left` / Expired / Pending.

---

### 7.6 CycleMenu

**File:** `frontend/src/components/CycleMenu.tsx`  
**Props:** `{ user: User }` *(user is unused — `_user`)*  
**Nav key:** `menu`

**API calls:** `api.getMenu(day)` looped over all 7 days sequentially on mount. Result stored as `menuData[dowKey]` and `sidesData[dowKey]`.

**UI:** Day-selector pill row (Mon–Sun, Today badge) · Per-meal cards for periods with data · Snack rendered as chips · Footer credits `Cafeteria_Cycle_Menu_March_2026.xlsm`

**Print / Edit buttons:** Rendered but no `onClick` handlers (stubs).

**Role gating:** None.

---

### 7.7 Forms

**File:** `frontend/src/components/Forms.tsx`  
Exports five independent components. All use the `useLog(key, initial)` persistence hook (localStorage + Supabase `haccp_logs` + `api.saveDailyLog` fire-and-forget).

#### MachineLog

**Props:** `PeriodFormProps` (`user`, `period`, `setPeriod`)  
**Nav key:** `haccp` → `machine` sub-tab (also used via Portal `mballot` ← wait, this is via HACCP tabs)

Per-row fields: `date` · `time` · `meal` (B/L/D toggle) · `wash` (°F) · `rinse` (°F) · `psi` · `final` (°F) · `ppm` (low-temp machines only) · `init`  
**Role gating:** `canEdit = lvl >= 10`

#### CoolingLog

**Props:** `PeriodFormProps`  
Per-row fields: `date` · `product` · `qty` · `init` · `start` (time) · `t2` (°F @ 2h, bad if > 70) · `t6` (°F @ 6h, bad if > 40) · `rDate` · `rMeal` · `rStart` · `rTemp` (°F reheat, bad if < 165)  
**Role gating:** `canEdit = lvl >= 10`

#### MealLog

**Props:** `{ user: User }`  
**Nav key:** `mballot`  
Per-row fields: `name` (text) · `sig` (initials) · `type` (select from `DS.syncMealTypes()`) · `B`/`L`/`D` (checkboxes) · `ticket` (text)  
Summary fields: `monitors` (number) · `diners` (number)  
**API:** `api.saveDailyLog({ entry_type, title, data })`  
**Role gating:** `canEdit = lvl >= 10`

#### InspectionSheet

**Props:** `{ user: User }`  
**Nav key:** `inspection`  
Header fields: `staff` (pre-filled `display_name + last_name`) · `date` (today) · `meal` (select: Breakfast/Lunch/Brunch/Dinner)  
Rating fields: GOOD/FAIR/POOR button-group for each of 15 `INSPECTION_Q` items  
`comments` textarea (4 rows)  
**API:** `api.saveDailyLog(...)`  
**Role gating:** `canEdit = lvl >= 20` (stricter — manager+)

#### FoodRequest

**Props:** `{ user: User }`  
**Nav key:** `foodreq`  
Fields from `FOODREQ_FIELDS`: `originator` · `date` · `dept` · `ext` · `eventDate` · `eventTime` · `students` · `staff` · `location` · `theme` · `food` (textarea) · `drinks` (textarea) · `other` (textarea)  
**Submit flow:** `save()` + `api.saveDailyLog(...)` → sets `submitted = true` → `window.toast?.("Food request submitted")`  
**Role gating:** `canEdit = lvl >= 10`

---

### 7.8 SnackBar

**File:** `frontend/src/components/Operations.tsx` (exported as `SnackBar`)  
**Props:** `{ user: User }`  
**Nav key:** `snackbar`

**Fields:** `open` (opening cash $) · `sales` (register sales $) · `close` (closing cash counted $) · `date`  
**Variance:** `close - (open + sales)` — colored `ok` (within $0.005) / `neg` / `pos`  
**On save:** `api.saveDailyLog({ entry_type: 'other', title: 'Snack bar reconciliation - <date>', description: JSON.stringify({ open, sales, close }) })`  
**Static cards:** Operating hours (`SNACK_HOURS`) · Meal ticket rates (`MEAL_RATES`)  
**Role gating:** `canEdit = lvl >= 10`. Inputs disabled + Save hidden when false.

---

### 7.9 MonthlyInventory

**File:** `frontend/src/components/Operations.tsx` (exported as `MonthlyInventory`)  
**Props:** `{ user: User; period: [number, number] }`  
**Nav key:** `moninv`

**API calls:** `api.getInventory(m+1, y)` on mount + period change → processed via `invToList()` from `supabase.ts`  
**On save:** `api.stageChange('inventory_save', 'inventory', 'batch', payload, 'Monthly inventory — <Month> <Year>')`

**Inline row fields:** `opening` · `received` · `issued` (all number, step 0.5). Closing computed: `max(0, opening + received - issued)`.  
**Search:** `q` text filter on item name.  
**"Print report" / "Add item"** buttons — no `onClick` handlers (stubs).

**Role gating:** `canEdit = lvl >= 20` (stricter than most — assistant+). Edit + Save hidden when false.

**Note:** Invoice register table is always empty — `invoices` state is never populated.

---

### 7.10 SourceControl

**File:** `frontend/src/components/SourceControl.tsx`  
**Props:** `{ user: User; onCountChange?: (n: number) => void }`  
**Nav key:** `sourcectrl`

**API calls on mount:** `api.getStaging()` + `api.getCommits()` (parallel `Promise.all`)  
**Approve:** `api.approveCommit({ staging_ids, message, author_id })` — batch-approves selected entries  
**Reject:** `api.rejectStaging(entry_id)` — removes from local state, shows toast

**Layout (no tabs, both panels always visible):**

- **Info banner** — describes pipeline: Upload/AI → staged diff → review → commit → GitHub sync
- **Sync card** — data store `MJCC-Portal/mjcc`, last commit SHA + relative time, Synced / Pending sync pill
- **Left: Review queue** (all staged) or **My pending submissions** (staff view)
- **Right: Commit history** with GitHub sync indicators

**Role gating:**

| Level | Behavior |
|---|---|
| `lvl < 20` (staff) | Sees only own submissions (`submitted_by === user.username`); no action buttons; "Pending review" pill |
| `lvl >= 30` (canReview) | Sees all staged; checkboxes; Reject (×) + Commit (✓) per entry; "Commit selected (n)" / "Commit all (n)" buttons |

**`onCountChange`:** Fires with `staged.length` whenever staged array changes — used by Portal sidebar badge.

**Commit message auto-generation:** Single entry uses `OP_LABEL[operation]` or `new_value_text`; batch uses `"Batch commit — N staged change(s)"`.

---

### 7.11 Reports

**File:** `frontend/src/components/Reports.tsx`  
**Props:** `{ user: User; period: [number, number] }`  
**Nav key:** `reports` *(min level 30 — manager+)*

**API calls on mount (parallel):** `api.getInventory()` · `api.getEvents()` · `api.getCommits()`

**Tabs:** `catalogue` (default) · `templates` (renders `<TemplatesPanel>`)

**Catalogue — 12 reports in 3 groups:**

| Group | Reports |
|---|---|
| Inventory | Inventory Snapshot · Monthly Inventory Roll-up · Invoice Register |
| Compliance | Meal Logs · HACCP Temperature Logs · Sanitizer Logs · Inspection Sheets · Daily Operations · Snack Bar Reconciliation |
| Programs | Events & Programs · ServSafe Certifications · Commit History |

Preview table capped at 60 rows. Per-report Print + Download CSV buttons. `invoices`, `meallog`, `temp`, `sanit`, `inspection`, `dailyops`, `snackbar` reports build empty arrays (no live data source wired).

---

### 7.12 Templates

**File:** `frontend/src/components/Templates.tsx`  
**Exports:** `TemplatesPanel` (also re-exported as `Templates`)  
**Props:** None. Fully stateless. No API calls.

Blank printable SOP forms. Print via `window.open` + `window.print()` after 250–300ms. CSV via `DS.download()`.

**9 templates in 3 groups:**

| Group | Templates |
|---|---|
| HACCP logs | Temperature Log · Sanitizer Solution Log · Warewashing Machine Temp Log · Cooling & Reheating Chart |
| Operations logs | Daily Meal Log · Snack Bar Reconciliation · Daily Opening Checklist |
| Inspections | Food Services Inspection Sheet · Food Request Form |

Template kinds: `table` (column headers + N blank rows) · `checklist` (items + sub-tables) · `rating` (GOOD/FAIR/POOR rows) · `form` (label + blank lines, grid layout)

Bulk actions: "Download all (CSV)" · "Print all forms"

---

### 7.13 UsersView *(inline in Portal.tsx)*

Calls `fetchProfiles()` (direct Supabase query on `user_profiles`) on mount.

**Table:** User (display_name + last_name) · Username · Role (pill) · Auth method (Password vs 4-digit PIN based on role) · Status (Active/Disabled) · Edit/Delete buttons

**Nav key:** `users` *(min level 40 — admin only)*

---

### 7.14 ArchivesView *(inline in Portal.tsx)*

Calls `api.getInventoryHistory()` on mount.

**Layout:** Stat cards for 4 most recent snapshots · Full snapshot table (Period, On-Hand Value, Line Items, Below Par, Status, CSV download)

**Nav key:** `archives` *(min level 20)*

---

## Appendix: `stageChange` Operation Types

All staged changes flow through `api.stageChange(operation, entityType, entityId, payload, summary)` → `POST /api/staging`. Operations:

| Operation | Entity type | Triggered by |
|---|---|---|
| `inventory_save` | `inventory` | InventoryView row Stage button; MonthlyInventory save |
| `menu_save` | `menu` | (not yet wired in frontend) |
| `event_create` | `event` | EventsCalendar AddEventModal |
| `haccp_save` | `compliance` | (not yet wired — ComplianceHub uses `saveDailyLog` directly) |
| `daily_log` | `ops` | DailyOps · SnackBar · MealLog · InspectionSheet · FoodRequest |
| `user_create` | `user` | (not yet wired in frontend) |
| `user_update` | `user` | (not yet wired in frontend) |
