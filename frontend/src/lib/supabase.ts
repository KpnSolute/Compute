import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { User } from './constants';

/* localStorage keys — identical to the dashboard so config is shared */
const SUPA_URL_KEY = 'mjc_supa_url';
const SUPA_KEY_KEY = 'mjc_supa_key';

export interface SupaConfig {
  url: string;
  key: string;
}

export function getSupaConfig(): SupaConfig {
  try {
    return {
      url: (localStorage.getItem(SUPA_URL_KEY) || '').trim(),
      key: (localStorage.getItem(SUPA_KEY_KEY) || '').trim(),
    };
  } catch (e) {
    return { url: '', key: '' };
  }
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
  return !!getBackendToken() || localStorage.getItem('mjc_backend_token') !== null;
}

/* memoised client */
let _client: SupabaseClient | null = null;
export function getSupaClient(): SupabaseClient | null {
  if (_client) return _client;
  const { url: lsUrl, key: lsKey } = getSupaConfig();
  const env = import.meta.env as Record<string, string>;
  const url = lsUrl || env.VITE_SUPABASE_URL || '';
  const key = lsKey || env.VITE_SUPABASE_ANON_KEY || '';
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

  // Staff PIN login is handled entirely by backendPinLogin() in Login.tsx.
  // realLogin() is only called for the admin/manager Supabase Auth flow.
  if (type === 'staff') {
    return { ok: false, error: 'Staff must use the PIN keypad.' };
  }

  // ADMIN / MANAGER — Supabase Auth FIRST, then fetch profile with authenticated session.
  // Never query user_profiles with the anon key — RLS blocks it.
  if (!password) return { ok: false, error: 'Password is required.' };
  try {
    const { data: authData, error: authErr } = await db.auth.signInWithPassword({
      email: buildEmail(username),
      password,
    });
    if (authErr || !authData?.session) {
      return { ok: false, error: 'Incorrect password. Please try again.' };
    }

    // Now authenticated — fetch profile (RLS allows authenticated SELECT)
    // Note: per AGENTS §3 and plan, data queries should prefer FastAPI; this is retained only for auth bootstrap in realLogin (minimal glue).
    const { data: profile, error: profErr } = await db
      .from('user_profiles')
      .select('id, username, display_name, last_name, role, active')
      .eq('username', username)
      .single();
    if (profErr || !profile) {
      await db.auth.signOut();
      return { ok: false, error: 'Profile not found. Contact your administrator.' };
    }
    if (!profile.active) {
      await db.auth.signOut();
      return { ok: false, error: 'Account is disabled.' };
    }
    if (!['admin', 'manager', 'assistant', 'sudo'].includes(profile.role)) {
      await db.auth.signOut();
      return { ok: false, error: 'Staff accounts must use the Staff login.' };
    }

    // P4 fix (per Claude v1.3.0 + Grok plan): subscribe to Supabase TOKEN_REFRESHED so we immediately re-call backendLogin with the new access_token.
    // This keeps mjc_backend_token fresh and prevents the ~1h expiry 401 spam + uncaught ApiError the user saw on /api/inventory, /events, /menu (multiple components fire calls without central refresh).
    db.auth.onAuthStateChange((event, session) => {
      if (event === 'TOKEN_REFRESHED' && session?.access_token) {
        backendLogin(session.access_token).catch(() => {});
      }
    });

    return { ok: true, user: { ..._publicUser(profile), access_token: authData.session.access_token } };
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
  };
}

/* ── BACKEND AUTHENTICATION ── */
const BACKEND_TOKEN_KEY = 'mjc_backend_token';

export interface BackendAuthResult {
  ok: boolean;
  token?: string;
  user?: User;
  error?: string;
}

export function getBackendToken(): string | null {
  try {
    return localStorage.getItem(BACKEND_TOKEN_KEY) || null;
  } catch (e) {
    return null;
  }
}

export function saveBackendToken(token: string) {
  try {
    localStorage.setItem(BACKEND_TOKEN_KEY, token);
  } catch (e) {
    console.warn('[Auth] Failed to save backend token:', e);
  }
}

export function clearBackendToken() {
  try {
    localStorage.removeItem(BACKEND_TOKEN_KEY);
  } catch (e) {}
}

/**
 * Backend login for admin/manager using a Supabase Auth access token.
 * @param accessToken - JWT from Supabase Auth
 * @returns { ok, token, user, error }
 */
export async function backendLogin(accessToken: string): Promise<BackendAuthResult> {
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
    saveBackendToken(data.access_token);

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
export async function backendPinLogin(username: string, pin: string): Promise<BackendAuthResult> {
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
    saveBackendToken(data.access_token);

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

export async function realLogout() {
  try {
    const db = getSupaClient();
    if (db) await db.auth.signOut();
  } catch (e) {}
  clearBackendToken();
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

export async function fetchInventory() {
  try {
    const { api } = await import('./api');
    const data = await api.getInventory();
    return {
      ok: true,
      inv: groupByCategory(data.items),
      syncedAt: data.created_at,
      metadata: data.metadata
    };
  } catch (e: any) {
    return { ok: false, error: e.message };
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
  const db = getSupaClient();
  if (!db) return { ok: false, error: 'Not connected.' };
  try {
    const { data, error } = await db
      .from('user_profiles')
      .select('id, username, display_name, last_name, role, active')
      .order('username');
    if (error) return { ok: false, error: error.message };
    return { ok: true, users: data || [] };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

/* ── INVENTORY MATH (mirrors dashboard) ── */
export const CCOLOR: Record<string, string> = {
  Dairy: '#0D9488',
  Cereal: '#B45309',
  Beverages: '#2563EB',
  Snacks: '#7C3AED',
  'Dry Goods': '#92400E',
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
  const rcv = (it.w1r || 0) + (it.w2r || 0) + (it.w3r || 0) + (it.w4r || 0);
  const iss = (it.w1i || 0) + (it.w2i || 0) + (it.w3i || 0) + (it.w4i || 0);
  return Math.max(0, (it.onHand || 0) + rcv - iss) * (it.price || 0);
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
  return invToList(inv).filter((i) => (i.onHand || 0) < (i.par || 0) && (i.par || 0) > 0);
}
export function fmtMoney(n: number) {
  if (n >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
  return '$' + (n || 0).toFixed(2);
}
export function fmtMoneyFull(n: number) {
  return (
    '$' +
    (n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  );
}
