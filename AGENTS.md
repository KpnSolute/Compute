# AGENTS.md — MJCC Project

Full-stack cafeteria management system. FastAPI backend + Vite/React/Typescript frontend + Supabase.

## Two-Repo Architecture

| Repo | Role |
|------|------|
| `muttyman2000/MJCC-Managements-` (this) | App code — FastAPI, React, CI/CD |
| `MJCC-Portal/mjcc` | Data store — inventory snapshots, archives (no code, pure files) |

Data auto-syncs to `MJCC-Portal/mjcc` after commits via GitHub API.

## Agent Roles

| Agent | Responsibility |
|-------|--------------|
| **Catch21** | Logs all design/system changes to `CHANGELOG.md` in real-time |
| **Github** | Manages `git add/commit/push` with `Update X.X.X` version pattern |
| **Orchestrator** | Coordinates above agents; delegates frontend/API to Claude, data/logic to Gemini |
| **Claude** | Frontend & API — React components, FastAPI routes |
| **Gemini** | Data & backend logic — Supabase, GitHub sync, core services |

## Single Source of Memory

`CHANGELOG.md` is the canonical log. Every agent must:
- Check in on every prompt to identify loggable changes
- Record all Design Changes and System Updates with timestamps
- End each session with a "Daily Summary" close-out entry

## Commands

```bash
# Backend
cd backend && pip install -r requirements.txt && python main.py  # port 8000

# Frontend
cd frontend && npm install && npm run dev  # port 5173

# Lint
ruff check backend/     # single quotes, 120-char limit
ruff format backend/

# Metadata cleanup (Windows Zone.Identifier files)
bash scripts/strip_metadata.sh
```

## Key Conventions

- **Tokens in root `.env`** — never commit
- **Absolute imports** from `backend` in Python
- **CSS:** Tailwind only, no plain CSS
- **React:** Functional components + hooks + TypeScript interfaces
- **API calls** must match FastAPI endpoints in `backend/main.py`
- **UI changes** require reading `/templates/` first (mandatory assets)
- **Deploy:** Azure App Service via `.github/workflows/deploy.yml` (Docker to ACR)
- **Supabase MCP** configured in `.vscode/mcp.json` — uses `SUPABASE_MCP_TOKEN` env var
