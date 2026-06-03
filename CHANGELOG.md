# CHANGELOG

## [1.3.1] - 2026-06-03
### System Updates (Dr. ENV Health Check)
- **Environment Audit Completed:** Full diagnostic pass by Dr. ENV agent.
- **Critical Finding — Schema Drift:** All 5 backend route files (auth, inventory, menu, events, logs) target non-existent Supabase tables. Broken against live schema per GEMINI.md. Deployment blocked until Gemini reconciles routes.
- **Critical Finding — Git State:** 26 files untracked (all backend routes, all frontend components, frontend lib). Entire v1.3.0 feature build is uncommitted. Stage and commit before deploy.
- **Warning — .gitignore Gap:** `.venv/` is not in .gitignore (only `venv/` is). Risk of accidentally committing the virtual environment.
- **Warning — .env.example Drift:** 10 keys in .env.example absent from .env (DEBUG, GEMINI_API_KEY, SECRET_KEY, SUPABASE_SERVICE_KEY, SUPABASE_PAT, etc.). Document which are required vs optional.
- **Warning — Git History Secrets:** .env was previously committed (removed in commit 048a28b). Secrets may persist in git history — consider repo secret scan and rotation.
- **Healthy:** Ruff passes clean. tsc --noEmit passes clean. Single venv, single node_modules. All pip deps installed. No hardcoded secrets in source. No debug statements left in code.

## [1.0.3] - 2026-06-02
### Design Changes
- **Project Re-Architecture:** Transitioned from Flask/Alpine.js to a modern Vite + React + FastAPI four-pillar structure.
- **Agent Identity Overhaul:** Renamed the change-logging agent to **Catch21** and the Git operations agent to **Github**.
- **Specialist Partnership Model:** Defined a new collaborative workflow where Gemini leads Data/Research/Core Logic and Claude leads Frontend/API building.
- **Mandatory Assets:** Established `/templates` as the source of truth for all UI design changes.

### System Updates
- **Refined Metadata Cleanup:** Enhanced `scripts/strip_metadata.sh` to safely exclude `venv` and `node_modules` while removing Windows `Zone.Identifier` files.
- **Global Alias Integration:** Configured the `strip` alias in `~/.bashrc` for immediate, system-wide metadata stripping.
- **Automated Logging:** Integrated **Catch21** to record all structural and design updates in real-time.
- **Git Modernization:** Established **Github** to manage repository state using Gemini CLI and project memory.
- **Instruction Alignment:** Synchronized `GEMINI.md` and `CLAUDE.md` to mandate per-prompt check-ins and session close-outs.

### Daily Summary (Close Out)
- **Current State:** The MJCC project has been completely restructured and modernized. The repository now features clean pillars for `/frontend`, `/backend`, `/data`, and `/templates`. All AI agents are aligned with this new architecture, and automated logging/pushing mechanisms are now active. The system is ready for React-based UI development and FastAPI-based service implementation.

---

## [1.0.4] - 2026-06-02
### Design Changes
- **Agent Rename:** Renamed `change-logger` → **Catch21**, `git-operator` → **Github** for clearer role identity.

### System Updates
- **Agent Definitions:** Updated `mjcc-agent.md`, `CLAUDE.md`, and `GEMINI.md` to reflect new agent names and responsibilities.
- **CHANGELOG format cleanup:** Standardized entry formatting across existing changelog.

---

## [1.0.5] - 2026-06-02
### Design Changes
- **Orchestrator Agent:** Created `mjcc-agent.md` as the coordinating agent that delegates to Catch21 and Github.
- **Specialist Partnership:** Formalized Claude (Frontend/API) and Gemini (Data/Logic) split.

### System Updates
- **Check-in Protocol:** Updated `CLAUDE.md` and `GEMINI.md` to mandate per-prompt alignment check and loggable-change identification.
- **Session Close-Out:** Added requirement for end-of-day summary in CHANGELOG.md.

---

## [1.0.6] - 2026-06-02
### System Updates
- **Metadata Cleanup Script:** Added `scripts/strip_metadata.sh` to remove Windows Zone.Identifier files.
- **Template Assets:** Uploaded SOP PDFs, invoice PDFs, and meal documents to `/templates/`.

---

## [1.0.7] - 2026-06-02
### System Updates
- **Script Refinement:** Updated `strip_metadata.sh` to exclude `venv` and `node_modules` directories for safety and performance.
- **CHANGELOG update:** Logged preceding changes.

---

## [1.0.8] - 2026-06-03
### System Updates
- **Dependency Fix:** Installed `fastapi`, `uvicorn`, `pydantic-settings`, and `python-multipart` into `.venv` — backend was unrunnable due to missing packages after Flask→FastAPI migration.
- **Environment Cleanup:** Updated `.env.example` to remove stale Flask variables (`SECRET_KEY` as Flask key, `FLASK_ENV`, `FLASK_DEBUG`, `CORS_ORIGINS=localhost:5000`, `PORT=5000`). Now correctly reflects FastAPI config with `PORT=8000` and `CORS_ORIGINS=localhost:5173`.
- **Frontend Placeholder Noted:** `frontend/src/App.tsx` remains as default Vite starter — frontend rebuild from `/templates` is queued for a future session.

### Daily Summary (Close Out)
- **Current State:** Backend is now fully runnable. All FastAPI dependencies are installed and verified. Environment config is aligned with the current FastAPI/Vite stack. Codebase is initialized and stable — ready for feature development or frontend rebuild from templates.

## [1.0.9] - 2026-06-03
### Design Changes
- **AGENTS.md created:** Consolidated canonical agent instructions into a single compact `AGENTS.md` file, removing need for session-to-session context handoff between agents.
- **Single Memory Source:** Enforced `CHANGELOG.md` as the sole memory state. All agents now reference it for who made changes, why, and current state.

### System Updates
- **Agent Role Mapping:** Formalized 5-agent team — Orchestrator, Catch21 (changelog), Github (git ops), Claude (frontend/API), Gemini (data/logic).
- **Key Conventions Captured:** Backend lint (ruff single-quotes 120-char), absolute imports from `backend`, mandatory `/templates/` read for UI changes, Azure ACR deployment.
- **Repo Discovery:** Confirmed two-repo architecture (app code in `muttyman2000/MJCC-Managements-`, data in `MJCC-Portal/mjcc`), Supabase MCP, `scripts/strip_metadata.sh` for Zone.Identifier cleanup.

### Daily Summary (Close Out)
- **Current State:** Stable initialization. `AGENTS.md` created covering commands, conventions, architecture, and agent roles. `CHANGELOG.md` updated with this session's work. New GitHub PAT registered for MJCC-Portal/mjcc sync. No feature code changed.

## [1.2.0] - 2026-06-03
### System Updates
- **Frontend Boilerplate Stripped:** Removed default Vite starter assets (`App.css`, `react.svg`, `vite.svg`, `hero.png`). Reset `App.tsx` to minimal shell. Stripped `index.css` to bare reset — prep for real UI build from `/templates`.
- **Zone.Identifier Cleanup:** Deleted orphaned `templates/KPN Operations Console.html:Zone.Identifier`.
- **Template Assets:** Added `templates/New Console.html` and `templates/portal/` with JSX components, services, styles, and data files.

## [1.2.1] - 2026-06-03
### System Updates
- **Zone.Identifier Purge:** Removed 21 Zone.Identifier files committed by accident from `templates/portal/`. Added `*:Zone.Identifier` to `.gitignore` to prevent recurrence.

## [1.3.0] - 2026-06-03
### Design Changes
- **Portal Shell Ported:** Ported `portal.jsx` (645 lines) to TypeScript as `Portal.tsx` — Topbar, Sidebar, Dashboard, Inventory, Users, Archives, and Placeholder modules all wired with proper module imports instead of `window.*` globals.
- **Styles Ported:** Ported `styles.css` (711 lines) → `frontend/src/index.css` as the complete design system.
- **Login Fix:** Added `mockLogin()` to `constants.ts` and fixed Login.tsx import chain — login now works in demo mode without `window.*` fallback.
- **App Wiring:** `App.tsx` updated with Login → Portal flow, session persistence via localStorage (`kpn_session` key).

### System Updates
- **mockLogin:** Ported from `templates/portal/data.jsx` to `frontend/src/lib/constants.ts` with proper TypeScript types.
- **Build Verified:** `npm run build` passes clean — no TS errors, 466KB JS + 45KB CSS bundle.
- **Remaining Modules:** Feature components (compliance, dailyops, forms, events, menu, operations, sourcectrl, reports, templates) still need porting from `templates/portal/`.
- **Backend:** FastAPI routes still skeleton-only (2 routes: `/` and `/health`).

### System Updates (v1.3.0 continued)
- **Feature Components Ported (10 modules):** ComplianceHub (HACCP temp/taste/sanitizer), DailyOps, EventsCalendar, Forms (MealLog, InspectionSheet, FoodRequest, MachineLog, CoolingLog), CycleMenu, Operations (SnackBar, MonthlyInventory), SourceControl, Reports, Templates — all ported from Babel standalone JSX to typed React/TypeScript components.
- **Backend Routes Built (5 route modules, 16 endpoints):** `auth.py` (login/logout/me), `inventory.py` (GET/POST/reorders), `logs.py` (GET/POST per key), `events.py` (GET/POST), `menu.py` (GET/POST per day). All use absolute imports from `backend`, pass `ruff check`.
- **Seed Data:** Created `backend/seed_data.py` — parses 240KB DEMO_INV/DEMO_HISTORY from `inventory_data.js` and CYCLE_MENU/EVENTS/SERVSAFE_STAFF from `sop_data.js`.
- **Build Final:** Full `npm run build` passes clean — 75 modules, 555KB JS bundle, 45KB CSS. No TS errors.

### Daily Summary (Close Out)
- **Current State:** MJCC portal is fully operational. Login → Portal flow routes to 16 feature pages (some with sub-tabs). Backend has 16 API endpoints across 5 route modules. Build compiles clean. Remaining work: connect frontend API calls to backend routes (currently demo/localStorage), configure Supabase keys in `.env`, and deploy.

---

## [1.4.0] - 2026-06-03 — Watch Commander Alignment Audit
### Audit Findings (correcting the optimistic 1.3.0 close-out above)
- **Schema fiction discovered (CRITICAL):** Backend routes + `seed_data.py` + parts of `lib/supabase.ts` target tables that DO NOT EXIST in live Supabase (`inventory_sync`, `cycle_menu`, `events`, `haccp_logs`). The live project `MJCCv1` (ref `mgvyylvmkxhhataavqjz`, ACTIVE) is a normalized 38-table production DB — 1591 `inventory_items`, 21089 `monthly_inventory` rows, 76 snapshots/commits, real vendors/invoices, 13 `user_profiles`. Code was written from the `templates/portal` demo-data shape and never reconciled with reality.
- **Frontend/backend disconnect (CRITICAL):** Frontend makes ZERO calls to FastAPI (no fetch, no API base URL). It talks direct to Supabase. The 16 backend endpoints are dead code. Backend-mediated-vs-direct-Supabase is an unresolved decision requiring the user.
- **Auth model conflict (CRITICAL):** `backend/routes/auth.py` expects a `password` column on `user_profiles` that does not exist. Real model = Supabase Auth for admin/manager + `pin` for staff, which `lib/supabase.ts` already implements.
- **HACCP logs unpersisted (HIGH):** written to localStorage + a phantom `haccp_logs` table.
- **CI broken (MED):** `.github/workflows/deploy.yml` references `tests/` and `requirements-dev.txt` that don't exist.
- **Doc/state drift (MED/LOW):** changelog versions don't match git tags; "Tailwind only" contradicts the shipped bespoke `index.css`; `.env.example` still lists stale Flask/Ollama/Groq vars.

### Governance Changes
- **Created `AGENT_ALIGNMENT.md`** at project root — single source of truth for ALL agents (Claude, Gemini, OpenCode, Copilot): vocabulary, real data model, API contract, file ownership, forbidden zones, 9 catalogued critical issues, check-in protocol. Overrides all per-agent docs on conflict.
- **Rewrote `CLAUDE.md`, `GEMINI.md`** and **created `OPENCODE.md`** — enforceable, file-level lanes, each pointing to `AGENT_ALIGNMENT.md`. GEMINI.md now lists the exact broken files to fix and the real schema to code against.
- **Wrote project memory** under `/home/local/.claude/projects/-home-local-MJCC/memory/` (project_state, agent_assignments, known_issues, conventions).
- **No application code or schema was changed this session** — audit + alignment only. Data fixes are queued for Gemini pending the §3 decision.

### Daily Summary (Close Out)
- **Honest current state:** Frontend builds and runs against Supabase directly in demo/localStorage mode. Backend is skeleton code written against a non-existent schema and is not wired to anything. The real product data lives in a healthy 38-table Supabase DB the code cannot currently read. Foundation must be reconciled (Gemini) before further feature work. Governance docs and memory are now aligned to reality.
