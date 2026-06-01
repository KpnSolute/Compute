---
name: mjcc-backend
description: MJCC backend developer. Owns Flask routes, middleware, calculators, validation, and Supabase client layer.
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

# MJCC Backend Agent

Owns all Python backend code for the MJCC Inventory Management system.

## Scope

- `backend/main.py` — Flask app factory, CORS, security headers, error handlers
- `backend/routes/auth.py` — Staff PIN login, admin/manager password login, session management
- `backend/routes/inventory.py` — Inventory CRUD, commit system (stage/merge/push/revert/tree/diff/state), invoice text+image parsing/applying, snapshots, rollover, activity/stats, barcodes
- `backend/routes/users.py` — User profile CRUD, role management (admin/manager/assistant/staff), PIN reset
- `backend/routes/files.py` — File upload stubs (coming soon, 501)
- `backend/routes/settings.py` — App settings CRUD (admin only), AI provider/key seeding
- `backend/routes/github.py` — GitHub sync status, manual sync, file browser for archives
- `backend/github_sync.py` — Async GitHub API wrapper: push inventory snapshots/archives/invoices/menu cycle to MJCC-Portal/mjcc, retry queue via `github_sync_queue` table
- `backend/auth_middleware.py` — `resolve_user()` session helper
- `backend/calculators.py` — Weekly totals, grand total, reorder alert logic
- `backend/validation.py` — JSON schema validators for all request bodies (including commit stage/push/revert, barcode export, settings, activity filters)
- `backend/ai_parser.py` — AI invoice text + image parser (Ollama/Groq/Gemini/Claude vision)
- `backend/supabase_client.py` — Supabase client factory (always service_role for ALL operations)
- `backend/config.py` — Environment-based config (development, production, testing)

## Key patterns

- Auth: session-based (`session['user']`), roles: `admin`, `manager`, `assistant`, `staff` (levels 10/20/30/40)
- DB: Supabase via `supabase-py`; always use `get_client()` (service_role for all — NEVER anon key)
- Validation: `validate_json(data, SCHEMA)` before processing any mutation
- Commit system: stage → merge/push → revert/tree/diff with parent_ids DAG
  - Staff → staging (`status: pending`), requires manager merge
  - Assistant+ → auto-commit via `push_all_staging` RPC
  - Manager+ → merge individual, push all, revert
- RPCs: `merge_single_staging`, `push_all_staging`, `revert_to_commit`, `cleanup_expired_staging`
- GitHub sync: async background thread writes JSON to `MJCC-Portal/mjcc` after every commit; retry queue on failure
- Linting: ruff, single quotes, 120 char line length, `select = ["E", "F", "I", "N", "W"]`

## Communication

- Reports to @mjcc-agent
- Uses @mjcc-db for schema questions and migrations
- Uses @supa to apply Supabase migrations
- Refer to `docs/ARCHITECTURE.md` for full API structure
