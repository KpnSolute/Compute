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

**Recommended MCPs (add to your agent runtimes):**

1. **Playwright MCP** (preferred — you already have Chromium provisioned in WSL from prior OpenCode work)
   - Command: `npx @playwright/mcp` (or install globally)
   - Gives: navigate, click, fill, screenshot, console logs, and network/request inspection via evaluate or built-in tracing.
   - For headed (watch real Chrome-like window + use real DevTools alongside): omit --headless.

2. **Cursor built-in browser tool** ("cursor-ide-browser") — available automatically in Cursor sessions for UI verification.

3. **Chrome DevTools / CDP-focused MCPs** (for direct Network + Console surface)
   - Search for current "chrome-devtools-mcp", "browser-tools-mcp", or "puppeteer-mcp" servers.
   - These expose tools like getNetworkLogs, getConsoleMessages, performance traces — closest to "Chrome dev tools for seeing the backend".

**Config examples (add to mcpServers):**

For project `.cursor/mcp.json` / `.vscode/mcp.json` (Windows/Cursor):
```json
{
  "mcpServers": {
    "supabase": { ...existing... },
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp"]
    }
  }
}
```

For Claude Code / Gemini / OpenCode agent roots (typically in WSL):
- Edit the Claude Code config (often `~/.config/claude/config.json`, `claude_desktop_config.json`, or use `claude mcp add` CLI if available in your agent env).
- Or per-project under the agent's view of this tree's `.claude/settings.json` + env.
- Same JSON shape under the agent's mcpServers.

**Workflow for seeing backend calls (example for Claude):**
1. Use browser MCP tool to navigate to the frontend (prod https://kpncompute.onrender.com or local :5173 after setting frontend/.env).
2. Perform the user action (e.g. admin login, go to Operations tab, edit a weekly count, hit Save/Stage).
3. Ask the MCP for recent network activity: filter requests containing "mjcc-managements.onrender.com/api/" or "inventory", "staging", "events".
4. Inspect: method, full URL, Authorization header (Bearer), request body (the payload you staged), response status + body (what the route actually returned vs what component expected).
5. Cross-correlate with `render logs -r <backend-service-id> --level error` or path `/api/inventory`.
6. This replaces or augments manual F12 for the AI.

**Also always available (no MCP needed):**
- Manual: In any browser, load the site → F12 → Network tab → filter `api/` or the Render backend hostname. Preserve log on navigation if needed.
- Backend visibility: `render services` then `render logs -r <id>` (or `--path /api/...`).
- Combine both for full picture (frontend request shape + backend processing logs).

**Setup commands (run in the env where the agent runs):**
- Ensure Playwright browsers: `npx playwright install chromium`
- On pure WSL (no GUI): may need system libs (see prior OpenCode session notes for Debian package extraction if sudo limited).
- For Windows Chrome + WSL agent hybrid: launch Chrome on host with `--remote-debugging-port=9222`, then use CDP connect from WSL MCP (advanced; start with Playwright's own Chromium).

**Verification (before claiming "Claude has devtools access"):**
- Agent can successfully call a browser_navigate or equivalent tool.
- It can reproduce a login + data action and report back a real /api/* request + response.
- Log the outcome in CHANGELOG.

Add these MCPs to **all** your agent roots (Claude primary, plus Gemini/OpenCode for parity) using the same pattern as the existing Supabase remote MCP. The project .cursor/.vscode/.claude/.agents trees already carry the skills for this.
