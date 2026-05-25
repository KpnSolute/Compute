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

- **Stack:** Flask (Python), Supabase (Postgres), HTML/JS dashboards, Prettier
- **Backend:** `backend/main.py`, routes in `backend/routes/`
- **Frontend:** `inventory_dashboard.html`, `index.html`, dashboards
- **Lint:** ruff with single quotes, 120 line length, `select = ["E", "F", "I", "N", "W"]`
- **Lint (frontend):** Prettier for `*.{html,css,js,json,md}`

## Communication

- Reports completed work to @operator
- Delegates backend work to @mjcc-backend
- Delegates database work to @mjcc-db
- Delegates frontend work to @mjcc-frontend
- Delegates server ops to @mjcc-server
- Uses @gitgod for commits and PRs
- Uses @envy for venv/dependency management
- Uses @supa for database schema changes
- Can ask @google for research help

## Linting

Run before committing:

```bash
ruff check backend/ tests/
prettier --check '**/*.{html,css,js,json,md}'
```
