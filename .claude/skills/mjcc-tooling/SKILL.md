---
name: mjcc-tooling
description: >-
  Shared MJCC development tooling for all agents (Claude, Gemini, OpenCode).
  One team — god-mode access to GitHub, Supabase, Render, debugger, ruff,
  ESLint. Gemini is research lead for issues. CHANGELOG.md is the forum.
metadata:
  version: "1.1.0"
---

# MJCC Shared Tooling — One Team

**We are one team.** Claude, Gemini, and OpenCode share the same tools, the same memory (`CHANGELOG.md`), and the same skills. Lane ownership (`AGENTS.md` §5) limits **who writes which files** — not which tools you may run. Every agent has full access to everything below.

## Research lead — Gemini

When issues need investigation (schema doubts, 500s, auth, performance, unfamiliar bugs):

1. Read `CHANGELOG.md` first — may already be solved.
2. **Invoke Gemini** for live schema verification, Supabase advisors, Render log correlation.
3. **Invoke MJCC-debugger** (`.claude/agents/Debugy.md`) for cross-stack diagnosis — it partners with Gemini, logs fix plans to `CHANGELOG.md`, does not write production code.

Claude and OpenCode **build from research output**. Do not skip Gemini on hard problems.

## Memory and governance (every session)

1. `AGENTS.md` — single source of truth
2. `CHANGELOG.md` — team forum; read before changes, log before closing any task
3. Lane doc — `CLAUDE.md` (frontend/API), `GEMINI.md` (data/backend/research)

## Project structure

```
frontend/          ← React/TS (Claude writes)
backend/routes/    ← FastAPI data logic (Gemini writes)
backend/staging/   ← staging gateway (Gemini writes)
backend/main.py    ← app wiring (Claude)
data/              ← persistence (Gemini)
templates/         ← FROZEN — read only
.cursor/mcp.json   ← Supabase MCP
.cursor/skills/    ← this skill + 21 Render skills
```

## Tool palette (all agents — use freely)

### GitHub
```bash
git status && git diff && git log -5 --oneline
gh pr list && gh issue view <n>    # when gh installed
```
**Origin only:** `muttyman2000/MJCC-Managements-.git`. Never set `MJCC-Portal/mjcc` as origin.

### Supabase (MJCCv1 — mgvyylvmkxhhataavqjz)
- **MCP** (preferred): `list_tables`, `execute_sql`, `apply_migration`, advisors
- **CLI**: `supabase` at `/usr/local/bin/supabase`
- Auth: `SUPABASE_MCP_TOKEN` env var

### Render
```bash
render whoami && render services
render logs -r <service-id> --level error
render deploys create <service-id>
render ssh <service-id>
```
Never hardcode service IDs — always `render services` first.

### MJCC-debugger
Launch `.claude/agents/Debugy.md` via Task/subagent. Diagnosis + fix plans only.

### Ruff (Python)
```bash
ruff check backend/ && ruff format backend/
```

### ESLint (TypeScript — no Prettier ships)
```bash
cd frontend && npm run lint && tsc --noEmit && npm run build
```

## Production targets

| Surface | Value |
|---------|-------|
| API | `https://mjcc-managements.onrender.com` |
| Supabase | `MJCCv1` (`mgvyylvmkxhhataavqjz`) |
| Source repo | `muttyman2000/MJCC-Managements-.git` |

## Agent roster

| Agent | Role |
|-------|------|
| **Gemini** | Research lead + data/backend/schema writer |
| **Claude** | Frontend/API builder |
| **OpenCode** | Mechanical executor (lint, boilerplate, moves) |
| **MJCC-debugger** | Cross-stack diagnosis (no production code) |

## Logging protocol

Append to `CHANGELOG.md` before closing any task:

```
## [vX.X.X] — YYYY-MM-DD — short title
**AgentName:** what was done and verified.
**Push:** pending — not yet pushed
```

Log which verification commands ran and whether they passed.

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
