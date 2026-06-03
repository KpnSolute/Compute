import { isConnected, loadLog, invToList } from './supabase';

export const DS = {
  /* current provider — 'live' once a backend is connected, else 'demo' */
  source() {
    return isConnected() ? 'live' : 'demo';
  },

  /* ── reference / seed datasets (backend: GET endpoints) ── */
  // These would typically fetch from Supabase in a real app
  // For now, they return from window if available, or empty
  events() {
    return (window as any).EVENTS || [];
  },
  catMeta() {
    return (window as any).CAT_META || {};
  },
  servsafe() {
    return (window as any).SERVSAFE_STAFF || [];
  },
  cycleMenu() {
    return (window as any).CYCLE_MENU || {};
  },
  menuSides() {
    return (window as any).MENU_SIDES || {};
  },
  openingChecklist() {
    return (window as any).OPENING_CHECKLIST || [];
  },
  mealSchedule() {
    return (window as any).MEAL_SCHEDULE || [];
  },
  incidentTypes() {
    return (window as any).INCIDENT_TYPES || [];
  },
  snackHours() {
    return (window as any).SNACK_HOURS || [];
  },
  mealRates() {
    return (window as any).MEAL_RATES || [];
  },
  mealTypes() {
    return (window as any).MEAL_TYPES || [];
  },
  submitTypes() {
    return (window as any).SUBMIT_TYPES || [];
  },
  staged() {
    return ((window as any).STAGED_CHANGES || []).map((s: any) => ({ ...s }));
  },
  commits() {
    return ((window as any).COMMITS || []).map((c: any) => ({ ...c }));
  },
  invoices(_period: [number, number]) {
    return ((window as any).MONTHLY_INVOICES || []).map((i: any) => ({ ...i }));
  },

  /* ── inventory (backend: GET /inventory?period=) ── */
  inventoryList(inv: any, period: [number, number]) {
    const src = inv || ((window as any).demoInvFor ? (window as any).demoInvFor(period[0], period[1]) : {});
    return invToList(src);
  },
  monthlyRollup(inv: any, period: [number, number]) {
    return this.inventoryList(inv, period).map((it: any) => ({
      id: it.id || String(it.sku || Math.random()),
      cat: it.cat,
      item: it.desc,
      price: it.price || 0,
      opening: it.onHand || 0,
      received: (it.w1r || 0) + (it.w2r || 0) + (it.w3r || 0) + (it.w4r || 0),
      issued: 0,
    }));
  },

  /* ── log store (real entered records) ── */
  logKeys(prefix: string) {
    const out: string[] = [];
    const p = 'mjc_log_' + (prefix || '');
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.indexOf(p) === 0) out.push(k.slice('mjc_log_'.length));
      }
    } catch (e) {}
    return out.sort();
  },
  logs(prefix: string) {
    return this.logKeys(prefix)
      .map((key) => ({ key, data: loadLog(key, null) }))
      .filter((x) => x.data);
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
      (window as any).toast && (window as any).toast('Downloaded ' + filename);
    } catch (e) {
      (window as any).toast && (window as any).toast('Download failed');
    }
  },
};
