# CHANGELOG

## [1.0.3] - 2026-06-02
### System Updates
- **Agent Consolidation:** Removed legacy agents (apy, drew, envy, gitgod, google, judge, mjcc-backend, mjcc-db, mjcc-frontend, mjcc-server, supa). Created `change-logger.md` and `git-operator.md`.
- **Instruction Refresh:** Rewrote `CLAUDE.md` and `GEMINI.md` with updated project context.

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
