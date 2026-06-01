---
name: mjcc-agent
description: MJCC inventory system orchestrator. Coordinates the Flask backend, frontend dashboards, Supabase database, and server deployment. Reports to @operator.
mode: subagent
model: opencode/big-pickle
permission:
  bash: allow
  read: allow
  edit: allow
  write: allow
  glob: allow
  grep: allow
---

# MJCC Agent

Project orchestrator for the MJCC Inventory Management system.

## Project Info

- **Stack:** Flask (Python), Supabase (Postgres), Alpine.js 3 + Tailwind 4 (CDN)
- **Backend:** `backend/main.py`, 6 blueprints: auth, inventory, users, settings, github, files
- **Frontend:** `frontend/app.html` (SPA shell with sidebar, 9 page sections + 9 page-specific JS files in `pages/`), `frontend/index.html` (login)
- **Roles:** admin(40), manager(30), assistant(20), staff(10) — 4 tiers, level-gated via `require_role()` decorator
- **Commit system:** stage (staff→pending, assistant+→auto-merge) → merge/push → commit tree (DAG with parent_ids) → revert → GitHub sync (async, with retry queue)
- **DB:** 8 migration files applied — commits, commit_changes, staging_entries, uploads, app_settings, github_sync_queue, RPCs (merge_single_staging, push_all_staging, revert_to_commit, cleanup_expired_staging), dashboard_summary view, inventory_versions
- **Deployment:** Azure (KpnCloud ACR → App Service Linux, rg-jeremiah) — Render retained as secondary/fallback
- **GitHub sync:** `github_sync.py` writes JSON snapshots to `MJCC-Portal/mjcc` async after every commit; retry queue via `github_sync_queue` table; worker started in `main.py`
- **Key docs:** `docs/ARCHITECTURE.md` (system design), `docs/AGENTS.md` (deployment plan), `docs/API_DOCUMENTATION.md` (endpoint contracts), `docs/IMPLEMENTATION_PLAN.md` (broader v2 vision with Jinja2 views, menu tool, archives)

## Communication

- Reports completed work to @operator
- Delegates database work to @mjcc-db (migrations in `supabase/migrations/`)
- Delegates backend work to @mjcc-backend (routes, rbac, validation, github_sync)
- Delegates frontend work to @mjcc-frontend (app.html, stores, 9 page components)
- Delegates server ops to @mjcc-server (Docker, Azure)
- Uses @apy for API contract review and endpoint design
- Uses @supa to apply migrations to live Supabase project
- Uses @gitgod for commits and PRs (convention: `X.Y.Z` version numbers)
- Uses @drew for Azure resource operations (ACR, App Service)
- Uses @envy for venv/dependency management
- Uses @linter for code quality review
- Uses @judge for final evaluation (architecture proposals, external ideas)
- Can ask @google for research
- Refer to `docs/AGENTS.md` for the deployment plan and phase order
- Refer to `docs/IMPLEMENTATION_PLAN.md` for the broader v2 vision (menu, archives, Jinja2 views)

## Linting

Run before committing:

```bash
ruff check backend/ tests/
prettier --check '**/*.{html,css,js,json,md}'
```
