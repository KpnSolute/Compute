import { createClient, SupabaseClient } from '@supabase/supabase-js';
import bcrypt from 'bcryptjs';
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
  const { url, key } = getSupaConfig();
  if (!url || !key) return null;
  _client = createClient(url, key, {
    auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kpn_supa_auth' },
  });
  return _client;
}

function _checkPin(plain: string, stored: string): boolean {
  stored = String(stored || '');
  if (stored.startsWith('$2')) {
    try {
      return bcrypt.compareSync(String(plain), stored);
    } catch (e) {
      return false;
    }
  }
  return String(plain) === stored;
}

function buildEmail(username: string) {
  if (username === 'sudo') return 'sudo@mjc.local';
  return `${username}@mjc-cafeteria.com`;
}

export async function realLogin({
  username,
  type,
  pin,
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

  // 1. fetch profile
  let profile: any;
  try {
    const { data, error } = await db
      .from('user_profiles')
      .select('id, username, display_name, last_name, role, pin, active')
      .eq('username', username)
      .single();
    if (error || !data) {
      return { ok: false, error: 'Username not recognised.' };
    }
    profile = data;
  } catch (e) {
    return { ok: false, error: 'Could not reach the directory. Check connection & table access.' };
  }

  if (!profile.active) return { ok: false, error: 'Account is disabled.' };

  // 2a. STAFF — PIN compare (mirrors backend)
  if (type === 'staff') {
    if (profile.role !== 'staff')
      return { ok: false, error: 'Admin & manager accounts must use the Admin / Manager login.' };
    if (!pin) return { ok: false, error: 'PIN is required.' };
    let ok;
    try {
      ok = _checkPin(pin, profile.pin);
    } catch (e: any) {
      return { ok: false, error: e.message };
    }
    if (!ok) return { ok: false, error: 'Incorrect PIN. Please try again.' };
    return { ok: true, user: _publicUser(profile) };
  }

  // 2b. ADMIN / MANAGER / ASSISTANT — real Supabase Auth
  if (type === 'admin') {
    if (!['admin', 'manager', 'assistant'].includes(profile.role))
      return { ok: false, error: 'Staff accounts must use the Staff login.' };
    if (!password) return { ok: false, error: 'Password is required.' };
    try {
      const { data, error } = await db.auth.signInWithPassword({
        email: buildEmail(username),
        password,
      });
      if (error || !data?.session) {
        return { ok: false, error: 'Incorrect password. Please try again.' };
      }
      return { ok: true, user: { ..._publicUser(profile), access_token: data.session.access_token } };
    } catch (e) {
      return { ok: false, error: 'Incorrect password. Please try again.' };
    }
  }

  return { ok: false, error: 'Invalid login type.' };
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

  const BASE = (import.meta.env as Record<string, string>).VITE_API_BASE || 'http://localhost:8000';
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

  const BASE = (import.meta.env as Record<string, string>).VITE_API_BASE || 'http://localhost:8000';
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
export async function saveLog(key: string, data: any, syncedBy?: string) {
  saveLogLocal(key, data);
  const db = getSupaClient();
  if (!db) return { ok: true, where: 'local' };
  try {
    const { error } = await db
      .from('haccp_logs')
      .upsert(
        { id: key, data, updated_by: syncedBy || 'portal', updated_at: new Date().toISOString() },
        { onConflict: 'id' }
      );
    if (error) return { ok: true, where: 'local', note: error.message };
    return { ok: true, where: 'supabase' };
  } catch (e: any) {
    return { ok: true, where: 'local', note: e.message };
  }
}
export async function fetchLog(key: string) {
  const db = getSupaClient();
  if (db) {
    try {
      const { data, error } = await db.from('haccp_logs').select('data, updated_by, updated_at').eq('id', key).single();
      if (!error && data) {
        saveLogLocal(key, data.data);
        return {
          ok: true,
          data: data.data,
          updatedBy: data.updated_by,
          updatedAt: data.updated_at,
          where: 'supabase',
        };
      }
    } catch (e) {}
  }
  return { ok: true, data: loadLog(key, null), where: 'local' };
}

export async function fetchInventory() {
  const db = getSupaClient();
  if (!db) return { ok: false, error: 'Not connected.' };
  try {
    const { data, error } = await db.from('inventory_sync').select('data, synced_by, synced_at').eq('id', 1).single();
    if (error) return { ok: false, error: error.message };
    const inv = data?.data?.liveInventory || null;
    return {
      ok: true,
      inv,
      syncedBy: data?.synced_by,
      syncedAt: data?.synced_at,
      liveMonth: data?.data?.liveMonth || null,
    };
  } catch (e: any) {
    return { ok: false, error: e.message };
  }
}

export async function pushInventory(inv: any, syncedBy?: string) {
  const db = getSupaClient();
  if (!db) return { ok: false, error: 'Not connected.' };
  try {
    const row = {
      id: 1,
      data: {
        version: 2,
        exportedAt: new Date().toISOString(),
        liveMonth: { month: 4, year: 2026 },
        liveInventory: inv,
        snapshots: {},
      },
      synced_by: syncedBy || 'portal',
      synced_at: new Date().toISOString(),
    };
    const { error } = await db.from('inventory_sync').upsert(row, { onConflict: 'id' });
    if (error) return { ok: false, error: error.message };
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
  const out: any[] = [];
  Object.keys(inv || {}).forEach((cat) => {
    (inv[cat] || []).forEach((it: any) => out.push({ ...it, cat }));
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
