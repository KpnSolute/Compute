import { useState, useEffect, useCallback } from 'react';
import { I, KpnMark } from '../lib/icons';
import {
  type User, ROLE_LEVEL, ROLE_LABEL, MONTHS, NAV, DOW_FULL, DOW_KEYS, USERS
} from '../lib/constants';
import { DS } from '../lib/services';
import {
  isConnected,
  realLogout, loadLog, fetchInventory,
  fetchProfiles, invToList, catTotals, reorders, iTotal,
  grandTotal, fmtMoney, fmtMoneyFull, catColor
} from '../lib/supabase';
import { SupaSetupModal } from './Login';
import { ComplianceHub } from './ComplianceHub';
import { DailyOps } from './DailyOps';
import { EventsCalendar } from './EventsCalendar';
import { MealLog, InspectionSheet, FoodRequest } from './Forms';
import { CycleMenu } from './CycleMenu';
import { SnackBar, MonthlyInventory } from './Operations';
import { SourceControl } from './SourceControl';
import { Reports } from './Reports';

let toastTimer: ReturnType<typeof setTimeout>;
function toast(msg: string) {
  let t = document.getElementById('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.appendChild(t); }
  t.innerHTML = '';
  const span = document.createElement('span');
  span.textContent = msg;
  t.appendChild(span);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 2600);
}
(window as any).toast = toast;

const initials = (u: User) =>
  ((u.display_name?.[0] || '') + (u.last_name?.[0] || '')).toUpperCase() ||
  (u.username || '?').slice(0, 2).toUpperCase();

const MEAL_ICON: Record<string, string> = {
  Breakfast: '\u{1F305}', Brunch: '\u{1F373}', Lunch: '\u{2600}\uFE0F',
  Dinner: '\u{1F319}', Snack: '\u{1F34E}'
};

function useInventory(connected: boolean): [any, () => Promise<void>] {
  const [state, setState] = useState({ loading: false, inv: null as any, syncedBy: null as string | null, syncedAt: null as string | null, error: null as string | null });
  const load = useCallback(async () => {
    if (!connected) { setState({ loading: false, inv: null, syncedBy: null, syncedAt: null, error: null }); return; }
    setState(s => ({ ...s, loading: true, error: null }));
    const res = await fetchInventory();
    if (res.ok) setState({ loading: false, inv: res.inv, syncedBy: res.syncedBy ?? null, syncedAt: res.syncedAt ?? null, error: res.inv ? null : 'empty' });
    else setState({ loading: false, inv: null, syncedBy: null, syncedAt: null, error: res.error });
  }, [connected]);
  useEffect(() => { load(); }, [load]);
  return [state, load];
}

function Topbar({ user, period, setPeriod, connected, syncState, onSync, onOpenSetup }: {
  user: User; period: [number, number]; setPeriod: (p: [number, number]) => void;
  connected: boolean; syncState: string; onSync: () => void; onOpenSetup: () => void;
}) {
  const [menu, setMenu] = useState(false);
  useEffect(() => {
    const close = () => setMenu(false);
    if (menu) { window.addEventListener('click', close); return () => window.removeEventListener('click', close); }
  }, [menu]);
  const [m, y] = period;
  let badgeClass = 'inv-badge', badgeText: string;
  if (!connected) { badgeClass += ' demo'; badgeText = 'Demo mode'; }
  else if (syncState === 'loading') { badgeClass += ' syncing'; badgeText = 'Syncing\u2026'; }
  else if (syncState === 'error') { badgeClass += ' err'; badgeText = 'Sync error'; }
  else badgeText = 'LIVE \u00B7 Supabase';

  return (
    <header className="topbar">
      <div className="tb-left">
        <span style={{ display: 'flex' }}><KpnMark size={26} /></span>
        <div>
          <div className="tb-title">Food Service Data Management</div>
          <div className="tb-sub">Inventory \u00B7 28-Day Menu \u00B7 Sourcing</div>
        </div>
      </div>
      <div className="tb-right">
        <span className={badgeClass} onClick={connected ? onSync : onOpenSetup} title={connected ? 'Click to refresh' : 'Click to connect'}>
          <span className="rt"></span>{badgeText}
        </span>
        <select className="tb-select" value={m} onChange={e => setPeriod([+e.target.value, y])}>
          {MONTHS.map((nm, i) => <option key={i} value={i}>{nm}</option>)}
        </select>
        <select className="tb-select" value={y} onChange={e => setPeriod([m, +e.target.value])}>
          {[2024, 2025, 2026].map(yr => <option key={yr} value={yr}>{yr}</option>)}
        </select>
        <div className="tb-user" onClick={e => { e.stopPropagation(); setMenu(v => !v); }}>
          <div className="avatar">{initials(user)}</div>
          <div className="hide-sm">
            <div className="nm">{user.display_name} {user.last_name}</div>
            <div className="rl">{ROLE_LABEL[user.role]}</div>
          </div>
          {menu && (
            <div className="usermenu" onClick={e => e.stopPropagation()}>
              <div className="um-head">
                <div className="nm">{user.display_name} {user.last_name}</div>
                <div className="em">{user.username}@mjc-cafeteria.com</div>
              </div>
              <button className="um-item">{I.user()} My profile</button>
              <button className="um-item" onClick={onOpenSetup}>{I.database()} Data source</button>
              <button className="um-item danger" onClick={() => { realLogout(); (window as any).__logout?.(); }}>{I.logout()} Sign out</button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function Sidebar({ user, active, setActive, reorderCount, stagedCount }: {
  user: User; active: string; setActive: (k: string) => void; reorderCount: number; stagedCount: number;
}) {
  const lvl = ROLE_LEVEL[user.role];
  return (
    <nav className="sidebar">
      {NAV.map(group => {
        const items = group.items.filter(it => lvl >= (it.min || 0));
        if (!items.length) return null;
        return (
          <div key={group.group}>
            <div className="nav-group-lbl">{group.group}</div>
            {items.map(it => (
              <button key={it.key} className="nav-item" data-active={active === it.key} onClick={() => setActive(it.key)}>
                {I[it.icon]()}
                <span>{it.label === 'Source Control' && lvl < 20 ? 'My Submissions' : it.label}</span>
                {it.key === 'inventory' && reorderCount > 0 && <span className="nb">{reorderCount}</span>}
                {it.key === 'sourcectrl' && stagedCount > 0 && <span className="nb">{stagedCount}</span>}
              </button>
            ))}
          </div>
        );
      })}
      <div className="sidebar-foot">
        Signed in as <b>{ROLE_LABEL[user.role]}</b><br />
        <span style={{ fontFamily: 'BlinkMacSystemFont' }}>KPN Food Service \u00B7 v3.0</span>
      </div>
    </nav>
  );
}

function Loading({ label = 'Loading live data\u2026' }) {
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}

function ConnectBanner({ onOpen }: { onOpen: () => void }) {
  return (
    <div className="banner info">
      {I.cloud()}
      <span>Showing demo data. Connect your Supabase project to see live inventory.</span>
      <span className="bx" onClick={onOpen}>Connect \u2192</span>
    </div>
  );
}

function Dashboard({ user, period, connected, invState, onSync, onOpenSetup, go }: {
  user: User; period: [number, number]; connected: boolean;
  invState: any; onSync: () => void; onOpenSetup: () => void; go: (k: string) => void;
}) {
  const lvl = ROLE_LEVEL[user.role];
  const live = connected ? invState.inv : (window as any).demoInvFor?.(period[0], period[1]);
  const todayISO = new Date().toISOString().slice(0, 10);

  let gt = 0, reorderList: any[] = [], catRows: any[] = [], itemCount = 0;
  if (live) {
    gt = grandTotal(live);
    reorderList = reorders(live);
    const ct = catTotals(live);
    const maxCat = ct.length ? ct[0].val : 1;
    itemCount = invToList(live).length;
    catRows = ct.slice(0, 7).map((c: any) => ({
      name: c.name, color: c.color, val: fmtMoney(c.val),
      pct: maxCat ? Math.max(4, Math.round(c.val / maxCat * 100)) : 0
    }));
  }

  const monRows = invToList(live || {}).map((it: any) => ({
    price: it.price || 0, opening: it.onHand || 0,
    received: (it.w1r || 0) + (it.w2r || 0) + (it.w3r || 0) + (it.w4r || 0), issued: 0,
  }));
  const miSum = monRows.reduce((a: any, r: any) => {
    a.open += r.opening * r.price; a.recv += r.received * r.price;
    a.close += Math.max(0, r.opening + r.received - r.issued) * r.price; return a;
  }, { open: 0, recv: 0, close: 0 });

  const dayKey = DOW_KEYS[new Date().getDay()];
  const menu: any = DS.cycleMenu()[dayKey] || {};
  const menuMeals = ['Breakfast', 'Brunch', 'Lunch', 'Dinner', 'Snack'].filter(m => menu[m] && menu[m].length);

  const ml = loadLog('meallog:' + todayISO, null);
  const mlRows = (ml && ml.rows) || [];
  const mlCount = (m: string) => mlRows.filter((r: any) => r[m[0]]).length;
  const mlTotals = {
    B: mlCount('B'), L: mlCount('L'), D: mlCount('D'),
    T: mlRows.filter((r: any) => r.ticket && !String(r.ticket).toUpperCase().includes('COMP')).length
  };

  const upcoming = DS.events().filter((e: any) => e.date >= todayISO).sort((a: any, b: any) => a.date.localeCompare(b.date));
  const nextEvent = upcoming[0];
  const invoices = DS.invoices(period);
  const invoiceTotal = invoices.reduce((s: number, i: any) => s + (i.total || 0), 0);
  const invoiceCount = invoices.length;

  const fmtShort = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  const KPIS = [
    { key: 'val', label: 'Inventory Value', icon: 'dollar', tint: '#1E73E8', bg: '#EFF5FE', val: fmtMoney(gt), sub: itemCount + ' line items', to: 'inventory' },
    { key: 'low', label: 'Below Par', icon: 'alert', tint: '#D97706', bg: '#FEF3C7', val: String(reorderList.length), sub: 'flagged for reorder', to: 'inventory' },
    { key: 'meals', label: 'Meals Logged', icon: 'users', tint: '#1B3A6B', bg: '#EEF2F8', val: String(mlTotals.B + mlTotals.L + mlTotals.D), sub: 'today', to: 'mballot' },
    { key: 'mi', label: 'Closing Value', icon: 'fileText', tint: '#0E7490', bg: '#ECFEFF', val: fmtMoney(miSum.close), sub: 'monthly inventory', to: 'moninv' },
    { key: 'inv', label: 'Invoices', icon: 'inbox', tint: '#059669', bg: '#F0FDF4', val: String(invoiceCount), sub: fmtMoney(invoiceTotal) + ' this month', to: 'moninv' },
    { key: 'evt', label: 'Next Event', icon: 'calCheck', tint: '#6D28D9', bg: '#EDE9FE', val: nextEvent ? fmtShort(nextEvent.date) : '\u2014', sub: nextEvent ? nextEvent.title : 'none scheduled', to: 'events', small: true },
  ];

  const QUICK = [
    { label: 'Log HACCP reading', icon: 'thermo', to: 'haccp' },
    { label: 'Log staff meal', icon: 'users', to: 'mballot' },
    { label: 'Food request form', icon: 'inbox', to: 'foodreq' },
    { label: 'Run inspection', icon: 'clipboard', to: 'inspection' },
    { label: 'Daily operations', icon: 'checkSquare', to: 'dailyops' },
    { label: 'Monthly inventory', icon: 'fileText', to: 'moninv' },
  ];

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Welcome back, {user.display_name || user.username}</h2>
          <div className="ph-sub">
            Operations overview \u00B7 {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
            {live && invState.syncedAt && <> \u00B7 synced {new Date(invState.syncedAt).toLocaleString()}</>}
          </div>
        </div>
        <div className="ph-actions">
          {connected
            ? <button className="btn" onClick={onSync}>{I.refresh()} Refresh</button>
            : <button className="btn" onClick={onOpenSetup}>{I.cloud()} Connect</button>}
          {lvl >= 20 && <button className="btn primary" onClick={() => go('moninv')}>{I.plus()} New entry</button>}
        </div>
      </div>

      {!connected && <ConnectBanner onOpen={onOpenSetup} />}
      {connected && invState.loading && <Loading />}
      {connected && invState.error && invState.error !== 'empty' &&
        <div className="banner warn">{I.alert()}<span>Couldn\u2019t load live data: {invState.error}</span><span className="bx" onClick={onSync}>Retry</span></div>}

      <div className="stat-grid kpi6">
        {KPIS.map(s => (
          <div className="stat-card kpi-card" key={s.key} onClick={() => go(s.to)}>
            <div className="sc-top"><div className="sc-ic" style={{ background: s.bg, color: s.tint }}>{I[s.icon]()}</div></div>
            <div className="sc-lbl">{s.label}</div>
            <div className="sc-val" style={s.small ? { fontSize: 16, fontFamily: 'var(--font)' } : undefined}>{s.val}</div>
            <div className="sc-delta eq" style={{ marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.sub}</div>
          </div>
        ))}
      </div>

      <div className="grid-2">
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h3>Today\u2019s menu \u00B7 {DOW_FULL[new Date().getDay()]}</h3>
              <span className="ch-link" onClick={() => go('menu')} style={{ cursor: 'pointer' }}>Full menu \u2192</span>
            </div>
            <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              {menuMeals.length === 0 && <div style={{ fontSize: 12, color: 'var(--faint)' }}>No menu for today.</div>}
              {menuMeals.map(meal => (
                <div key={meal} className="dash-meal">
                  <div className="dm-head">{MEAL_ICON[meal]} {meal}</div>
                  <div className="dm-items">
                    {meal === 'Snack'
                      ? menu[meal].join(' \u00B7 ')
                      : menu[meal].map((it: any) => typeof it === 'string' ? it : it.item).join(' \u00B7 ')}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Inventory value by category</h3>
              <span className="ch-link" onClick={() => go('inventory')} style={{ cursor: 'pointer' }}>{connected ? 'Live' : MONTHS[period[0]] + ' ' + period[1]}</span>
            </div>
            <div className="card-body flush">
              {catRows.map((c: any) => (
                <div className="cat-row" key={c.name}>
                  <span className="cat-dot" style={{ background: c.color }}></span>
                  <span className="cat-nm">{c.name}</span>
                  <span className="cat-bar"><span className="cat-fill" style={{ width: c.pct + '%', background: c.color }}></span></span>
                  <span className="cat-val">{c.val}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Inventory alerts</h3>
              <span className="viol-pill" style={{ margin: 0 }}>{I.alert({ style: { width: 13, height: 13 } })} {reorderList.length} below par</span>
            </div>
            <div className="card-body">
              {reorderList.length === 0
                ? <div style={{ fontSize: 12, color: 'var(--faint)' }}>All items at or above par level.</div>
                : <div className="alert-chips">
                  {reorderList.slice(0, 12).map((r: any, i: number) => (
                    <span className="alert-chip" key={i}>{r.desc}<b>{r.onHand || 0}/{r.par}</b></span>
                  ))}
                  {reorderList.length > 12 && <span className="alert-more" onClick={() => go('inventory')}>+{reorderList.length - 12} more \u2192</span>}
                </div>}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <div className="card">
            <div className="card-head">
              <h3>Meal log \u00B7 today</h3>
              <span className="ch-link" onClick={() => go('mballot')} style={{ cursor: 'pointer' }}>Full log \u2192</span>
            </div>
            <div className="card-body">
              <div className="dash-meal-counts">
                {[['Breakfast', mlTotals.B], ['Lunch', mlTotals.L], ['Dinner', mlTotals.D], ['Tickets', mlTotals.T]].map(([l, n]) => (
                  <div className="dmc" key={l as string}><span className="dmc-n">{n as number}</span><span className="dmc-l">{l as string}</span></div>
                ))}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Monthly inventory \u00B7 {MONTHS[period[0]]}</h3>
              <span className="ch-link" onClick={() => go('moninv')} style={{ cursor: 'pointer' }}>Manage \u2192</span>
            </div>
            <div className="card-body">
              <div className="mi-mini">
                <div className="mim" style={{ background: '#EEF2F8' }}><span className="mim-l" style={{ color: '#1B3A6B' }}>Opening</span><span className="mim-v">{fmtMoney(miSum.open)}</span></div>
                <div className="mim" style={{ background: '#F0FDF4' }}><span className="mim-l" style={{ color: '#166534' }}>Received</span><span className="mim-v" style={{ color: '#166534' }}>{fmtMoney(miSum.recv)}</span></div>
                <div className="mim" style={{ background: '#EFF5FE' }}><span className="mim-l" style={{ color: '#1660C8' }}>Closing</span><span className="mim-v" style={{ color: '#1660C8' }}>{fmtMoney(miSum.close)}</span></div>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Upcoming events</h3>
              <span className="ch-link" onClick={() => go('events')} style={{ cursor: 'pointer' }}>Calendar \u2192</span>
            </div>
            <div className="card-body flush">
              {upcoming.slice(0, 4).map((e: any) => {
                const meta = DS.catMeta()[e.cat] || { color: '#475569', bg: '#F1F5F9', dot: '#64748B' };
                return (
                  <div className="up-ev" key={e.id} onClick={() => go('events')}>
                    <span className="up-dot" style={{ background: meta.dot }}></span>
                    <span className="up-title">{e.title}</span>
                    <span className="up-date">{fmtShort(e.date)}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Quick actions</h3></div>
            <div className="card-body">
              <div className="qa-grid">
                {QUICK.map(q => (
                  <button className="qa-btn" key={q.to} onClick={() => go(q.to)}>{I[q.icon]({ style: { width: 15, height: 15 } })}<span>{q.label}</span></button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function InventoryView({ user, period, connected, invState, onSync, onOpenSetup }: {
  user: User; period: [number, number]; connected: boolean;
  invState: any; onSync: () => void; onOpenSetup: () => void;
}) {
  const lvl = ROLE_LEVEL[user.role];
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');

  const live = connected && invState.inv;
  let rows: any[], cats: string[];
  if (live) {
    rows = invToList(invState.inv).map((it: any) => ({
      sku: it.sku, desc: it.desc, cat: it.cat, price: it.price || 0,
      onHand: it.onHand || 0, par: it.par || 0,
      status: ((it.onHand || 0) < (it.par || 0) && (it.par || 0) > 0) ? 'low' : 'ok',
      value: iTotal(it),
    }));
    cats = [...new Set(rows.map((r: any) => r.cat))];
  } else {
    rows = ((window as any).INVENTORY_SAMPLE || []).map((r: any) => ({ ...r, value: r.price * r.onHand }));
    cats = [...new Set(rows.map((r: any) => r.cat))];
  }
  const filtered = rows.filter((r: any) =>
    (!cat || r.cat === cat) &&
    (!q || (r.desc || '').toLowerCase().includes(q.toLowerCase()) || String(r.sku || '').includes(q))
  );

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Inventory</h2>
          <div className="ph-sub">
            {MONTHS[period[0]]} {period[1]} \u00B7 {filtered.length} of {rows.length} items{live ? ' \u00B7 live' : ' \u00B7 demo'}
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn">{I.scan()} Scan</button>
          {connected && <button className="btn" onClick={onSync}>{I.refresh()} Refresh</button>}
          {lvl >= 30 && <button className="btn primary">{I.plus()} Add item</button>}
        </div>
      </div>

      {!connected && <ConnectBanner onOpen={onOpenSetup} />}
      {connected && invState.loading && <Loading />}
      {connected && invState.error && invState.error !== 'empty' &&
        <div className="banner warn">{I.alert()}<span>Couldn\u2019t load live data: {invState.error}</span><span className="bx" onClick={onSync}>Retry</span></div>}

      {(!connected || invState.inv) && (
        <div className="card">
          <div className="card-head" style={{ gap: 10, flexWrap: 'wrap' }}>
            <div style={{ position: 'relative', flex: 1, minWidth: 200, maxWidth: 340 }}>
              <span style={{ position: 'absolute', left: 11, top: 8, color: 'var(--faint)' }}>{I.search({ style: { width: 16, height: 16 } })}</span>
              <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search SKU or description\u2026"
                style={{ width: '100%', padding: '8px 12px 8px 34px', border: '1px solid var(--line)', borderRadius: 8, fontSize: 12.5 }} />
            </div>
            <select className="btn" value={cat} onChange={e => setCat(e.target.value)} style={{ paddingRight: 8 }}>
              <option value="">All categories</option>
              {cats.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </div>
          <div className="card-body flush tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>SKU</th><th>Description</th><th>Category</th>
                  <th className="r">Unit Price</th><th className="r">On Hand</th><th className="r">Par</th>
                  <th>Status</th><th className="r">Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r: any, i: number) => (
                  <tr key={(r.sku || '') + i}>
                    <td className="num" style={{ color: 'var(--muted)' }}>{r.sku || '\u2014'}</td>
                    <td style={{ fontWeight: 600 }}>{r.desc}</td>
                    <td><span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                      <span style={{ width: 8, height: 8, borderRadius: 2, background: catColor(r.cat) }}></span>{r.cat}</span></td>
                    <td className="r num">${(r.price || 0).toFixed(2)}</td>
                    <td className="r num">{r.onHand}</td>
                    <td className="r num" style={{ color: 'var(--faint)' }}>{r.par}</td>
                    <td>{r.status === 'low' ? <span className="pill warn">Below par</span> : <span className="pill ok">In stock</span>}</td>
                    <td className="r num">{fmtMoneyFull(r.value)}</td>
                  </tr>
                ))}
                {!filtered.length && <tr><td colSpan={8} style={{ textAlign: 'center', padding: 30, color: 'var(--faint)' }}>No items match your filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

function UsersView({ connected, onOpenSetup }: { connected: boolean; onOpenSetup: () => void }) {
  const [state, setState] = useState({ loading: connected, users: null as any[] | null, error: null as string | null });
  useEffect(() => {
    let alive = true;
    if (!connected) { setState({ loading: false, users: USERS, error: null }); return; }
    (async () => {
      setState({ loading: true, users: null, error: null });
      const res = await fetchProfiles();
      if (!alive) return;
      if (res.ok) setState({ loading: false, users: (res as any).users, error: null });
      else setState({ loading: false, users: null, error: (res as any).error });
    })();
    return () => { alive = false; };
  }, [connected]);

  const users = state.users || [];
  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Users &amp; Access</h2>
          <div className="ph-sub">{users.length} accounts \u00B7 role-based access control{connected ? ' \u00B7 live' : ' \u00B7 demo'}</div>
        </div>
        <div className="ph-actions"><button className="btn primary">{I.plus()} Invite user</button></div>
      </div>

      {!connected && <ConnectBanner onOpen={onOpenSetup} />}
      {state.loading && <Loading label="Loading directory\u2026" />}
      {state.error && <div className="banner warn">{I.alert()}<span>Couldn\u2019t load users: {state.error}</span></div>}

      {!state.loading && !state.error && (
        <div className="card">
          <div className="card-body flush tbl-wrap">
            <table className="data">
              <thead><tr><th>User</th><th>Username</th><th>Role</th><th>Auth method</th><th>Status</th><th></th></tr></thead>
              <tbody>
                {users.map((u: User) => (
                  <tr key={u.id || u.username}>
                    <td><div className="user-cell"><div className="avatar">{initials(u)}</div><div><div style={{ fontWeight: 700 }}>{u.display_name} {u.last_name || ''}</div><div style={{ fontSize: 11, color: 'var(--faint)' }}>{u.username}@mjc-cafeteria.com</div></div></div></td>
                    <td className="num" style={{ color: 'var(--muted)' }}>{u.username}</td>
                    <td><span className={'pill role-' + u.role}>{ROLE_LABEL[u.role] || u.role}</span></td>
                    <td style={{ color: 'var(--muted)' }}>{u.role === 'staff' ? '4-digit PIN' : 'Password'}</td>
                    <td>{u.active ? <span className="pill ok">Active</span> : <span className="pill off">Disabled</span>}</td>
                    <td style={{ display: 'flex', gap: 6 }}>
                      <button className="btn" style={{ padding: '5px 9px' }}>{I.edit({ style: { width: 14, height: 14 } })}</button>
                      <button className="btn" style={{ padding: '5px 9px', color: 'var(--red)' }}>{I.del({ style: { width: 14, height: 14 } })}</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

const PAGE_INFO: Record<string, { icon: string; title: string; sub: string; feats: string[] }> = {
  menu: { icon: 'calendar', title: '28-Day Cycle Menu', sub: 'Plan the rotating cycle menu, map recipes to inventory items, and forecast quantities against on-hand counts.', feats: ['28-day rotation', 'Recipe \u2192 SKU mapping', 'Quantity forecasting', 'Nutrition / HACCP notes'] },
  barcodes: { icon: 'qr', title: 'Barcodes & Scan', sub: 'Generate CODE128 / QR labels and run mobile scan sessions to update on-hand counts in real time.', feats: ['Bulk label export', 'Camera scan sessions', 'Auto on-hand sync', 'Print sheets'] },
  sourcectrl: { icon: 'branch', title: 'Source Control', sub: 'Every inventory change is staged, reviewed, and committed \u2014 with full history and one-click revert.', feats: ['Staged commits', 'Diff & review', 'Change history', 'Revert to commit'] },
  archives: { icon: 'archive', title: 'Archives', sub: 'Monthly snapshots, vendor invoices, and exported reports \u2014 retained and searchable.', feats: ['Monthly snapshots', 'Invoice archive', 'Report exports', 'Audit trail'] },
  settings: { icon: 'settings', title: 'Settings', sub: 'Configure the data source, AI invoice parsing, and platform preferences.', feats: ['Supabase connection', 'AI provider & model', 'Org preferences', 'API keys'] },
};

function PlaceholderPage({ pageKey, onOpenSetup }: { pageKey: string; onOpenSetup: () => void }) {
  const p = PAGE_INFO[pageKey] || { icon: 'grid', title: 'Page', sub: '', feats: [] as string[] };
  return (
    <div className="fade-in">
      <div className="page-head"><div><h2>{p.title}</h2><div className="ph-sub">Module preview</div></div></div>
      <div className="placeholder">
        <div className="pic">{I[p.icon]()}</div>
        <h3>{p.title}</h3>
        <p>{p.sub}</p>
        <div className="feature-list">
          {p.feats.map((f, i) => (<div className="fl" key={i}>{I.checkCircle()} {f}</div>))}
        </div>
        {pageKey === 'settings' && <div style={{ marginTop: 22 }}><button className="btn primary" onClick={onOpenSetup}>{I.database({ style: { width: 15, height: 15 } })} Manage data source</button></div>}
      </div>
    </div>
  );
}

function ArchivesView(_props: { period: [number, number] }) {
  const arch = (window as any).DEMO_ARCHIVES || [];
  return (
    <div className="fade-in">
      <div className="page-head">
        <div><h2>Archives</h2><div className="ph-sub">Monthly inventory snapshots \u00B7 retained for audit</div></div>
        <div className="ph-actions"><button className="btn">{I.download()} Export all</button></div>
      </div>
      <div className="stat-grid">
        {arch.slice(0, 4).map((a: any) => (
          <div className="stat-card" key={a.period}>
            <div className="sc-top">
              <div className="sc-ic" style={{ background: a.status === 'live' ? '#F0FDF4' : '#EEF2F8', color: a.status === 'live' ? '#059669' : '#1B3A6B' }}>{I.archive()}</div>
              {a.status === 'live' && <span className="pill ok">Live</span>}
            </div>
            <div className="sc-lbl">{a.label}</div>
            <div className="sc-val">{fmtMoney(a.value)}</div>
            <div className="sc-delta eq" style={{ marginTop: 4 }}>{a.items} items \u00B7 {a.low} below par</div>
          </div>
        ))}
      </div>
      <div className="card">
        <div className="card-head"><h3>All snapshots</h3></div>
        <div className="card-body flush tbl-wrap">
          <table className="data">
            <thead><tr><th>Period</th><th className="r">On-Hand Value</th><th className="r">Line Items</th><th className="r">Below Par</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {arch.map((a: any) => (
                <tr key={a.period}>
                  <td style={{ fontWeight: 700 }}>{a.label}</td>
                  <td className="r num">{fmtMoneyFull(a.value)}</td>
                  <td className="r num">{a.items}</td>
                  <td className="r num" style={{ color: a.low ? 'var(--amber)' : 'var(--green)' }}>{a.low}</td>
                  <td>{a.status === 'live' ? <span className="pill ok">Live</span> : <span className="pill off">Archived</span>}</td>
                  <td className="r"><button className="btn" style={{ padding: '5px 11px' }}>{I.download({ style: { width: 14, height: 14 } })} CSV</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export interface PortalProps {
  user: User;
  onLogout: () => void;
  density?: string;
}

export function Portal({ user, onLogout, density = 'comfortable' }: PortalProps) {
  const lvl = ROLE_LEVEL[user.role];
  const [active, setActive] = useState('dashboard');
  const [period, setPeriod] = useState<[number, number]>([4, 2026]);
  const [connected, setConnected] = useState(isConnected());
  const [showSetup, setShowSetup] = useState(false);
  const [invState, reloadInv] = useInventory(connected);
  const [stagedCount, setStagedCount] = useState(DS.staged().length);

  useEffect(() => { (window as any).__logout = onLogout; }, [onLogout]);

  const navItem = NAV.flatMap(g => g.items).find(it => it.key === active);
  useEffect(() => { if (navItem && lvl < (navItem.min || 0)) setActive('dashboard'); }, [active, lvl, navItem]);

  function onConnSaved() {
    const c = isConnected();
    setConnected(c);
    if (c) { toast('Connected to Supabase'); setTimeout(reloadInv, 60); }
    else toast('Disconnected \u2014 demo mode');
  }
  function doSync() { reloadInv(); toast('Refreshing live data\u2026'); }

  const reorderCount = (connected && invState.inv) ? reorders(invState.inv).length : 0;
  const syncState = invState.loading ? 'loading' : (invState.error && invState.error !== 'empty' ? 'error' : 'ok');

  const common = { user, period, connected, invState, onSync: doSync, onOpenSetup: () => setShowSetup(true), go: setActive };

  const renderPage = () => {
    if (active === 'dashboard') return <Dashboard {...common} />;
    if (active === 'inventory') return <InventoryView {...common} />;
    if (active === 'haccp') return <ComplianceHub user={user} connected={connected} />;
    if (active === 'dailyops') return <DailyOps user={user} connected={connected} />;
    if (active === 'events') return <EventsCalendar user={user} />;
    if (active === 'menu' && lvl >= 20) return <CycleMenu user={user} />;
    if (active === 'mballot') return <MealLog user={user} connected={connected} />;
    if (active === 'inspection' && lvl >= 20) return <InspectionSheet user={user} connected={connected} />;
    if (active === 'foodreq') return <FoodRequest user={user} connected={connected} />;
    if (active === 'snackbar') return <SnackBar user={user} connected={connected} />;
    if (active === 'moninv' && lvl >= 20) return <MonthlyInventory user={user} period={period} connected={connected} />;
    if (active === 'sourcectrl') return <SourceControl user={user} connected={connected} onCountChange={(n) => setStagedCount(n)} />;
    if (active === 'reports' && lvl >= 30) return <Reports user={user} period={period} connected={connected} invState={invState} />;
    if (active === 'users' && lvl >= 40) return <UsersView connected={connected} onOpenSetup={() => setShowSetup(true)} />;
    if (active === 'archives' && lvl >= 20) return <ArchivesView period={period} />;
    return <PlaceholderPage pageKey={active} onOpenSetup={() => setShowSetup(true)} />;
  };

  return (
    <div className="portal" data-density={density}>
      <Topbar user={user} period={period} setPeriod={setPeriod} connected={connected}
        syncState={syncState} onSync={doSync} onOpenSetup={() => setShowSetup(true)} />
      <Sidebar user={user} active={active} setActive={setActive} reorderCount={reorderCount} stagedCount={stagedCount} />
      <main className="main">{renderPage()}</main>
      {showSetup && <SupaSetupModal onClose={() => setShowSetup(false)} onSaved={onConnSaved} />}
    </div>
  );
}
