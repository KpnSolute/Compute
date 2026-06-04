# MJCC Backend Audit — Quick Reference

## The Core Problem

**40% complete code, 0% functional for production**

- ❌ 3/5 route modules target **non-existent Supabase tables**
- ❌ Authentication is **completely broken** (wrong schema, in-memory sessions)
- ❌ Frontend **bypasses backend entirely** (no API calls to FastAPI)
- ⚠️ 1 route module **partially works** (SourceControl — tables exist)

---

## Endpoint Status Summary

| Module | Endpoints | Table Exists? | Works? | Frontend Uses? |
|--------|-----------|---------------|--------|---------------|
| `auth.py` | 3 | N/A | ❌ BROKEN | ❌ NO |
| `inventory.py` | 3 | ❌ NO | ❌ BROKEN | ❌ NO |
| `logs.py` | 2 | ❌ NO | ❌ BROKEN | ❌ NO |
| `events.py` | 2 | ❌ NO | ❌ BROKEN | ❌ NO |
| `menu.py` | 2 | ❌ NO | ❌ BROKEN | ❌ NO |
| `sourcectrl.py` | 4 | ✅ YES | ✅ ~60% | ✅ YES |
| `github_sync.py` | 2 | ✅ YES | ⚠️ ~70% | ❌ NO |
| **TOTAL** | **16** | **2/5** | **15 broken** | **1 uses** |

---

## Top 5 Critical Issues

### 1. Authentication is Dead Code
- Backend expects `password` column on `user_profiles` → **doesn't exist**
- Real system: Supabase Auth (admin) + bcrypt PIN (staff)
- Frontend never calls `/api/auth/login` (uses Supabase directly)
- In-memory session tokens (lost on restart, forgeable)

**Fix:** Implement JWT verification from Supabase, remove password logic

---

### 2. Schema Mismatch: 5 Tables Don't Exist

| Code Expects | Real Supabase | Impact |
|--------------|---------------|--------|
| `inventory_sync` | `monthly_inventory` (21,089 rows) | Inventory endpoints broken |
| `cycle_menu` | Doesn't exist | Menu endpoints broken |
| `events` | `events` (3 rows) — exists! | Events endpoints dead |
| `haccp_logs` | Doesn't exist | Compliance endpoints broken |

**Fix:** (Gemini) Reconcile with real 38-table schema, create missing tables

---

### 3. Frontend Doesn't Use Backend API
- Only `SourceControl.tsx` calls FastAPI (via `api.*` functions)
- All other components read/write Supabase **directly**
- Backend is **dead code** for 11 of 12 features

**Fix:** (Architecture decision) Either kill backend or route all calls through it

---

### 4. No Access Control (Security Risk)
- All 16 endpoints are **publicly readable/writable**
- No role checks (any caller can approve commits, modify inventory)
- No auth guards (no Bearer token validation)

**Fix:** Add `@require_role('admin')` decorators, JWT verification

---

### 5. No Input Validation or Error Handling
- No range validation (negative inventory allowed?)
- No type checking (floats where ints expected)
- Endpoints assume Supabase always succeeds
- No retry logic, no logging

**Fix:** Add Pydantic models, error handling, structured logging

---

## What Actually Works

✅ **SourceControl endpoints** (~60% functional)
- `GET /api/commits` — Lists commits (real table exists)
- `GET /api/staging` — Lists staged changes (real table exists)
- `POST /api/staging` — Creates staging entry
- `POST /api/commits` — Approves & commits (has concurrency bugs)
- `DELETE /api/staging/{id}` — Rejects entries

✅ **GitHub Sync** (if GITHUB_TOKEN set)
- `POST /api/github-sync/run` — Background push job
- `GET /api/github-sync/status` — Queue stats

✅ **Basic Routing**
- `GET /health` — Returns ok
- `GET /` — Serves frontend
- `GET /{path}` — SPA fallback

---

## What's Missing (Not Implemented at All)

| Feature | Endpoints Needed | Impact |
|---------|------------------|--------|
| **User Management** | GET/POST/PUT/DELETE /api/users | Portal shows user list but never loads it |
| **Vendors/Suppliers** | CRUD for vendors, purchase orders | Operations blocked |
| **RBAC** | @require_role decorators | Security hole |
| **Input Validation** | Pydantic models for all requests | Data integrity risk |
| **Compliance Logs** | Create `haccp_logs` table + CRUD | No persistent compliance records |
| **Menu Structure** | Create `menus` table + design | Menu feature broken |
| **Error Handling** | HTTP error responses, logging | Debugging impossible |
| **Documentation** | OpenAPI/Swagger spec | No API contract |

---

## Login Problem Diagnosis

### Why Login Is Broken (Backend)

**The backend auth endpoint doesn't work because:**

```python
# backend/routes/auth.py:35
if req.password != user.get("password", ""):  # ← "password" column doesn't exist!
    raise HTTPException(status_code=401, detail="Invalid credentials")
```

Real `user_profiles` schema has:
- `id`, `username`, `display_name`, `last_name`, `role`, `pin`, `active`
- NO `password` column

### Why Login Actually Works (Frontend)

**Frontend works because it uses Supabase Auth directly:**

```typescript
// frontend/lib/supabase.ts:131
const { data, error } = await db.auth.signInWithPassword({
  email: buildEmail(username),
  password,
});
```

For **staff**: Compares plaintext PIN (or bcrypt)
For **admin**: Uses Supabase Auth (separate from user_profiles)

### Recommendation: Fix Backend to Match Frontend

**Option 1 (Recommended):** Remove backend auth, let frontend handle Supabase Auth
- Backend just validates Bearer tokens from Supabase
- Simpler, cleaner, no password storage in backend
- Frontend already implements this correctly

**Option 2:** Dual auth system
- Backend accepts password via HTTPS only
- Hash passwords with bcrypt before storing
- Add password reset endpoint
- Add session expiry
- Add rate limiting

**Option 3:** Hybrid (best for now)
- Keep frontend's Supabase Auth
- Backend validates JWT tokens from Supabase
- Backend CRUD endpoints check roles but don't authenticate

---

## Quick Wins (Easy Fixes, High Impact)

### Week 1

1. **Fix Auth** (2-4 hours)
   - Replace `SessionStore` with JWT verification
   - Add `get_current_user()` dependency
   - Protect endpoints with `@Depends(get_current_user)`

2. **Fix Schema** (1-2 hours)
   - Update `inventory.py` to query `monthly_inventory` instead of `inventory_sync`
   - Update `events.py` to query real `events` table
   - Document actual schema

3. **Add Input Validation** (3-4 hours)
   - Create Pydantic models for request bodies
   - Add type hints, range checks
   - Example: `onHand: int = Field(ge=0)`

### Week 2

4. **Create Missing Tables** (Gemini)
   - Create `haccp_logs` for compliance
   - Create `cycle_menu` for menus or redesign

5. **Add RBAC** (2-3 hours)
   - Create `require_role()` decorator
   - Apply to sensitive endpoints
   - Test with demo roles

6. **Add Error Handling** (3-4 hours)
   - HTTP exception responses
   - Structured error logging
   - Retry logic for Supabase failures

---

## Files to Fix (Priority Order)

1. **`backend/routes/__init__.py`** — Replace SessionStore
2. **`backend/routes/auth.py`** — Remove password logic, add JWT
3. **`backend/routes/inventory.py`** — Fix table references
4. **`backend/routes/logs.py`** — Depends on creating `haccp_logs` table
5. **`backend/routes/menu.py`** — Depends on schema decision
6. **`backend/routes/sourcectrl.py`** — Add concurrency protection, RBAC
7. **`frontend/src/lib/api.ts`** — Add Bearer token to requests

---

## Production Readiness Scorecard

| Category | Score | Status |
|----------|-------|--------|
| **API Implementation** | 4/10 | Dead code, broken schema |
| **Authentication** | 1/10 | Fundamentally broken |
| **Data Validation** | 0/10 | None |
| **Error Handling** | 2/10 | Bare minimum |
| **Access Control** | 0/10 | No RBAC |
| **Testing** | 0/10 | No tests |
| **Documentation** | 1/10 | No OpenAPI |
| **Monitoring** | 1/10 | No logging |
| **Deployment** | 5/10 | Docker works but unvalidated |
| **Security** | 1/10 | Public endpoints, no auth |
| **OVERALL** | **1.5/10** | **NOT PRODUCTION READY** |

---

## Recommended Next Steps

### For Product Managers
1. Decide: Keep backend or remove?
   - Keep: All frontend calls route through FastAPI (caching, auth, biz logic)
   - Remove: Frontend talks direct to Supabase (simpler, less latency)
2. Clarify: Must HACCP logs be persistent or just localStorage?
3. Clarify: What's the menu schema (7 days or event-based)?

### For Backend Developer
1. Fix auth first (1-2 days)
2. Reconcile schema (1 day)
3. Add validation (2 days)
4. Add RBAC (1 day)
5. Add error handling (1 day)
6. Total: ~1 week to MVP

### For Frontend Developer
1. Add Bearer token to all API calls
2. Handle 401 errors (redirect to login)
3. Add error UI (toast notifications)

---

**Report Generated:** 2026-06-03  
**Full Details:** See `/home/local/MJCC/BACKEND_AUDIT.md`  
**Questions?** Review CHANGELOG.md entry [1.4.0] for context
