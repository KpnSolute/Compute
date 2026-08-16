import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { User } from './constants';
import { workspaceHeaders } from './workspace';

// Supabase JS is scoped strictly to authentication (signInWithPassword,
// signOut, session refresh). All data reads/writes go through FastAPI
// (see lib/api.ts) — this file must never grow a data-query export again.

export interface SupaConfig {
  url: string;
  key: string;
}

function getSupaConfig(): SupaConfig {
  const env = import.meta.env as Record<string, string>;
  return {
    url: env.VITE_SUPABASE_URL || '',
    key: env.VITE_SUPABASE_ANON_KEY || '',
  };
}

/* memoised client */
let _client: SupabaseClient | null = null;
export function getSupaClient(): SupabaseClient | null {
  if (_client) return _client;
  const { url, key } = getSupaConfig();
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kpn_supa_auth' },
  });
  return _client;
}

function buildEmail(username: string) {
  if (username === 'sudo') return 'sudo@mjc.local';
  return `${username}@mjc-cafeteria.com`;
}

export async function realLogin({
  username,
  type,
  pin: _pin,
  password,
}: {
  username: string;
  type: 'staff' | 'admin';
  pin?: string;
  password?: string;
}): Promise<{ ok: boolean; user?: User; error?: string }> {
  username = (username || '').trim().toLowerCase();
  if (!username) return { ok: false, error: 'Username is required.' };

  const db = getSupaClient();
  if (!db) return { ok: false, error: 'Not connected to Supabase.' };

  // Staff PIN login is handled by backendPinLogin(); this password flow is for
  // any active user with a Supabase Auth account.
  if (type === 'staff') {
    return { ok: false, error: 'Staff must use the PIN keypad.' };
  }

  // Password users authenticate with Supabase Auth first. FastAPI owns the
  // profile, role, and active-account checks when the token is exchanged.
  if (!password) return { ok: false, error: 'Password is required.' };
  try {
    const { data: authData, error: authErr } = await db.auth.signInWithPassword({
      email: buildEmail(username),
      password,
    });
    if (authErr || !authData?.session) {
      return { ok: false, error: 'Incorrect password. Please try again.' };
    }

    // FastAPI will validate the profile, role, and active flag during backendLogin().
    // Guard: Supabase can return an already-expired access_token when the prior
    // session hits its 1-hour TTL during the same browser session. If so, the
    // onAuthStateChange SIGNED_OUT event fires immediately after login and tears
    // down the session before the caller stores it. Refresh proactively.
    let accessToken = authData.session.access_token;
    if ((authData.session.expires_at ?? 0) - Date.now() / 1000 < 60) {
      const { data: refreshed } = await db.auth.refreshSession();
      if (refreshed?.session?.access_token) accessToken = refreshed.session.access_token;
    }
    return {
      ok: true,
      user: {
        id: authData.session.user.id,
        username,
        display_name: '',
        last_name: '',
        role: 'staff',
        access_token: accessToken,
      },
    };
  } catch (e) {
    return { ok: false, error: 'Incorrect password. Please try again.' };
  }
}

function _publicUser(p: any): User {
  return {
    id: p.id,
    username: p.username,
    display_name: p.display_name || '',
    last_name: p.last_name || '',
    role: p.role,
    active: p.active,
    email: p.email,
    tenant: p.tenant,
    workspaces: p.workspaces || [],
    must_change_password: !!p.must_change_password,
    must_change_pin: !!p.must_change_pin,
  };
}

/* ── BACKEND AUTHENTICATION ── */
const BACKEND_TOKEN_KEY = 'mjc_backend_token';
const BACKEND_TOKEN_PERSIST_KEY = 'mjc_backend_token_persist';
const SUPABASE_AUTH_STORAGE_KEY = 'kpn_supa_auth';

export interface BackendAuthResult {
  ok: boolean;
  token?: string;
  user?: User;
  error?: string;
}

export function getBackendToken(): string | null {
  try {
    return sessionStorage.getItem(BACKEND_TOKEN_KEY) || localStorage.getItem(BACKEND_TOKEN_KEY) || null;
  } catch (e) {
    return null;
  }
}

export function isBackendTokenPersistent(): boolean {
  try {
    if (sessionStorage.getItem(BACKEND_TOKEN_KEY)) return false;
    if (localStorage.getItem(BACKEND_TOKEN_PERSIST_KEY) === '1') return true;
    // Legacy remembered sessions predate the explicit persist flag.
    return !!localStorage.getItem(BACKEND_TOKEN_KEY);
  } catch (e) {
    return false;
  }
}

export function saveBackendToken(token: string, remember = true) {
  try {
    if (remember) {
      localStorage.setItem(BACKEND_TOKEN_KEY, token);
      localStorage.setItem(BACKEND_TOKEN_PERSIST_KEY, '1');
      sessionStorage.removeItem(BACKEND_TOKEN_KEY);
      sessionStorage.removeItem(BACKEND_TOKEN_PERSIST_KEY);
    } else {
      sessionStorage.setItem(BACKEND_TOKEN_KEY, token);
      sessionStorage.setItem(BACKEND_TOKEN_PERSIST_KEY, '0');
      localStorage.removeItem(BACKEND_TOKEN_KEY);
      localStorage.removeItem(BACKEND_TOKEN_PERSIST_KEY);
    }
  } catch (e) {
    console.warn('[Auth] Failed to save backend token:', e);
  }
}

export function clearBackendToken() {
  try {
    localStorage.removeItem(BACKEND_TOKEN_KEY);
    localStorage.removeItem(BACKEND_TOKEN_PERSIST_KEY);
    localStorage.removeItem(SUPABASE_AUTH_STORAGE_KEY);
    sessionStorage.removeItem(BACKEND_TOKEN_KEY);
    sessionStorage.removeItem(BACKEND_TOKEN_PERSIST_KEY);
  } catch (e) {}
}

/**
 * Backend login for admin/manager using a Supabase Auth access token.
 * @param accessToken - JWT from Supabase Auth
 * @returns { ok, token, user, error }
 */
export async function backendLogin(accessToken: string, remember = true): Promise<BackendAuthResult> {
  if (!accessToken) {
    return { ok: false, error: 'Access token is required' };
  }

  const BASE = (import.meta.env as Record<string, string>).VITE_API_BASE || 'https://mjcc-managements.onrender.com';
  console.debug('[Auth] Sending login to backend /api/auth/login...');

  try {
    const response = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...workspaceHeaders() },
      body: JSON.stringify({ access_token: accessToken }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      console.warn('[Auth] Backend login failed:', error);
      try {
        const json = JSON.parse(error);
        return { ok: false, error: json.detail || 'Login failed' };
      } catch {
        return { ok: false, error: `Login failed: ${response.status}` };
      }
    }

    const data = await response.json();
    console.debug('[Auth] Backend login succeeded, token saved');
    saveBackendToken(data.access_token, remember);

    return {
      ok: true,
      token: data.access_token,
      user: _publicUser(data.user),
    };
  } catch (e: any) {
    console.warn('[Auth] Backend login error:', e.message);
    return { ok: false, error: e.message || 'Network error' };
  }
}

/**
 * Backend login for staff using username + PIN.
 * @param username - Staff username
 * @param pin - 4-digit PIN
 * @returns { ok, token, user, error }
 */
export async function backendPinLogin(username: string, pin: string, remember = false): Promise<BackendAuthResult> {
  username = (username || '').trim().toLowerCase();
  if (!username || !pin) {
    return { ok: false, error: 'Username and PIN are required' };
  }

  const BASE = (import.meta.env as Record<string, string>).VITE_API_BASE || 'https://mjcc-managements.onrender.com';
  console.debug('[Auth] Sending PIN login to backend /api/auth/login...');

  try {
    const response = await fetch(BASE + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...workspaceHeaders() },
      body: JSON.stringify({ username, pin }),
    });

    if (!response.ok) {
      const error = await response.text().catch(() => response.statusText);
      console.warn('[Auth] Backend PIN login failed:', error);
      try {
        const json = JSON.parse(error);
        return { ok: false, error: json.detail || 'PIN login failed' };
      } catch {
        return { ok: false, error: `PIN login failed: ${response.status}` };
      }
    }

    const data = await response.json();
    console.debug('[Auth] Backend PIN login succeeded, token saved');
    saveBackendToken(data.access_token, remember);

    return {
      ok: true,
      token: data.access_token,
      user: _publicUser(data.user),
    };
  } catch (e: any) {
    console.warn('[Auth] Backend PIN login error:', e.message);
    return { ok: false, error: e.message || 'Network error' };
  }
}

export async function ensureFreshBackendAuth(minTtlSeconds = 300): Promise<void> {
  const db = getSupaClient();
  if (!db) return;

  try {
    const { data } = await db.auth.getSession();
    let session = data.session;
    if (!session) return;

    const expiresAt = session.expires_at ?? 0;
    if (expiresAt && expiresAt - Date.now() / 1000 < minTtlSeconds) {
      const { data: refreshed, error } = await db.auth.refreshSession();
      if (error) return;
      session = refreshed.session || session;
    }

    if (session?.access_token) {
      await backendLogin(session.access_token, isBackendTokenPersistent());
    }
  } catch {
    // Best-effort only. The request path still handles 401s centrally.
  }
}

let _logoutInProgress = false;

export async function realLogout() {
  _logoutInProgress = true;
  try {
    const db = getSupaClient();
    if (db) await db.auth.signOut();
  } catch (_e) {}
  clearBackendToken();
  _logoutInProgress = false;
}

let _authRefreshInitialized = false;

/**
 * Register the Supabase onAuthStateChange listener once at app startup.
 * TOKEN_REFRESHED keeps mjc_backend_token in sync with the refreshed JWT.
 * SIGNED_OUT from an external source (e.g. Supabase dashboard) fires mjc:session-expired.
 */
export function initAuthRefresh() {
  if (_authRefreshInitialized) return;
  _authRefreshInitialized = true;
  const db = getSupaClient();
  if (!db) return;
  db.auth.onAuthStateChange((event, session) => {
    if (event === 'TOKEN_REFRESHED' && session?.access_token) {
      backendLogin(session.access_token, isBackendTokenPersistent()).catch(() => {});
    }
    if (event === 'SIGNED_OUT' && !_logoutInProgress) {
      window.dispatchEvent(
        new CustomEvent('mjc:session-expired', { detail: { reason: 'logout' } }),
      );
    }
  });
}
