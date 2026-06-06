# Plan: MJCC Production Diagnosis via MJCC-Debugger

## Context
User reports issues on the main production site. Production API is confirmed live (`/health` → 200), but specific endpoints and the full auth+data flow need smoke testing. MJCC-debugger agent will be used to diagnose all failures against production (not localhost), then log findings + a fix plan to `CHANGELOG.md` as a new version entry.

## What We Know (from pre-plan exploration)
- **Git:** Clean, up to date with `origin/main`.
- **API up:** `https://mjcc-managements.onrender.com/health` → `{"status":"ok"}`
- **Auth-gated endpoints return 401 without token** — correct behavior, not a fault.
- **Likely failure surfaces:**
  1. **CORS** — `main.py` defaults `CORS_ORIGINS=localhost:5173`. If Render env var is not set to the production frontend domain, ALL browser requests fail preflight.
  2. **Auth flow** — ES256 JWKS + HS256 fallback JWT chain; PIN login; token exchange with backend.
  3. **Data endpoints** — inventory, dashboard stats, events, menu, logs — all need a valid token to test.
  4. **I-3 (dispatch password landmine)** — latent but needs documenting.
  5. **I-4 (HACCP localStorage vs backend)** — risk if production users are logging compliance data.

## Execution Plan

### Step 1 — Launch MJCC-debugger agent
Single foreground agent call to `MJCC-debugger` with the following explicit mandate:

**Debugger tasks (all against production, no localhost):**

1. **CORS check** — curl with `Origin: https://kpncompute.onrender.com` (and try common static-site domains) and inspect `Access-Control-Allow-Origin` response header. Identify which origins are allowed and whether the browser frontend domain is included.
   ```
   curl -s -I -H "Origin: https://kpncompute.onrender.com" \
     https://mjcc-managements.onrender.com/api/inventory
   ```

2. **Auth smoke test (staff PIN login)** — POST to `/api/auth/login` with staff PIN credentials to get a token, then use it on `/api/auth/me` and `/api/inventory`.
   ```
   curl -s -X POST https://mjcc-managements.onrender.com/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"username":"jeremiah","pin":"<pin>"}'
   ```
   (If PIN unknown, test admin JWT path instead via Supabase signIn.)

3. **Key endpoint sweep** (with valid token or auth header):
   - `GET /api/inventory` — inventory list
   - `GET /api/dashboard/stats` (or `/api/stats`) — dashboard
   - `GET /api/events` — events calendar
   - `GET /api/logs/haccp` — HACCP logs
   - `GET /api/menu/Mon` — menu
   - `GET /api/commits` — source control

4. **Render env var audit** — run `render services` to get service IDs, then check what env vars are set on the backend service (especially `CORS_ORIGINS`, `SUPABASE_JWT_SECRET`, `SUPABASE_SERVICE_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`).
   ```
   render services
   render env <backend-service-id>
   ```

5. **Render production logs** — tail last 50 lines of production logs for runtime errors:
   ```
   render logs -r <backend-service-id> --tail 50
   ```

6. **Diagnose every failure** — for each non-200 or unexpected response: identify root cause (missing env var, CORS misconfiguration, auth chain failure, schema mismatch, missing route), and write a concrete one-line fix.

### Step 2 — MJCC-debugger writes to CHANGELOG.md
After diagnosis, the debugger logs a new entry at the top of `CHANGELOG.md` following the §8 forum format:

```
## [v1.2.5] — 2026-06-05 — Production Diagnosis: [short title of findings]
**MJCC-debugger:** [Summary of what was tested and what failed]
### Findings
- [CORS] ...
- [AUTH] ...
- [ENDPOINT X] ...
### Fix Plan
1. ...
2. ...
**Push:** pending — not yet pushed
```

### Step 3 (post-approval, separate session)
Claude (main agent) implements the fixes identified by the debugger, verifies with `tsc --noEmit` + `npm run build` + re-curl production, then commits + pushes.

## Files Potentially Modified by Fixes (not by this plan — diagnosis only)
- `backend/main.py` — CORS origins list
- `backend/routes/__init__.py` — JWT validator config
- `backend/staging/dispatch.py` — I-3 password key removal
- Render dashboard env vars — `CORS_ORIGINS` value

## Verification (post-fix, not in this plan)
- `curl -s -I -H "Origin: <frontend-domain>" https://mjcc-managements.onrender.com/api/inventory` → must include correct `Access-Control-Allow-Origin`
- Full auth → data round-trip with real credentials returns 200 + data
- `npm run build` clean, `ruff check backend/` clean
