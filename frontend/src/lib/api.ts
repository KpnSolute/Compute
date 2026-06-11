import { getBackendToken, clearBackendToken } from './supabase';

const envBase = (import.meta.env as Record<string, string>).VITE_API_BASE;
if (!envBase) {
  console.warn('VITE_API_BASE not set — falling back (violates production rule). Set in frontend/.env');
}
const BASE = envBase || 'https://mjcc-managements.onrender.com';

class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getBackendToken();
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(BASE + path, {
    headers: { ...headers, ...opts?.headers },
    ...opts,
  });

  if (res.status === 401) {
    // Stale or expired token — clear session and signal re-login
    clearBackendToken();
    window.dispatchEvent(new CustomEvent('mjc:session-expired'));
    let body: string;
    try { const json = await res.json(); body = json.detail || 'Session expired'; }
    catch { body = 'Session expired'; }
    throw new ApiError(401, body);
  }

  if (!res.ok) {
    let body: string;
    try {
      const json = await res.json();
      body = json.detail || JSON.stringify(json);
    } catch {
      body = await res.text().catch(() => res.statusText);
    }
    throw new ApiError(res.status, body);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export interface Commit {
  commit_id: string;
  message: string;
  author_id: string;
  author_name?: string;
  submitter_role?: string;
  status: string;
  branch: string;
  created_at: string;
  merged_at?: string;
  github_sha?: string | null;
  github_synced_at?: string | null;
  change_count: number;
}

export interface StagingEntry {
  entry_id: string;
  entity_type: string;
  entity_id: string;
  field_name: string;
  old_value_text?: string | null;
  new_value_text?: string | null;
  change_type: string;
  metadata?: Record<string, unknown>;
  status: 'pending' | 'merged' | 'rejected';
  submitted_by: string;
  submitter_name?: string;
  submitter_role?: string;
  review_note?: string | null;
  created_at: string;
  expires_at?: string | null;
  operation?: string;
  full_payload?: Record<string, unknown>;
}

export type EntityType = 'inventory' | 'menu' | 'user' | 'compliance' | 'event' | 'ops';

export interface SubmitStagingBody {
  entity_type: EntityType;
  entity_id: string;
  field_name: string;
  old_value?: string;
  new_value: string;
  change_type: string;
  metadata?: Record<string, unknown>;
  operation?: string;
  full_payload?: Record<string, unknown>;
}

export interface ApproveCommitBody {
  staging_ids: string[];
  message: string;
  author_id: string;
}

export const api = {
  // Auth
  async login(body: { username?: string; password?: string; pin?: string; access_token?: string }): Promise<{ user: any; token: string }> {
    const data: any = await req('/api/auth/login', { method: 'POST', body: JSON.stringify(body) });
    return { user: data.user, token: data.access_token };
  },

  async getMe(): Promise<any> {
    return req('/api/auth/me');
  },

  async logout(): Promise<void> {
    await req('/api/auth/logout', { method: 'POST' });
  },

  // Users
  async getUsers(activeOnly?: boolean): Promise<any[]> {
    const q = activeOnly ? '?active_only=true' : '';
    const data: any = await req(`/api/users${q}`);
    return data.users || [];
  },

  async createUser(body: any): Promise<any> {
    return req('/api/users', { method: 'POST', body: JSON.stringify(body) });
  },

  async updateUser(userId: string, body: any): Promise<any> {
    return req(`/api/users/${userId}`, { method: 'PUT', body: JSON.stringify(body) });
  },

  async getUser(userId: string): Promise<any> {
    return req(`/api/users/${userId}`);
  },

  async deleteUser(userId: string): Promise<void> {
    return req(`/api/users/${userId}`, { method: 'DELETE' });
  },

  // Inventory
  async getInventory(month?: number, year?: number): Promise<any> {
    const params = new URLSearchParams();
    if (month !== undefined) params.set('month', String(month));
    if (year !== undefined) params.set('year', String(year));
    const qs = params.toString();
    return req(`/api/inventory${qs ? '?' + qs : ''}`);
  },

  async saveInventory(body: any): Promise<any> {
    return req('/api/inventory', { method: 'POST', body: JSON.stringify(body) });
  },

  async getInventoryHistory(limit?: number): Promise<any[]> {
    const q = limit ? `?limit=${limit}` : '';
    return req(`/api/inventory/history${q}`);
  },

  async getReorders(): Promise<any[]> {
    return req('/api/inventory/reorders');
  },

  // Period / month rollover
  async getPeriodStatus(): Promise<{
    current_month: number; current_year: number;
    latest_month: number | null; latest_year: number | null;
    next_month: number | null; next_year: number | null;
    needs_rollover: boolean;
    current_label: string; latest_label: string; next_label: string;
  }> {
    return req('/api/inventory/period-status');
  },

  async performRollover(message?: string): Promise<{ ok: boolean; result: any }> {
    return req('/api/inventory/rollover', { method: 'POST', body: JSON.stringify({ message: message ?? null }) });
  },

  // Menu
  async getMenu(day: string): Promise<any> {
    return req(`/api/menu/${encodeURIComponent(day)}`);
  },

  async saveMenu(day: string, body: any): Promise<any> {
    return req(`/api/menu/${encodeURIComponent(day)}`, { method: 'POST', body: JSON.stringify(body) });
  },

  // Events
  async getEvents(): Promise<any[]> {
    return req('/api/events');
  },

  async createEvent(body: any): Promise<any> {
    return req('/api/events', { method: 'POST', body: JSON.stringify(body) });
  },

  // Opening Checklist
  async getOpeningChecklist(): Promise<any[]> {
    return req('/api/opening-checklist');
  },

  // ServSafe Certifications
  async getServSafe(): Promise<any[]> {
    return req('/api/servsafe');
  },

  // Meal Periods
  async getMealPeriods(): Promise<any[]> {
    return req('/api/meal-periods');
  },

  // Incidents
  async getIncidents(limit?: number, type?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (type) params.set('type', type);
    const qs = params.toString();
    return req(`/api/incidents${qs ? '?' + qs : ''}`);
  },
  async createIncident(body: any): Promise<any> {
    return req('/api/incidents', { method: 'POST', body: JSON.stringify(body) });
  },

  // Invoices
  async getInvoices(month?: number, year?: number): Promise<any[]> {
    const params = new URLSearchParams();
    if (month !== undefined) params.set('month', String(month));
    if (year !== undefined) params.set('year', String(year));
    const qs = params.toString();
    return req(`/api/invoices${qs ? '?' + qs : ''}`);
  },
  async getInvoiceItems(invoiceId: string): Promise<any[]> {
    return req(`/api/invoices/${encodeURIComponent(invoiceId)}/items`);
  },

  // Inventory Categories
  async getInventoryCategories(): Promise<any[]> {
    return req('/api/inventory-categories');
  },

  // Dashboard
  async getDashboardStats(): Promise<any> {
    return req('/api/dashboard/stats');
  },

  // Archives
  async getArchives(): Promise<any[]> {
    return req('/api/archives');
  },
  async getArchiveDetail(year: number, month: number): Promise<any> {
    return req(`/api/archives/${year}/${month}`);
  },

  // Logs
  async getHaccpLogs(limit?: number, location?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (location) params.set('location', location);
    const qs = params.toString();
    return req(`/api/logs/haccp${qs ? '?' + qs : ''}`);
  },

  async saveHaccpLog(body: any): Promise<any> {
    return req('/api/logs/haccp', { method: 'POST', body: JSON.stringify(body) });
  },

  async getDailyLogs(limit?: number, entryType?: string): Promise<any[]> {
    const params = new URLSearchParams();
    if (limit !== undefined) params.set('limit', String(limit));
    if (entryType) params.set('entry_type', entryType);
    const qs = params.toString();
    return req(`/api/logs/daily${qs ? '?' + qs : ''}`);
  },

  async saveDailyLog(body: any): Promise<any> {
    return req('/api/logs/daily', { method: 'POST', body: JSON.stringify(body) });
  },

  async getCompliance(): Promise<any> {
    return req('/api/logs/compliance');
  },

  // Source Control
  async getCommits(limit = 50, offset = 0): Promise<Commit[]> {
    return req(`/api/commits?limit=${limit}&offset=${offset}`);
  },

  async getStaging(entityType?: string): Promise<StagingEntry[]> {
    const q = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : '';
    return req(`/api/staging${q}`);
  },

  async submitStaging(body: SubmitStagingBody): Promise<StagingEntry> {
    return req('/api/staging', { method: 'POST', body: JSON.stringify(body) });
  },

  async stageChange(operation: string, entityType: EntityType, entityId: string, payload: any, summary: string): Promise<StagingEntry> {
    return this.submitStaging({
      entity_type: entityType,
      entity_id: entityId,
      field_name: operation,
      change_type: operation,
      new_value: summary,
      metadata: { summary },
      operation,
      full_payload: payload,
    });
  },

  async approveCommit(body: ApproveCommitBody): Promise<Commit> {
    return req('/api/commits', { method: 'POST', body: JSON.stringify(body) });
  },

  async rejectStaging(id: string, reviewNote?: string): Promise<void> {
    const qs = reviewNote ? `?review_note=${encodeURIComponent(reviewNote)}` : '';
    return req(`/api/staging/${id}${qs}`, { method: 'DELETE' });
  },

  // Data Entry
  async uploadDataEntry(file: File, hint: string, month?: number, year?: number, week?: number, direction?: string): Promise<{ batch_id: string; staged_count: number; operations: Record<string, number>; file: string; month: number; year: number }> {
    const token = getBackendToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const form = new FormData();
    form.append('file', file);
    form.append('hint', hint);
    if (month !== undefined) form.append('month', String(month));
    if (year !== undefined) form.append('year', String(year));
    if (week !== undefined) form.append('week', String(week));
    if (direction !== undefined) form.append('direction', direction);
    const res = await fetch(BASE + '/api/data-entry/upload', { method: 'POST', headers, body: form });
    if (!res.ok) {
      let body: string;
      try { const json = await res.json(); body = json.detail || JSON.stringify(json); }
      catch { body = await res.text().catch(() => res.statusText); }
      throw new ApiError(res.status, body);
    }
    return res.json();
  },

  async getDataEntryPreview(batchId: string): Promise<any[]> {
    return req(`/api/data-entry/preview/${encodeURIComponent(batchId)}`);
  },

  async getDataEntrySettings(): Promise<any> {
    return req('/api/data-entry/settings');
  },

  async updateDataEntrySettings(body: { provider?: string; model?: string }): Promise<any> {
    return req('/api/data-entry/settings', { method: 'PUT', body: JSON.stringify(body) });
  },

  // User preferences (theme, etc.) — saved per-user in Supabase app_settings
  async getUserPreferences(): Promise<{ theme?: string }> {
    return req('/api/users/me/preferences');
  },

  async updateUserPreferences(prefs: { theme?: string }): Promise<any> {
    return req('/api/users/me/preferences', { method: 'PUT', body: JSON.stringify(prefs) });
  },

  // Self-service profile
  async getMyProfile(): Promise<any> {
    return req('/api/users/me');
  },

  async updateMyProfile(body: { display_name?: string; last_name?: string; phone?: string; job_title?: string; bio?: string; avatar_url?: string }): Promise<any> {
    return req('/api/users/me', { method: 'PUT', body: JSON.stringify(body) });
  },

  // AI key management (sudo only)
  async getAIKeys(): Promise<Array<{ provider: string; is_active: boolean; has_key: boolean; base_url: string | null; updated_at: string | null }>> {
    return req('/api/data-entry/ai-keys');
  },

  async updateAIKey(provider: string, body: { api_key?: string; base_url?: string; is_active?: boolean }): Promise<any> {
    return req(`/api/data-entry/ai-keys/${encodeURIComponent(provider)}`, { method: 'PUT', body: JSON.stringify(body) });
  },

  // AI tool toggles (sudo only)
  async getAITools(): Promise<Record<string, boolean>> {
    return req('/api/data-entry/ai-tools');
  },

  async updateAITools(tools: Record<string, boolean>): Promise<Record<string, boolean>> {
    return req('/api/data-entry/ai-tools', { method: 'PUT', body: JSON.stringify({ tools }) });
  },

  // AI usage stats (sudo only)
  async getAIUsage(days?: number, limit?: number): Promise<any> {
    const params = new URLSearchParams();
    if (days !== undefined) params.set('days', String(days));
    if (limit !== undefined) params.set('limit', String(limit));
    const qs = params.toString();
    return req(`/api/data-entry/ai-usage${qs ? '?' + qs : ''}`);
  },

  // ── Agent ────────────────────────────────────────────────────────────────

  async getAgentConfig(): Promise<any> {
    return req('/api/agent/config');
  },

  async updateAgentConfig(body: any): Promise<any> {
    return req('/api/agent/config', { method: 'PUT', body: JSON.stringify(body) });
  },

  async sendAgentMessage(message: string): Promise<{ response: string; tool_calls: any[]; rate_limit: any }> {
    return req('/api/agent/chat', { method: 'POST', body: JSON.stringify({ message }) });
  },

  async getAgentHistory(limit?: number): Promise<any[]> {
    const qs = limit ? `?limit=${limit}` : '';
    const data: any = await req(`/api/agent/history${qs}`);
    return data.turns || [];
  },

  async clearAgentHistory(): Promise<{ deleted: number }> {
    return req('/api/agent/history', { method: 'DELETE' });
  },

};
