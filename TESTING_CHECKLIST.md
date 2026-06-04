# Frontend Authentication Integration - Testing Checklist

**Date:** 2026-06-03  
**Integration:** Backend JWT Token Validation + PIN Login  
**Tester:** [Your Name]  
**Environment:** [Dev/Staging/Production]  
**Status:** ⬜ Not Started | 🟡 In Progress | ✅ Complete | ❌ Failed

---

## Pre-Test Setup

- [ ] Backend running on `http://localhost:8000` (or configured API base)
- [ ] Frontend running on `http://localhost:5173`
- [ ] Supabase project connected and configured in frontend
- [ ] Browser DevTools open (F12)
- [ ] localStorage and Network tabs ready
- [ ] Console filter set to show `[Auth]` and `[API]` logs

**Setup Commands:**
```bash
# Terminal 1: Backend
cd backend && python main.py

# Terminal 2: Frontend
cd frontend && npm run dev

# Check connectivity
curl http://localhost:8000/health  # Should return {"status": "ok"}
```

---

## Test 1: Admin/Manager Login - Full Flow ✅

**Objective:** Verify admin/manager can login via Supabase + Backend validation

**Steps:**
- [ ] Open frontend at `http://localhost:5173`
- [ ] Click "Admin / Manager" tab (should be default)
- [ ] Enter username: `amartin`
- [ ] Enter password: `kpn2026`
- [ ] Click "Sign in"

**Expected Results:**
- [ ] No error message displayed
- [ ] Redirect to Portal/Dashboard within 2-3 seconds
- [ ] Console shows: `[Auth] Sending token to backend /api/auth/login...`
- [ ] Console shows: `[Auth] Backend login succeeded, token saved`
- [ ] localStorage contains `mjc_backend_token` key
- [ ] localStorage contains `kpn_session` with user profile

**Verification Commands (in console):**
```javascript
localStorage.getItem('mjc_backend_token')  // Should return a long JWT-like string
JSON.parse(localStorage.getItem('kpn_session'))  // Should have user info
```

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 2: Admin/Manager Login - Invalid Password ✅

**Objective:** Verify error handling for incorrect password

**Steps:**
- [ ] Open login page
- [ ] Select "Admin / Manager" tab
- [ ] Enter username: `amartin`
- [ ] Enter password: `wrongpassword`
- [ ] Click "Sign in"

**Expected Results:**
- [ ] Error message: `"Incorrect password. Please try again."`
- [ ] User remains on login page
- [ ] Console shows: `[Auth] Supabase Auth error...` OR backend error
- [ ] NO token stored in localStorage
- [ ] PIN field (if visible) should be cleared

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 3: Admin/Manager Login - Invalid Username ✅

**Objective:** Verify error handling for nonexistent user

**Steps:**
- [ ] Open login page
- [ ] Select "Admin / Manager" tab
- [ ] Enter username: `nonexistent`
- [ ] Enter password: `kpn2026`
- [ ] Click "Sign in"

**Expected Results:**
- [ ] Error message: `"Username not recognised."` OR similar
- [ ] User remains on login page
- [ ] NO token stored in localStorage

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 4: Staff PIN Login - Valid PIN ✅

**Objective:** Verify staff can login with PIN

**Steps:**
- [ ] Open login page
- [ ] Click "Staff PIN" tab
- [ ] Enter username: `rkhan`
- [ ] Enter PIN: `4729` (using keypad or typing)
- [ ] PIN should auto-submit when all 4 digits entered

**Expected Results:**
- [ ] No error message displayed
- [ ] Redirect to Portal/Dashboard
- [ ] Console shows: `[Auth] Sending PIN login to backend /api/auth/login...`
- [ ] Console shows: `[Auth] Backend PIN login succeeded, token saved`
- [ ] localStorage contains `mjc_backend_token` (should be `pin_{user_id}` format)
- [ ] localStorage contains `kpn_session` with user profile

**Verification Commands (in console):**
```javascript
const token = localStorage.getItem('mjc_backend_token');
console.log('Token format:', token.startsWith('pin_') ? 'Correct' : 'Wrong format');
```

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 5: Staff PIN Login - Invalid PIN ✅

**Objective:** Verify error handling for incorrect PIN

**Steps:**
- [ ] Open login page
- [ ] Click "Staff PIN" tab
- [ ] Enter username: `rkhan`
- [ ] Enter PIN: `0000` (all zeros)
- [ ] Wait for auto-submit

**Expected Results:**
- [ ] Error message: `"Invalid PIN"` OR similar
- [ ] PIN field clears automatically
- [ ] User remains on Staff PIN screen
- [ ] NO token stored in localStorage

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 6: Staff PIN Login - Invalid Username ✅

**Objective:** Verify error handling for nonexistent staff user

**Steps:**
- [ ] Open login page
- [ ] Click "Staff PIN" tab
- [ ] Enter username: `nonexistent`
- [ ] Enter PIN: `1234`
- [ ] Wait for auto-submit

**Expected Results:**
- [ ] Error message: `"Invalid credentials"` OR similar
- [ ] PIN field clears
- [ ] User remains on login page
- [ ] NO token stored in localStorage

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 7: API Calls Include Authorization Header ✅

**Objective:** Verify all API calls include backend token in Authorization header

**Steps:**
- [ ] Login successfully (either admin or staff)
- [ ] Open DevTools → Network tab
- [ ] Navigate to a page that makes API calls (e.g., Inventory, Dashboard)
- [ ] Look for API requests (e.g., to `/api/commits`, `/api/staging`)

**Expected Results:**
- [ ] Each request shows in Network tab
- [ ] Click on request → Headers tab
- [ ] "Authorization" header present with value: `Bearer {token}`
- [ ] Token matches value in localStorage `mjc_backend_token`
- [ ] Console shows: `[API] Using backend token for request: /api/...`

**Network Tab Check:**
```
Request Headers:
Authorization: Bearer eyJ0eXAiOiJKV1QiLCJhbGc...
Content-Type: application/json
```

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 8: Token Persistence - Page Refresh ✅

**Objective:** Verify session persists after page refresh

**Steps:**
- [ ] Login successfully
- [ ] Note the current page
- [ ] Press F5 to refresh page
- [ ] Wait for page to reload

**Expected Results:**
- [ ] Should NOT redirect to login page
- [ ] Page content loads immediately
- [ ] User should still be logged in
- [ ] localStorage still contains `mjc_backend_token` and `kpn_session`
- [ ] Next API call includes Authorization header

**Console Check (after refresh):**
```javascript
console.log('Token present:', !!localStorage.getItem('mjc_backend_token'));
```

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 9: Logout - Complete Session Cleanup ✅

**Objective:** Verify logout clears all tokens and redirects to login

**Steps:**
- [ ] Login successfully
- [ ] Locate logout button (typically in header/sidebar)
- [ ] Click logout

**Expected Results:**
- [ ] Redirect to login page
- [ ] All localStorage auth keys cleared:
  - [ ] `mjc_backend_token` removed
  - [ ] `kpn_session` removed
  - [ ] `kpn_supa_auth` cleared (Supabase)
- [ ] Console shows logout cleanup messages
- [ ] Cannot navigate back to Portal without logging in again

**Console Verification (after logout):**
```javascript
console.log('Backend token:', localStorage.getItem('mjc_backend_token')); // null
console.log('Session:', localStorage.getItem('kpn_session')); // null
```

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 10: Token Expiry - Backend 401 Handling ✅

**Objective:** Verify frontend handles 401 errors gracefully

**Steps:**
- [ ] Login successfully
- [ ] Manually delete token: `localStorage.removeItem('mjc_backend_token')`
- [ ] Try to navigate to a protected route or trigger API call
- [ ] OR wait for token to naturally expire (if set to expire in dev)

**Expected Results:**
- [ ] API call returns 401 status
- [ ] Page should redirect to login OR show error
- [ ] Console shows error handling

**Alternative Test (Mock Expired Token):**
- [ ] After login, go to console
- [ ] Run: `localStorage.setItem('mjc_backend_token', 'invalid_or_expired_token')`
- [ ] Try to load a protected page
- [ ] Should get 401 error

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 11: Demo Mode - No Backend Calls ✅

**Objective:** Verify system works in demo mode (not connected to Supabase)

**Steps:**
- [ ] Open frontend WITHOUT configuring Supabase connection
- [ ] OR click "Manage" → "Disconnect" to disconnect existing connection
- [ ] Login should show "Demo mode" message at bottom
- [ ] Use demo credentials: click "Use" on amartin row
- [ ] Click "Sign in"

**Expected Results:**
- [ ] Login succeeds with mock data
- [ ] NO backend API calls made
- [ ] No `[Auth]` console logs about backend
- [ ] localStorage `mjc_backend_token` may or may not be set (depends on implementation)
- [ ] User can access Portal with local/mock data

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 12: Multiple Concurrent Logins ✅

**Objective:** Verify system handles rapid login attempts

**Steps:**
- [ ] Open login page
- [ ] Enter valid credentials
- [ ] Rapidly click "Sign in" button multiple times
- [ ] Watch network tab for requests

**Expected Results:**
- [ ] Should not create duplicate sessions
- [ ] Only one successful login flow completes
- [ ] Redirect happens once
- [ ] No errors in console

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 13: Network Latency - Slow Backend ✅

**Objective:** Verify UI handles slow network/backend

**Steps:**
- [ ] Throttle network: DevTools → Network → set to "Slow 3G"
- [ ] Attempt login
- [ ] Monitor loading state

**Expected Results:**
- [ ] "Verifying…" or loading message shows
- [ ] Submit button disabled during request
- [ ] Eventually completes (no timeout error unless configured)
- [ ] Works correctly once response received

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 14: Backend Connection Check ✅

**Objective:** Verify frontend detects backend connectivity

**Steps:**
- [ ] Backend running: `http://localhost:8000`
- [ ] Check connection dot at bottom of login page

**Expected Results:**
- [ ] Green dot with "Connected to Supabase" OR similar
- [ ] "Live · Supabase connected · v3.0"

**Alternative - Simulate Disconnection:**
- [ ] Stop backend service
- [ ] Refresh frontend page
- [ ] Should show "not connected" state

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 15: Cross-Tab Session Sync (Optional) ✅

**Objective:** Verify tokens work across multiple browser tabs

**Steps:**
- [ ] Login in Tab A
- [ ] Open Tab B to same application
- [ ] Manually navigate to portal URL in Tab B

**Expected Results (if localStorage sync implemented):**
- [ ] Tab B should recognize session from Tab A
- [ ] Should not redirect to login
- [ ] Both tabs maintain separate but valid sessions

**Current Expected (without sync):**
- [ ] Tab B redirects to login (separate session)
- [ ] Can login independently in Tab B

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 16: Different User Roles ✅

**Objective:** Verify different roles can login and have correct permissions

**Steps:**
- [ ] Test login with each role:
  - [ ] Admin: `amartin` / `kpn2026`
  - [ ] Manager: `dcortez` / `kpn2026`
  - [ ] Assistant: `lprice` / `kpn2026`
  - [ ] Staff: `rkhan` / PIN `4729`

**Expected Results:**
- [ ] Each role successfully logs in
- [ ] User profile shows correct role
- [ ] Navigation/features match role permissions

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 17: Password Toggle Visibility ✅

**Objective:** Verify password field eye icon works

**Steps:**
- [ ] Select "Admin / Manager" tab
- [ ] Enter password
- [ ] Click eye icon to show password

**Expected Results:**
- [ ] Password text becomes visible
- [ ] Eye icon changes to eye-off icon
- [ ] Click again to hide password

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 18: PIN Keypad Input Methods ✅

**Objective:** Verify PIN input works via keypad and keyboard

**Steps:**
- [ ] Select "Staff PIN" tab
- [ ] Test 1: Click keypad buttons (1-9, 0, Delete, Clear)
- [ ] Test 2: Type PIN using keyboard numbers
- [ ] Test 3: Use Delete button to remove digit

**Expected Results:**
- [ ] PIN dots update correctly
- [ ] Both input methods work
- [ ] Delete removes last digit
- [ ] Clear button empties all digits
- [ ] Auto-submit when 4 digits entered

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 19: Remember Me Checkbox ✅

**Objective:** Verify "Keep me signed in" checkbox works

**Steps:**
- [ ] Login with "Keep me signed in" CHECKED
- [ ] Refresh page
- [ ] User should stay logged in

**Then:**
- [ ] Logout
- [ ] Login with "Keep me signed in" UNCHECKED
- [ ] Refresh page
- [ ] Should be redirected to login

**Expected Results:**
- [ ] Checked: localStorage persists session
- [ ] Unchecked: session not stored, requires re-login after refresh

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Test 20: Console Debug Logging ✅

**Objective:** Verify debug logs are present and helpful

**Steps:**
- [ ] Set console filter to `[Auth]` and `[API]`
- [ ] Perform login
- [ ] Perform API calls
- [ ] Note all log messages

**Expected Results:**
- [ ] `[Auth]` logs show flow: "Sending token..." → "succeeded..."
- [ ] `[API]` logs show: "Using backend token for request..."
- [ ] No errors in console (warnings are OK)
- [ ] Logs are helpful for debugging

**Result:** ⬜ Not Run | 🟡 In Progress | ✅ Pass | ❌ Fail

**Notes:** ___________________________________________________________

---

## Post-Test Summary

**Tests Passed:** _____ / 20  
**Tests Failed:** _____ / 20  
**Tests Skipped:** _____ / 20  

**Critical Issues Found:**
```
1. ___________________________________________________________
2. ___________________________________________________________
3. ___________________________________________________________
```

**Minor Issues Found:**
```
1. ___________________________________________________________
2. ___________________________________________________________
3. ___________________________________________________________
```

**Recommendations:**
```
___________________________________________________________
___________________________________________________________
___________________________________________________________
```

**Overall Status:**
- ⬜ Not Ready for Deployment
- 🟡 Ready with Known Issues
- ✅ Ready for Production

**Approved By:** ________________  
**Approval Date:** ________________  
**Sign-Off:** ________________

---

## Regression Testing Checklist (Post-Deployment)

Run these tests after deploying to ensure no regression:

- [ ] Existing features still work (inventory, menus, logs)
- [ ] Supabase queries still function (not broken by token changes)
- [ ] Admin dashboard loads and displays data correctly
- [ ] No console errors on login or navigation
- [ ] API response times reasonable (< 2 seconds for normal ops)
- [ ] Mobile login works (responsive design)
- [ ] Dark mode still functional (if implemented)

---

**End of Testing Checklist**
