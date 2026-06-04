# AGENT_ALIGNMENT.md — MJCC Single Source of Truth

**MANDATORY READING for ALL agents: Claude, Gemini, OpenCode, GitHub Copilot.**
This file overrides any conflicting statement in `CLAUDE.md`, `GEMINI.md`, `OPENCODE.md`, or `AGENTS.md`.
If you find a contradiction between this file and another doc, **this file wins** and you must flag the other doc for correction.

Last aligned: 2026-06-04 (Watch Commander team audit — live schema reconciled).

---

## 0. THE ONE THING YOU MUST UNDERSTAND FIRST

The original committed code was written against an **imaginary database schema**. As of 2026-06-04 this is **partially reconciled**: Gemini created the missing `events`, `haccp_logs`, `daily_operations_logs` tables (and others) so the newer route/staging code now targets REAL tables. The live database is real, large, and normalized. **Before writing any data code, read Section 4 (Real Data Model) and verify against live Supabase via MCP. Do NOT assume table/column names are correct just because they appear in `.py`/`.ts` files — verify.** Known still-broken spots: `user_profiles` has NO `password` column (I-3), and `cycle_menu`/`inventory_sync` names are still fiction.

See Section 7 (Known Critical Issues) for the full list and current status.

---

## 1. PROJECT IDENTITY

- **What it is:** A full-stack management system for the Miami Job Corps Cafeteria (MJCC) / "Jeremiah's Custom Creations" cafeteria operation. Inventory, HACCP compliance logs, cycle menus, events, invoices, vendors, and a Git-style source-control layer over inventory snapshots.
- **Stack:** Vite + React + TypeScript + Tailwind (frontend) · FastAPI + Python (backend) · Supabase / PostgreSQL (database).
- **Live Supabase project:** `MJCCv1` (ref `mgvyylvmkxhhataavqjz`, region us-west-1, ACTIVE). This is the one `.env` points to.
  - `MJCCv2` (ref `qprfonxvthmaoxfixigk`) is **INACTIVE** — do not target it without explicit user approval.
### ⚠️ TWO REPOS — NEVER MIX THESE (read before touching git or `.env`)

There are **two completely separate GitHub repos**. Confusing them has already broken `git remote origin` once. Do not let it happen again.

| Repo | URL | Role | `git remote`? | Render? |
|------|-----|------|---------------|---------|
| **SOURCE CODE** | `git@github.com:muttyman2000/MJCC-Managements-.git` | All source code. The Dockerfile lives here. | ✅ **THIS is `origin`.** Every `git push` goes here. | ✅ Render auto-deploys from THIS repo on push to `main`. |
| **DATA ARCHIVE** | `https://github.com/MJCC-Portal/mjcc.git` | Data store for the in-app Source Control module. Snapshots/archives pushed here by `github_sync.py` via the GitHub Contents API. | ❌ **NEVER set as a git remote.** | ❌ Render never reads this repo. |

**RULES:**
- `git remote origin` MUST be `muttyman2000/MJCC-Managements-.git`. Never change it to `MJCC-Portal/mjcc`.
- `GITHUB_REPO=MJCC-Portal/mjcc` in `.env` is **correct and intentional** — it is the data-archive target for the backend sync worker, NOT a code remote.
- If you ever see `MJCC-Portal/mjcc` set as `git remote origin`, that is a BUG. Revert it to the source-code repo immediately.

- **Code repo:** `git@github.com:muttyman2000/MJCC-Managements-.git` (origin/main). Render deploys from here.
- **Data repo:** `https://github.com/MJCC-Portal/mjcc.git` (referenced in `.env` as `GITHUB_REPO`) — data archive / snapshot store written by `backend/github_sync.py` via GitHub Contents API. **Not a code remote. Not connected to Render.**

---

## 2. SHARED VOCABULARY

| Term | Meaning |
|------|---------|
| **Portal** | The authenticated React SPA (`frontend/src/components/Portal.tsx`) the user logs into. |
| **Module** | A top-level feature page in the Portal, keyed by `NAV` in `constants.ts` (e.g. `inventory`, `haccp`, `events`, `sourcectrl`). |
| **Period** | A month/year pair, encoded in legacy code as `year*100 + month` (e.g. May 2026 → `202605`). The real DB stores `month` and `year` as separate integer columns. |
| **Snapshot** | A saved monthly inventory state. Real table: `monthly_snapshots` / `inventory_versions`. |
| **Commit** | A Git-style inventory change record. Real tables: `commits`, `commit_changes`. |
| **HACCP log** | A food-safety record (temp, taste, sanitizer). Currently frontend-only via localStorage `mjc_log_*` keys. **No live table exists** — see Issue I-4. |
| **demo mode** | Frontend fallback when no Supabase config is present in localStorage; reads `window.*` globals that no longer exist (returns empty). |
| **live mode** | Frontend talks to Supabase directly using a client configured from localStorage keys `mjc_supa_url` / `mjc_supa_key`. |

---

## 3. API CONTRACT

### Current reality (BROKEN — do not assume it works)
- **The frontend makes ZERO HTTP calls to the FastAPI backend.** There is no API base URL, no `fetch`, no `import.meta.env.VITE_API_*` anywhere in `frontend/src`. Confirmed by grep on 2026-06-03.
- The frontend talks **directly to Supabase** from the browser via `@supabase/supabase-js` (`frontend/src/lib/supabase.ts`).
- The FastAPI backend (`backend/main.py` + `backend/routes/*`) exposes 16 endpoints that **nothing calls** and that query **non-existent tables**.

### Backend endpoints as written (all currently non-functional against live DB)
| Method | Path | Queries table | Status |
|--------|------|---------------|--------|
| GET | `/` | — | OK |
| GET | `/health` | — | OK |
| POST | `/api/auth/login` | `user_profiles` (expects `password` col) | BROKEN — no `password` column |
| POST | `/api/auth/logout` | in-memory | OK but useless |
| GET | `/api/auth/me` | in-memory | OK but useless |
| GET/POST | `/api/inventory` | `inventory_sync` | BROKEN — table does not exist |
| GET | `/api/inventory/reorders` | `inventory_sync` | BROKEN |
| GET/POST | `/api/logs/{key}` | `haccp_logs` | BROKEN — table does not exist |
| GET/POST | `/api/events` | `events` | BROKEN — table does not exist |
| GET/POST | `/api/menu/{day}` | `cycle_menu` | BROKEN — table does not exist |

### RESOLVED DECISION (2026-06-03, confirmed by user)
**Option A — Backend-mediated** is the chosen pattern.

- Frontend calls FastAPI (`VITE_API_BASE=http://localhost:8000`); FastAPI owns all Supabase communication.
- **Gemini** rewrites all `backend/routes/*` against the real schema (Section 4).
- **Claude** builds the frontend API client (`frontend/src/lib/api.ts`) and wires components to call FastAPI endpoints instead of Supabase directly.
- The direct-to-Supabase client in `supabase.ts` is retained only for Supabase Auth (`signInWithPassword`, `signOut`, `getUser`) — all data queries route through FastAPI.
- The `mjc_supa_url` / `mjc_supa_key` localStorage pattern (demo/live mode toggle) is **deprecated** — app config comes from `VITE_API_BASE` env var going forward.

**No data code should be written that bypasses FastAPI unless it is a Supabase Auth call.**

---

## 4. REAL DATA MODEL (live Supabase `MJCCv1`, verified 2026-06-03)

This is the **authoritative schema**. 38 tables, RLS enabled on all. Key tables and their real columns:

- **`user_profiles`** (13 rows): `id, username, display_name, role, pin, active, created_at, updated_at, last_name`
  - **NO `password` column.** Admin/manager auth is meant to go through Supabase Auth (`auth.signInWithPassword` with synthesized email `username@mjc-cafeteria.com`), as the frontend already does. Staff auth = `pin` compare. Backend `auth.py` is wrong.
- **`inventory_items`** (1591 rows): `id, sku, barcode_id, description, category_id, vendor_id, unit_price, par_level, unit, active, on_hand, ...`
- **`inventory_categories`** (9 rows): `id, name, color, icon, sort_order`
- **`monthly_inventory`** (21089 rows): `id, item_id, month, year, on_hand, w1_received..w4_received, w1_issued..w4_issued, unit_price, ...`
- **`monthly_snapshots`** (76 rows): `id, month, year, grand_total, category_totals, item_count, reorder_count, preset, data, wk1_total..wk4_total, starting_total, saved_by, saved_at`
- **`inventory_master`** (316 rows) / **`item_barcodes`** (316) / **`barcodes`** (409): barcode + master item layers.
- **`vendors`** (3) · **`invoices`** (7) · **`invoice_items`** (64): purchasing/invoicing.
- **`menu_cycles`** (1) + **`menu_entries`** (0): cycle menu. `menu_entries`: `cycle_id, week_number, day_of_week, meal_type, items, sides, is_vegetarian, sort_order`.
- **`events`** (29 rows — CREATED since the 2026-06-03 audit): `id, cat, title, date, theme, description, suggested_menu, status, created_at, updated_at`. NOTE the category column is **`cat`**, not `category`.
- **`haccp_logs`** (0 rows — CREATED): `id, location, temperature, unit, timestamp, checked_by, notes, created_at`.
- **`daily_operations_logs`** (0 rows — CREATED): `id, entry_type, title, description, severity, data, created_by, created_at`.
- **Other tables CREATED since 2026-06-03:** `opening_checklist_items` (8), `servsafe_certifications` (7), `incident_logs` (0), `meal_periods` (5), `archive_import_log` (0).
- **Source-control layer:** `commits` (76), `commit_changes` (5460), `inventory_versions` (76), `staging_entries` (0 — now has `operation` + `full_payload` columns added by migration `003_staging_gateway.sql`), `github_sync_queue` (0).
- **Ops:** `centers` (1), `month_status` (1), `app_settings` (6), `audit_log` (0).
- **Empty/scaffolded:** `weekly_counts`, `inventory_transactions`, `reorder_alerts`, `email_templates`, `email_log`, `documents`, `qr_codes`, `uploads`.

**`events`, `haccp_logs`, and `daily_operations_logs` NOW EXIST (created by Gemini between 2026-06-03 and 2026-06-04) and are verified against live Supabase.** The schema fiction (I-1) is largely resolved for these tables. STILL fiction: `cycle_menu`, `inventory_sync` (use `menu_entries` / `inventory_items` instead). And `user_profiles` STILL has NO `password` column — see I-3, which is NOT resolved.

---

## 5. FILE OWNERSHIP & FORBIDDEN ZONES

| Path | Owner | Others may |
|------|-------|-----------|
| `frontend/src/components/**` | **Claude** | read only |
| `frontend/src/App.tsx`, `main.tsx`, `index.css` | **Claude** | read only |
| `frontend/src/lib/services.ts`, `constants.ts`, `icons.tsx` | **Claude** | read only |
| `frontend/src/lib/supabase.ts` (data access) | **Gemini** (schema), **Claude** (auth/UI glue) | coordinate |
| `backend/routes/**` data logic | **Gemini** | Claude reviews route shape |
| `backend/staging/**` (gateway, `dispatch.py`) | **Gemini** (data logic) | Claude reviews op contract shape |
| `backend/migrations/**` | **Gemini** (schema/DDL) | nobody else writes |
| `backend/routes/auth.py` | **Gemini** (must align to real auth model) | — |
| `backend/main.py` (app wiring/CORS) | **Claude** | Gemini reviews |
| `backend/seed_data.py` | **Gemini** | — |
| `/data/**` | **Gemini** | read only |
| Supabase schema / migrations | **Gemini** (via MCP) | nobody else writes schema |
| `/templates/**` | **READ-ONLY for everyone.** Source of truth for UI + seed data. Never edit. | — |
| `CHANGELOG.md` | every agent appends; nobody rewrites history | — |
| `.env` | **never read secrets aloud, never commit** | — |

**Forbidden zones (no agent writes without explicit user approval):**
- `/templates/**` — frozen reference assets.
- `.env` — secrets.
- Git history rewrites (`rebase`, `push --force`).
- The INACTIVE `MJCCv2` Supabase project.
- `node_modules/`, `.venv/`, `__pycache__/`, `.ruff_cache/`.

---

## 6. CONVENTIONS (enforced for every agent)

### Backend (Python / FastAPI)
- Ruff: **single quotes**, **120-char** line limit. Run `ruff check backend/ && ruff format backend/` before every commit.
- **Absolute imports** from `backend` (e.g. `from backend.routes import supabase`).
- Secrets from root `.env` only. Never hard-code.

### Frontend (React / TypeScript)
- Functional components + hooks. TypeScript interfaces for all props.
- **Tailwind for layout/utility styling.** NOTE: the project ALSO ships a 711-line hand-written design system in `index.css` ported from the templates. Tailwind-only is aspirational, not current reality — see Issue I-5. Do not claim "Tailwind only" until reconciled.
- API/data calls must match whichever pattern Section 3 resolves to. Today they go direct to Supabase.

### Git
- Commit message pattern in history is `Update X.X.X`. This is **uninformative** — see Issue I-6. Going forward, use descriptive messages.
- End commit messages with the Co-Authored-By line per Claude Code policy.
- Branch before committing if on `main` and the user has not said to commit directly.

---

## 7. KNOWN CRITICAL ISSUES (root causes of the consistency problem)

- **I-1 — Schema fiction (SEVERITY: PARTIALLY RESOLVED 2026-06-04, was CRITICAL).** Gemini created `events` (29 rows), `haccp_logs`, `daily_operations_logs`, `opening_checklist_items`, `servsafe_certifications`, `incident_logs`, `meal_periods` — the newer `data.py`/`sourcectrl.py`/`staging/dispatch.py` code targets REAL tables now, verified via MCP. **STILL fiction:** `inventory_sync` and `cycle_menu` table names (use `inventory_items` / `menu_entries`). Old `seed_data.py` may still reference dead names — Gemini to audit. **Root cause:** code was written from `templates/portal/*.jsx` demo shape; schema has since been built to match.
- **I-2 — Frontend/backend disconnect (CRITICAL).** Frontend never calls the backend. Two competing data layers exist. Section 3 decision required.
- **I-3 — Auth model conflict (STILL CRITICAL, NEW INSTANCE 2026-06-04).** `user_profiles` has NO `password` column (verified: columns are id, username, display_name, role, pin, active, created_at, updated_at, last_name, email, last_login). Real model = Supabase Auth for admin/manager + `pin` for staff. **NEW VIOLATION:** `backend/staging/dispatch.py::dispatch_user_create` writes a `password` field to `user_profiles` — this insert WILL FAIL at runtime whenever a `user_create` op replays. Gemini must remove the `password` key. The old `auth.py` password assumption may also linger — Gemini to verify.
- **I-4 — HACCP logs have no persistence layer (HIGH).** Frontend writes HACCP data to localStorage `mjc_log_*` and optionally a `haccp_logs` Supabase table that **does not exist**. Data is effectively browser-local and lost on cache clear.
- **I-5 — Styling contract violated (MEDIUM).** Docs say "Tailwind only" but the app ships a large bespoke `index.css`. Pick one story.
- **I-6 — Changelog vs git history mismatch (MEDIUM).** `CHANGELOG.md` versions (1.0.x → 1.3.0) do not line up with git tags (`Update 1.1.0` … `1.2.3`). Changelog claims "1.3.0 fully operational" while the build cannot reach live data. Commits are opaque `Update X.X.X`. The changelog is aspirational marketing, not an accurate log.
- **I-7 — CI references missing files (MEDIUM).** `.github/workflows/deploy.yml` runs `ruff check backend/ tests/` and installs `requirements-dev.txt` and runs `pytest`, but `tests/` and `requirements-dev.txt` **do not exist**. CI is red or skipped.
- **I-8 — `.env.example` drift (LOW).** `.env.example` still lists Flask/Ollama/Groq vars (`SECRET_KEY`, `DEBUG`, `AI_PROVIDER`, `GROQ_*`) that the real `.env` and FastAPI stack don't use. `GITHUB_REPO` differs between the two (`KpnWorld/MJCC` vs `MJCC-Portal/mjcc`).
- **I-9 — Phantom agents (LOW).** Docs reference agents "Catch21", "Github", "Orchestrator" as if autonomous. They are **not real running agents** — they are role labels for prompt behavior. Treat them as conventions, not services.

---

## 8. CHECK-IN & CHANGELOG PROTOCOL

Every agent, every session:
1. **Read this file first.** Then read the relevant agent doc (`CLAUDE.md` / `GEMINI.md` / `OPENCODE.md`).
2. **Verify before assuming.** Schema claims in code are presumed wrong (Section 0). Confirm tables/columns against live Supabase via MCP before writing data code.
3. **Stay in your lane** (Section 5). If a task crosses ownership, name the other agent and coordinate; do not silently cross.
4. **Log accurately — MANDATORY BEFORE CLOSING ANY TASK.** Append to `CHANGELOG.md` what you ACTUALLY changed and whether it works end-to-end, BEFORE you consider the task done. This applies to EVERY agent including **OpenCode** — a completed task with no CHANGELOG entry is a protocol violation. Do not write aspirational "fully operational" claims that aren't verified by a passing build against live data. If you forget and the Watch Commander finds an unlogged change, that is on you.
5. **Flag, don't paper over.** If you hit one of the Section 7 issues, surface it to the user. Do not build new features on top of broken foundations.

---

## 9. AGENT ROSTER (authoritative)

| Agent | Owns | Must NOT touch |
|-------|------|----------------|
| **Claude** | Frontend (React/TS/Tailwind), `backend/main.py` wiring, API contract shape | Supabase schema, `/data`, `/templates`, core data logic |
| **Gemini** | Data & backend logic, Supabase schema/migrations (via MCP), `backend/routes/*` data, `seed_data.py`, `/data` | Frontend components, `/templates` |
| **OpenCode** | Mechanical/repetitive tasks under explicit instruction: lint fixes, file moves, boilerplate, test scaffolding. See `OPENCODE.md`. | Architecture decisions, schema, auth, `/templates`, anything in Section 7 |
| **GitHub Copilot** | NOT INTEGRATED. Inline completions only when added. See `OPENCODE.md` note. | Everything until formally onboarded |
