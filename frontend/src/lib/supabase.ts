import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { User } from './constants';
import { itemEndingValue, itemTotals, isBelowPar } from './inventoryFormulas';

/* localStorage keys — identical to the dashboard so config is shared */
const SUPA_URL_KEY = 'mjc_supa_url';
const SUPA_KEY_KEY = 'mjc_supa_key';

export interface SupaConfig {
  url: string;
  key: string;
}

export function getSupaConfig(): SupaConfig {
  const env = import.meta.env as Record<string, string>;
  return {
    url: env.VITE_SUPABASE_URL || '',
    key: env.VITE_SUPABASE_ANON_KEY || '',
  };
}

export function saveSupaConfig(url: string, key: string) {
  try {
    localStorage.setItem(SUPA_URL_KEY, (url || '').trim());
    localStorage.setItem(SUPA_KEY_KEY, (key || '').trim());
  } catch (e) {}
  _client = null; // force rebuild
}

export function clearSupaConfig() {
  try {
    localStorage.removeItem(SUPA_URL_KEY);
    localStorage.removeItem(SUPA_KEY_KEY);
  } catch (e) {}
  _client = null;
}

export function isConnected(): boolean {
  return !!getBackendToken();
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
      headers: { 'Content-Type': 'application/json' },
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
      headers: { 'Content-Type': 'application/json' },
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

export function _logKey(key: string) {
  return 'mjc_log_' + key;
}
export function loadLog(key: string, fallback: any) {
  try {
    const raw = localStorage.getItem(_logKey(key));
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return fallback;
}
export function saveLogLocal(key: string, data: any) {
  try {
    localStorage.setItem(_logKey(key), JSON.stringify(data));
  } catch (e) {}
}
/**
 * saveLog now redirects to the backend API for persistence.
 * Local-first fallback is maintained in localStorage.
 */
export async function saveLog(key: string, data: any, syncedBy?: string) {
  saveLogLocal(key, data);
  
  // In the backend-mediated architecture, we use the FastAPI client
  // rather than direct Supabase JS upserts for data.
  try {
    const { api } = await import('./api');
    
    // Determine which API to call based on the key/context
    // This is a simplified shim to maintain the existing local-first UI pattern
    if (key.includes('haccp')) {
      await api.saveHaccpLog({
        location: data.location || 'Unknown',
        temperature: data.temperature || 0,
        unit: data.unit || 'F',
        timestamp: new Date().toISOString(),
        checked_by: syncedBy || 'portal',
        notes: data.notes || ''
      });
    } else {
      await api.saveDailyLog({
        entry_type: 'other',
        title: `Log Update: ${key}`,
        description: JSON.stringify(data),
        data: JSON.stringify(data)
      });
    }
    
    return { ok: true, where: 'backend' };
  } catch (e: any) {
    console.warn('[Storage] Backend sync failed, kept local:', e.message);
    return { ok: true, where: 'local', note: e.message };
  }
}

/**
 * fetchLog reads from the backend API.
 */
export async function fetchLog(key: string) {
  try {
    const { api } = await import('./api');
    let data: any;
    
    if (key.includes('haccp')) {
      const logs = await api.getHaccpLogs(1, key);
      data = logs[0];
    }
    
    if (data) {
      saveLogLocal(key, data);
      return { ok: true, data, where: 'backend' };
    }
  } catch (e) {}
  
  return { ok: true, data: loadLog(key, null), where: 'local' };
}

/**
 * fetchInventory and pushInventory now use the backend API.
 * The 'inventory_sync' table is legacy/fiction.
 */
function groupByCategory(items: any[]) {
  const dict: Record<string, any[]> = {};
  for (const it of items || []) {
    const cat = it.category || 'Uncategorized';
    if (!dict[cat]) dict[cat] = [];
    dict[cat].push(it);
  }
  return dict;
}

export async function fetchInventory(month?: number, year?: number) {
  try {
    const { api } = await import('./api');
    const data = await api.getInventory(month, year);
    return {
      ok: true,
      inv: groupByCategory(data.items),
      syncedAt: data.created_at,
      metadata: data.metadata
    };
  } catch (e: any) {
    if ((e as any)?.status === 404) {
      return { ok: true as const, inv: {} as Record<string, any[]>, syncedAt: null, metadata: {} };
    }
    return { ok: false as const, error: e?.message || 'Load failed' };
  }
}

export async function pushInventory(inv: any, syncedBy?: string) {
  try {
    const { api } = await import('./api');
    const payload = {
      items: inv,
      metadata: { synced_by: syncedBy }
    };
    await api.saveInventory(payload);
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function fetchProfiles() {
  try {
    const { api } = await import('./api');
    const users = await api.getUsers();
    return { ok: true, users };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/* ── INVENTORY MATH (mirrors dashboard) ── */
export const CCOLOR: Record<string, string> = {
  // Current taxonomy (as of June 2026 rename)
  Dairy: '#0D9488',
  Cereal: '#B45309',
  Beverages: '#2563EB',
  Snacks: '#7C3AED',
  'Dry Goods': '#92400E',
  Produce: '#15803D',
  Meats: '#B91C1C',
  'Frozen Food': '#0369A1',
  Disposables: '#6B7280',
  'New Items': '#F59E0B',
  // Legacy aliases — kept for backward compatibility with items not yet remapped
  'Produce & Fresh': '#15803D',
  'Protein & Meat': '#B91C1C',
  'Frozen Foods': '#0369A1',
  Supplies: '#6B7280',
  Bread: '#CA8A04',
  Condiments: '#DB2777',
};
export function catColor(c: string) {
  return CCOLOR[c] || '#1E73E8';
}
export function iTotal(it: any) {
  return itemEndingValue(it);
}
export function invToList(inv: any) {
  if (Array.isArray(inv)) return inv;
  const out: any[] = [];
  Object.keys(inv || {}).forEach((cat) => {
    if (Array.isArray(inv[cat])) {
      inv[cat].forEach((it: any) => out.push({ ...it, cat }));
    }
  });
  return out;
}
export function grandTotal(inv: any) {
  return invToList(inv).reduce((s, i) => s + iTotal(i), 0);
}
export function catTotals(inv: any) {
  return Object.keys(inv || {})
    .map((cat) => ({
      name: cat,
      color: catColor(cat),
      val: (inv[cat] || []).reduce((s: number, i: any) => s + iTotal(i), 0),
      count: (inv[cat] || []).length,
    }))
    .sort((a, b) => b.val - a.val);
}
export function reorders(inv: any) {
  return invToList(inv).filter((i) => isBelowPar(itemTotals(i).ending, i.par));
}
export function fmtMoney(n: number) {
  return '$' + (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
export function fmtMoneyFull(n: number) {
  return (
    '$' +
    (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
