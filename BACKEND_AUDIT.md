# MJCC FastAPI Backend Audit Report
**Date:** 2026-06-03  
**Auditor:** Comprehensive Code Review  
**System:** Full-stack cafeteria management (FastAPI + React + Supabase)

---

## EXECUTIVE SUMMARY

The FastAPI backend has **16 implemented endpoints across 5 route modules**, but the codebase suffers from **critical schema mismatch**: routes target non-existent Supabase tables (`inventory_sync`, `cycle_menu`, `events`, `haccp_logs`) while the actual production database has a normalized 38-table structure with different table names and schema. Additionally, **authentication is fundamentally broken** — the backend expects a plaintext `password` column that doesn't exist on `user_profiles`.

**Frontend makes ZERO API calls to FastAPI** — it communicates directly with Supabase. The backend is dead code.

---

## 1. ALL IMPLEMENTED ENDPOINTS

### Route Module: `auth.py` (3 endpoints)

| HTTP | Path | Status | Implementation | Issue |
|------|------|--------|----------------|-------|
| POST | `/api/auth/login` | BROKEN | Expects `username`, optional `password`/`pin` | ❌ **PASSWORD COLUMN DOESN'T EXIST** — real auth is Supabase Auth for admin/manager + PIN for staff |
| POST | `/api/auth/logout` | BROKEN | Deletes in-memory session token | ⚠️ Session store is non-persistent (in-memory, lost on restart) |
| GET | `/api/auth/me` | BROKEN | Returns user from in-memory token | ⚠️ Depends on login working |

**auth.py Issues:**
- `supabase.table("user_profiles").eq("password", ...)` — column doesn't exist
- In-memory `SessionStore` (UUID tokens) has no persistence/TTL
- No Supabase Auth integration (admin/manager should use Supabase Auth)
- No Bearer token validation beyond simple existence check

---

### Route Module: `inventory.py` (3 endpoints)

| HTTP | Path | Status | Implementation | Issue |
|------|------|--------|----------------|-------|
| GET | `/api/inventory?month=M&year=Y` | BROKEN | Queries `inventory_sync` table by period | ❌ **TABLE DOESN'T EXIST** — real table is `monthly_inventory` (21,089 rows) |
| POST | `/api/inventory` | BROKEN | Upserts `inventory_sync` payload | ❌ **TABLE DOESN'T EXIST** |
| GET | `/api/inventory/reorders` | BROKEN | Calculates low-stock items from `inventory_sync` | ❌ **TABLE DOESN'T EXIST** |

**inventory.py Issues:**
- No auth guards — any caller can read/write
- Expects flat structure `{category: [{sku, desc, onHand, par, ...}]}` (hardcoded in `seed_data.py`)
- Real schema is normalized: `inventory_items` (SKUs) → `monthly_inventory` (monthly snapshots with quantities)
- No validation of numeric fields (onHand, par, price)

---

### Route Module: `logs.py` (2 endpoints)

| HTTP | Path | Status | Implementation | Issue |
|------|------|--------|----------------|-------|
| GET | `/api/logs/{key}` | BROKEN | Retrieves from `haccp_logs` table | ❌ **TABLE DOESN'T EXIST** |
| POST | `/api/logs/{key}` | BROKEN | Upserts into `haccp_logs` | ❌ **TABLE DOESN'T EXIST** — frontend writes to localStorage only |

**logs.py Issues:**
- No auth guards
- `{key: string}` maps to a single JSON `data` column — no normalization
- Frontend uses only localStorage, never calls this endpoint
- `updated_by` is required but unvalidated

---

### Route Module: `events.py` (2 endpoints)

| HTTP | Path | Status | Implementation | Issue |
|------|------|--------|----------------|-------|
| GET | `/api/events` | BROKEN | Lists all events ordered by date | ❌ **TABLE DOESN'T EXIST** |
| POST | `/api/events` | BROKEN | Creates event with title, date, cat, theme, description, menu | ❌ **TABLE DOESN'T EXIST** |

**events.py Issues:**
- No ID generation, no auth, no timestamps
- No validation of date format
- No menu structure definition
- Frontend never calls these endpoints

---

### Route Module: `menu.py` (2 endpoints)

| HTTP | Path | Status | Implementation | Issue |
|------|------|--------|----------------|-------|
| GET | `/api/menu/{day}` | BROKEN | Retrieves cycle menu for day (Mon–Sun) | ❌ **TABLE DOESN'T EXIST** |
| POST | `/api/menu/{day}` | BROKEN | Updates cycle menu for day | ❌ **TABLE DOESN'T EXIST** |

**menu.py Issues:**
- `VALID_DAYS` hardcoded to 7 days
- Returns null for missing days (no seed/default)
- No auth guards
- Frontend never calls these endpoints (writes to localStorage only)

---

### Route Module: `sourcectrl.py` (4 endpoints)

| HTTP | Path | Status | Implementation | Working | Issue |
|------|------|--------|----------------|---------|-------|
| GET | `/api/commits?limit=50&offset=0` | IMPLEMENTED | Queries `commits` table with joins | ✅ **PARTIALLY WORKS** | Real table exists (76 rows), but missing error handling |
| GET | `/api/staging?entity_type=X` | IMPLEMENTED | Lists pending `staging_entries` | ✅ **PARTIALLY WORKS** | Real table exists, enriches with user profiles |
| POST | `/api/staging` | IMPLEMENTED | Creates staging entry | ✅ **PARTIALLY WORKS** | No auth, resolves author to first admin if missing |
| POST | `/api/commits` (approve) | IMPLEMENTED | Creates commit + updates staging status | ✅ **PARTIALLY WORKS** | **No idempotency checks** — calling twice creates 2 commits |
| DELETE | `/api/staging/{entry_id}` | IMPLEMENTED | Rejects staging entry | ✅ **PARTIALLY WORKS** | Returns `{"ok": true}` but should verify rejection |

**sourcectrl.py Issues:**
- No auth guards — any caller can approve/reject changes
- Hardcoded `ENTITY_TYPES` but no validation against real schema
- No concurrent-write protection
- Staging entries have no expiry enforcement (expires_at column ignored)
- No audit trail of who approved what

---

### Route Module: `github_sync.py` (2 endpoints)

| HTTP | Path | Status | Implementation | Issue |
|------|------|--------|----------------|-------|
| POST | `/api/github-sync/run` | IMPLEMENTED | Enqueues background GitHub push | ⚠️ Partially broken | **Requires GITHUB_TOKEN** — missing from most .env files |
| GET | `/api/github-sync/status` | IMPLEMENTED | Returns queue statistics | ✅ WORKS | Counts pending/synced/failed queue entries |

**github_sync.py Issues:**
- Assumes `GITHUB_REPO=MJCC-Portal/mjcc` is data-archive (correct)
- **Hard dependency on GITHUB_TOKEN** — fails silently if missing
- Base64-encodes entire commit JSON into GitHub (wasteful, not idiomatic)
- No webhook handler for GitHub responses (fire-and-forget)
- Retries 3x then marks failed, but no alert mechanism

---

### Core Route (`main.py`)

| HTTP | Path | Status |
|------|------|--------|
| GET | `/health` | ✅ Returns `{"status": "ok"}` |
| GET | `/` | ✅ Serves frontend `index.html` or welcome message |
| GET | `/{path:full_path}` | ✅ Catch-all serves `index.html` (SPA fallback) |

---

## 2. FRONTEND COMPONENTS & THEIR API EXPECTATIONS

### Components Using Backend API (`/api/*`)

Only **1 component** talks to FastAPI:

**`SourceControl.tsx`** — Uses `api.ping()`, `api.getStaging()`, `api.getCommits()`, `api.submitStaging()`, `api.approveCommit()`, `api.rejectStaging()`
- Implements a staging/commit workflow for data changes
- **Status:** Backend routes exist but broken (tables don't exist)
- **Frontend Status:** Works against live Supabase `commits` and `staging_entries` tables in demo mode

### Components Using Supabase Directly (NOT FastAPI)

All other 10 components bypass FastAPI and talk directly to Supabase:

| Component | Reads From | Writes To | Status |
|-----------|-----------|-----------|--------|
| `Login.tsx` | `user_profiles` | Supabase Auth | ✅ Works (in demo mode) |
| `Portal.tsx` | `inventory_sync` (id=1) | localStorage | ⚠️ Expects wrong table |
| `ComplianceHub.tsx` | `haccp_logs` | localStorage + `haccp_logs` | ⚠️ Phantom table |
| `DailyOps.tsx` | `haccp_logs` | localStorage + `haccp_logs` | ⚠️ Phantom table |
| `Forms.tsx` | `haccp_logs` | localStorage + `haccp_logs` | ⚠️ Phantom table |
| `CycleMenu.tsx` | `cycle_menu` | Supabase | ❌ Table doesn't exist |
| `EventsCalendar.tsx` | `events` | Supabase | ❌ Table doesn't exist |
| `Operations.tsx` | localStorage | localStorage | ✅ Works (local only) |
| `Reports.tsx` | Data computed from inventory | — | ✅ Works (local only) |
| `Templates.tsx` | window globals | — | ✅ Works (hardcoded) |

---

## 3. AUTHENTICATION FLOW ANALYSIS

### Current Implementation (Broken)

**Backend Auth (`auth.py`):**
```
POST /api/auth/login { username, password, pin }
  → SELECT * FROM user_profiles WHERE username = ? AND active = TRUE
  → If role in (admin, manager, assistant): compare req.password == user.password
  → If role = staff: compare req.pin == user.pin
  → CREATE in-memory UUID token
  → Return { token, user }

GET /api/auth/me with Authorization: Bearer <token>
  → LOOKUP token in in-memory SessionStore
  → RETURN user or 401
```

**Frontend Auth (`lib/supabase.ts`):**
```
realLogin({ username, type, pin, password })
  → SELECT id, username, display_name, role, pin, active FROM user_profiles
  → If type = staff: bcrypt-compare(pin, user.pin)
  → If type = admin: auth.signInWithPassword(email@mjc-cafeteria.com, password)
     (calls Supabase Auth, NOT backend)
  → RETURN { ok: true, user, access_token? }
```

### Critical Mismatches

1. **Password Column Doesn't Exist**
   - Backend tries to read/compare `user.password` column
   - Real `user_profiles` table has NO `password` column
   - Admin/manager auth should use Supabase Auth, not plaintext

2. **Two Different Auth Systems**
   - Frontend uses Supabase Auth (admin/manager) + bcrypt PIN (staff)
   - Backend expects plaintext password (admin/manager) + plaintext PIN (staff)
   - Frontend never calls backend auth endpoints

3. **Session Store is Non-Persistent**
   - Backend UUID tokens live only in RAM
   - Lost on server restart
   - No TTL/expiry

4. **No Bearer Token Validation**
   - Backend only checks token exists, no signature/verification
   - Frontend doesn't send Bearer tokens to API (it sends direct to Supabase)

---

## 4. CRITICAL MISSING/INCOMPLETE FEATURES

### Highest Priority (Blocking Production)

1. **❌ User Management Endpoints (NEW — Missing)**
   - GET `/api/users` — list all user_profiles
   - POST `/api/users` — create new user
   - PUT `/api/users/{id}` — update user
   - DELETE `/api/users/{id}` — deactivate user
   - No frontend component to call these; Portal.tsx shows user list but never fetches

2. **❌ Inventory CRUD (Broken Schema)**
   - Backend targets `inventory_sync` table (doesn't exist)
   - Real schema is `inventory_items` (1,591 rows) + `monthly_inventory` (21,089 rows)
   - Need endpoints:
     - GET `/api/inventory/items` — list all items with categories
     - GET `/api/inventory/monthly/{year}/{month}` — fetch monthly snapshot
     - POST `/api/inventory/monthly/{year}/{month}` — create/update snapshot
     - POST `/api/inventory/reorder` — create purchase order

3. **❌ Menu Management Endpoints (NEW — Missing)**
   - Backend has `/api/menu/{day}` but `cycle_menu` table doesn't exist
   - Need to redesign: cycle menu should be normalized (Menu → Days → Items)
   - Or: create `cycle_menu` table with proper schema

4. **❌ Events/Compliance Persistence**
   - `events` table doesn't exist (3 rows in production!)
   - `haccp_logs` table doesn't exist (critical for compliance)
   - Frontend writes to localStorage, never persists to Supabase

5. **❌ Authentication Overhaul (NEW — Complete Rewrite)**
   - Backend should NOT own password checking
   - Backend should accept Bearer token from Supabase Auth
   - Backend should validate token against `auth.users` or cached session
   - Remove in-memory SessionStore, use Redis or JWT

### Medium Priority (Missing Features)

6. **⚠️ Role-Based Access Control**
   - No auth guards on ANY endpoint (all 16 are public)
   - No role checks (`@require_role('admin')` decorator missing)
   - `sourcectrl.py` should check user is manager+ to approve commits

7. **⚠️ Input Validation**
   - No validation on inventory quantities (negative numbers allowed?)
   - No validation on menu item descriptions (length limits?)
   - No validation on event dates (past dates allowed?)
   - No SQL injection protection (Supabase client-side should handle, but explicit validation needed)

8. **⚠️ Error Handling**
   - All endpoints assume Supabase succeeds
   - No retry logic
   - No logging of errors
   - `github_sync.py` logs errors to DB but no alerting

9. **⚠️ Pagination & Filtering**
   - `GET /commits` has limit/offset but no filtering
   - `GET /staging` has entity_type filter but no date range
   - No search endpoints

10. **⚠️ Audit Trail**
    - No who/when/what logging on data changes
    - `sourcectrl.py` creates commits but no detailed audit per field change

### Low Priority (Nice-to-Have)

11. ⚠️ File uploads (invoices, receipts, SOPs)
12. ⚠️ Full-text search
13. ⚠️ Data export (CSV/PDF)
14. ⚠️ Webhooks (for external integrations)

---

## 5. AUTHENTICATION ARCHITECTURE PROBLEMS

### Problem 1: Password Column Missing
**Evidence:**
```python
# backend/routes/auth.py:35
if req.password != user.get("password", ""):
    raise HTTPException(...)
```
Real Supabase schema has NO `password` column on `user_profiles`. This code will never work.

### Problem 2: Real Auth System is Supabase Auth
**Evidence:**
```typescript
// frontend/lib/supabase.ts:131
const { data, error } = await db.auth.signInWithPassword({
  email: buildEmail(username),
  password,
});
```
Frontend uses Supabase Auth for admin/manager login. Backend should trust Supabase Auth tokens, not manage its own.

### Problem 3: Session Store is Non-Persistent & Insecure
**Evidence:**
```python
# backend/routes/__init__.py:20-30
class SessionStore:
    def __init__(self):
        self._sessions = {}  # Lost on restart!
    
    def create(self, user_data):
        token = str(uuid4())  # No signature, any UUID is valid
        self._sessions[token] = { ... }
        return token
```
- In-memory dictionary (lost on server restart)
- UUID tokens have no cryptographic signature (trivial to forge)
- No expiry/TTL
- Not shared across process instances (bad for load-balancing)

### Problem 4: Frontend Never Calls Backend Auth
**Evidence:**
- `frontend/src/lib/api.ts` has no login/logout functions
- `frontend/src/components/Login.tsx` calls `realLogin()` from `lib/supabase.ts`, not FastAPI
- `SourceControl.tsx` uses `api.ping()` to detect if backend is live, but doesn't auth with it

### Recommended Auth Architecture

```
┌─ Frontend ─────────────────┬─ Backend ──────────────┐
│                            │                        │
│ 1. realLogin()             │                        │
│    ↓                       │                        │
│ 2. Supabase Auth ←────────────────────────────────→ 3. Validate with Supabase JWT
│    (get session)           │   Backend verifies key │
│                            │   in Supabase.auth     │
│ 4. Store access_token      │                        │
│    in localStorage         │                        │
│                            │                        │
│ 5. Send Bearer token ────────────────────────────→ 6. Verify token
│    on each API call        │   Check auth.users     │
│                            │   Cache for 5 mins     │
│                            │                        │
│                            │                        │
└────────────────────────────┴────────────────────────┘
```

**Fixes Required:**

1. **Remove in-memory SessionStore** — replace with JWT verification
2. **Add Supabase JWT verification** to backend:
   ```python
   import jwt
   
   @app.middleware("http")
   async def validate_token(request, call_next):
       token = request.headers.get("Authorization", "").replace("Bearer ", "")
       if token:
           try:
               payload = jwt.decode(token, SUPABASE_KEY, algorithms=["HS256"])
               request.state.user_id = payload["sub"]
           except:
               pass
       return await call_next(request)
   ```
3. **Fix `auth.py`** to remove password logic, accept Bearer tokens
4. **Frontend should send Bearer token** to API calls (currently doesn't)

---

## 6. MISSING TABLE MAPPINGS (REAL SCHEMA vs CODE)

### Phantom Tables (Code Expects But Don't Exist)

| Code Table | Real Table | Notes |
|------------|-----------|-------|
| `inventory_sync` (id=1, data=JSON) | `monthly_inventory` (21,089 rows) | Completely different schema |
| `cycle_menu` (id=day, data=JSON) | ? (does not exist) | Should be `menus` + `menu_items` |
| `events` | `events` (3 rows exist!) | Table EXISTS but code never reads it |
| `haccp_logs` (id=key, data=JSON) | ? (does not exist) | Compliance data should be `compliance_checks` or similar |

### Real Tables Code Doesn't Use

| Real Table | Rows | Purpose | Should Be Used By |
|-----------|------|---------|-----------------|
| `inventory_items` | 1,591 | Master SKU list | `GET /api/inventory/items` |
| `vendors` | 98 | Supplier directory | (exists but unused) |
| `purchase_orders` | ? | Orders from vendors | (not in backend) |
| `invoices` | ? | Vendor invoices | (not in backend) |
| `compliance_checks` | ? | Health/safety audits | (backend uses phantom `haccp_logs`) |
| `user_roles` | ? | Role definitions | (should cache in backend) |
| `audit_log` | ? | Change history | (sourcectrl doesn't use this) |

---

## 7. PRODUCTION READINESS CHECKLIST

### Authentication & Security
- [ ] Replace in-memory SessionStore with JWT/Redis
- [ ] Add Supabase Auth token verification
- [ ] Add role-based access control decorators to all endpoints
- [ ] Add rate limiting (prevent brute-force)
- [ ] Add CORS validation (currently allows all origins)
- [ ] Remove plaintext password handling
- [ ] Add HTTPS enforcement

### Data Integrity
- [ ] Fix schema mismatch (inventory, menu, events, logs)
- [ ] Add input validation (types, ranges, formats)
- [ ] Add transaction support (multi-table updates)
- [ ] Add concurrent-write protection
- [ ] Add audit trail (who/when/what)
- [ ] Add soft-delete support (don't hard-delete historical data)

### API Design
- [ ] Consistent error responses (RFC 7807 Problem Details)
- [ ] API versioning (v1 prefix)
- [ ] Proper HTTP status codes (201 for create, 204 for delete)
- [ ] Request/response documentation (OpenAPI/Swagger)
- [ ] Pagination on all list endpoints
- [ ] Filtering/sorting on list endpoints

### Observability
- [ ] Request logging
- [ ] Error tracking (Sentry or similar)
- [ ] Performance monitoring (slow query logs)
- [ ] Health check endpoint (more than just `{"status": "ok"}`)

### Deployment
- [ ] Environment validation (required env vars check)
- [ ] Database migration system
- [ ] Graceful shutdown (in-flight requests complete)
- [ ] Load-balancer health checks
- [ ] Database connection pooling

### Testing
- [ ] Unit tests for auth logic
- [ ] Integration tests against Supabase test DB
- [ ] Load testing (concurrent requests)
- [ ] Security scanning (OWASP Top 10)

---

## 8. RECOMMENDED PRIORITY FIXES

### Phase 1: Foundation (Week 1)

1. **Audit Supabase Schema** (Gemini task)
   - Document real table structures
   - Identify missing tables needed for HACCP/events/menu
   - Create schema documentation

2. **Fix Authentication** (Claude + Backend)
   - Remove plaintext password logic
   - Implement JWT verification from Supabase
   - Add role-based decorators
   - Test with demo credentials

3. **Reconcile Inventory Endpoints** (Gemini)
   - Map real schema to API contract
   - Create GET /api/inventory/items (master list)
   - Create GET /api/inventory/monthly/{year}/{month}
   - Fix POST /api/inventory/reorders

### Phase 2: Core Features (Week 2)

4. **Create Missing Tables** (Gemini)
   - Create `haccp_logs` for compliance persistence
   - Create or fix `events` table
   - Create proper menu structure (`menus` + `menu_items` or update schema)

5. **Implement Missing CRUD**
   - Users management endpoints
   - Vendors/suppliers management
   - Purchase orders

6. **Add Input Validation** (Claude)
   - Pydantic models for all request bodies
   - Type validation, range checks
   - Error messages

### Phase 3: Polish (Week 3)

7. **Add Access Control** (Claude)
   - Role-based decorators on all endpoints
   - Test with different user roles

8. **Observability** (Devops)
   - Structured logging
   - Error tracking

9. **Documentation**
   - OpenAPI/Swagger spec
   - Architecture diagram
   - API client examples

---

## 9. EXAMPLE FIXES (Code Snippets)

### Fix 1: Replace Auth.py with JWT Verification

```python
# backend/routes/auth.py (NEW)
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
import jwt
import os

router = APIRouter(prefix="/api/auth", tags=["auth"])
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

class LoginResponse(BaseModel):
    token: str
    user: dict

def get_current_user(authorization: str = Header("")):
    """Dependency to verify Bearer token."""
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="No token provided")
    
    try:
        payload = jwt.decode(token, SUPABASE_KEY, algorithms=["HS256"])
        user_id = payload.get("sub")
        if not user_id:
            raise HTTPException(status_code=401, detail="Invalid token")
        return user_id
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

@router.get("/me", response_model=dict)
async def me(user_id: str = Depends(get_current_user)):
    """Get current user profile (must provide Bearer token)."""
    result = (
        supabase.table("user_profiles")
        .select("*")
        .eq("id", user_id)
        .single()
        .execute()
    )
    if not result.data:
        raise HTTPException(status_code=404, detail="User not found")
    return result.data
```

### Fix 2: Add Role-Based Access Control

```python
# backend/routes/utils.py (NEW)
from fastapi import HTTPException, Depends
from backend.routes import supabase

async def require_role(*roles):
    """Dependency factory for role checks."""
    def check_role(user_id: str = Depends(get_current_user)):
        result = (
            supabase.table("user_profiles")
            .select("role")
            .eq("id", user_id)
            .single()
            .execute()
        )
        if not result.data or result.data["role"] not in roles:
            raise HTTPException(status_code=403, detail="Insufficient permissions")
        return user_id
    return check_role

# Usage:
@router.post("/users")
async def create_user(
    user_data: UserCreate,
    _: str = Depends(require_role("admin"))
):
    """Create new user (admin only)."""
    ...
```

### Fix 3: Fix Inventory Endpoints for Real Schema

```python
# backend/routes/inventory.py (UPDATED)
@router.get("/items")
async def list_inventory_items(category: str = None):
    """List all inventory items, optionally filtered by category."""
    q = supabase.table("inventory_items").select("*")
    if category:
        q = q.eq("category", category)
    result = q.order("name").execute()
    return result.data

@router.get("/monthly/{year}/{month}")
async def get_monthly_inventory(year: int, month: int):
    """Get monthly inventory snapshot."""
    if not (1 <= month <= 12):
        raise HTTPException(status_code=400, detail="Month must be 1-12")
    
    result = (
        supabase.table("monthly_inventory")
        .select("*")
        .eq("year", year)
        .eq("month", month)
        .execute()
    )
    return result.data
```

---

## 10. SUMMARY TABLE: What's Working vs Broken

| Component | Exists | Schema Valid | Frontend Uses | Status |
|-----------|--------|--------------|---------------|--------|
| **Auth** | ✅ | ❌ | ❌ | Backend broken, frontend works |
| **Inventory** | ✅ | ❌ | ⚠️ (localStorage only) | Wrong schema |
| **Logs** | ✅ | ❌ | ⚠️ (localStorage only) | Table doesn't exist |
| **Events** | ✅ | ❌ | ❌ | Table doesn't exist |
| **Menu** | ✅ | ❌ | ⚠️ (localStorage only) | Table doesn't exist |
| **SourceControl** | ✅ | ✅ | ✅ | Mostly works (live tables exist) |
| **GitHub Sync** | ✅ | ✅ | ❌ | Works if GITHUB_TOKEN set |
| **Users CRUD** | ❌ | — | ❌ | MISSING entirely |
| **Vendors/POs** | ❌ | — | ❌ | MISSING entirely |
| **Compliance** | ❌ | — | ⚠️ | Uses phantom table |
| **RBAC** | ❌ | — | ❌ | MISSING entirely |

---

## CONCLUSION

**The FastAPI backend is 40% complete and non-functional for production:**

- 3/5 route modules target non-existent tables
- Authentication is completely broken (wrong password column, in-memory sessions)
- Frontend bypasses backend entirely (makes direct Supabase calls)
- No role-based access control
- No input validation
- No error handling

**Immediate Action Required:**
1. Reconcile backend against real Supabase schema (Gemini)
2. Rewrite authentication to use Supabase JWT (Claude)
3. Implement missing CRUD endpoints (both)
4. Add access control (Claude)

**Estimated Effort:** 2-3 weeks for production-ready backend

---

Generated: 2026-06-03 | Full Backend Audit
