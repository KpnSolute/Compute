---
name: mjcc-tooling
description: >-
  Shared MJCC development tooling — master index for all agents (mjcc-api,
  mjcc-ui, mjcc-data). God-mode access to GitHub, Supabase, Render, ruff,
  ESLint, Chrome DevTools. CHANGELOG.md is the team forum. Links to all
  MJCC-specific skills.
metadata:
  version: "2.0.0"
---

# MJCC Shared Tooling — Master Index

Three specialized agents share this tooling. Lane ownership limits who writes which files — not which tools you may run.

## Agent Roster (v3.0)

| Agent | Role | Workspace |
|-------|------|-----------|
| **mjcc-api** | FastAPI backend, routes, dispatch, AI parsing | `API.md` |
| **mjcc-ui** | React/TS frontend, Portal, index.css | `UI.md` |
| **mjcc-data** | Supabase schema, migrations, RLS, RPCs | `DATA.md` |

## Session Protocol (every agent, every session)

1. Read your workspace doc (`API.md` / `UI.md` / `DATA.md`)
2. Read `CHANGELOG.md` (newest 30 lines minimum)
3. Read `AGENTS.md` §0 (the three override rules)
4. Work. Log to `CHANGELOG.md` before closing.

## Memory and governance

- `AGENTS.md` — single source of truth for schema and conventions
- `CHANGELOG.md` — team ballroom / forum; read before changes, log after
- `DATA.md` — live schema reference (verify against DB, may lag)
- `API.md` — endpoint contracts
- `UI.md` — component and design-system reference

## Project structure

```
frontend/          ← React/TS (mjcc-ui writes)
backend/routes/    ← FastAPI data logic (mjcc-api writes)
backend/staging/   ← staging gateway (mjcc-api writes)
backend/main.py    ← app wiring (mjcc-api writes)
backend/ai/        ← AI data-entry parsing (mjcc-api writes)
templates/         ← FROZEN — read only, never edit
.claude/agents/    ← mjcc-api.md, mjcc-ui.md, mjcc-data.md
.claude/skills/    ← this file + all skills below
```

## Tool palette (all agents — use freely)

### GitHub
```bash
git status && git diff && git log -5 --oneline
gh pr list && gh issue view <n>
```
**Origin only:** `muttyman2000/MJCC-Managements-.git`

### Supabase (MJCCv1 — mgvyylvmkxhhataavqjz)
MCP (preferred): `list_tables`, `execute_sql`, `apply_migration`, `get_advisors`
→ See skill: **mjcc-mcps**

### Render
```bash
render whoami && render services
render logs -r <service-id> --level error
render deploys create <service-id>
```
Never hardcode service IDs — always `render services` first.

### Ruff (Python)
```bash
ruff check backend/ && ruff format backend/
```
→ See skill: **mjcc-ruff**

### ESLint (TypeScript — no Prettier)
```bash
cd frontend && npm run lint && npx tsc --noEmit && npm run build
```

## Production targets

| Surface | Value |
|---------|-------|
| API | `https://mjcc-managements.onrender.com` |
| Frontend | `https://kpncompute.onrender.com` |
| Supabase | `MJCCv1` (`mgvyylvmkxhhataavqjz`) |
| Source repo | `muttyman2000/MJCC-Managements-.git` |

## MJCC Skills Index

| Skill | Purpose |
|-------|---------|
| `mjcc-tooling` | This file — master index |
| `mjcc-mcps` | Supabase MCP, Chrome DevTools MCP, GitHub MCP usage |
| `mjcc-ui-scheme` | CSS tokens, component classes, Portal architecture, VSCode UI |
| `mjcc-ruff` | Python backend lint/format commands and style rules |
| `mjcc-supabase-auth` | Auth flows, token storage, login patterns |
| `mjcc-git` | Commit format, push workflow, branch rules |
| `skillsense` | Auto-create a skill when you detect a repeated pattern |
| `render-*` (21 skills) | Render platform operations |

## Logging protocol

Append to `CHANGELOG.md` before closing any task:

```
## [vX.X.X] — YYYY-MM-DD — short title
**Claude/mjcc-api/mjcc-ui/mjcc-data:** what was done and verified.
**Build:** tsc clean / ruff clean / build passing (as applicable)
**Push:** pending — not yet pushed
```

## Browser / Chrome DevTools for live backend inspection (dev visibility)

**Goal:** Let the AI directly "see" what the running website (local dev or prod) is sending/receiving to the FastAPI backend, exactly like a human using F12 → Network tab.

**Why:** Essential for debugging API shape mismatches (e.g. flat list vs category-grouped inventory), auth flows, staging payloads, 4xx/5xx responses, timing, and CORS without relying on user copy-paste.

**Current project reality (analysis 2026-06-06):**
- Primary data path: `frontend/src/lib/api.ts` (all `api.*` methods hit `VITE_API_BASE` + Bearer). Used by `services.ts` (DS cache), SourceControl, Events, Operations writes, many Portal sections.
- Compatibility shims still active in `lib/supabase.ts`: `fetchInventory` (now delegates to `api.getInventory` + `groupByCategory`), `invToList`/`catTotals`/`reorders`/`iTotal`/`fmtMoney*`/`catColor`, plus log localStorage bridges. These power Dashboard summaries, monthly grids, reorder counts, and some Forms/Reports in Portal.tsx.
- Auth glue (realLogin, backendLogin/PIN, token mgmt) lives in supabase.ts and is correct (Supabase Auth for admins → backend JWT exchange).
- Production target always: https://mjcc-managements.onrender.com (set via frontend/.env VITE_API_BASE; never revert to localhost per AGENTS §0).
- Frontend static on separate Render service; no SPA routes (state machine in Portal).

**Recommended MCP — Chrome DevTools MCP (primary, 2026-06-07 switch):**

We **removed Playwright MCP entirely** because it was unstable on this setup (WSL/Windows browser split, GPU/dxg crashes, no X server, on-demand Chromium downloads — see CHANGELOG v1.4.9, v1.5.0, v1.5.3). The runtime is now **native Windows**, so the stable official choice is:

1. **Chrome DevTools MCP** (`chrome-devtools-mcp`, maintained by Google's Chrome DevTools team) — **PRIMARY (and only browser MCP)**.
   - Command: `npx -y chrome-devtools-mcp@latest` (on Windows, wrap in `cmd /c` for reliable stdio).
   - Connects to Chrome over the Chrome DevTools Protocol (CDP) instead of spawning/controlling its own browser → no GPU/display/subprocess fragility.
   - Network inspection (full `/api/*` URLs, request payloads, response bodies, Authorization Bearer headers), console messages, DOM, and performance traces are first-class — exactly the F12 → Network surface we need.
   - Prereqs (verified 2026-06-07): Node v24.16, npm 11, Chrome at `C:\Program Files\Google\Chrome\Application\chrome.exe`.

2. **Cursor built-in browser tool** ("cursor-ide-browser") — available automatically in Cursor sessions for UI verification.

**Config (current, in this tree):**

Root `.mcp.json` (Claude Code, native Windows) + `.vscode/mcp.json` (Cursor/VS Code) carry the chrome-devtools server; `.claude/settings.json` enables it via `enabledMcpjsonServers: ["chrome-devtools"]`. Shape:
```json
{
  "mcpServers": {
    "chrome-devtools": {
      "command": "cmd",
      "args": ["/c", "npx", "-y", "chrome-devtools-mcp@latest"]
    }
  }
}
```
Restart Claude Code after editing `.mcp.json` so the new server is picked up.

**Workflow for seeing backend calls (example for Claude):**
1. Use browser MCP tool to navigate to the frontend (prod https://kpncompute.onrender.com or local :5173 after setting frontend/.env).
2. Perform the user action (e.g. admin login, go to Operations tab, edit a cell, hit Save/Stage).
3. Ask the MCP for recent network activity: filter requests containing "mjcc-managements.onrender.com/api/" or "inventory", "staging", "events".
4. Inspect: method, full URL, Authorization header (Bearer), request body (the payload you staged), response status + body (what the route actually returned vs what component expected).
5. Cross-correlate with `render logs -r <backend-service-id> --level error` or path `/api/inventory`.
6. This replaces or augments manual F12 for the AI.

**Also always available (no MCP needed):**
- Manual: In any browser, load the site → F12 → Network tab → filter `api/` or the Render backend hostname. Preserve log on navigation if needed.
- Backend visibility: `render services` then `render logs -r <id>` (or `--path /api/...`).
- Combine both for full picture (frontend request shape + backend processing logs).

**Setup commands (native Windows):**
- Nothing to pre-install for Chrome DevTools MCP beyond Node + Chrome (both present). `npx -y chrome-devtools-mcp@latest` fetches the server on first run.
- It drives your installed Chrome — no separate Chromium download needed (this was a Playwright pain point, now gone).
- Restart Claude Code after `.mcp.json` changes.

**Verification (before claiming "Claude has devtools access"):**
- Agent can successfully call a browser_navigate or equivalent tool.
- It can reproduce a login + data action and report back a real /api/* request + response.
- Log the outcome in CHANGELOG.

Add these MCPs to **all** your agent roots (Claude primary, plus Gemini/OpenCode for parity) using the same pattern as the existing Supabase remote MCP. The project .cursor/.vscode/.claude/.agents trees already carry the skills for this.
