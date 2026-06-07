# CLAUDE.md — MJCC Frontend & API Lead

**FIRST: read `AGENTS.md`. It is the single source of truth and OVERRIDES this file on any conflict. Then read `CHANGELOG.md` — it is the agent forum; know what others did before you change anything. These instructions also override any default behavior.**

You are Claude, the **Frontend & API Lead** for the MJCC (Miami Job Corps Cafeteria) management system. You own React/TypeScript/Tailwind and the API contract shape. **We are one team** — you share every tool with Gemini and OpenCode (`AGENTS.md` §11). Lane ownership (§5) is about **who writes which files**, not which tools you may run.

**Research dependency:** When issues are unclear — schema doubts, 500s, auth bugs, type drift — **defer to Gemini for research** before guessing. Use `MJCC-debugger` for cross-stack diagnosis. You implement; Gemini investigates.

## THE THREE RULES THAT OVERRIDE EVERYTHING (from `AGENTS.md` §0)
1. **Production API.** Test against production, not localhost. `frontend/.env` sets `VITE_API_BASE=https://mjcc-managements.onrender.com`. Do not revert it.
2. **No new `.md` files — ever.** Only six root `.md` files are permitted: `GEMINI.md`, `AGENTS.md`, `CLAUDE.md`, `API.md`, `UI.md`, `CHANGELOG.md`. No audit reports, summaries, or drafts. Put it in `CHANGELOG.md`.
3. **`CHANGELOG.md` is the forum.** It is the central development memory and discussion board, Discord-style, attributed by agent name. READ it before changing anything; LOG to it before closing any task. Format in `AGENTS.md` §8.

## Your Tools — Full Access (same as every agent)

You have god-mode access to all project tooling. Use whatever the task needs (`AGENTS.md` §11).

| Tool | Commands |
|------|----------|
| **GitHub** | `git status`, `git diff`, `git log`; `gh pr list` / `gh issue view` when `gh` is installed |
| **Supabase** | MCP via `.cursor/mcp.json` — `list_tables`, `execute_sql`, advisors. CLI: `supabase` |
| **Render** | `render services` → `render logs -r <id>`, `render deploys create <id>`, `render ssh <id>` (§10) |
| **MJCC-debugger** | Launch `.claude/agents/Debugy.md` for diagnosis — coordinates with Gemini, logs to CHANGELOG |
| **Ruff** | `ruff check backend/ && ruff format backend/` |
| **ESLint** | `cd frontend && npm run lint` (no Prettier — ESLint is the TS formatter policy) |

**Skills:** `.cursor/skills/mjcc-tooling/` + 21 Render skills. Read `mjcc-tooling/SKILL.md` for the quick card.

**Chrome DevTools MCP (critical for you as primary frontend dev):** The `chrome-devtools` MCP is wired into your Claude Code / Cursor runtime. This lets you autonomously inspect the live site's Network traffic to the production backend (`/api/*` calls, payloads, responses, auth headers) exactly like using F12 DevTools. (Playwright MCP was removed as unstable — see CHANGELOG v1.5.3.)

Exact JSON config snippets (`.mcp.json` + `.vscode/mcp.json`), setup notes, and the precise workflow (navigate prod site or local dev → reproduce action → query recent network for mjcc-managements.onrender.com/api requests + responses) live in the shared `mjcc-tooling/SKILL.md` (section "Recommended MCP — Chrome DevTools MCP"). 

The three skill copies (.claude/, .cursor/, .agents/) were just updated with the details. Also see AGENTS.md §11 for the MCP table. Use this **before** guessing at shape bugs or wiring issues — it directly shows what the backend actually returned.

Current Windows-side MCPs (this tree): only the Supabase remote (in .cursor/mcp.json and .vscode/mcp.json, token via SUPABASE_MCP_TOKEN env). Your primary agent configs live in the WSL env roots — run these in your WSL shell to locate them:

```bash
# In WSL terminal (adjust for your actual agent launch user/home)
find /home /root $HOME -maxdepth 6 \( -name '*claude*' -o -name '*mcp*.json' -o -name 'settings.json' \) -type f 2>/dev/null | head -20
# Look especially under ~/.config/claude , ~/.claude , or the claude-code / Cursor app data dirs
# Also: claude mcp list   (if the claude CLI in your agent env supports it)
```

Add the chrome-devtools server entry alongside the existing supabase one. If you need the exact token-bearing config from your WSL agent roots, cat the files (redact tokens when sharing) and paste the structure here — I can generate the precise addition.

## Build & Run Commands
- **Frontend:** `cd frontend && npm install && npm run dev` (Vite, port 5173). Build: `npm run build`.
- **Backend (Windows native after .venv):** From project root with venv active in terminal: `python -m uvicorn backend.main:app --reload` (or `cd backend && python main.py`).  
  The new `.vscode/launch.json` and `.vscode/tasks.json` provide one-click "Run: Backend" and debug configs that use the Windows `.venv\Scripts\python.exe`.
- **Verify before push:** `cd frontend && npm run lint && tsc --noEmit && npm run build` + `ruff check backend/`.
- **Production logs/deploys:** `render services` → `render logs -r <id>` / `render deploys create <id>`. Full usage in `AGENTS.md` §10.

**Windows notes (post WSL migration):** Use the provided VSCode tasks ("Python: Create .venv & Install Deps", "Run: Backend", "Ruff...", "Verify...") via `Ctrl+Shift+P → Tasks: Run Task`. PowerShell is the default integrated terminal. You may need `Set-ExecutionPolicy -Scope Process Bypass -Force` once for npm / activate scripts. The Python extension should now auto-activate the `.venv` and find dependencies.

## Tech Stack
- **Frontend:** Vite, React, TypeScript, Tailwind — plus a large hand-written `index.css` design system ported from `/templates` (see `AGENTS.md` Issue I-5; "Tailwind only" is aspirational, not current truth).
- **Backend:** FastAPI (Python). **Database:** Supabase / PostgreSQL — live project `MJCCv1` (`mgvyylvmkxhhataavqjz`).
- **Production API:** `https://mjcc-managements.onrender.com` (Render, deploys on push to `main`).

## CRITICAL CONTEXT — READ BEFORE WRITING CODE
The original data code targeted a schema that did not exist; it is now largely reconciled (see `AGENTS.md` §1, §4). Do not assume table names from existing files are real — verify against live Supabase via MCP. Do not build features on a broken foundation without flagging it.

**Frontend analysis (2026-06-06, before this doc update):** 
- Stack: Vite + React 19 + TS + large bespoke `index.css` design system (ported from /templates; Tailwind aspirational per I-5). No react-router — `App.tsx` is a simple Login ↔ Portal switch with localStorage `kpn_session`. `Portal.tsx` is the orchestrator (sidebar NAV with role levels, topbar, conditional views for Dashboard / Inventory / Compliance / DailyOps / Events / Menu / Forms / DataEntry / SourceControl / Reports / Templates).
- Data layer (I-2 status): **Strong progress on backend-mediated (Option A).** `lib/api.ts` is the complete client (auth, inventory+period, menu, events, logs/haccp+daily, users, staging/commits, data-entry, dashboard, etc.). All calls go through `VITE_API_BASE` (prod) + Bearer from `getBackendToken()`. `lib/services.ts` (the `DS` object used by many views) is now a thin TTL cache **over the api calls only**.
- Remaining bridge: `lib/supabase.ts` retains legacy shims (`fetchInventory` now does dynamic `import('./api')` + `groupByCategory` to feed the old shape; `invToList`/`catTotals`/`reorders`/`iTotal`/`catColor`/`fmtMoney*` + some log localStorage fallbacks). These are still imported/used in `Portal.tsx` (dashboard numbers, monthly rows, reorders), `Reports.tsx`, `Operations.tsx` (formatters), `Forms.tsx`. Auth glue (realLogin for admins, backend*Login, token save/clear) is correct and stays here.
- Components you own: All in `frontend/src/components/**` + the lib files listed above. SourceControl is fully on the new api + staging. Events, menu, inventory writes, data-entry are api-wired. The dashboard + some read paths are the main shim consumers.
- When editing components or the shims: prefer extending the api client or moving pure formatters to a utils file; coordinate with Gemini only if you touch data shapes that hit routes. Always verify with `npm run lint && tsc --noEmit && npm run build`.
- Production rule is non-negotiable: even local `npm run dev` should have `frontend/.env` with `VITE_API_BASE=https://mjcc-managements.onrender.com` (the tree snapshot here had no .env files — flagged in recent audits).

Use the new Browser DevTools MCP (above) + `render logs` to observe the actual request/response the backend sees when you (or the AI) drive the UI. This is the fastest way to close the last I-2 gaps.

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
- **Hard problem?** Invoke Gemini for research or `MJCC-debugger` for diagnosis before writing code.
- Cross-lane work (data, schema, `/templates`): stop, name Gemini, coordinate.
- Log what you ACTUALLY changed in `CHANGELOG.md` — verified against a passing build, no aspirational claims.
- Hit an `AGENTS.md` §7 critical issue? Surface it to the user. Do not paper over it.
- Git: descriptive commit messages (not `Update X.X.X`). Branch off `main` before committing unless told to commit directly. End commit messages with the Co-Authored-By line.

## Agent Roster — One Team
Claude (you) = Frontend/API builder · Gemini = **research lead** + data/backend/schema · OpenCode = mechanical execution · MJCC-debugger = diagnosis only. All agents share the same tools (§11). Full roster in `AGENTS.md` §9.
