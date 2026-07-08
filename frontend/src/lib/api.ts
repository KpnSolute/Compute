import { getBackendToken, clearBackendToken, ensureFreshBackendAuth } from './supabase';
import { markSessionActivity } from './session';

const envBase = (import.meta.env as Record<string, string>).VITE_API_BASE;
if (!envBase) {
  console.warn('VITE_API_BASE not set — falling back (violates production rule). Set in frontend/.env');
}
const BASE = envBase || 'https://mjcc-managements.onrender.com';

function compactErrorBody(body: any): string {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  const normalized = (text || 'Request failed').replace(/\s+/g, ' ').trim();
  return normalized.length > 500 ? `${normalized.slice(0, 497).trim()}...` : normalized;
}

class ApiError extends Error {
  status: number;
  detail: any;
  constructor(status: number, body: any) {
    super(compactErrorBody(body));
    this.status = status;
    this.detail = body;
    this.name = 'ApiError';
  }
}

async function req<T>(path: string, opts?: RequestInit): Promise<T> {
  const token = getBackendToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
    'Pragma': 'no-cache',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(BASE + path, {
    headers: { ...headers, ...opts?.headers },
    cache: opts?.cache ?? 'no-store',
    ...opts,
  });

  if (res.status === 401) {
    // Stale or expired token — clear session and signal re-login
    clearBackendToken();
    window.dispatchEvent(new CustomEvent('mjc:session-expired', { detail: { reason: 'unauthorized' } }));
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
  const data = await res.json() as T;
  if ((opts?.method ?? 'GET').toUpperCase() !== 'GET') {
    window.dispatchEvent(new CustomEvent('mjcc:live-data-changed', { detail: { path } }));
  }
  return data;
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
  pull_request_id?: string | null;
  pr_number?: number | null;
  pr_title?: string | null;
}

export interface SourceTransaction {
  change_id?: string;
  commit_id?: string | null;
  item_id?: string | null;
  sku?: string | null;
  description?: string | null;
  entity_type?: string | null;
  entity_id?: string | null;
  field?: string | null;
  field_name?: string | null;
  action?: string | null;
  old_value?: number | null;
  new_value?: number | null;
  old_value_text?: string | null;
  new_value_text?: string | null;
  month?: number | null;
  year?: number | null;
  week_number?: number | null;
  created_at?: string | null;
  commit_message?: string | null;
  github_sha?: string | null;
  github_synced_at?: string | null;
  author_name?: string | null;
  author_role?: string | null;
  unit_price?: number | null;
  unit?: string | null;
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
  pull_request_id?: string | null;
}

export interface AuditFinding {
  id: string;
  check_type: string;
  severity: 'error' | 'warning' | 'info';
  sku?: string | null;
  message: string;
  details?: Record<string, unknown>;
  resolved: boolean;
  created_at: string;
}

export interface AuditReport {
  month: number;
  year: number;
  total: number;
  counts: { error: number; warning: number; info: number };
  findings: AuditFinding[];
}

/**
 * Inventory contract — mirrors backend/routes/inventory.py InventoryItem.
 * Keep these field names in lockstep with the Pydantic model: a rename on either
 * side should now be a compile error here instead of a silent runtime mismatch.
 * Monthly Inventory Template mapping: onHand=Opening OH, w{1..3}r=Received Wk{1..3},
 * w{1..3}p=Pulled Wk{1..3}, totalReceived/totalPulled/closingQty are derived
 * (=SUM / Opening+Received-Pulled), value=Ending value.
 */
export interface InventoryItem {
  id?: string | null;
  sku: string;
  desc: string;
  onHand?: number | null;
  par?: number | null;
  category: string;
  price?: number | null;
  unit?: string;
  status?: string;
  w1r?: number | null; w2r?: number | null; w3r?: number | null;
  w1p?: number | null; w2p?: number | null; w3p?: number | null;
  running_total?: number | null;
  totalReceived?: number | null;
  totalPulled?: number | null;
  closingQty?: number | null;
  value?: number | null;
  openingUnitCost?: number | null;
  openingValue?: number | null;
  receivedValue?: number | null;
  pulledValue?: number | null;
  endingValue?: number | null;
  sku_pending?: boolean | null;
  needs_attention?: boolean | null;
}

export interface InventoryResponse {
  id: string;
  items: InventoryItem[];
  metadata: Record<string, unknown>;
  notes: string;
  created_at: string;
}

export interface LowStockItem {
  sku: string;
  desc: string;
  category: string;
  onHand: number;
  par: number;
  short: number;
}

export interface InventoryCatalogItem {
  id: string;
  sku: string;
  description: string;
  category_id?: string | null;
  category: string;
  unit_price?: number | null;
  par_level?: number | null;
  unit?: string | null;
  active?: boolean | null;
  sku_pending?: boolean | null;
  needs_attention?: boolean | null;
}

export type EntityType = 'inventory' | 'menu' | 'user' | 'compliance' | 'event' | 'ops';

// Menu — 28-day cycle editor
export interface MenuCycleDaySummary {
  cycle_day: number;
  cycle_week: number;
  day_of_week: string;
  zone: number;
  morning_service: string;
  midday_service: string;
  evening_service: string;
  active: boolean;
}

export interface MenuCycleOverview {
  anchor_date: string;
  today: { date: string; cycle_day: number };
  days: MenuCycleDaySummary[];
}

export interface MenuSlot {
  record_id: string;
  meal_group: string;
  meal_period: string;
  service_order: number;
  slot_order: number;
  slot_name: string;
  item_id?: string | null;
  item_name: string;
  active: boolean;
}

export interface MenuCycleDay {
  cycle_day: number;
  cycle_week: number;
  day_of_week: string;
  zone: number;
  morning_service: string;
  midday_service: string;
  evening_service: string;
  slots: MenuSlot[];
}

export interface PublicMenuCycleSlot { slot_name: string; item_name: string }
export interface PublicMenuCycleDay {
  cycle_day: number;
  day_of_week: string;
  meals: Record<string, PublicMenuCycleSlot[]>;
}
export interface PublicMenuCycle { anchor_date: string; days: PublicMenuCycleDay[] }

export interface MenuFeedbackRow {
  id: string;
  cycle_day: number;
  slot: string;
  dish_name: string;
  avg_rating?: number | null;
  response_count?: number | null;
  updated_at?: string | null;
}

export interface PublicMenuStats {
  rows: MenuFeedbackRow[];
  top_meals: MenuFeedbackRow[];
}

export interface PublicMealPeriod {
  meal: string;
  label: string;
  open_hour?: number | null;
  close_hour?: number | null;
  sort_order?: number | null;
  active?: boolean;
}

export interface PublicMenuServiceStatus {
  now: string;
  current_period?: PublicMealPeriod | null;
  next_period?: PublicMealPeriod | null;
  periods: PublicMealPeriod[];
}

export interface FlowAssignment {
  id: string;
  title: string;
  description: string;
  assigned_to: string | null;
  assigned_to_role: string | null;
  created_by: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  priority: 'low' | 'normal' | 'high' | 'urgent';
  due_date: string | null;
  link_type: string | null;
  link_key: string | null;
  link_params: Record<string, unknown>;
  completed_at: string | null;
  completed_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostBudget {
  id: string;
  month: number;
  year: number;
  gov_allotment: number;
  w1_planned_pull: number | null;
  w2_planned_pull: number | null;
  w3_planned_pull: number | null;
  w1_planned_renewable: number | null;
  w2_planned_renewable: number | null;
  w3_planned_renewable: number | null;
  notes: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CostCategoryBreakdown {
  category_id: string;
  name: string;
  color: string | null;
  icon: string | null;
  opening_value: number;
  pulled_value: number;
  received_value: number;
  ending_value: number;
}

export interface CostSummary {
  budget: CostBudget | null;
  pct_used: number | null;
  category_breakdown: CostCategoryBreakdown[];
  total_starting: number;
  total_pulled: number;
  total_received: number;
  total_ending: number;
  reviewable_spend: number;
  total_spend: number;
}

export interface CostTrendPoint {
  month: number;
  year: number;
  total_spend: number;
  gov_allotment: number | null;
}

export interface CostAverages {
  avg_pull_amount: number;
  avg_reviewable_amount: number;
  months_sampled: number;
}

export interface PublicMenuToday {
  date: string;
  cycle_day: number;
  cycle_week: number;
  day_of_week: string;
  meals: Record<string, PublicMenuCycleSlot[]>;
  service_status?: PublicMenuServiceStatus;
}

export interface MealPeriod {
  id: string;
  meal: string;
  label: string;
  open_hour?: number | null;
  close_hour?: number | null;
  rate?: number | string | null;
  sort_order?: number | null;
}

export interface MenuSuggestion {
  id: string;
  source: string;
  cycle_day: number;
  meal_period: string;
  slot_name: string;
  suggested_item: string;
  notes?: string | null;
  submitted_by: string;
  status: 'new' | 'reviewed' | 'applied' | 'dismissed';
  created_at: string;
}

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

  async getUserPassword(id: string): Promise<any> {
    return req(`/api/users/${id}/credentials`);
  },

  async getRoleScopes(): Promise<{ scopes: Record<string, string[]>; available: string[] }> {
    return req('/api/users/role-scopes');
  },

  async updateRoleScopes(scopes: Record<string, string[]>): Promise<{ scopes: Record<string, string[]>; available: string[] }> {
    return req('/api/users/role-scopes', { method: 'PUT', body: JSON.stringify({ scopes }) });
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
  async getInventory(month?: number, year?: number): Promise<InventoryResponse> {
    const params = new URLSearchParams();
    if (month !== undefined) params.set('month', String(month));
    if (year !== undefined) params.set('year', String(year));
    const qs = params.toString();
    return req<InventoryResponse>(`/api/inventory${qs ? '?' + qs : ''}`);
  },

  async saveInventory(body: { items: unknown; metadata?: Record<string, unknown> }): Promise<InventoryResponse> {
    return req<InventoryResponse>('/api/inventory', { method: 'POST', body: JSON.stringify(body) });
  },

  async stageWeeklyPull(body: {
    month: number;
    year: number;
    week: number;
    items: Array<{ sku: string; desc: string; qty: number; price: number; category?: string; unit?: string }>;
    note?: string;
  }): Promise<any> {
    const itemCount = body.items.length;
    return req('/api/staging', {
      method: 'POST',
      body: JSON.stringify({
        entity_type: 'inventory',
        entity_id: `pull/${body.year}/${body.month}/w${body.week}`,
        field_name: 'pull_sheet',
        change_type: 'update',
        operation: 'inventory_week_update',
        summary: `Pull sheet W${body.week} — ${itemCount} item${itemCount !== 1 ? 's' : ''}`,
        full_payload: {
          month: body.month,
          year: body.year,
          week: body.week,
          direction: 'issued',
          overwrite: true,
          overwrite_scope: {
            kind: 'week',
            label: `W${body.week} issued`,
            month: body.month,
            year: body.year,
            week: body.week,
            direction: 'issued',
          },
          review_new: true,
          items: body.items,
          notes: body.note || '',
        },
      }),
    });
  },

  async stageMonthlyInvoiceTotals(body: {
    month: number;
    year: number;
    weeks: Record<string, number>;
    notes?: Record<string, string>;
  }): Promise<any> {
    const total = Object.values(body.weeks).reduce((sum, value) => sum + Number(value || 0), 0);
    return req('/api/staging', {
      method: 'POST',
      body: JSON.stringify({
        entity_type: 'inventory',
        entity_id: `invoice-totals/${body.year}/${body.month}`,
        field_name: 'monthly_invoice_totals',
        change_type: 'update',
        operation: 'monthly_invoice_totals_update',
        summary: `Invoice totals ${body.month}/${body.year}`,
        new_value: `$${total.toFixed(2)}`,
        full_payload: {
          month: body.month,
          year: body.year,
          weekly_invoice_totals: {
            source: 'manager_entered',
            weeks: body.weeks,
            total,
            notes: body.notes || {},
          },
        },
      }),
    });
  },

  async updateInventoryItem(sku: string, body: { par?: number; unit?: string }): Promise<any> {
    return req(`/api/inventory/items/${encodeURIComponent(sku)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
  },

  // Post-session inventory auditor (logical-issue findings written after each commit)
  async getInventoryAudit(month: number, year: number): Promise<AuditReport> {
    return req(`/api/inventory/audit?month=${month}&year=${year}`);
  },

  async runInventoryAudit(month: number, year: number): Promise<{ month: number; year: number; findings: number }> {
    return req(`/api/inventory/audit?month=${month}&year=${year}`, { method: 'POST' });
  },

  async getInventoryHistory(limit?: number): Promise<InventoryResponse[]> {
    const q = limit ? `?limit=${limit}` : '';
    return req<InventoryResponse[]>(`/api/inventory/history${q}`);
  },

  async getReorders(): Promise<LowStockItem[]> {
    return req<LowStockItem[]>('/api/inventory/reorders');
  },

  async getInventoryItems(params?: { sku?: string; sku_pending?: boolean; needs_attention?: boolean; category_id?: string; limit?: number }): Promise<InventoryCatalogItem[]> {
    const p = new URLSearchParams();
    if (params?.sku) p.set('sku', params.sku);
    if (params?.sku_pending !== undefined) p.set('sku_pending', String(params.sku_pending));
    if (params?.needs_attention !== undefined) p.set('needs_attention', String(params.needs_attention));
    if (params?.category_id) p.set('category_id', params.category_id);
    if (params?.limit !== undefined) p.set('limit', String(params.limit));
    const qs = p.toString();
    return req<InventoryCatalogItem[]>(`/api/inventory/items${qs ? '?' + qs : ''}`);
  },

  async mergeInventoryItems(keepId: string, removeId: string): Promise<any> {
    return req('/api/inventory/merge', {
      method: 'POST',
      body: JSON.stringify({ keep_id: keepId, remove_id: removeId }),
    });
  },

  async adminPatchInventoryItem(sku: string, body: { par?: number; unit?: string; desc?: string; category?: string; price?: number; active?: boolean; new_sku?: string }): Promise<any> {
    return req(`/api/inventory/items/${encodeURIComponent(sku)}`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
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

  async getMonthStatus(month: number, year: number): Promise<{ month: number; year: number; status: string; published: boolean }> {
    return req(`/api/inventory/month-status?month=${month}&year=${year}`);
  },

  async performRollover(message?: string): Promise<{ ok: boolean; result: any }> {
    return req('/api/inventory/rollover', { method: 'POST', body: JSON.stringify({ message: message ?? null }) });
  },

  async getWeekStatus(month: number, year: number): Promise<Array<{ week: number; status: string; locked_by: string | null; locked_at: string | null }>> {
    return req(`/api/inventory/week-status?month=${month}&year=${year}`);
  },

  async setWeekStatus(month: number, year: number, week: number, status: string): Promise<{ ok: boolean }> {
    return req('/api/inventory/week-status', { method: 'POST', body: JSON.stringify({ month, year, week, status }) });
  },

  async getMyStagingEntries(): Promise<{ count: number; entries: any[] }> {
    return req('/api/staging/mine');
  },

  // Menu (legacy — kept for compat; saveMenu is 410 on the backend now)
  async getMenu(day: string): Promise<any> {
    return req(`/api/menu/${encodeURIComponent(day)}`);
  },

  async saveMenu(day: string, body: any): Promise<any> {
    return req(`/api/menu/${encodeURIComponent(day)}`, { method: 'POST', body: JSON.stringify(body) });
  },

  // Menu — 28-day cycle editor
  async getMenuCycleOverview(): Promise<MenuCycleOverview> {
    return req('/api/menu/cycle/overview');
  },

  // Public, unauthenticated — all 28 days + dishes in one call (dashboard previews)
  async getPublicMenuCycle(): Promise<PublicMenuCycle> {
    const res = await fetch(`${BASE}/api/public/menu/cycle`, { cache: 'no-store' });
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
    return res.json();
  },

  async getPublicMenuToday(): Promise<PublicMenuToday> {
    const res = await fetch(`${BASE}/api/public/menu/today`, { cache: 'no-store' });
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
    return res.json();
  },

  async getPublicMenuStats(limit = 8): Promise<PublicMenuStats> {
    const res = await fetch(`${BASE}/api/public/menu/stats?limit=${encodeURIComponent(String(limit))}`, { cache: 'no-store' });
    if (!res.ok) throw new ApiError(res.status, await res.text().catch(() => res.statusText));
    return res.json();
  },

  async getMenuCycleDay(n: number): Promise<MenuCycleDay> {
    return req(`/api/menu/cycle/day/${n}`);
  },

  async getMenuToday(): Promise<MenuCycleDay & { date: string; cycle_day: number }> {
    return req('/api/menu/today');
  },

  async updateMenuSlot(recordId: string, body: { item_id?: string; item_name?: string; active?: boolean }): Promise<MenuSlot> {
    return req(`/api/menu/slot/${encodeURIComponent(recordId)}`, { method: 'PUT', body: JSON.stringify(body) });
  },

  async addMenuSlot(day: number, body: { meal_group: string; meal_period: string; slot_name: string; item_id?: string; item_name?: string; slot_order?: number }): Promise<MenuSlot> {
    return req(`/api/menu/cycle/day/${day}/slots`, { method: 'POST', body: JSON.stringify(body) });
  },

  async searchMenuItems(q: string): Promise<Array<{ id: string; name: string; active: boolean }>> {
    return req(`/api/menu/items?q=${encodeURIComponent(q)}`);
  },

  async getMenuSettings(): Promise<{ anchor_date: string }> {
    return req('/api/menu/settings');
  },

  async saveMenuSettings(anchor_date: string): Promise<{ anchor_date: string }> {
    return req('/api/menu/settings', { method: 'PUT', body: JSON.stringify({ anchor_date }) });
  },

  async getMenuSuggestions(status?: string): Promise<MenuSuggestion[]> {
    const q = status ? `?status=${encodeURIComponent(status)}` : '';
    return req(`/api/menu/suggestions${q}`);
  },

  async updateMenuSuggestion(id: string, status: MenuSuggestion['status']): Promise<MenuSuggestion> {
    return req(`/api/menu/suggestions/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify({ status }) });
  },

  // Events
  async getEvents(): Promise<any[]> {
    return req('/api/events');
  },

  async createEvent(body: any): Promise<any> {
    return req('/api/events', { method: 'POST', body: JSON.stringify(body) });
  },

  async deleteEvent(id: string | number): Promise<{ deleted: boolean; id: string }> {
    return req(`/api/events/${id}`, { method: 'DELETE' });
  },

  // Opening Checklist
  async getOpeningChecklist(): Promise<any[]> {
    return req('/api/opening-checklist');
  },

  // ServSafe Certifications
  async getServSafe(): Promise<any[]> {
    return req('/api/servsafe');
  },

  async updateServSafe(id: string | number, body: any): Promise<any> {
    return req(`/api/servsafe/${id}`, { method: 'PUT', body: JSON.stringify(body) });
  },

  // Meal Periods
  async getMealPeriods(): Promise<MealPeriod[]> {
    return req('/api/meal-periods');
  },

  async updateMealPeriod(id: string, body: { label?: string; open_hour?: number; close_hour?: number; sort_order?: number }): Promise<MealPeriod> {
    return req(`/api/meal-periods/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(body) });
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

  async createCategory(name: string, sort_order?: number): Promise<any> {
    return req('/api/inventory-categories', {
      method: 'POST', body: JSON.stringify({ name, sort_order: sort_order ?? null }),
    });
  },

  async updateCategory(id: string, name: string, sort_order?: number): Promise<any> {
    return req(`/api/inventory-categories/${encodeURIComponent(id)}`, {
      method: 'PATCH', body: JSON.stringify({ name, sort_order: sort_order ?? null }),
    });
  },

  async deleteCategory(id: string): Promise<void> {
    return req(`/api/inventory-categories/${encodeURIComponent(id)}`, { method: 'DELETE' });
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

  // Flow (task assignments)
  async getFlowAssignments(opts?: { status?: string; all?: boolean }): Promise<FlowAssignment[]> {
    const params = new URLSearchParams();
    if (opts?.status) params.set('status', opts.status);
    if (opts?.all) params.set('all', 'true');
    const qs = params.toString();
    return req(`/api/flow/assignments${qs ? '?' + qs : ''}`);
  },

  async createFlowAssignment(body: {
    title: string;
    description?: string;
    assigned_to?: string;
    assigned_to_role?: string;
    priority?: 'low' | 'normal' | 'high' | 'urgent';
    due_date?: string;
    link_type?: string;
    link_key?: string;
    link_params?: Record<string, unknown>;
  }): Promise<FlowAssignment> {
    return req('/api/flow/assignments', { method: 'POST', body: JSON.stringify(body) });
  },

  async updateFlowAssignment(id: string, body: Partial<{
    title: string;
    description: string;
    priority: 'low' | 'normal' | 'high' | 'urgent';
    due_date: string;
    assigned_to: string;
    assigned_to_role: string;
    status: 'open' | 'in_progress' | 'done' | 'cancelled';
  }>): Promise<FlowAssignment> {
    return req(`/api/flow/assignments/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteFlowAssignment(id: string): Promise<void> {
    await req(`/api/flow/assignments/${id}`, { method: 'DELETE' });
  },

  // Cost Manager
  async getCostBudget(month: number, year: number): Promise<CostBudget | null> {
    return req(`/api/cost/budget?month=${month}&year=${year}`);
  },

  async saveCostBudget(body: {
    month: number;
    year: number;
    gov_allotment: number;
    w1_planned_pull?: number;
    w2_planned_pull?: number;
    w3_planned_pull?: number;
    w1_planned_renewable?: number;
    w2_planned_renewable?: number;
    w3_planned_renewable?: number;
    notes?: string;
  }): Promise<CostBudget> {
    return req('/api/cost/budget', { method: 'POST', body: JSON.stringify(body) });
  },

  async getCostSummary(month: number, year: number): Promise<CostSummary> {
    return req(`/api/cost/summary?month=${month}&year=${year}`);
  },

  async getCostTrend(month: number, year: number, months = 6): Promise<CostTrendPoint[]> {
    return req(`/api/cost/trend?month=${month}&year=${year}&months=${months}`);
  },

  async getCostAverages(months = 6): Promise<CostAverages> {
    return req(`/api/cost/averages?months=${months}`);
  },

  // Source Control
  async getCommits(limit = 50, offset = 0): Promise<Commit[]> {
    return req(`/api/commits?limit=${limit}&offset=${offset}`);
  },

  async getTransactions(params?: { limit?: number; offset?: number; action?: string; month?: number; year?: number }): Promise<SourceTransaction[]> {
    const p = new URLSearchParams();
    p.set('limit', String(params?.limit ?? 300));
    p.set('offset', String(params?.offset ?? 0));
    if (params?.action) p.set('action', params.action);
    if (params?.month !== undefined) p.set('month', String(params.month));
    if (params?.year !== undefined) p.set('year', String(params.year));
    return req(`/api/transactions?${p.toString()}`);
  },

  async getStaging(entityType?: string): Promise<StagingEntry[]> {
    const q = entityType ? `?entity_type=${encodeURIComponent(entityType)}` : '';
    return req(`/api/staging${q}`);
  },

  async submitStaging(body: SubmitStagingBody): Promise<StagingEntry> {
    const result = await req('/api/staging', { method: 'POST', body: JSON.stringify(body) });
    window.dispatchEvent(new CustomEvent('mjcc:staging-changed'));
    return result as StagingEntry;
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
    await ensureFreshBackendAuth();
    return req('/api/commits', { method: 'POST', body: JSON.stringify(body) });
  },

  // GitHub archive sync — drains github_sync_queue (queued automatically after
  // every commit) and pushes pending snapshots to the data-archive repo.
  async runGithubSync(): Promise<{ ok: boolean; message: string }> {
    return req('/api/github-sync/run', { method: 'POST' });
  },

  async getGithubSyncStatus(): Promise<{ total: number; synced: number; pending: number; failed: number; recent?: Array<{ id: string; operation?: string; commit_id?: string; attempts?: number; last_error?: string; synced_at?: string; created_at?: string }> }> {
    return req('/api/github-sync/status');
  },

  async rejectStaging(id: string, reviewNote?: string): Promise<void> {
    const qs = reviewNote ? `?review_note=${encodeURIComponent(reviewNote)}` : '';
    return req(`/api/staging/${id}${qs}`, { method: 'DELETE' });
  },

  async unstageMany(ids: string[], reviewNote?: string): Promise<{ rejected: number }> {
    // Use raw fetch — bypasses req()'s auto-logout-on-401 so a transient
    // server error during deploy doesn't kill the user's session.
    const token = getBackendToken();
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(BASE + '/api/staging', {
      method: 'DELETE',
      headers,
      cache: 'no-store',
      body: JSON.stringify({ entry_ids: ids, review_note: reviewNote ?? 'Unstaged by user' }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(res.status, body?.detail || `Unstage failed (${res.status})`);
    }
    const data = await res.json();
    window.dispatchEvent(new CustomEvent('mjcc:live-data-changed', { detail: { path: '/api/staging' } }));
    return data;
  },

  // Pull Requests
  async openPull(body: { title: string; description?: string; entry_ids?: string[] }): Promise<any> {
    return req('/api/pulls', { method: 'POST', body: JSON.stringify(body) });
  },

  async getPulls(status = 'open', limit = 50, offset = 0): Promise<any[]> {
    const p = new URLSearchParams({ status, limit: String(limit), offset: String(offset) });
    return req(`/api/pulls?${p.toString()}`);
  },

  async getPull(prId: string): Promise<any> {
    return req(`/api/pulls/${encodeURIComponent(prId)}`);
  },

  async mergePull(prId: string): Promise<any> {
    await ensureFreshBackendAuth();
    return req(`/api/pulls/${encodeURIComponent(prId)}/merge`, { method: 'POST' });
  },

  async closePull(prId: string, note?: string): Promise<any> {
    return req(`/api/pulls/${encodeURIComponent(prId)}/close`, {
      method: 'POST',
      body: JSON.stringify({ note: note ?? null }),
    });
  },

  // Data Entry
  async uploadDataEntry(file: File, hint: string, month?: number, year?: number, week?: number, direction?: string, description?: string, signal?: AbortSignal, overwrite?: boolean): Promise<{ batch_id: string; staged_count: number; staging_ids?: string[]; sku_queued?: number; operations: Record<string, number>; file: string; month: number; year: number; description?: string; reconciliation?: any; ai_provider?: string; ai_model?: string; overwrite?: boolean; overwrite_scope?: any }> {
    markSessionActivity();
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
    if (description?.trim()) form.append('description', description.trim());
    if (overwrite !== undefined) form.append('overwrite', String(overwrite));
    const res = await fetch(BASE + '/api/data-entry/upload', { method: 'POST', headers, body: form, signal, cache: 'no-store' });
    if (!res.ok) {
      let body: string;
      try { const json = await res.json(); body = json.detail || JSON.stringify(json); }
      catch { body = await res.text().catch(() => res.statusText); }
      throw new ApiError(res.status, body);
    }
    // Backend streams SSE to keep the connection alive during long AI parse jobs.
    // Consume the stream, ignoring heartbeat comments, resolving on the data event.
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('text/event-stream')) {
      return new Promise((resolve, reject) => {
        const reader = res.body!.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        const pump = async () => {
          try {
            for (;;) {
              const { done, value } = await reader.read();
              if (done) { reject(new ApiError(503, 'Stream ended before result was received')); return; }
              markSessionActivity();
              buf += decoder.decode(value, { stream: true });
              const events = buf.split('\n\n');
              buf = events.pop()!;
              for (const evt of events) {
                const dataLine = evt.split('\n').find(l => l.startsWith('data: '));
                if (!dataLine) continue; // SSE comment / heartbeat
                const data = JSON.parse(dataLine.slice(6));
                if (!data.__ok) {
                  reader.cancel().catch(() => {});
                  // Preserve status + detail so DataEntry's error-type switches work
                  const err = new ApiError(data.status ?? 422, data.detail ?? 'Upload failed');
                  reject(err);
                  return;
                }
                reader.cancel().catch(() => {});
                // eslint-disable-next-line @typescript-eslint/no-unused-vars
                const { __ok, ...result } = data;
                markSessionActivity();
                window.dispatchEvent(new CustomEvent('mjcc:live-data-changed', { detail: { path: '/api/data-entry/upload' } }));
                resolve(result as any);
                return;
              }
            }
          } catch (e) { reject(e); }
        };
        pump();
      });
    }
    const data = await res.json();
    window.dispatchEvent(new CustomEvent('mjcc:live-data-changed', { detail: { path: '/api/data-entry/upload' } }));
    return data;
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

  async updateMyPassword(body: { new_password: string }): Promise<any> {
    return req('/api/users/me/password', { method: 'PUT', body: JSON.stringify(body) });
  },

  async updateMyPin(body: { new_pin: string }): Promise<any> {
    return req('/api/users/me/pin', { method: 'PUT', body: JSON.stringify(body) });
  },

  async uploadMyAvatar(file: File): Promise<any> {
    const token = getBackendToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;

    const form = new FormData();
    form.append('file', file);

    const res = await fetch(BASE + '/api/users/me/avatar', {
      method: 'POST',
      headers,
      body: form,
      cache: 'no-store',
    });

    if (res.status === 401) {
      clearBackendToken();
      window.dispatchEvent(new CustomEvent('mjc:session-expired', { detail: { reason: 'unauthorized' } }));
      throw new ApiError(401, 'Session expired');
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

    const data = await res.json();
    window.dispatchEvent(new CustomEvent('mjcc:live-data-changed', { detail: { path: '/api/users/me/avatar' } }));
    return data;
  },

  // AI key management (sudo only)
  async getAIKeys(): Promise<Array<{ provider: string; is_active: boolean; has_key: boolean; base_url: string | null; updated_at: string | null }>> {
    return req('/api/data-entry/ai-keys');
  },

  async updateAIKey(provider: string, body: { api_key?: string; base_url?: string; is_active?: boolean }): Promise<any> {
    return req(`/api/data-entry/ai-keys/${encodeURIComponent(provider)}`, { method: 'PUT', body: JSON.stringify(body) });
  },

  async getAIModels(provider: string): Promise<{ provider: string; models: Array<{ id: string; label: string; vision: boolean }> }> {
    return req(`/api/data-entry/models?provider=${encodeURIComponent(provider)}`);
  },

  async createAIKey(body: { provider: string; label: string; api_key?: string; base_url?: string; model_override?: string; set_active?: boolean }): Promise<any> {
    return req('/api/data-entry/ai-keys', { method: 'POST', body: JSON.stringify(body) });
  },

  async updateAIKeyById(id: string, body: { label?: string; api_key?: string; base_url?: string; model_override?: string; is_active?: boolean }): Promise<any> {
    return req(`/api/data-entry/ai-keys/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(body) });
  },

  async deleteAIKey(id: string): Promise<void> {
    return req(`/api/data-entry/ai-keys/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async setAIStack(body: { provider: string; key_id: string; model: string; vision_capable?: boolean }): Promise<any> {
    return req('/api/data-entry/ai-stack', { method: 'POST', body: JSON.stringify(body) });
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

  // Automations — stored server-side in app_settings keyed by user
  async getAutomations(): Promise<any[]> {
    try { const d: any = await req('/api/agent/automations'); return d.automations || []; }
    catch { return []; }
  },
  async saveAutomations(automations: any[]): Promise<void> {
    await req('/api/agent/automations', { method: 'PUT', body: JSON.stringify({ automations }) });
  },
  async runAutomation(prompt: string): Promise<{ response: string; tool_calls: any[] }> {
    return req('/api/agent/chat', { method: 'POST', body: JSON.stringify({ message: prompt }) });
  },

  // SKU Review Queue (manager+)
  async getSKUReview(status = 'pending', limit = 100): Promise<any[]> {
    const p = new URLSearchParams({ status, limit: String(limit) });
    return req(`/api/sku-review?${p.toString()}`);
  },

  async resolveSKU(rowId: string, body: {
    resolution: 'new_item' | 'alias_existing' | 'override_existing';
    item_id?: string;
    new_sku?: string;
    new_desc?: string;
    new_category?: string;
  }): Promise<any> {
    return req(`/api/sku-review/${encodeURIComponent(rowId)}/resolve`, {
      method: 'POST',
      body: JSON.stringify(body),
    });
  },

};
