# Authentication Flow Diagrams

## 1. Complete Login Flow - Admin/Manager

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOGIN SCREEN (Admin/Manager)                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Username:  [amartin        ]                               │ │
│  │ Password:  [••••••••       ] [👁]                          │ │
│  │ [✓] Keep me signed in                                      │ │
│  │                         [Sign in →]                        │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                    [User clicks Sign in]
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼ (if connected)            ▼ (if demo mode)
        ┌──────────────────┐        ┌──────────────────┐
        │ realLogin()      │        │ mockLogin()      │
        │ Supabase Auth    │        │ Local demo data  │
        └──────────────────┘        └──────────────────┘
                │                           │
                │ ✓ Success                 │ ✓ Success
                │ ✗ Error                   │ ✗ Error
                ▼                           │
        ┌──────────────────────────┐        │
        │ Got Supabase JWT Token?  │        │
        │ - access_token           │        │
        │ - user profile           │        │
        └──────────────────────────┘        │
                │                           │
                ├─ No token ─────► ERROR   │
                │                   └──────┼──► Return Error
                │                           │
                ▼ Yes                       │
        ┌──────────────────────────┐        │
        │ backendLogin(token)      │        │
        │ POST /api/auth/login     │        │
        │ {access_token: "JWT..."}│        │
        └──────────────────────────┘        │
                │                           │
                ├─ 401 Invalid ─►► ERROR   │
                ├─ 500 Error ────► ERROR   │
                ├─ 400 Bad Req ──► ERROR   │
                │                           │
                ▼ 200 OK                    │
        ┌──────────────────────────┐        │
        │ Backend Validates JWT:   │        │
        │ - Checks signature       │        │
        │ - Checks expiry          │        │
        │ - Checks user exists     │        │
        │ - Checks user active     │        │
        └──────────────────────────┘        │
                │                           │
                ▼                           │
        ┌──────────────────────────┐        │
        │ Returns:                 │        │
        │ {                        │        │
        │  access_token: "JWT...", │        │
        │  user: {                 │        │
        │    id, username,         │        │
        │    display_name, role    │        │
        │  }                       │        │
        │ }                        │        │
        └──────────────────────────┘        │
                │                           │
        ┌───────┴──────────┐                │
        │                  │                │
        ▼ Save to           ▼ Return        │
   localStorage       to Login    │
   "mjc_backend_token"            │
   (Supabase JWT)                │
        │                  │     │
        │                  ▼     │
        │            ┌──────────────┐
        │            │ Update State:│
        │            │ - Set user   │
        │            │ - Set token  │
        │            │ - Remember?  │
        │            └──────────────┘
        │                  │     │
        │                  ▼     │
        │            ┌──────────────────────┐
        │            │ Success! Redirect to │
        │            │ Portal/Dashboard     │
        │            └──────────────────────┘
        │
        └──────────────────────────────────► [Session Active]
```

---

## 2. Complete Login Flow - Staff PIN

```
┌─────────────────────────────────────────────────────────────────┐
│                    LOGIN SCREEN (Staff PIN)                      │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ Staff username: [rkhan    ]                                │ │
│  │                                                             │ │
│  │ Enter 4-digit PIN:                                         │ │
│  │ ● ● ● ●  (empty dots)                                    │ │
│  │                                                             │ │
│  │ ┌───┬───┬───┐                                             │ │
│  │ │ 1 │ 2 │ 3 │                                             │ │
│  │ ├───┼───┼───┤                                             │ │
│  │ │ 4 │ 5 │ 6 │                                             │ │
│  │ ├───┼───┼───┤                                             │ │
│  │ │ 7 │ 8 │ 9 │                                             │ │
│  │ ├───┼───┼───┤                                             │ │
│  │ │CLR│ 0 │ ⌫ │                                             │ │
│  │ └───┴───┴───┘                                             │ │
│  └─────────────────────────────────────────────────────────────┘ │
└─────────────────────────────────────────────────────────────────┘
                              │
                    [User types PIN: 4-7-2-9]
                              │
                     ● ● ● ●  (filled)
                              │
                 [Auto-submit after 4 digits]
                              │
                ┌─────────────┴─────────────┐
                │                           │
                ▼ (if connected)            ▼ (if demo mode)
        ┌──────────────────────┐    ┌──────────────────┐
        │ backendPinLogin()    │    │ mockLogin()      │
        │ POST /api/auth/login │    │ Local demo data  │
        │ {username, pin}      │    └──────────────────┘
        └──────────────────────┘              │
                │                   ✓ Success │
                ▼                             │
        ┌──────────────────────┐             ▼
        │ Backend validates:   │    ┌──────────────────┐
        │ - User exists        │    │ Success! Proceed │
        │ - User role = staff  │    └──────────────────┘
        │ - PIN matches        │             │
        │ - User active        │             │
        └──────────────────────┘             │
                │                            │
       ├─ User not found ──► ERROR          │
       ├─ Role ≠ staff ─────► ERROR          │
       ├─ PIN mismatch ─────► ERROR          │
       │                                     │
       ▼ ✓ PIN verified                     │
        ┌──────────────────────┐             │
        │ Returns:             │             │
        │ {                    │             │
        │  access_token:       │             │
        │    "pin_user-id",    │             │
        │  user: {             │             │
        │    id, username,     │             │
        │    display_name,     │             │
        │    role: "staff"     │             │
        │  }                   │             │
        │ }                    │             │
        └──────────────────────┘             │
                │                            │
        ┌───────┴──────────┐                │
        │                  │                │
        ▼ Save to          ▼ Return         │
   localStorage       to Login      │
   "mjc_backend_token"             │
   (pin_user-id)                   │
        │                  │       │
        │                  ▼       │
        │            ┌──────────────┐
        │            │ Update State:│
        │            │ - Set user   │
        │            │ - Set token  │
        │            └──────────────┘
        │                  │       │
        │                  ▼       ▼
        │          ┌──────────────────┐
        │          │ Success! Redirect│
        │          │ to Portal        │
        │          └──────────────────┘
        │
        └──────────────────────────► [Session Active]
```

---

## 3. API Call With Token Injection

```
┌────────────────────────────────┐
│ Any API Call                   │
│ e.g., api.getCommits(50, 0)   │
└────────────────────────────────┘
            │
            ▼
    ┌──────────────────┐
    │ req() function   │
    │ in api.ts        │
    └──────────────────┘
            │
            ▼
    ┌──────────────────────────┐
    │ getBackendToken()        │
    │ from localStorage        │
    └──────────────────────────┘
            │
    ┌───────┴────────┐
    │                │
    ▼ Token exists   ▼ No token
┌──────────────┐   ┌──────────────┐
│ Add header:  │   │ Send request │
│ Authorization│   │ without auth │
│ Bearer {...} │   │ (may fail)   │
└──────────────┘   └──────────────┘
    │                │
    └────────┬───────┘
             │
             ▼
    ┌──────────────────────┐
    │ Send HTTP Request    │
    │ GET /api/commits     │
    │ Headers: {           │
    │   'Authorization':   │
    │   'Bearer jwt...'    │
    │ }                    │
    └──────────────────────┘
             │
    ┌────────┴─────────┐
    │                  │
    ▼ 401 Error        ▼ 200 Success
┌──────────────┐   ┌──────────────┐
│ Token expired│   │ Return data  │
│ or invalid   │   │ as normal    │
│ Redirect to  │   └──────────────┘
│ login        │
└──────────────┘
```

---

## 4. Logout Flow

```
┌────────────────────┐
│ Logout Button      │
│ (Header/Sidebar)   │
└────────────────────┘
         │
         ▼
    [User clicks]
         │
         ▼
┌────────────────────────────┐
│ handleLogout() in App.tsx  │
└────────────────────────────┘
         │
         ├─► clearBackendToken()
         │   Remove: "mjc_backend_token"
         │   from localStorage
         │
         ├─► realLogout()
         │   Sign out from Supabase Auth
         │
         ├─► Remove "kpn_session"
         │   from localStorage
         │
         └─► Redirect to /login
             │
             ▼
    ┌──────────────────────┐
    │ Login Page           │
    │ (Fresh, no session)  │
    └──────────────────────┘
```

---

## 5. Token Validation at Backend

```
Frontend sends:                Backend processes:

┌──────────────────────────┐  ┌──────────────────────────┐
│ POST /api/auth/login     │  │ Check request type:      │
│ {                        │  │                          │
│  access_token:           │  ├─ Has access_token? ────►┌────────────┐
│  "eyJ0eXAi..."          │  │                          │ JWT Mode   │
│ }                        │  │                          └────────────┘
└──────────────────────────┘  │                          │
                              │  ├─ Has username+pin? ──┼──►┌────────────┐
                              │                          │   │ PIN Mode   │
                              │                          │   └────────────┘
                              │
            ┌─────────────────┴──────────────────┐
            │                                    │
            ▼ JWT Mode                           ▼ PIN Mode
    ┌─────────────────────┐            ┌─────────────────────┐
    │ 1. Validate JWT:    │            │ 1. Find user:       │
    │    - Check sig      │            │    SELECT * FROM    │
    │    - Check expiry   │            │    user_profiles    │
    │    - Get user_id    │            │    WHERE username   │
    └─────────────────────┘            │                     │
            │                          └─────────────────────┘
            ▼                                    │
    ┌─────────────────────┐                    ▼
    │ 2. Fetch profile:   │            ┌─────────────────────┐
    │    SELECT * FROM    │            │ 2. Validate PIN:    │
    │    user_profiles    │            │    Compare input    │
    │    WHERE id         │            │    with stored      │
    └─────────────────────┘            └─────────────────────┘
            │                                    │
            ▼                                    ▼
    ┌─────────────────────┐            ┌─────────────────────┐
    │ 3. Check:           │            │ 3. Check:           │
    │    - User exists    │            │    - Role = staff   │
    │    - User active    │            │    - User active    │
    │    - Role valid     │            │    - PIN matches    │
    └─────────────────────┘            └─────────────────────┘
            │                                    │
    ┌───────┴─────────────┐            ┌───────┴─────────────┐
    │                     │            │                     │
    ▼ ✓ All valid         ▼ ✗ Error   ▼ ✓ PIN match         ▼ ✗ Error
┌──────────────┐    ┌──────────────┐ ┌──────────────┐  ┌──────────────┐
│ Return 200:  │    │ Return 401:  │ │ Return 200:  │  │ Return 401:  │
│ {            │    │ {            │ │ {            │  │ {            │
│  access_token│    │  detail: msg │ │  access_token│  │  detail: msg │
│  user: {...} │    │ }            │ │  user: {...} │  │ }            │
│ }            │    │              │ │ }            │  │              │
└──────────────┘    └──────────────┘ └──────────────┘  └──────────────┘
```

---

## 6. Session State Machine

```
┌────────────────────────┐
│   Initial State        │
│ (No Session)           │
└────────────────────────┘
         │
         │ User opens page
         ▼
┌────────────────────────┐
│   Login Page Shown     │
│ - Check localStorage   │
│ - If no token: show    │
│   login form           │
└────────────────────────┘
         │
         ├─ Click login form
         │        │
         │        ▼
         │  ┌──────────────┐
         │  │ Loading...   │
         │  └──────────────┘
         │        │
         │   ┌────┴─────────┐
         │   │              │
         │   ▼ Success      ▼ Error
         │ ┌────────────┐ ┌──────────────┐
         │ │ Save token │ │ Show error   │
         │ │ Save user  │ │ Keep on login│
         │ │ Save prefs │ └──────────────┘
         │ └────────────┘
         │   │
         │   ▼
         ├─►┌────────────────────────────┐
             │ Authenticated Session      │
             │ - Token in localStorage    │
             │ - User in state            │
             │ - Portal accessible        │
             └────────────────────────────┘
                    │
                    ├─ Page refresh
                    │  │
                    │  ▼ Check localStorage
                    │  ├─ Token exists ─┐
                    │  │                 │
                    │  ▼                 ▼
                    │  ┌──────────────┐  Restore session
                    │  │ Restore      │
                    │  │ Continue     │
                    │  └──────────────┘
                    │     │
                    │     ▼
                    │  Portal loads
                    │
                    ├─ Click logout
                    │  │
                    │  ▼ Clear all tokens
                    │
                    ▼
         ┌────────────────────────────┐
         │ Logged Out State           │
         │ - localStorage cleared     │
         │ - Session cleared          │
         │ - Redirect to login        │
         └────────────────────────────┘
```

---

## 7. Token Format Comparison

```
╔════════════════════════════════════════════════════════════════╗
║                    ADMIN/MANAGER TOKEN (JWT)                   ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║ Format:  eyJ0eXAiOiJKV1QiLCJhbGc....[payload]....[signature]   ║
║                                                                ║
║ Structure:                                                     ║
║ ┌─────────────┐ ┌──────────────────┐ ┌──────────────────────┐║
║ │   Header    │ │     Payload      │ │    Signature        ││
║ │ (algorithm) │ │ (claims + data)  │ │ (cryptographic)     ││
║ └─────────────┘ └──────────────────┘ └──────────────────────┘║
║                                                                ║
║ Payload Contains:                                              ║
║ {                                                              ║
║   "sub": "user-uuid",                                         ║
║   "email": "amartin@mjc-cafeteria.com",                      ║
║   "exp": 1717450000,        // Expires in 1 hour              ║
║   "iat": 1717446400,        // Issued at                      ║
║   ...other claims...                                          ║
║ }                                                              ║
║                                                                ║
║ Validation:                                                    ║
║ ✓ Cryptographically signed (cannot forge)                     ║
║ ✓ Expiry checked (1 hour default)                             ║
║ ✓ Full identity info inside token                             ║
║                                                                ║
║ Security: HIGH (requires Supabase private key to forge)       ║
║ Size: ~500-800 bytes                                          ║
║ Expiry: 1 hour (automatic via Supabase)                       ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝

╔════════════════════════════════════════════════════════════════╗
║                    STAFF TOKEN (Pseudo-token)                  ║
╠════════════════════════════════════════════════════════════════╣
║                                                                ║
║ Format:  pin_{user_id}                                        ║
║ Example: pin_u-staff-001                                      ║
║                                                                ║
║ Structure:                                                     ║
║ ┌──────┐ ┌────────────────┐                                   ║
║ │ Prefix│ │ User ID (UUID) │                                  ║
║ │ "pin_" │ │ from database  │                                 ║
║ └──────┘ └────────────────┘                                   ║
║                                                                ║
║ Validation:                                                    ║
║ ✓ Starts with "pin_" prefix (identifies as PIN session)       ║
║ ✓ Format checked (basic validation)                           ║
║ ✓ Used to lookup user in database                             ║
║                                                                ║
║ Security: MEDIUM (predictable format, not cryptographic)      ║
║ Size: ~20-40 bytes                                            ║
║ Expiry: Session-based (until logout or server restart)        ║
║                                                                ║
╚════════════════════════════════════════════════════════════════╝
```

---

**Legend:**
- `→` = Flow direction
- `▼` = Decision point
- `✓` = Success path
- `✗` = Error path
- `[ ]` = User action
- `{ }` = Data structure
- `│ └` = Branching

