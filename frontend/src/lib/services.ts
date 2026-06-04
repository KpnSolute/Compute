import { api } from './api';

const cache = new Map<string, { data: any; ts: number }>();
const CACHE_TTL = 30000;

function cached<T>(key: string, defaultVal: T): T {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.ts < CACHE_TTL) return hit.data as T;
  return defaultVal;
}

async function populate<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  const data = await fetcher();
  cache.set(key, { data, ts: Date.now() });
  return data;
}

export const DS = {
  source() {
    return 'live';
  },

  async events() {
    return populate('events', () => api.getEvents());
  },
  async cycleMenu() {
    return populate('cycleMenu', async () => {
      const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
      const results: Record<string, any> = {};
      for (const day of days) {
        try {
          const menu = await api.getMenu(day);
          results[day.toLowerCase()] = menu?.data || null;
        } catch {
          results[day.toLowerCase()] = null;
        }
      }
      return results;
    });
  },
  async openingChecklist() {
    return populate('opening_checklist', () => api.getOpeningChecklist());
  },
  async mealSchedule() {
    return populate('meal_schedule', () => api.getMealPeriods());
  },
  catMeta() {
    return populate('catMeta', () => api.getInventoryCategories().then(cats => {
      const m: Record<string, any> = {};
      cats.forEach(c => m[c.name] = { label: c.name, color: c.color, bg: c.color + '20', dot: c.color });
      return m;
    }));
  },
  async servsafe() {
    return populate('servsafe', () => api.getServSafe());
  },
  incidentTypes() {
    return ['Safety', 'Behavior', 'Medical', 'Facility', 'Other'];
  },
  async snackHours() {
    return populate('snackHours', () => api.getMealPeriods().then(periods =>
      periods.map(p => ({ day: p.label, open: String(p.open_hour || 0), close: String(p.close_hour || 0) }))
    ));
  },
  async mealRates() {
    return populate('mealRates', () => api.getMealPeriods().then(periods =>
      periods.map(p => ({ type: p.label, rate: p.rate }))
    ));
  },
  async mealTypes() {
    return populate('mealTypes', () => api.getMealPeriods().then(periods =>
      periods.map(p => ({ key: p.meal, label: p.label }))
    ));
  },
  submitTypes() {
    return ['inventory', 'menu', 'user', 'compliance', 'event', 'ops'];
  },

  async staged() {
    return populate('staged', () => api.getStaging());
  },
  async commits() {
    return populate('commits', () => api.getCommits());
  },
  async invoices(period: [number, number]) {
    return populate('invoices', () => api.getInvoices(period[0], period[1]));
  },

  /* ── sync cache accessors (call after async methods have been awaited) ── */
  syncEvents() {
    return cached<any[]>('events', []);
  },
  syncCycleMenu() {
    return cached<any>('cycleMenu', {});
  },
  syncStaged() {
    return cached<any[]>('staged', []);
  },
  syncCommits() {
    return cached<any[]>('commits', []);
  },
  syncOpeningChecklist() {
    return cached<any[]>('opening_checklist', []);
  },
  syncMealSchedule() {
    return cached<any[]>('meal_schedule', []);
  },
  syncServSafe() { return cached<any[]>('servsafe', []); },
  syncCatMeta() { return cached<any>('catMeta', {}); },
  syncInvoices() { return cached<any[]>('invoices', []); },
  syncSnackHours() { return cached<any[]>('snackHours', []); },
  syncMealRates() { return cached<any[]>('mealRates', []); },
  syncMealTypes() { return cached<any[]>('mealTypes', []); },

  /* ── export helpers ── */
  toCSV(columns: { label: string; key?: string; get?: (r: any) => any }[], rows: any[]) {
    const esc = (v: any) => {
      v = v == null ? '' : String(v);
      return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
    };
    const head = columns.map((c) => esc(c.label)).join(',');
    const body = rows
      .map((r) => columns.map((c) => esc(typeof c.get === 'function' ? c.get(r) : r[c.key!])).join(','))
      .join('\n');
    return head + '\n' + body;
  },
  download(filename: string, text: string, mime?: string) {
    try {
      const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      setTimeout(() => {
        URL.revokeObjectURL(url);
        a.remove();
      }, 120);
    } catch (e) {
      console.warn('Download failed:', e);
    }
  },
};
