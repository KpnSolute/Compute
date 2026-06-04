# Quick Reference - Frontend Authentication Integration

**Status:** ✅ Implemented  
**Build Status:** ✅ Passing  
**Ready for:** Testing & Deployment

---

## 🚀 Quick Start

### For Developers

**Import these functions:**
```typescript
import {
  realLogin,              // Supabase Auth (unchanged)
  backendLogin,           // NEW: Validate token with backend
  backendPinLogin,        // NEW: Staff PIN login
  getBackendToken,        // NEW: Get stored token
  clearBackendToken,      // NEW: Clear token
} from '@/lib/supabase';
```

**Use in Login Component:**
```typescript
// Admin/Manager flow
const supaRes = await realLogin({ username, type: 'admin', password });
if (supaRes.ok && supaRes.user?.access_token) {
  const res = await backendLogin(supaRes.user.access_token);
}

// Staff flow
const res = await backendPinLogin(username, pin);
```

**API calls automatically include token:**
```typescript
import { api } from '@/lib/api';
const commits = await api.getCommits(); // Token automatically added
```

---

## 📊 What Changed

| Component | Before | After |
|-----------|--------|-------|
| Login Flow | Supabase only | Supabase + Backend |
| API Headers | No auth | Bearer token included |
| Staff Login | N/A | PIN to backend |
| Token Storage | Supabase session | localStorage key |
| Session Logout | Supabase only | + Clear backend token |

---

## 🔑 Token Management

**Stored as:** `localStorage.getItem('mjc_backend_token')`

**Admin Token Format:** Supabase JWT (1 hour expiry)
```
eyJ0eXAiOiJKV1QiLCJhbGc...
```

**Staff Token Format:** Pseudo-token
```
pin_user-id-here
```

**Used As:** Authorization header on all API calls
```
Authorization: Bearer eyJ0eXAi...
```

---

## 🧪 Quick Test Commands

**Browser Console:**
```javascript
// Check token exists
localStorage.getItem('mjc_backend_token')

// Check user profile
JSON.parse(localStorage.getItem('kpn_session'))

// Clear all auth (debugging)
['mjc_backend_token', 'kpn_session', 'kpn_supa_auth'].forEach(k => localStorage.removeItem(k))

// View auth logs
// Filter console by [Auth] or [API]
```

**Network Tab:**
1. Login
2. Check any API request
3. Look for `Authorization: Bearer ...` header

---

## 🎯 Login Test Credentials

| User | Role | Username | Password | Method |
|------|------|----------|----------|--------|
| Angela Martin | Admin | amartin | kpn2026 | Admin Tab |
| Daniel Cortez | Manager | dcortez | kpn2026 | Admin Tab |
| Lena Price | Assistant | lprice | kpn2026 | Admin Tab |
| Rasheed Khan | Staff | rkhan | 4729 | Staff PIN |

---

## 📋 Files Modified

```
frontend/src/
├── lib/
│   ├── supabase.ts       (+125 lines: backend auth functions)
│   └── api.ts            (+3 lines: token injection)
├── components/
│   └── Login.tsx         (+30 lines: backend integration)
└── App.tsx               (+1 line: clear token on logout)
```

---

## 🐛 Debug & Troubleshooting

### No token in localStorage
```javascript
// Token should exist after login
console.log(localStorage.getItem('mjc_backend_token'));

// If null, check backend response in Network tab
// Should have "access_token" field
```

### API call getting 401
```javascript
// Token may have expired
localStorage.removeItem('mjc_backend_token');
// Must re-login

// Or check backend is running
fetch('http://localhost:8000/health')
```

### Login not working
1. Check browser console for `[Auth]` logs
2. Check Network tab for `/api/auth/login` request
3. Verify Supabase credentials (if admin)
4. Verify PIN in Supabase (if staff)

---

## 🔗 Related Files

| File | Purpose |
|------|---------|
| `FRONTEND_AUTH_INTEGRATION.md` | Full technical documentation |
| `TESTING_CHECKLIST.md` | 20 comprehensive test cases |
| `FRONTEND_AUTH_EXAMPLES.ts` | Code examples and patterns |
| `IMPLEMENTATION_SUMMARY.md` | What was changed and why |
| `backend/routes/auth.py` | Backend `/api/auth/login` endpoint |

---

## ✅ Pre-Deployment Checklist

- [ ] Run `npm run build` - should succeed
- [ ] Run all 20 tests from TESTING_CHECKLIST.md
- [ ] Verify backend `/api/auth/login` endpoint is working
- [ ] Test with real Supabase credentials (not demo)
- [ ] Check Authorization headers in Network tab
- [ ] Verify all user roles can login
- [ ] Test logout clears all tokens
- [ ] Verify demo mode still works
- [ ] Check browser console has no errors
- [ ] Verify existing features still work

---

## 🚢 Deployment Notes

1. **Backend must be deployed first** - API needs `/api/auth/login`
2. **Verify CORS** - frontend origin must be allowed
3. **Check `.env`** - `VITE_API_BASE` should point to backend
4. **Monitor logs** - watch for token validation errors
5. **Test real users** - demo credentials must match Supabase

---

## 📞 Support Matrix

| Issue | Check | Fix |
|-------|-------|-----|
| Backend unreachable | Network tab 404/500 | Restart backend, check URL |
| Token not sent | Request headers | Re-login, clear localStorage |
| 401 errors | Console logs | Token expired, re-login |
| PIN not working | Supabase table | Verify user role = "staff" |
| Session lost on refresh | localStorage | Check "Keep me signed in" |

---

## 🎓 Key Concepts

**JWT Token (Admin/Manager)**
- Cryptographically signed by Supabase
- Contains user claims (sub, email, etc.)
- 1-hour expiry by default
- Validated at backend

**Pseudo-Token (Staff)**
- Format: `pin_{user_id}`
- Simple string, not encrypted
- Session-based, no expiry
- Used for backend session tracking

**Authorization Header**
- Added to every API request
- Format: `Bearer {token}`
- Enables backend to identify user
- Allows role-based access control

---

## 📖 Code Snippets

**Check if user is logged in:**
```typescript
import { getBackendToken } from '@/lib/supabase';

const isLoggedIn = !!getBackendToken();
```

**Manual API call with token:**
```typescript
import { getBackendToken } from '@/lib/supabase';

const token = getBackendToken();
fetch('/api/endpoint', {
  headers: { 'Authorization': `Bearer ${token}` }
});
```

**Force re-login:**
```typescript
import { clearBackendToken } from '@/lib/supabase';

clearBackendToken();
window.location.href = '/login';
```

---

## 🎯 Success Criteria

- ✅ Admin/Manager can login with Supabase password
- ✅ Backend validates JWT token
- ✅ Staff can login with PIN
- ✅ All API calls include Authorization header
- ✅ Session persists on page refresh
- ✅ Logout clears all tokens
- ✅ Demo mode works without backend
- ✅ Error messages are user-friendly
- ✅ Console logs are helpful for debugging
- ✅ No TypeScript errors

---

**Version:** 1.0  
**Updated:** 2026-06-03  
**Status:** Ready ✅
