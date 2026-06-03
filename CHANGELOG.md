# CHANGELOG

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
