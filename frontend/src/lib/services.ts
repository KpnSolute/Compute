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
    return populate('opening_checklist', () => api.getDailyLogs(50, 'opening_checklist'));
  },
  async mealSchedule() {
    return populate('meal_schedule', () => api.getDailyLogs(50, 'meal_schedule'));
  },
  catMeta() {
    return {};
  },
  servsafe() {
    return [];
  },
  incidentTypes() {
    return ['Safety', 'Behavior', 'Medical', 'Facility', 'Other'];
  },
  snackHours() {
    return [
      { day: 'Monday', open: '07:00', close: '14:30' },
      { day: 'Tuesday', open: '07:00', close: '14:30' },
      { day: 'Wednesday', open: '07:00', close: '14:30' },
      { day: 'Thursday', open: '07:00', close: '14:30' },
      { day: 'Friday', open: '07:00', close: '14:30' },
    ];
  },
  mealRates() {
    return [
      { type: 'Student', breakfast: 2.50, lunch: 4.00, dinner: 5.50 },
      { type: 'Staff', breakfast: 3.50, lunch: 5.50, dinner: 7.00 },
      { type: 'Visitor', breakfast: 4.00, lunch: 6.50, dinner: 8.50 },
    ];
  },
  mealTypes() {
    return ['Breakfast', 'Lunch', 'Dinner', 'Snack', 'Brunch'];
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
  invoices(_period: [number, number]) {
    return [];
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
