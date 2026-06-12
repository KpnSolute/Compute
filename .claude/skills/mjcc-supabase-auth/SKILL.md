---
name: mjcc-supabase-auth
description: >-
  MJCC Supabase authentication patterns: project ref, service key usage,
  admin vs staff login flows, token storage, and the backend JWT exchange.
  Read this before touching any auth code.
metadata:
  version: "1.0.0"
---

# MJCC — Supabase Authentication

---

## Project Coordinates

| Key | Value |
|---|---|
| Project name | MJCCv1 |
| Project ref | `mgvyylvmkxhhataavqjz` |
| Region | `us-west-1` |
| Supabase URL | `https://mgvyylvmkxhhataavqjz.supabase.co` |
| Frontend uses | `@supabase/supabase-js` for Auth ONLY |
| Data calls | FastAPI backend (`VITE_API_BASE`) — never direct Supabase JS for data |

---

## Auth Model — Critical

`user_profiles` has **NO `password` column**. Never write one. The auth strategy is:

| Role | Login method | Mechanism |
|---|---|---|
| Admin / Manager | Supabase Auth email+password | `supabase.auth.signInWithPassword()` with synthesized email → then exchange for backend JWT |
| Staff | PIN | 4-digit PIN sent to `POST /api/auth/pin-login` → backend JWT |

---

## Login Flow — Admin / Manager

In `frontend/src/lib/supabase.ts`:

```ts
// 1. Supabase Auth sign-in (synthesized email: username@mjcc.local)
const { data, error } = await supabase.auth.signInWithPassword({
  email: `${username}@mjcc.local`,
  password: password,
});

// 2. Exchange Supabase session for backend JWT
const { token, user } = await backendLogin(data.session.access_token);

// 3. Store backend token
localStorage.setItem('mjc_backend_token', token);
```

`realLogin(username, password)` orchestrates steps 1+2. Do NOT bypass it.

---

## Login Flow — Staff (PIN)

```ts
// PIN login — no Supabase Auth involved
const { token, user } = await backendPinLogin(username, pin);
localStorage.setItem('mjc_backend_token', token);
```

Backend endpoint: `POST /api/auth/pin-login` with `{ username, pin }`.

---

## Token Usage in API Calls

Every FastAPI data call requires `Authorization: Bearer <token>`:

```ts
// In frontend/src/lib/api.ts
function getBackendToken(): string {
  return localStorage.getItem('mjc_backend_token') ?? '';
}

// All api.* functions use this header automatically
const headers = {
  'Authorization': `Bearer ${getBackendToken()}`,
  'Content-Type': 'application/json',
};
```

---

## Backend Token Verification

In FastAPI (`backend/auth.py`):

```python
# Verify token and get user
async def get_current_user(token: str = Depends(oauth2_scheme)):
    # validates JWT, returns user_profile row
    ...

# Manager-only dependency
async def _require_admin_or_manager(user = Depends(get_current_user)):
    if user['role'] not in ('manager', 'admin'):
        raise HTTPException(status_code=403, detail='Manager or admin required')
    return user
```

---

## Supabase Service Key (Backend)

The backend uses the Supabase **service key** (not anon key) for DB operations — it bypasses RLS. It is read from environment variable `SUPABASE_SERVICE_ROLE_KEY`.

**Never read this key aloud. Never commit it. It is in `.env` (backend) and Render environment vars.**

---

## Session Storage Keys

| Key | Content |
|---|---|
| `mjc_backend_token` | Backend JWT (used for all API calls) |
| `kpn_session` | User profile JSON (cached for Portal startup) |

Clearing both = full logout.

---

## Supabase JS Client Init (frontend/src/lib/supabase.ts)

```ts
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
```

This client is used **Auth-only**. All data fetching goes through `api.ts`.

---

## Common Bugs to Avoid

- Never write `password` to `user_profiles` — it doesn't exist.
- Never use `supabase.from('inventory_items').select(...)` in components — use `api.getInventory()`.
- Never hardcode the service key in code — always read from env.
- Never store the service key in `localStorage` or cookies.
- The Supabase anon key is safe to expose in frontend env — it's read-only by RLS design.
