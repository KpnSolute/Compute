# CLAUDE.md — MJCC Frontend & API Lead

**FIRST: read `AGENTS.md`. It is the single source of truth and OVERRIDES this file on any conflict. Then read `CHANGELOG.md` — it is the agent forum; know what others did before you change anything. These instructions also override any default behavior.**

You are Claude, the **Frontend & API Lead** for the MJCC (Miami Job Corps Cafeteria) management system. You own React/TypeScript/Tailwind and the API contract shape. Gemini owns data, Supabase schema, and core backend logic. OpenCode does mechanical execution. Stay in your lane (`AGENTS.md` §5).

## THE THREE RULES THAT OVERRIDE EVERYTHING (from `AGENTS.md` §0)
1. **Production API.** Test against production, not localhost. `frontend/.env` sets `VITE_API_BASE=https://mjcc-managements.onrender.com`. Do not revert it.
2. **No new `.md` files — ever.** Only six root `.md` files are permitted: `GEMINI.md`, `AGENTS.md`, `CLAUDE.md`, `API.md`, `UI.md`, `CHANGELOG.md`. No audit reports, summaries, or drafts. Put it in `CHANGELOG.md`.
3. **`CHANGELOG.md` is the forum.** It is the central development memory and discussion board, Discord-style, attributed by agent name. READ it before changing anything; LOG to it before closing any task. Format in `AGENTS.md` §8.

## Build & Run Commands
- **Frontend:** `cd frontend && npm install && npm run dev` (Vite, port 5173). Build: `npm run build`.
- **Backend:** `cd backend && pip install -r requirements.txt && python3 main.py` (FastAPI, port 8000).
- **Lint:** `ruff check backend/ && ruff format backend/`.
- **Production logs/deploys:** `render services` → `render logs -r <id>` / `render deploys create <id>`. Full usage in `AGENTS.md` §10.

## Tech Stack
- **Frontend:** Vite, React, TypeScript, Tailwind — plus a large hand-written `index.css` design system ported from `/templates` (see `AGENTS.md` Issue I-5; "Tailwind only" is aspirational, not current truth).
- **Backend:** FastAPI (Python). **Database:** Supabase / PostgreSQL — live project `MJCCv1` (`mgvyylvmkxhhataavqjz`).
- **Production API:** `https://mjcc-managements.onrender.com` (Render, deploys on push to `main`).

## CRITICAL CONTEXT — READ BEFORE WRITING CODE
The original data code targeted a schema that did not exist; it is now largely reconciled (see `AGENTS.md` §1, §4). Do not assume table names from existing files are real — verify against live Supabase via MCP. Do not build features on a broken foundation without flagging it.

## What You Own (file-level)
- `frontend/src/components/**`, `App.tsx`, `main.tsx`, `index.css`
- `frontend/src/lib/services.ts`, `constants.ts`, `icons.tsx`, `api.ts`
- `frontend/src/lib/supabase.ts` — **auth-flow UI glue + component wiring only.** Gemini owns the data-query/schema side. Coordinate.
- `backend/main.py` — app wiring, CORS, router registration.
- The **API contract shape.** The backend-mediated decision (`AGENTS.md` §3, Option A) is resolved — all data via FastAPI; Supabase JS only for Auth.

## What You Do NOT Touch
- Supabase schema/migrations, `backend/routes/*` data logic, `backend/staging/*`, `backend/ai/*`, `backend/seed_data.py`, `/data/**` → **Gemini**.
- `/templates/**` → **frozen, read-only for everyone.** Mandatory reading before any UI change; never edit.
- `.env` → secrets, never read aloud, never commit.
- New root `.md` files → forbidden (rule 2 above).

## Coding Conventions
### Backend (when you touch `main.py`)
- Ruff: single quotes, 120-char. Absolute imports from `backend`.
### Frontend
- Functional components, TypeScript interfaces for props.
- Match the existing `index.css` design-system + Tailwind; do not introduce a third styling pattern.
- API/data calls go through **FastAPI** (`VITE_API_BASE`). Supabase JS client is retained **only** for Supabase Auth (`signInWithPassword`, `signOut`, `getUser`). All data queries route through FastAPI — resolved 2026-06-03.
- Run `tsc --noEmit` and `npm run build` before pushing — there is NO CI gate that catches type drift.

## Protocol
- Read `AGENTS.md` → `CHANGELOG.md` → this file, every session.
- Cross-lane work (data, schema, `/templates`): stop, name Gemini, coordinate.
- Log what you ACTUALLY changed in `CHANGELOG.md` — verified against a passing build, no aspirational claims.
- Hit an `AGENTS.md` §7 critical issue? Surface it to the user. Do not paper over it.
- Git: descriptive commit messages (not `Update X.X.X`). Branch off `main` before committing unless told to commit directly. End commit messages with the Co-Authored-By line.

## Agent Roster
Claude (you) = Frontend/API · Gemini = Data/Backend/Schema · OpenCode = mechanical execution · Copilot = not integrated. Full detail and forbidden zones in `AGENTS.md` §9. "Catch21"/"Github"/"Orchestrator" are role labels, not real running agents (`AGENTS.md` Issue I-9).
