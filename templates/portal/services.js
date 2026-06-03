/* ══════════════════════════════════════════════════════════════
   DATA SOURCE — the single seam between the frontend and the backend.
   Every module reads its data through window.DS.* (never from inline
   constants). Today each accessor returns the demo/seed provider; to go
   live, replace the body with a fetch() to the FastAPI / Supabase backend
   — no component changes required.

   Log-backed accessors read the real records the user has entered
   (localStorage 'mjc_log_*', the same store saveLog uses), so reports and
   dashboards reflect actual data, not hardcoded values.
═══════════════════════════════════════════════════════════════ */
window.DS = {
  /* current provider — 'live' once a backend is connected, else 'demo' */
  source(){ return window.isConnected && window.isConnected() ? 'live' : 'demo'; },

  /* ── reference / seed datasets (backend: GET endpoints) ── */
  events(){ return window.EVENTS || []; },
  catMeta(){ return window.CAT_META || {}; },
  servsafe(){ return window.SERVSAFE_STAFF || []; },
  cycleMenu(){ return window.CYCLE_MENU || {}; },
  menuSides(){ return window.MENU_SIDES || {}; },
  openingChecklist(){ return window.OPENING_CHECKLIST || []; },
  mealSchedule(){ return window.MEAL_SCHEDULE || []; },
  incidentTypes(){ return window.INCIDENT_TYPES || []; },
  snackHours(){ return window.SNACK_HOURS || []; },
  mealRates(){ return window.MEAL_RATES || []; },
  mealTypes(){ return window.MEAL_TYPES || []; },
  submitTypes(){ return window.SUBMIT_TYPES || []; },
  staged(){ return (window.STAGED_CHANGES || []).map(s=>({ ...s })); },
  commits(){ return (window.COMMITS || []).map(c=>({ ...c })); },
  invoices(period){ return (window.MONTHLY_INVOICES || []).map(i=>({ ...i })); },

  /* ── inventory (backend: GET /inventory?period=) ──
     Accepts a live snapshot when the portal has one; otherwise falls back
     to the demo provider for the requested period. */
  inventoryList(inv, period){
    const src = inv || (window.demoInvFor ? window.demoInvFor(period[0], period[1]) : {});
    return window.invToList ? window.invToList(src) : [];
  },
  monthlyRollup(inv, period){
    return this.inventoryList(inv, period).map(it=>({
      id: it.id || String(it.sku||Math.random()),
      cat: it.cat, item: it.desc, price: it.price || 0,
      opening: it.onHand || 0,
      received: (it.w1r||0)+(it.w2r||0)+(it.w3r||0)+(it.w4r||0),
      issued: 0,
    }));
  },

  /* ── log store (real entered records) ──
     loadLog/saveLog persist under 'mjc_log_<key>'. logs(prefix) returns
     every saved record whose key starts with <prefix>. Backend: swap for
     GET /logs?prefix=. */
  logKeys(prefix){
    const out = [], p = 'mjc_log_' + (prefix||'');
    try{
      for(let i=0;i<localStorage.length;i++){
        const k = localStorage.key(i);
        if(k && k.indexOf(p)===0) out.push(k.slice('mjc_log_'.length));
      }
    }catch(e){}
    return out.sort();
  },
  logs(prefix){
    return this.logKeys(prefix).map(key=>({ key, data: window.loadLog ? window.loadLog(key, null) : null }))
      .filter(x=>x.data);
  },

  /* ── export helpers ── */
  toCSV(columns, rows){
    const esc = v => { v = (v==null?'':String(v)); return /[",\n]/.test(v) ? '"'+v.replace(/"/g,'""')+'"' : v; };
    const head = columns.map(c=>esc(c.label)).join(',');
    const body = rows.map(r=>columns.map(c=>esc(typeof c.get==='function'?c.get(r):r[c.key])).join(',')).join('\n');
    return head + '\n' + body;
  },
  download(filename, text, mime){
    try{
      const blob = new Blob([text], { type: mime || 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = filename;
      document.body.appendChild(a); a.click();
      setTimeout(()=>{ URL.revokeObjectURL(url); a.remove(); }, 120);
      window.toast && window.toast('Downloaded ' + filename);
    }catch(e){ window.toast && window.toast('Download failed'); }
  },
};
