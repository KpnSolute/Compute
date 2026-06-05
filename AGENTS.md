# AGENTS.md — MJCC Single Source of Truth & Governance

**MANDATORY READING for ALL agents: Claude, Gemini, OpenCode, GitHub Copilot.**
This file is the single source of truth. It OVERRIDES any conflicting statement in `CLAUDE.md`, `GEMINI.md`, or any other doc. If you find a contradiction between this file and another doc, **this file wins** and you must flag the other doc for correction.

This file replaces the former `AGENT_ALIGNMENT.md` (deleted 2026-06-04 — its content is folded in here).

Last aligned: 2026-06-04 (Watch Commander — production cutover + doc consolidation).

---

## 0. THE THREE RULES THAT OVERRIDE EVERYTHING

1. **PRODUCTION API.** All agents test against **production**, not localhost. `frontend/.env` sets `VITE_API_BASE=https://mjcc-managements.onrender.com`. Do not revert it to `http://localhost:8000`. The deployed FastAPI backend is the target.

2. **NO NEW `.md` FILES — EVER.** The ONLY `.md` files permitted at project root are: `GEMINI.md`, `AGENTS.md`, `CLAUDE.md`, `API.md`, `UI.md`, `CHANGELOG.md`. Do not create audit reports, summaries, synthesis docs, integration drafts, or any other `.md`. If you have something to say, it goes in `CHANGELOG.md`.

3. **CHANGELOG.md IS THE FORUM.** `CHANGELOG.md` is the central development memory and discussion board for all agents — formatted like a Discord server. Every thought, decision, and change goes there, attributed by agent name. **READ `CHANGELOG.md` BEFORE MAKING ANY CHANGE** so you know what the other agents have already done and decided. See §8 for the format.

---

## 1. THE ONE THING YOU MUST UNDERSTAND ABOUT THE CODE

The original committed code was written against an **imaginary database schema**. As of 2026-06-04 this is **largely reconciled**: Gemini created the missing `events`, `haccp_logs`, `daily_operations_logs` tables (and others) so the route/staging code now targets REAL tables. The live database is real, large, and normalized. **Before writing any data code, read §4 (Real Data Model) and verify against live Supabase via MCP. Do NOT assume table/column names are correct just because they appear in `.py`/`.ts` files — verify.** Known still-broken spots: `user_profiles` has NO `password` column (I-3), and `cycle_menu`/`inventory_sync` names are fiction (use `menu_entries` / `inventory_items`).

See §7 for the full known-issues list and current status.

---

## 2. PROJECT IDENTITY

- **What it is:** A full-stack management system for the Miami Job Corps Cafeteria (MJCC) / "Jeremiah's Custom Creations" operation. Inventory, HACCP compliance logs, cycle menus, events, invoices, vendors, and a Git-style source-control layer over inventory snapshots.
- **Stack:** Vite + React + TypeScript + Tailwind (frontend) · FastAPI + Python (backend) · Supabase / PostgreSQL (database).
- **Live Supabase project:** `MJCCv1` (ref `mgvyylvmkxhhataavqjz`, region us-west-1, ACTIVE). This is the one `.env` points to.
  - `MJCCv2` (ref `qprfonxvthmaoxfixigk`) is **INACTIVE** — do not target it without explicit user approval.
- **Production API:** `https://mjcc-managements.onrender.com` (Render, deploys from the source-code repo on push to `main`).

### TWO REPOS — NEVER MIX THESE (read before touching git or `.env`)

There are **two completely separate GitHub repos**. Confusing them has already broken `git remote origin` once. Do not let it happen again.

| Repo | URL | Role | `git remote`? | Render? |
|------|-----|------|---------------|---------|
| **SOURCE CODE** | `git@github.com:muttyman2000/MJCC-Managements-.git` | All source code. The Dockerfile lives here. | **THIS is `origin`.** Every `git push` goes here. | Render auto-deploys from THIS repo on push to `main`. |
| **DATA ARCHIVE** | `https://github.com/MJCC-Portal/mjcc.git` | Data store for the in-app Source Control module. Snapshots/archives pushed here by `github_sync.py` via the GitHub Contents API. | **NEVER set as a git remote.** | Render never reads this repo. |

**RULES:**
- `git remote origin` MUST be `muttyman2000/MJCC-Managements-.git`. Never change it to `MJCC-Portal/mjcc`.
- `GITHUB_REPO=MJCC-Portal/mjcc` in `.env` is **correct and intentional** — it is the data-archive target for the backend sync worker, NOT a code remote.
- If you ever see `MJCC-Portal/mjcc` set as `git remote origin`, that is a BUG. Revert it to the source-code repo immediately.

---

## 3. API CONTRACT

### Resolved decision (2026-06-03, confirmed by user): Backend-mediated (Option A)

- Frontend calls FastAPI (`VITE_API_BASE=https://mjcc-managements.onrender.com`); FastAPI owns all Supabase communication.
- **Gemini** owns all `backend/routes/*` data logic against the real schema (§4).
- **Claude** owns the frontend API client (`frontend/src/lib/api.ts`) and component wiring.
- The Supabase JS client in `supabase.ts` is retained **only** for Supabase Auth (`signInWithPassword`, `signOut`, `getUser`). **All data queries route through FastAPI.**
- The `mjc_supa_url` / `mjc_supa_key` localStorage demo/live toggle is **deprecated** — config comes from `VITE_*` env vars.

**No data code should bypass FastAPI unless it is a Supabase Auth call.**

### Endpoint reality (shipped routes target REAL tables)
The route layer has been rewritten off the old fiction. Current shipped routes query real tables:
- `inventory.py` → `monthly_inventory` / `inventory_items` / `inventory_categories` / `live_inventory` (view). The old `inventory_sync` name is dead.
- `menu.py` → `menu_entries` / `menu_cycles`. The old `cycle_menu` name is dead.
- `logs.py` → real `haccp_logs` / `daily_operations_logs`.
- `events.py` → real `events` table (category column is `cat`, not `category`).
- `auth.py` → Supabase Auth JWT (admin/manager) + `user_profiles.pin` (staff). No `password` column.

The full endpoint catalogue with request/response shapes lives in `API.md`.

---

## 4. REAL DATA MODEL (live Supabase `MJCCv1`, verified via MCP)

This is the **authoritative schema**. 38 tables, RLS enabled on all. Key tables and real columns:

- **`user_profiles`** (13 rows): `id, username, display_name, role, pin, active, created_at, updated_at, last_name, email, last_login`.
  - **NO `password` column.** Admin/manager auth = Supabase Auth (`auth.signInWithPassword`, synthesized email `username@mjc-cafeteria.com`). Staff auth = `pin` compare. Any code inserting `password` into `user_profiles` is a bug (I-3).
- **`inventory_items`** (1591 rows): `id, sku, barcode_id, description, category_id, vendor_id, unit_price, par_level, unit, active, on_hand, ...`.
- **`inventory_categories`** (9 rows): `id, name, color, icon, sort_order`.
- **`monthly_inventory`** (21089 rows): `id, item_id, month, year, on_hand, w1_received..w4_received, w1_issued..w4_issued, unit_price, ...`. **`month` is 0-indexed** — do not widen the constraint without confirming. Period is `month` + `year` separate integer columns, NOT `year*100+month`.
- **`monthly_snapshots`** (76 rows): `id, month, year, grand_total, category_totals, item_count, reorder_count, preset, data, wk1_total..wk4_total, starting_total, saved_by, saved_at`.
- **`inventory_master`** (316) / **`item_barcodes`** (316) / **`barcodes`** (409): barcode + master item layers.
- **`vendors`** (3) · **`invoices`** (7) · **`invoice_items`** (64): purchasing/invoicing.
- **`menu_cycles`** (1) + **`menu_entries`** (0): cycle menu. `menu_entries`: `cycle_id, week_number, day_of_week, meal_type, items, sides, is_vegetarian, sort_order`. `items`/`sides` are **`text`** columns storing JSON strings — serialize with `json.dumps()` on write, `json.loads()` on read.
- **`events`** (29 rows): `id, cat, title, date, theme, description, suggested_menu, status, created_at, updated_at`. Category column is **`cat`**, not `category`.
- **`haccp_logs`** (0 rows): `id, location, temperature, unit, timestamp, checked_by, notes, created_at`.
- **`daily_operations_logs`** (0 rows): `id, entry_type, title, description, severity, data, created_by, created_at`. `data` is `text` (not jsonb).
- **Other real tables:** `opening_checklist_items` (8), `servsafe_certifications` (7), `incident_logs` (0), `meal_periods` (5), `archive_import_log` (0).
- **Source-control layer:** `commits` (76), `commit_changes` (5460), `inventory_versions` (76), `staging_entries` (has `operation` + `full_payload` jsonb), `github_sync_queue` (0).
- **Ops:** `centers` (1), `month_status` (1), `app_settings` (6), `audit_log` (0).
- **Empty/scaffolded:** `weekly_counts`, `inventory_transactions`, `reorder_alerts`, `email_templates`, `email_log`, `documents`, `qr_codes`, `uploads`.

**STILL fiction (do not use):** `cycle_menu`, `inventory_sync`. **`pending_changes`, `staging_area`, `transaction_history`** are dead legacy schema (0 rows) — DROP candidates, do not build on them.

---

## 5. FILE OWNERSHIP & FORBIDDEN ZONES

| Path | Owner | Others may |
|------|-------|-----------|
| `frontend/src/components/**` | **Claude** | read only |
| `frontend/src/App.tsx`, `main.tsx`, `index.css` | **Claude** | read only |
| `frontend/src/lib/services.ts`, `constants.ts`, `icons.tsx`, `api.ts` | **Claude** | read only |
| `frontend/src/lib/supabase.ts` (auth/UI glue) | **Claude** (auth/UI), **Gemini** (data-query side) | coordinate |
| `backend/routes/**` data logic | **Gemini** | Claude reviews route shape |
| `backend/staging/**` (gateway, `dispatch.py`) | **Gemini** | Claude reviews op contract shape |
| `backend/ai/**` (AI data-entry pipeline) | **Gemini** (data logic) | Claude reviews contract shape |
| `backend/migrations/**` | **Gemini** (schema/DDL) | nobody else writes |
| `backend/routes/auth.py` | **Gemini** (align to real auth model) | — |
| `backend/main.py` (app wiring/CORS/routers) | **Claude** | Gemini reviews |
| `backend/seed_data.py` | **Gemini** | — |
| `/data/**` | **Gemini** | read only |
| Supabase schema / migrations | **Gemini** (via MCP) | nobody else writes schema |
| `/templates/**` | **READ-ONLY for everyone.** Source of truth for UI + seed data. Never edit. | — |
| `CHANGELOG.md` | **every agent appends** (the forum); nobody rewrites history | — |
| `.env` | **never read secrets aloud, never commit** | — |

**Forbidden zones (no agent writes without explicit user approval):**
- `/templates/**` — frozen reference assets.
- `.env` — secrets.
- Git history rewrites (`rebase`, `push --force`).
- The INACTIVE `MJCCv2` Supabase project.
- `node_modules/`, `.venv/`, `__pycache__/`, `.ruff_cache/`.
- **New root-level `.md` files** — only the six permitted files (§0 rule 2).

---

## 6. CONVENTIONS (enforced for every agent)

### Backend (Python / FastAPI)
- Ruff: **single quotes**, **120-char** line limit. Run `ruff check backend/ && ruff format backend/` before every commit. (Quote-style enforcement requires a ruff config — if absent, match the file's existing style and flag the gap.)
- **Absolute imports** from `backend` (e.g. `from backend.routes import supabase`).
- Secrets from root `.env` only. Never hard-code.
- New tables need an RLS policy or the anon client gets zero rows. Backend uses the **service_role** key for data routes.

### Frontend (React / TypeScript)
- Functional components + hooks. TypeScript interfaces for all props.
- Match the existing `index.css` design system + Tailwind. Do not introduce a third styling pattern. ("Tailwind only" is aspirational — a large bespoke `index.css` ships; see I-5.)
- Run `tsc --noEmit` and `npm run build` before pushing frontend changes — there is NO CI gate that catches type drift.
- Data calls go through FastAPI (`VITE_API_BASE`). Supabase JS only for Auth.

### Git
- Descriptive commit messages — NOT `Update X.X.X`.
- End commit messages with the Co-Authored-By line per Claude Code policy.
- Branch before committing if on `main` and the user has not said to commit directly.

---

## 7. KNOWN CRITICAL ISSUES

- **I-1 — Schema fiction (LARGELY RESOLVED).** Real tables created for `events`, `haccp_logs`, `daily_operations_logs`, and the ops tables; routes/staging target them. STILL fiction: `inventory_sync`, `cycle_menu`. Audit `seed_data.py` for dead names.
- **I-2 — Frontend/backend disconnect (IN PROGRESS).** Historically the frontend never called FastAPI. The §3 Option-A wiring is the active migration — verify each module actually hits `VITE_API_BASE` before calling it done.
- **I-3 — Auth model conflict (STILL CRITICAL).** `user_profiles` has NO `password` column. `backend/staging/dispatch.py::dispatch_user_create`/`dispatch_user_update` write/pass a `password` key — schema-invalid, guaranteed runtime failure once a Users UI stages `user_create`. Currently a latent landmine (no frontend stages those ops). Gemini removes the `password` key. Separately, creating an admin/manager requires a Supabase Auth user, not just a profile row.
- **I-4 — HACCP logs persistence (HIGH).** `haccp_logs` table is real and `logs.py` is schema-valid, but the frontend still writes to localStorage (`mjc_log_*`). Frontend wiring to `POST /api/logs/haccp` not done.
- **I-5 — Styling contract (MEDIUM).** Docs say "Tailwind only"; app ships a large bespoke `index.css`. Pick one story.
- **I-6 — Changelog vs reality drift (MEDIUM).** Historical changelog versions don't match git tags and contain aspirational claims. The new forum format (§8) + push-tracking line is the fix going forward. History is append-only — do not rewrite it.
- **I-7 — CI broken (MEDIUM).** `.github/workflows/deploy.yml` installs `requirements-dev.txt` and runs `pytest` against `tests/`. A `tests/` dir and a `backend/requirements-dev.txt` now exist in the working tree — confirm the workflow paths match before relying on CI. The root-level `requirements-dev.txt` was removed in the 2026-06-04 cleanup.
- **I-8 — `.env.example` drift (LOW).** May list stale vars not used by the FastAPI stack. Reconcile against real `.env` keys.
- **I-9 — Phantom agents (LOW).** "Catch21", "Github", "Orchestrator" are role labels, not real running agents. Treat as conventions.

---

## 8. CHANGELOG PROTOCOL — THE FORUM

`CHANGELOG.md` is the central development memory and agent discussion board, formatted like a Discord server. Every agent, every session:

1. **READ `CHANGELOG.md` FIRST** (then this file, then your agent doc). Know what others did and decided before you touch anything.
2. **Verify before assuming.** Schema claims in code are presumed wrong (§1). Confirm tables/columns against live Supabase via MCP before writing data code.
3. **Stay in your lane** (§5). Cross-lane work → name the other agent and coordinate; do not silently cross.
4. **Log to the forum — MANDATORY BEFORE CLOSING ANY TASK.** A completed task with no CHANGELOG entry is a protocol violation. This applies to EVERY agent including OpenCode. No aspirational "fully operational" claims — log what you ACTUALLY changed and whether it works.
5. **Flag, don't paper over.** Hit a §7 issue? Surface it to the user.

### Versioning & format
- Convention: `vX.X.X`. The log was reset to `v1.0.0` on 2026-06-04 — sequence forward from there. Newest entry on top.
- Every entry is attributed by agent name, Discord-style:

```
## [v1.0.1] — 2026-06-04
**Claude:** what was done and why.
**Gemini:** own changes or acknowledgements.
**Push:** [agent who pushed] → [git SHA stub] — [timestamp]    (or: pending — not yet pushed)
```

- The `**Push:**` line tracks deployment in-log so push state is visible without `git log`.
- History below the reset line is preserved and append-only — do not rewrite it.

---

## 9. AGENT ROSTER (authoritative)

| Agent | Owns | Must NOT touch |
|-------|------|----------------|
| **Claude** | Frontend (React/TS/Tailwind), `frontend/src/lib/api.ts`, `backend/main.py` wiring, API contract shape | Supabase schema, `/data`, `/templates`, core data logic |
| **Gemini** | Data & backend logic, Supabase schema/migrations (via MCP), `backend/routes/*`, `backend/staging/*`, `backend/ai/*`, `seed_data.py`, `/data` | Frontend components, `/templates` |
| **OpenCode** | Mechanical/repetitive tasks under explicit instruction: lint fixes, file moves, boilerplate, test scaffolding | Architecture decisions, schema, auth, `/templates`, anything in §7 |
| **GitHub Copilot** | NOT INTEGRATED. Inline completions only when added. | Everything until formally onboarded |

"Catch21" / "Github" / "Orchestrator" are role labels, not real running agents (I-9).
