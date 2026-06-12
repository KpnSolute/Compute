---
name: mjcc-mcps
description: >-
  How to use the three MJCC MCP servers: Supabase (live DB queries/migrations),
  Chrome DevTools (live network inspection of prod API calls), and GitHub MCP
  (repo state, diffs, commits). Essential for any agent doing data, debug, or
  deployment work.
metadata:
  version: "1.0.0"
---

# MJCC MCP Servers — Usage Guide

Three MCP servers are wired into the MJCC runtime. Use them before guessing.

---

## 1. Supabase MCP — Live Database

**Project:** MJCCv1 — ref `mgvyylvmkxhhataavqjz` — region `us-west-1`

### When to use
- Verify a column name before writing a route or query
- Run a read-only diagnostic query
- Apply a migration (DDL change) — always `apply_migration` for DDL, not raw `execute_sql`
- Check advisors for RLS gaps, unused indexes, or security warnings

### Key tools
```
mcp__claude_ai_Supabase__list_tables          → see all tables
mcp__claude_ai_Supabase__execute_sql          → run SQL (reads + writes)
mcp__claude_ai_Supabase__apply_migration      → DDL changes only
mcp__claude_ai_Supabase__get_advisors         → security + performance advisor
mcp__claude_ai_Supabase__get_logs             → recent Supabase log lines
mcp__claude_ai_Supabase__list_migrations      → migration history
```

### Verify column names (always do this before trusting code)
```sql
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_name = 'inventory_items'
ORDER BY ordinal_position;
```

### Safety rules
- NEVER run `DELETE`, `TRUNCATE`, `DROP` without explicit user authorization
- Use `apply_migration` for `ALTER TABLE` / `CREATE TABLE` — not raw `execute_sql`
- After any RLS change, verify policies: `SELECT * FROM pg_policies WHERE tablename = 'X'`

### Critical invariants (verify, don't assume)
- `monthly_inventory.month` → 0-indexed (0=Jan)
- `staging_entries.status` → only `pending/merged/rejected`
- `user_profiles` → NO `password` column
- `par_level` → global in `inventory_items`, not per period

---

## 2. Chrome DevTools MCP — Live Network Inspection

**Purpose:** Inspect real `/api/*` calls to `https://mjcc-managements.onrender.com` as they happen — exactly like F12 → Network tab. Use this BEFORE guessing at shape mismatches.

**Prereqs:** Chrome must be open. Works over CDP (no browser spawning).

### When to use
- A component shows wrong data — verify the actual API response shape
- A 4xx/5xx appears — see the real request payload and response body
- Auth token flow unclear — inspect the `Authorization: Bearer` header
- Staging payload format question — watch the real `POST /api/staging` body

### Key tools
```
mcp__chrome-devtools__navigate_page          → go to a URL
mcp__chrome-devtools__list_network_requests  → list recent network calls
mcp__chrome-devtools__get_network_request    → get one request's full detail
mcp__chrome-devtools__take_screenshot        → visual snapshot
mcp__chrome-devtools__evaluate_script        → run JS in page context
mcp__chrome-devtools__list_console_messages  → browser console output
```

### Workflow: debug an API call
1. `navigate_page` → `https://kpncompute.onrender.com` (prod frontend)
2. Perform the action in question (or ask user to)
3. `list_network_requests` → filter for `/api/`
4. `get_network_request` on the suspect call → see full URL, headers, request body, response status + body
5. Cross-check with `render logs -r <backend-service-id>` for the server-side view

### Test login credentials
- Admin: `jeremiah` / `JerBlue.16`
- Production frontend: `https://kpncompute.onrender.com`

---

## 3. GitHub MCP — Repo State

**Repo:** `muttyman2000/MJCC-Managements-.git` — this is the ONLY valid origin.

### When to use
- Check recent commit history before changing something
- Inspect a diff without running git locally
- Look up file contents at a specific SHA
- Search code across the repo

### Key tools
```
mcp__github__list_commits           → recent commit log
mcp__github__get_file_contents      → read file at HEAD or SHA
mcp__github__get_pull_request       → PR details
mcp__github__search_code            → find a symbol across repo
```

### Never use GitHub MCP to
- Push code (use `git push` via Bash instead)
- Bypass the git hook — `--no-verify` is forbidden

---

## 4. Sequential Thinking MCP — Complex Planning

For multi-step architectural changes, schema transformations, or large refactors:

```
mcp__sequential-thinking__sequentialthinking
```

Use this to break apart a complex problem into traceable steps before writing any code. Especially useful when a change touches DB schema + API routes + frontend in the same task.
