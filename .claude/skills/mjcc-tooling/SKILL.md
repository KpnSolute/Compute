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
