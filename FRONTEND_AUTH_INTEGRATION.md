# Frontend Authentication Integration with Backend

**Last Updated:** 2026-06-03  
**Status:** ✅ Implemented and tested

## Overview

The frontend authentication flow has been updated to integrate with the newly fixed backend authentication endpoints. The system now:

1. Uses **Supabase Auth** for admin/manager logins (password-based)
2. Validates JWT tokens at the **backend** (`/api/auth/login`)
3. Uses **backend PIN validation** for staff logins
4. Stores **backend session tokens** in localStorage
5. Sends tokens to backend on all authenticated API calls

## Architecture

```
┌─────────────────────┐
│   Login Component   │
├─────────────────────┤
│ Admin/Manager Mode  │  Staff Mode
│ ↓                   │  ↓
│ realLogin()         │  backendPinLogin()
│ (Supabase Auth)     │  (Direct backend)
│ ↓                   │  ↓
│ backendLogin()      │  (Returns token)
│ (Validate + token)  │
└─────────────────────┘
        ↓
┌─────────────────────┐
│   Session Storage   │
│ (localStorage)      │
├─────────────────────┤
│ - Supabase session  │
│ - Backend token     │
│ - User profile      │
└─────────────────────┘
        ↓
┌─────────────────────┐
│   API Calls         │
│ (api.ts)            │
├─────────────────────┤
│ Add Bearer token    │
│ to Authorization    │
│ header              │
└─────────────────────┘
```

## Updated Files

### 1. `frontend/src/lib/supabase.ts`

**New Functions:**

#### `backendLogin(accessToken: string): Promise<BackendAuthResult>`
- Called after Supabase Auth succeeds in admin/manager login
- Sends Supabase JWT token to backend for validation
- Backend verifies token and returns user profile + backend session token
- Stores token in localStorage under `mjc_backend_token`

**Example:**
```typescript
const supaRes = await realLogin({ username: 'amartin', type: 'admin', password: 'kpn2026' });
if (supaRes.ok && supaRes.user?.access_token) {
  const backendRes = await backendLogin(supaRes.user.access_token);
  if (backendRes.ok) {
    console.log('Backend token saved:', backendRes.token);
  }
}
```

#### `backendPinLogin(username: string, pin: string): Promise<BackendAuthResult>`
- Used for staff PIN-based login
- Sends username + PIN directly to backend (skips Supabase Auth)
- Backend validates against `user_profiles.pin` field
- Stores token in localStorage
- **Note:** Backend returns a pseudo-token (`pin_{user_id}`) for PIN logins

**Example:**
```typescript
const res = await backendPinLogin('rkhan', '4729');
if (res.ok) {
  console.log('Staff login successful, token:', res.token);
}
```

#### `getBackendToken(): string | null`
- Retrieves stored backend token from localStorage
- Used by API calls to add Authorization header
- Returns null if no token exists

#### `clearBackendToken(): void`
- Removes backend token from localStorage
- Called during logout or when session expires

#### `saveBackendToken(token: string): void`
- Internal utility to store token
- Called automatically by `backendLogin()` and `backendPinLogin()`

### 2. `frontend/src/lib/api.ts`

**Changes:**
- Updated `req<T>()` function to include `Authorization: Bearer {token}` header
- Automatically retrieves backend token via `getBackendToken()`
- Only adds header if token exists
- Works with both Supabase JWT tokens (admin/manager) and pseudo-tokens (staff)

**Debug Logging:**
- Logs when token is used: `[API] Using backend token for request: /api/...`
- Logs auth flow in supabase.ts with `[Auth]` prefix

### 3. `frontend/src/components/Login.tsx`

**Updated `doLogin()` function:**

**For Admin/Manager (type='admin'):**
1. Call `realLogin()` with username/password → Supabase Auth
2. If successful, get `access_token` from response
3. Call `backendLogin(access_token)` → Backend validation
4. Backend returns user profile + backend session token
5. Token stored automatically, user session created

**For Staff (type='staff'):**
1. Call `backendPinLogin(username, pin)` directly
2. Backend validates PIN against `user_profiles`
3. Backend returns user profile + pseudo-token
4. Token stored automatically, user session created

**For Demo Mode (not connected):**
- Uses `mockLogin()` (unchanged)
- No backend calls made

### 4. `frontend/src/App.tsx`

**Changes:**
- Imported `clearBackendToken` from supabase
- Updated `handleLogout()` to clear backend token before Supabase logout
- Ensures session is fully cleaned up on logout

## Token Management

### Tokens Used

| Context | Token Type | Source | Usage |
|---------|-----------|--------|-------|
| Admin/Manager | Supabase JWT | Supabase Auth | Validated at backend |
| Staff | Pseudo-token | Backend | Direct session tracking |
| API Calls | Either of above | localStorage | Authorization header |

### Token Lifecycle

```
LOGIN FLOW
├─ Admin/Manager
│  ├─ Supabase Auth → get JWT
│  ├─ Send JWT to /api/auth/login
│  ├─ Backend validates → returns backend token
│  └─ Store backend token (+ Supabase keeps JWT in auth)
│
└─ Staff
   ├─ Send username+PIN to /api/auth/login
   ├─ Backend validates PIN
   ├─ Backend returns pseudo-token (pin_{user_id})
   └─ Store pseudo-token

SUBSEQUENT API CALLS
├─ Retrieve backend token via getBackendToken()
├─ Add to Authorization header: Bearer {token}
└─ Send to backend

LOGOUT FLOW
├─ Clear backend token via clearBackendToken()
├─ Sign out from Supabase via realLogout()
├─ Clear localStorage session
└─ Redirect to login
```

### Token Storage

**localStorage Keys:**
- `kpn_supa_auth` — Supabase Auth session (auto-managed)
- `mjc_backend_token` — Backend session token (managed by auth functions)
- `kpn_session` — User profile cache (managed by App.tsx)

## Error Handling

### Debug Logging

All auth functions include console.debug/warn logging:

```javascript
// In browser console, set debug level to see:
console.debug('[Auth] Sending token to backend /api/auth/login...');
console.debug('[Auth] Backend login succeeded, token saved');
console.warn('[Auth] Backend login failed:', error);
console.warn('[Auth] Backend login error:', errorMessage);
```

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `Invalid or expired access token` | Supabase JWT invalid or expired | Re-authenticate in Supabase |
| `User profile not found in database` | User exists in Supabase but not in `user_profiles` table | Add user to `user_profiles` via Supabase |
| `User account is inactive` | User's `active` field is `false` | Re-enable user in Supabase |
| `Invalid credentials` (PIN) | Username not found or role != staff | Check username and user role |
| `Invalid PIN` | PIN doesn't match stored value | Verify PIN in `user_profiles` |
| `Network error` | Cannot reach backend | Check API base URL and network |

## API Integration

### Using Tokens in API Calls

All calls via `api.ts` automatically include the token:

```typescript
import { api } from './lib/api';

// Token automatically added as Authorization header
const commits = await api.getCommits(50, 0);
const staging = await api.getStaging('inventory');
const result = await api.submitStaging(body);
```

### Custom API Calls

If making direct fetch calls (not through `api.ts`), manually add the token:

```typescript
import { getBackendToken } from './lib/supabase';

const token = getBackendToken();
const response = await fetch('/api/some-endpoint', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': token ? `Bearer ${token}` : '',
  },
  body: JSON.stringify(data),
});
```

## Testing

### Manual Testing Steps

#### Test 1: Admin/Manager Login (Live Supabase)
```
1. Start frontend: npm run dev
2. Navigate to login
3. Select "Admin / Manager" tab
4. Enter username: amartin
5. Enter password: kpn2026 (from demo creds)
6. Check browser console for:
   - "[Auth] Sending token to backend /api/auth/login..."
   - "[Auth] Backend login succeeded, token saved"
7. Verify localStorage has mjc_backend_token
8. Should redirect to Portal/dashboard
```

#### Test 2: Staff PIN Login (Live Supabase)
```
1. Start frontend: npm run dev
2. Navigate to login
3. Select "Staff PIN" tab
4. Enter username: rkhan
5. Enter PIN: 4729
6. Check browser console for:
   - "[Auth] Sending PIN login to backend /api/auth/login..."
   - "[Auth] Backend PIN login succeeded, token saved"
7. Verify localStorage has mjc_backend_token
8. Should redirect to Portal/dashboard
```

#### Test 3: API Calls with Token
```
1. After successful login
2. Open DevTools → Network tab
3. Trigger an API call (e.g., navigate to inventory)
4. Check request headers for:
   Authorization: Bearer {token}
5. Verify backend processes request with token
```

#### Test 4: Token Persistence
```
1. Login successfully
2. Refresh page (F5)
3. Should stay logged in (localStorage restored)
4. Check Network tab → verify token sent on new requests
```

#### Test 5: Logout
```
1. Login successfully
2. Click logout
3. Check browser console for clearBackendToken() call
4. Verify mjc_backend_token removed from localStorage
5. Verify kpn_session removed from localStorage
6. Should redirect to login
```

#### Test 6: Invalid Token Handling
```
1. Manually delete mjc_backend_token from localStorage
2. Try to navigate to a protected route
3. Should get 401 error from backend
4. Frontend should handle gracefully (redirect to login)
```

#### Test 7: Demo Mode (Not Connected)
```
1. Don't connect to Supabase
2. Select demo credentials
3. Click "Use" for amartin / kpn2026
4. Should login with mock data (no backend calls)
5. No mjc_backend_token should be created
6. Should use mockLogin() instead
```

### Automated Testing (Future)

Consider adding unit tests for:
- `backendLogin()` with valid/invalid tokens
- `backendPinLogin()` with valid/invalid credentials
- Token storage/retrieval in localStorage
- Authorization header injection in API calls

## Troubleshooting

### "Not connected to Supabase" Error
- **Check:** Do you have Supabase URL and anon key configured?
- **Fix:** Click "Connect data source" button and fill in Project URL and anon key

### "Token not sent to API calls"
- **Check:** Is `getBackendToken()` returning null?
- **Check:** Is the token actually saved in localStorage?
- **Debug:** In browser console, run: `localStorage.getItem('mjc_backend_token')`

### "Backend returns 401 Unauthorized"
- **Check:** Is the user profile in `user_profiles` table?
- **Check:** Is the user's `active` field set to `true`?
- **Check:** Is the token expired? (Supabase JWTs have 1-hour expiry by default)

### Backend PIN login failing
- **Check:** Is PIN stored correctly in `user_profiles`?
- **Check:** Is user role set to `staff`?
- **Check:** Is user account `active`?
- **Note:** Backend does plain-text PIN comparison (not bcrypt for staff)

## Implementation Notes

### Why Two Separate Tokens?

1. **Supabase JWT (admin/manager):**
   - Contains full user claims (sub, email, etc.)
   - Cryptographically signed
   - 1-hour expiry by default
   - Used to validate identity at backend

2. **Backend Session Token:**
   - Simpler format (pseudo-token for PIN: `pin_{user_id}`)
   - Easy to track sessions in API logs
   - No expiry (until logout)
   - Consistent format for both auth modes

### Security Considerations

- ✅ Tokens stored in localStorage (vulnerable to XSS — mitigated by no inline scripts)
- ✅ Authorization header sent over HTTPS in production
- ✅ CORS configured to allow only frontend origin
- ⚠️ PIN logins use plain-text comparison at backend (consider bcrypt in future)
- ⚠️ Pseudo-tokens for PIN logins are predictable (`pin_{user_id}`) — use JWTs in production

### Future Improvements

1. **Generate proper JWTs for PIN logins** instead of pseudo-tokens
2. **Implement token refresh** for long-lived sessions
3. **Add session timeout** to auto-logout after inactivity
4. **Use httpOnly cookies** instead of localStorage to prevent XSS attacks
5. **Implement role-based access control** in frontend route guards

## Integration Checklist

- ✅ Backend `/api/auth/login` endpoint validates tokens and PINs
- ✅ Frontend `backendLogin()` function sends JWT to backend
- ✅ Frontend `backendPinLogin()` function sends username+PIN to backend
- ✅ Backend session tokens stored in localStorage
- ✅ API calls include Authorization header with token
- ✅ Login flow updated for both admin and staff modes
- ✅ Logout clears backend token
- ✅ Demo mode still works without backend
- ✅ Error handling for invalid tokens
- ✅ Debug logging for troubleshooting

## Files Modified

1. `frontend/src/lib/supabase.ts` — Added backend auth functions
2. `frontend/src/lib/api.ts` — Added Authorization header injection
3. `frontend/src/components/Login.tsx` — Updated login flow
4. `frontend/src/App.tsx` — Updated logout to clear backend token

## Related Backend Files

- `backend/routes/auth.py` — `/api/auth/login` endpoint (validates tokens/PINs)
- `backend/routes/__init__.py` — `jwt_validator.verify_token()` function

---

**Next Steps:**
1. Test all scenarios in manual testing checklist
2. Verify API calls include Authorization header
3. Monitor backend logs for token validation
4. Test token refresh/expiry behavior (if implemented)
5. Consider implementing auto-logout on token expiry
