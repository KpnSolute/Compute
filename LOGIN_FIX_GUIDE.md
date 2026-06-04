# MJCC Login Problem — Root Cause & Detailed Fixes

**Created:** 2026-06-03  
**Status:** Critical Issue, Ready to Fix

---

## The Problem: Why Login is Completely Broken

### Where the Problem Lives

**File:** `backend/routes/auth.py` (lines 19-44)  
**Severity:** Critical — 100% broken, fails for all users

```python
# ❌ BROKEN CODE
@router.post("/login")
async def login(req: LoginRequest):
    result = (
        supabase.table("user_profiles")
        .select("*")
        .eq("username", req.username)
        .eq("active", True)
        .execute()
    )

    if not result.data:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    user = result.data[0]

    if user["role"] in ("admin", "manager", "assistant"):
        if req.password != user.get("password", ""):  # ← ❌ "password" COLUMN DOESN'T EXIST
            raise HTTPException(status_code=401, detail="Invalid credentials")
    elif user["role"] == "staff":
        if req.pin != user.get("pin", ""):  # ← ⚠️ PIN comparison is plaintext (not bcrypt)
            raise HTTPException(status_code=401, detail="Invalid credentials")
    else:
        raise HTTPException(status_code=401, detail="Invalid credentials")

    token = sessions.create(user)  # ← ⚠️ In-memory tokens (lost on restart)
    return LoginResponse(token=token, user=user)
```

### Why It Fails

1. **Column Doesn't Exist**
   - Backend assumes `user_profiles.password` column exists
   - **Real schema has NO such column**
   - Database query returns `None` for `user.get("password", "")`
   - Comparison always fails: `req.password != ""`

2. **Wrong Authentication Model**
   - Backend expects plaintext passwords stored in `user_profiles`
   - Real system uses:
     - **Admin/Manager**: Supabase Auth (separate `auth.users` table)
     - **Staff**: bcrypt-hashed PIN (stored in `user_profiles.pin`)
   - Backend doesn't know about Supabase Auth

3. **Session Store is Non-Persistent**
   - Backend creates UUID tokens stored in RAM
   - Tokens lost on server restart
   - Any UUID is a valid token (no signature)
   - Not sharable across load-balanced instances

4. **Frontend Never Calls It**
   - Frontend doesn't make API calls to `/api/auth/login`
   - Frontend uses `realLogin()` from `lib/supabase.ts` (direct Supabase Auth)
   - Backend endpoint is dead code

---

## The Real Authentication System (What Actually Works)

### How Frontend Login Works

**File:** `frontend/src/lib/supabase.ts` (lines 75-145)

```typescript
✅ CORRECT - Frontend uses Supabase Auth directly

export async function realLogin({
  username,
  type,
  pin,
  password,
}: {
  username: string;
  type: 'staff' | 'admin';  // User chooses login type
  pin?: string;
  password?: string;
}): Promise<{ ok: boolean; user?: User; error?: string }> {
  
  // 1. Fetch user profile
  const { data: profile } = await db
    .from('user_profiles')
    .select('id, username, display_name, role, pin, active')
    .eq('username', username)
    .single();

  if (!profile.active) 
    return { ok: false, error: 'Account is disabled.' };

  // 2a. STAFF LOGIN
  if (type === 'staff') {
    if (profile.role !== 'staff')
      return { ok: false, error: 'Staff accounts must use Staff login.' };
    if (!pin) 
      return { ok: false, error: 'PIN required.' };
    
    // ✅ Compare with bcrypt or plaintext
    const ok = _checkPin(pin, profile.pin);  // bcrypt.compareSync or ===
    if (!ok) 
      return { ok: false, error: 'Incorrect PIN.' };
    return { ok: true, user: _publicUser(profile) };
  }

  // 2b. ADMIN/MANAGER LOGIN
  if (type === 'admin') {
    if (!['admin', 'manager', 'assistant'].includes(profile.role))
      return { ok: false, error: 'Use Admin login.' };
    if (!password) 
      return { ok: false, error: 'Password required.' };
    
    // ✅ Call Supabase Auth (NOT user_profiles.password)
    const { data, error } = await db.auth.signInWithPassword({
      email: buildEmail(username),  // john@mjc-cafeteria.com
      password,
    });
    if (error || !data?.session) 
      return { ok: false, error: 'Incorrect password.' };
    
    return { ok: true, user: { 
      ..._publicUser(profile), 
      access_token: data.session.access_token 
    }};
  }
}
```

### Real User Schema

**Table:** `supabase.auth.users` (Supabase Auth)
- `id` — UUID
- `email` — unique email (e.g., `john@mjc-cafeteria.com`)
- `encrypted_password` — bcrypt hash (Supabase manages this)
- `email_confirmed_at` — null if not verified

**Table:** `user_profiles` (User data)
- `id` — UUID (links to auth.users.id for admin/manager)
- `username` — unique text
- `display_name` — text
- `last_name` — text
- `role` — 'admin' | 'manager' | 'assistant' | 'staff'
- `pin` — text (bcrypt hash for staff, plaintext for now)
- `active` — boolean
- `created_at` — timestamp
- `updated_at` — timestamp

**No `password` column on `user_profiles`** ← This is why backend fails

---

## Solution Options

### Option 1: Remove Backend Auth (RECOMMENDED)

**Why:** Frontend already works, backend adds nothing, simplifies security

**Changes Needed:**

1. **Delete `backend/routes/auth.py`** completely
2. **Update `backend/routes/__init__.py`** to remove SessionStore
3. **Add JWT verification middleware** to `backend/main.py`
4. **Update frontend** to send Bearer tokens
5. **Keep Supabase Auth in frontend** (already working)

**Code Changes:**

```python
# backend/main.py (ADD THIS)
import jwt
from fastapi import Depends, HTTPException, Header

SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

def get_current_user(authorization: str = Header("")) -> dict:
    """Extract and verify JWT from Supabase Auth."""
    token = authorization.replace("Bearer ", "") if authorization else ""
    if not token:
        raise HTTPException(status_code=401, detail="No token provided")
    
    try:
        # Decode JWT using Supabase's public key
        payload = jwt.decode(
            token,
            SUPABASE_KEY,
            algorithms=["HS256"]
        )
        return {
            "user_id": payload.get("sub"),
            "email": payload.get("email"),
            "role": payload.get("user_metadata", {}).get("role")
        }
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

# Remove auth router include:
# app.include_router(auth_router)  ← DELETE THIS LINE
```

```typescript
// frontend/src/lib/api.ts (UPDATE THIS)
const req = async <T>(path: string, opts?: RequestInit): Promise<T> => {
  const token = localStorage.getItem('kpn_supa_auth:key');  // Get from Supabase auth store
  const headers = {
    'Content-Type': 'application/json',
    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
    ...opts?.headers,
  };
  
  const res = await fetch(BASE + path, { ...opts, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
};
```

**Pros:**
- ✅ Frontend already working perfectly
- ✅ No plaintext passwords in backend
- ✅ Session management delegated to Supabase (industry standard)
- ✅ Reduces backend complexity
- ✅ Mobile apps can use same Supabase Auth

**Cons:**
- ❌ Can't add backend-specific auth logic later
- ❌ No caching of user roles/permissions in backend

**Effort:** 2-3 hours

---

### Option 2: Hybrid Auth (BEST FOR NOW)

**Why:** Keep frontend's Supabase Auth, let backend verify tokens, no password logic

**Changes Needed:**

1. **Keep frontend** unchanged (already works)
2. **Rewrite backend auth.py** to verify JWT only
3. **Add role-based middleware** to protected endpoints
4. **Update frontend API calls** to include Bearer token

**Code:**

```python
# backend/routes/auth.py (COMPLETELY REWRITTEN)
from fastapi import APIRouter, HTTPException, Header, Depends
from pydantic import BaseModel
import jwt
import os

router = APIRouter(prefix="/api/auth", tags=["auth"])
SUPABASE_KEY = os.getenv("SUPABASE_ANON_KEY")

def get_current_user(authorization: str = Header("")) -> str:
    """Verify JWT from Supabase Auth, return user_id."""
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
        raise HTTPException(status_code=401, detail="Invalid or expired token")

@router.get("/me")
async def get_current_user_profile(user_id: str = Depends(get_current_user)):
    """Get current user's profile."""
    from backend.routes import supabase
    
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

@router.post("/logout")
async def logout(user_id: str = Depends(get_current_user)):
    """Logout (frontend handles session cleanup)."""
    # Backend doesn't manage sessions anymore
    return {"ok": True, "message": "Logged out"}
```

```python
# backend/routes/sourcectrl.py (ADD PROTECTION)
from fastapi import Depends
from backend.routes.auth import get_current_user

@router.post("/commits", status_code=201)
async def approve_commit(
    body: ApproveCommitBody,
    user_id: str = Depends(get_current_user)  # ← ADD THIS
):
    """Approve staged changes and create commit (requires auth)."""
    # Now only authenticated users can approve commits
    ...
```

```typescript
// frontend/src/lib/api.ts (UPDATE)
const req = async <T>(path: string, opts?: RequestInit): Promise<T> => {
  // Get Supabase session
  const { data: { session } } = await getSupaClient().auth.getSession();
  
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...opts?.headers as Record<string, string>,
  };
  
  // Add Bearer token if logged in
  if (session?.access_token) {
    headers['Authorization'] = `Bearer ${session.access_token}`;
  }
  
  const res = await fetch(BASE + path, { ...opts, headers });
  if (!res.ok) {
    if (res.status === 401) {
      // Redirect to login
      window.location.href = '/';
    }
    const body = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status}: ${body}`);
  }
  return res.json() as Promise<T>;
};
```

**Pros:**
- ✅ Minimal changes to frontend (already works)
- ✅ Backend can still require auth on sensitive endpoints
- ✅ No password management in backend
- ✅ Leverages Supabase's existing JWT infrastructure
- ✅ Role-based access control can be added later

**Cons:**
- ⚠️ Every request needs to decode JWT (minor performance)
- ⚠️ Still need to reconcile other schema mismatches

**Effort:** 4-6 hours (includes testing)

---

### Option 3: Full Backend Auth System (NOT RECOMMENDED)

**Why it's bad:** Duplicates work already done by Supabase, adds security risk

**If you insist, here's what's needed:**

1. **Add `password` column to `user_profiles`**
   ```sql
   ALTER TABLE user_profiles ADD COLUMN password_hash VARCHAR(255);
   ```

2. **Hash passwords with bcrypt before storing**
   ```python
   import bcrypt
   
   password_hash = bcrypt.hashpw(req.password.encode(), bcrypt.gensalt())
   supabase.table("user_profiles").update(
       {"password_hash": password_hash.decode()}
   ).eq("id", user_id).execute()
   ```

3. **Update login endpoint**
   ```python
   if req.password != user.get("password_hash", ""):  # ← Still WRONG
   # Should be:
   if not bcrypt.checkpw(req.password.encode(), user.get("password_hash", b"").encode()):
   ```

4. **Add session persistence (Redis or database)**
   ```python
   # Instead of in-memory SessionStore
   import redis
   
   redis_client = redis.Redis(host='localhost', port=6379)
   token = str(uuid4())
   redis_client.setex(token, 3600, json.dumps(user))  # 1 hour TTL
   ```

5. **Add password reset endpoint**
6. **Add rate limiting**
7. **Add password strength validation**
8. **Add password expiry**

**Effort:** 2-3 weeks  
**Complexity:** High  
**Risk:** Medium (password management is error-prone)  
**Recommendation:** DON'T do this — use Option 2 instead

---

## Recommended Fix Path (Step-by-Step)

### Phase 1: Frontend (30 minutes)

```typescript
// frontend/src/lib/api.ts — Add Bearer token to requests
const req = async <T>(path: string, opts?: RequestInit): Promise<T> => {
  const { data: { session } } = await getSupaClient()?.auth.getSession() ?? { data: { session: null } };
  
  const headers = {
    'Content-Type': 'application/json',
    ...(session?.access_token ? { 'Authorization': `Bearer ${session.access_token}` } : {}),
    ...opts?.headers,
  };
  
  const res = await fetch(BASE + path, { ...opts, headers });
  if (!res.ok) {
    if (res.status === 401) window.location.href = '/';
    throw new Error(`${res.status}: ${await res.text()}`);
  }
  return res.json();
};
```

### Phase 2: Backend Auth Fix (2 hours)

1. **Replace `backend/routes/__init__.py`**
   ```python
   # Remove SessionStore class entirely
   # Keep supabase client, sessions = SessionStore() becomes obsolete
   ```

2. **Replace `backend/routes/auth.py`**
   ```python
   # Copy code from Option 2 above (JWT verification only)
   ```

3. **Update `backend/main.py`**
   ```python
   # Remove: from backend.routes.auth import router as auth_router
   # Remove: app.include_router(auth_router)
   
   # Add auth_router that only has /me endpoint
   ```

### Phase 3: Protect Other Endpoints (1 hour)

Add `Depends(get_current_user)` to sensitive endpoints:
- `POST /api/staging` — Create staging entry
- `POST /api/commits` — Approve & commit
- `DELETE /api/staging/{id}` — Reject entry
- Any future user management endpoints

### Phase 4: Testing (1 hour)

```bash
# Test login still works
npm run dev  # Frontend
cd backend && python main.py  # Backend

# Test with demo credentials from Login.tsx
# Try SourceControl component (staging/commits)
# Verify Bearer token is sent and verified
```

### Phase 5: Deploy (30 minutes)

```bash
git add -A
git commit -m "Fix backend auth: JWT verification, remove SessionStore"
git push
# Azure App Service auto-deploys
```

---

## Testing Checklist

Before declaring "login fixed":

- [ ] Staff login works (demo: rkhan / PIN 4729)
- [ ] Admin login works (demo: amartin / kpn2026)
- [ ] API returns 401 without Bearer token
- [ ] API returns 401 with invalid Bearer token
- [ ] SourceControl staging/commits work
- [ ] Logout works
- [ ] Page refresh preserves session (frontend localStorage)
- [ ] Backend restart doesn't lose sessions (handled by frontend)

---

## Files Modified Summary

| File | Change | Reason |
|------|--------|--------|
| `backend/routes/__init__.py` | Remove SessionStore class | Token management now via JWT |
| `backend/routes/auth.py` | Rewrite entire module | JWT verification only, no password |
| `backend/main.py` | Remove auth router import, add middleware | Simplify routing |
| `frontend/src/lib/api.ts` | Add Bearer token to headers | Auth verification |
| `.github/workflows/deploy.yml` | (no change) | Works as-is |

---

## FAQ

**Q: What if user is logged out on frontend but tries to call API?**  
A: API returns 401, frontend catches it and redirects to login

**Q: What about password reset?**  
A: Handled by Supabase Auth (beyond scope of backend fix)

**Q: Can we use the backend JWT to call Supabase later?**  
A: No, but you can refresh from Supabase using the access_token

**Q: What about HACCP logs and other phantom tables?**  
A: Separate issue, address after auth is fixed

**Q: Why not use Supabase's API directly and skip FastAPI?**  
A: Backend can add caching, rate limiting, business logic later — keep the door open

---

## Summary

| Aspect | Before | After |
|--------|--------|-------|
| **Auth Model** | Plaintext password (broken) | JWT verification |
| **Session Storage** | In-memory (lost on restart) | Supabase Auth (persistent) |
| **Frontend Calls Backend Auth** | ❌ No | ✅ Yes (with Bearer token) |
| **Backend Validates Auth** | ❌ No | ✅ Yes (JWT) |
| **RBAC Support** | ❌ No | ✅ Yes (via Depends) |
| **Production Ready** | ❌ No | ✅ ~60% |

---

**Estimated Total Effort:** 4-6 hours  
**Breaking Changes:** None (frontend continues to work during backend rewrite)  
**Risk Level:** Low (Supabase Auth already validated)

