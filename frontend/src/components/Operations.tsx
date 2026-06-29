import { useState, useEffect, useMemo } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL, MONTHS } from '../lib/constants';
import { catColor, fmtMoney, fmtMoneyFull } from '../lib/supabase';
import { api } from '../lib/api';
import { matchesInventoryQuery, parseInventoryQuery } from '../lib/inventorySearch';

const SNACK_HOURS = [
  { day: 'Monday – Friday', lunch: '11:00 AM – 1:30 PM', eve: '' },
  { day: 'Saturday', lunch: '11:00 AM – 1:00 PM', eve: '' },
  { day: 'Sunday', lunch: 'Closed', eve: '' },
];

const MEAL_RATES = [
  { meal: 'Breakfast', rate: '$3.50' },
  { meal: 'Lunch', rate: '$5.75' },
  { meal: 'Dinner', rate: '$5.75' },
];

function Loading({ label = 'Loading…' }) {
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}

function cellN(val: number, onChange: (v: string) => void, canEdit: boolean, step = 1, w = 50) {
  if (!canEdit) return <span className="num">{val}</span>;
  return (
    <input
      className="sheet-inp ai-ring"
      type="number" min="0" step={step}
      style={{ width: w }}
      value={val ?? 0}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function cellT(val: string, onChange: (v: string) => void, canEdit: boolean) {
  if (!canEdit) return <span>{val}</span>;
  return (
    <input
      className="sheet-inp txt ai-ring"
      type="text"
      style={{ width: 52 }}
      value={val}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function SnackBar({ user }: { user: User }) {
  const lvl = ROLE_LEVEL[user.role] || 0;
  const canEdit = lvl >= 10;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [open, setOpen] = useState('');
  const [sales, setSales] = useState('');
  const [close, setClose] = useState('');
  const [saved, setSaved] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const o = parseFloat(open), s = parseFloat(sales), c = parseFloat(close);
  const ready = !isNaN(o) && !isNaN(s) && !isNaN(c);
  const variance = ready ? c - (o + s) : null;
  const vClass =
    variance === null
      ? ''
      : Math.abs(variance) < 0.005
        ? 'ok'
        : variance < 0
          ? 'neg'
          : 'pos';

  async function handleSave() {
    try {
      await api.saveDailyLog({
        entry_type: 'other',
        title: `Snack bar reconciliation - ${date}`,
        description: JSON.stringify({ open, sales, close }),
      });
      setSaved(true);
      setSavedAt(new Date());
    } catch {
      setSaved(false);
      (window as any).toast?.('Save failed — check your connection and try again.');
    }
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Snack Bar</h2>
          <div className="ph-sub">
            Daily cash reconciliation &amp; operating reference
          </div>
        </div>
        <div className="ph-actions">
          <label className="ft-field">
            <span>Business date</span>
            <input
              className="ipt sel"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
            />
          </label>
        </div>
      </div>

      <div className="grid-2">
        <div className="card" style={{ height: 'fit-content' }}>
          <div className="card-head"><h3>Daily sales reconciliation</h3></div>
          <div className="card-body" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <label className="ft-field">
              <span>Opening cash in register ($)</span>
              <input
                className="ipt sel"
                type="number"
                step="0.01"
                value={open}
                disabled={!canEdit}
                placeholder="0.00"
                onChange={(e) => { setOpen(e.target.value); setSaved(false); }}
              />
            </label>
            <label className="ft-field">
              <span>Total register sales ($)</span>
              <input
                className="ipt sel"
                type="number"
                step="0.01"
                value={sales}
                disabled={!canEdit}
                placeholder="0.00"
                onChange={(e) => { setSales(e.target.value); setSaved(false); }}
              />
            </label>
            <label className="ft-field">
              <span>Closing cash counted ($)</span>
              <input
                className="ipt sel"
                type="number"
                step="0.01"
                value={close}
                disabled={!canEdit}
                placeholder="0.00"
                onChange={(e) => { setClose(e.target.value); setSaved(false); }}
              />
            </label>

            <div className={'variance-box ' + vClass}>
              <span className="vb-lbl">Variance (counted − expected)</span>
              <span className="vb-val">
                {variance === null
                  ? '—'
                  : (variance > 0 ? '+' : '') + '$' + variance.toFixed(2)}
              </span>
              {variance !== null && (
                <span className="vb-note">
                  {Math.abs(variance) < 0.005
                    ? 'Balanced — drawer reconciles.'
                    : variance < 0
                      ? 'Short — recount & note shortage.'
                      : 'Over — recount & note overage.'}
                </span>
              )}
            </div>
            <div className="banner info" style={{ margin: 0 }}>
              {I.shield({ style: { width: 16, height: 16 } })}
              <span>
                Escort cash to Finance with Safety &amp; Security staff. Never
                transport receipts alone.
              </span>
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head"><h3>Operating hours</h3></div>
            <div className="card-body flush tbl-wrap">
              <table className="data">
                <thead>
                  <tr><th>Day</th><th>Lunch</th><th>Evening</th></tr>
                </thead>
                <tbody>
                  {SNACK_HOURS.map((r, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: 700, whiteSpace: 'nowrap' }}>{r.day}</td>
                      {r.eve === '' ? (
                        <td colSpan={2} style={{ color: 'var(--muted)' }}>{r.lunch}</td>
                      ) : (
                        <>
                          <td style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>{r.lunch}</td>
                          <td style={{ color: 'var(--muted)' }}>{r.eve}</td>
                        </>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
          <div className="card">
            <div className="card-head"><h3>Meal ticket rates</h3></div>
            <div className="card-body flush tbl-wrap">
              <table className="data">
                <thead>
                  <tr><th>Meal</th><th className="r">Rate</th></tr>
                </thead>
                <tbody>
                  {MEAL_RATES.map((r, i) => (
                    <tr key={i}><td>{r.meal}</td><td className="r num">{r.rate}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>

      <div className="formbar">
        {<div className="formbar-note">
          <span className="formbar-meta">
            Snack bar · {new Date(date + 'T12:00:00').toLocaleDateString()}
          </span>
        </div>}
        <div className="formbar-status">
          {saved && savedAt && <span className="formbar-saved">Saved {savedAt.toLocaleTimeString()}</span>}
        </div>
        {canEdit && (
          <button className="btn primary" onClick={handleSave} disabled={saved}>
            <I.save /> Save
          </button>
        )}
      </div>
    </div>
  );
}

export function MonthlyInventory({
  user,
  period,
  openSC,
  go,
}: {
  user: User;
  period: [number, number];
  openSC?: () => void;
  go?: (key: string) => void;
}) {
  const lvl = ROLE_LEVEL[user.role] || 0;
  const canEdit = lvl >= 20;
  const [m, y] = period;

  const [rows, setRows] = useState<any[]>([]);
  const [initRows, setInitRows] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [q, setQ] = useState('');
  const [viewMode, setViewMode] = useState<'flat' | 'group'>('flat');
  const [week, setWeek] = useState(0); // 0 = All, 1-4 = W1-W4
  const [maxWeeks, setMaxWeeks] = useState(4); // from API metadata.weeks_in_period

  // Local cache key for this period
  const draftKey = `mjcc_ops_draft_${m + 1}_${y}`;

  const saveDraft = (data: any[]) => {
    try { localStorage.setItem(draftKey, JSON.stringify({ rows: data, savedAt: Date.now() })); }
    catch { /* quota exceeded — silent */ }
  };

  const clearDraft = () => {
    try { localStorage.removeItem(draftKey); }
    catch { /* silent */ }
  };

  const restoreDraft = (): any[] | null => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed?.rows) ? parsed.rows : null;
    } catch { return null; }
  };

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setSaved(true);
    async function load() {
      try {
        const inv = await api.getInventory(m + 1, y);
        const wip = inv.metadata?.weeks_in_period ?? 4;
        const flat = (inv.items || []).map((it: any) => ({
          id: it.sku || String(Math.random()),
          cat: it.category || it.cat || '',
          item: it.desc || '',
          price: it.price || 0,
          par: it.par || 0,
          unit: it.unit || 'each',
          opening: it.onHand || 0,
          w1r: it.w1r || 0, w2r: it.w2r || 0, w3r: it.w3r || 0,
          w1p: it.w1p || 0, w2p: it.w2p || 0, w3p: it.w3p || 0,
          totalReceived: it.totalReceived,
          totalPulled: it.totalPulled,
          closingQty: it.closingQty,
        }));
        // Check for uncommitted draft
        const draft = restoreDraft();
        if (draft && draft.length > 0) {
          // Merge draft on top of fresh DB data: preserved edited values by sku/id
          const draftMap = new Map(draft.map((r: any) => [r.id, r]));
          const merged = flat.map((r: any) => ({ ...r, ...draftMap.get(r.id) }));
          // Add any draft rows that no longer exist in DB (new items, etc.)
          for (const dr of draft) {
            if (!merged.find((r: any) => r.id === dr.id)) merged.push(dr);
          }
          if (alive) { setRows(merged); setInitRows(flat); setMaxWeeks(wip); }
        } else {
          if (alive) { setRows(flat); setInitRows(flat); setMaxWeeks(wip); }
        }
        try {
          const ivs = await api.getInvoices(m + 1, y);
          if (alive) setInvoices(ivs || []);
        } catch { if (alive) setInvoices([]); }
      } catch {
        if (alive) { setRows([]); setInvoices([]); }
      }
      if (alive) setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [m, y]);

  function setR(id: string, f: string, v: string) {
    setRows((prev) => {
      const next = prev.map((r: any) => r.id === id ? { ...r, [f]: parseFloat(v) || 0 } : r);
      saveDraft(next);
      return next;
    });
    setSaved(false);
  }
  function setRStr(id: string, f: string, v: string) {
    setRows((prev) => {
      const next = prev.map((r: any) => r.id === id ? { ...r, [f]: v } : r);
      saveDraft(next);
      return next;
    });
    setSaved(false);
  }

  const totalRcv = (r: any) => (r.w1r || 0) + (r.w2r || 0) + (r.w3r || 0);
  const totalIss = (r: any) => (r.w1p || 0) + (r.w2p || 0) + (r.w3p || 0);
  const closing = (r: any) => Math.max(0, (r.opening || 0) + totalRcv(r) - totalIss(r));

  // Week-scoped accessors
  const wRcvF = week > 0 ? `w${week}r` : null;
  const wIssF = week > 0 ? `w${week}p` : null;
  const wRcv = (r: any) => week > 0 ? (r[`w${week}r`] || 0) : totalRcv(r);
  const wIss = (r: any) => week > 0 ? (r[`w${week}p`] || 0) : totalIss(r);

  const sum = rows.reduce(
    (a: any, r: any) => ({
      open: a.open + (r.opening || 0) * r.price,
      recv: a.recv + totalRcv(r) * r.price,
      iss: a.iss + totalIss(r) * r.price,
      close: a.close + closing(r) * r.price,
    }),
    { open: 0, recv: 0, iss: 0, close: 0 },
  );

  const searchQuery = useMemo(() => parseInventoryQuery(q), [q]);
  const filtered = q.trim()
    ? rows.filter((r: any) => matchesInventoryQuery(r, searchQuery))
    : rows;

  const categories = [...new Set(filtered.map((r: any) => r.cat as string))].sort();
  const grouped = categories.map((cat) => ({
    cat,
    items: filtered.filter((r: any) => r.cat === cat),
  }));

  const SUM_CARDS = [
    { lbl: 'Opening value', val: sum.open, tint: '#1B3A6B', bg: '#EEF2F8' },
    { lbl: 'Total received', val: sum.recv, tint: '#059669', bg: '#F0FDF4' },
    { lbl: 'Total issued', val: sum.iss, tint: '#D97706', bg: '#FEF3C7' },
    { lbl: 'Closing value', val: sum.close, tint: '#1E73E8', bg: '#EFF5FE' },
  ];

  const WK_LABELS = ['All', ...Array.from({ length: maxWeeks }, (_, i) => `Week ${i + 1}`)];
  const rcvColLabel = week === 0 ? 'Rcvd (total)' : `W${week} Received`;
  const issColLabel = week === 0 ? 'Issued (total)' : `W${week} Issued`;

  // Per-week received dollar totals (qty × price) — used for the week tile strip.
  const weekTotals = useMemo(() =>
    Array.from({ length: maxWeeks }, (_, i) => i + 1).map((wk) => ({
      wk,
      total: rows.reduce((s, r) => s + (r[`w${wk}r`] || 0) * r.price, 0),
    })).filter((wt) => wt.total > 0),
  [rows, maxWeeks]);

  // Per-week issued qty totals — determines which weeks have pull sheets recorded.
  const pullTotals = useMemo(() =>
    Array.from({ length: maxWeeks }, (_, i) => i + 1).map((wk) => ({
      wk,
      qty: rows.reduce((s, r) => s + (r[`w${wk}i`] || 0), 0),
    })).filter((pt) => pt.qty > 0),
  [rows, maxWeeks]);

  const nextWeek = weekTotals.length < maxWeeks ? weekTotals.length + 1 : null;

  function handleAddWeek(wk: number) {
    // Fire prefill event so DataEntry picks up month/year/week on mount.
    window.dispatchEvent(new CustomEvent('mjcc:dataentry-prefill', {
      detail: { week: wk, month: m, year: y, direction: 'received' },
    }));
    go?.('dataentry');
  }

  function handleAddPull(wk: number) {
    window.dispatchEvent(new CustomEvent('mjcc:dataentry-prefill', {
      detail: { week: wk, month: m, year: y, direction: 'issued' },
    }));
    go?.('dataentry');
  }

  async function handleSave() {
    setSaving(true);
    try {
      const notes = `${MONTHS[m]} ${y}`;
      // on_hand is the OPENING balance for the period (the DB model: the read
      // side and perform_rollover both compute ending = on_hand + received -
      // issued). Sending closing() here double-counted every receipt/issue on
      // read and compounded on each save. Persist the opening balance instead;
      // closing is always derived from opening + the weekly columns.
      const items = rows.map((r: any) => ({
        sku: r.id, desc: r.item,
        onHand: r.opening || 0,
        par: r.par, price: r.price, category: r.cat, unit: r.unit,
        w1r: r.w1r, w2r: r.w2r, w3r: r.w3r,
        w1p: r.w1p, w2p: r.w2p, w3p: r.w3p,
      }));

      const stagingIds: string[] = [];

      // 1. Stage bulk inventory data via Source Control (the ONLY write path)
      const bulkEntry = await api.stageChange(
        'inventory_save', 'inventory', `batch-moninv-${m + 1}-${y}`,
        { items, month: m + 1, year: y, notes },
        `Monthly inventory — ${notes}`,
      );
      stagingIds.push(bulkEntry.entry_id);

      // 2. Stage par changes as item_update (par is item-level, not period-level)
      const initMap = Object.fromEntries(initRows.map((r: any) => [r.id, r]));
      const parChanged = rows.filter((r: any) => {
        const init = initMap[r.id];
        return init && r.par !== init.par;
      });
      for (const r of parChanged) {
        const parEntry = await api.stageChange(
          'item_update', 'inventory', r.id,
          { sku: r.id, desc: r.item, par: r.par },
          `PAR update · ${r.item} → ${r.par}`,
        );
        stagingIds.push(parEntry.entry_id);
      }

      // 3. Auto-commit for managers (stage + commit = single action)
      if (lvl >= 30 && stagingIds.length) {
        await api.approveCommit({
          staging_ids: stagingIds,
          message: `Monthly inventory — ${MONTHS[m]} ${y} (${stagingIds.length} change${stagingIds.length !== 1 ? 's' : ''})`,
          author_id: user.id,
        });
      }

      clearDraft();
      setInitRows([...rows]);
      setSaved(true);
      setSavedAt(new Date());
      openSC?.();

      if (lvl >= 30) {
        (window as any).toast?.('Inventory saved and committed successfully');
      } else {
        (window as any).toast?.('Changes staged. A manager must approve them in Source Control.');
      }
    } catch (e: any) {
      (window as any).toast?.(`Save failed: ${e?.message || 'please try again'}`);
    } finally {
      setSaving(false);
    }
  }

  function renderRow(r: any) {
    return (
      <tr key={r.id}>
        <td style={{ fontWeight: 600, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {r.item}
        </td>
        <td>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 7, height: 7, borderRadius: 2, flexShrink: 0, background: catColor(r.cat) }} />
            <span style={{ fontSize: 11, color: 'var(--muted)' }}>{r.cat}</span>
          </span>
        </td>
        <td>{cellT(r.unit, (v) => setRStr(r.id, 'unit', v), canEdit)}</td>
        <td className="r">{cellN(r.par, (v) => setR(r.id, 'par', v), canEdit)}</td>
        <td className="r">{cellN(r.price, (v) => setR(r.id, 'price', v), canEdit, 0.01, 62)}</td>
        <td className="r">{cellN(r.opening, (v) => setR(r.id, 'opening', v), canEdit)}</td>
        <td className={`r${week > 0 ? ' rcv-cell' : ''}`}>
          {week > 0
            ? cellN(r[wRcvF!] || 0, (v) => setR(r.id, wRcvF!, v), canEdit)
            : <span className="num" style={{ color: wRcv(r) > 0 ? 'var(--green-ink)' : undefined, fontWeight: wRcv(r) > 0 ? 600 : undefined }}>{wRcv(r)}</span>
          }
        </td>
        <td className="r">
          {week > 0
            ? cellN(r[wIssF!] || 0, (v) => setR(r.id, wIssF!, v), canEdit)
            : <span className="num" style={{ color: wIss(r) > 0 ? 'var(--amber)' : undefined }}>{wIss(r)}</span>
          }
        </td>
        <td className="r num" style={{ fontWeight: 800 }}>{closing(r)}</td>
        <td className="r num" style={{ color: 'var(--muted)' }}>{fmtMoneyFull(closing(r) * r.price)}</td>
      </tr>
    );
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Monthly Inventory</h2>
          <div className="ph-sub">
            {MONTHS[m]} {y} · {rows.length} items · master month editor
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn" onClick={() => window.print()}>{I.printer()} Print</button>
          {canEdit && (
            <button className="btn primary" onClick={() => go?.('inventory')} title="Add a new item in the Inventory editor">
              {I.plus()} Add item
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="card mobile-compact"><Loading label="Loading inventory…" /></div>
      ) : (
        <>
          <div className="stat-grid">
            {SUM_CARDS.map((s, i) => (
              <div className="stat-card" key={i}>
                <div className="sc-top">
                  <div className="sc-ic" style={{ background: s.bg, color: s.tint }}>{I.fileText()}</div>
                </div>
                <div className="sc-lbl">{s.lbl}</div>
                <div className="sc-val">{fmtMoney(s.val)}</div>
              </div>
            ))}
          </div>

          {/* ── Week receipt tile strip ── */}
          {(weekTotals.length > 0 || nextWeek) && (
            <div className="wk-tile-row">
              {weekTotals.map((wt) => {
                const pull = pullTotals.find((pt) => pt.wk === wt.wk);
                return (
                  <button key={wt.wk} className="wk-tile wk-tile--recorded" onClick={() => setWeek(wt.wk)}>
                    <span className="wkt-label">Week {wt.wk}</span>
                    <span className="wkt-val">{fmtMoney(wt.total)}</span>
                    <span className="wkt-sub">
                      received{pull ? ` · ${pull.qty} pulled` : ' · no pulls yet'} · tap to filter
                    </span>
                  </button>
                );
              })}
              {nextWeek && (
                <>
                  <button className="wk-tile wk-tile--add" onClick={() => handleAddWeek(nextWeek)}>
                    <span className="wkt-plus">+</span>
                    <span className="wkt-label">Week {nextWeek}</span>
                    <span className="wkt-sub">record invoice</span>
                  </button>
                  <button className="wk-tile wk-tile--add" onClick={() => handleAddPull(nextWeek)}>
                    <span className="wkt-plus">↓</span>
                    <span className="wkt-label">Week {nextWeek}</span>
                    <span className="wkt-sub">record pulls</span>
                  </button>
                </>
              )}
            </div>
          )}

          <div className="card" style={{ marginBottom: 16 }}>
            {/* ── Controls row ── */}
            <div className="card-head" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
              <h3>Inventory editor</h3>
              <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', flex: 1 }}>
                {/* Search */}
                <div style={{ position: 'relative', minWidth: 150 }}>
                  <span style={{ position: 'absolute', left: 9, top: 8, color: 'var(--faint)', pointerEvents: 'none' }}>
                    {I.search({ style: { width: 14, height: 14 } })}
                  </span>
                  <input
                    className="ipt inventory-search-input"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search SKU, name, category, or $price"
                    style={{ width: '100%', paddingLeft: 28 }}
                  />
                </div>
                {/* View mode */}
                <div className="tab-bar" style={{ marginBottom: 0, borderBottom: 'none', gap: 2 }}>
                  {(['flat', 'group'] as const).map((mode) => (
                    <button key={mode} className={`tab-btn${viewMode === mode ? ' active' : ''}`}
                      onClick={() => setViewMode(mode)} style={{ fontSize: 11, padding: '5px 10px' }}>
                      {mode === 'flat' ? 'List' : 'By Category'}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* ── Week selector ── */}
            <div style={{ padding: '2px 16px 8px', borderBottom: '1px solid var(--line)' }}>
              <div className="tab-bar" style={{ marginBottom: 0 }}>
                {WK_LABELS.map((lbl, i) => (
                  <button key={i} className={`tab-btn${week === i ? ' active' : ''}`} onClick={() => setWeek(i)}>
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {/* ── Table ── */}
            <div className="card-body flush tbl-wrap">
              <table className="data sheet">
                <thead>
                  <tr>
                    <th style={{ minWidth: 130 }}>Item</th>
                    <th>Category</th>
                    <th className="wk" style={{ minWidth: 60 }}>Unit</th>
                    <th className="wk r">PAR</th>
                    <th className="wk r">Price</th>
                    <th className="r">Opening</th>
                    <th className={`wk r${week > 0 ? ' rcv' : ''}`}>{rcvColLabel}</th>
                    <th className="wk r">{issColLabel}</th>
                    <th className="r">Closing</th>
                    <th className="r">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {viewMode === 'flat' ? (
                    filtered.length === 0
                      ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 26, color: 'var(--faint)' }}>No items match.</td></tr>
                      : filtered.map((r: any) => renderRow(r))
                  ) : (
                    grouped.length === 0
                      ? <tr><td colSpan={10} style={{ textAlign: 'center', padding: 26, color: 'var(--faint)' }}>No items match.</td></tr>
                      : grouped.flatMap(({ cat, items }) => {
                          const cs = items.reduce(
                            (a: any, r: any) => ({
                              open: a.open + (r.opening || 0) * r.price,
                              close: a.close + closing(r) * r.price,
                              rcv: a.rcv + wRcv(r),
                              iss: a.iss + wIss(r),
                            }),
                            { open: 0, close: 0, rcv: 0, iss: 0 },
                          );
                          return [
                            <tr key={`hdr-${cat}`} style={{ background: 'var(--surface-2)' }}>
                              <td colSpan={10} style={{ fontWeight: 700, fontSize: 10.5, color: 'var(--muted)', paddingLeft: 14, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                  <span style={{ width: 8, height: 8, borderRadius: 2, background: catColor(cat) }} />
                                  {cat} · {items.length} items
                                </span>
                              </td>
                            </tr>,
                            ...items.map((r: any) => renderRow(r)),
                            <tr key={`sub-${cat}`} style={{ borderTop: '1.5px solid var(--line)', background: 'var(--surface-2)' }}>
                              <td colSpan={5} style={{ fontWeight: 700, fontSize: 11, color: 'var(--muted)', paddingLeft: 14 }}>
                                {cat} subtotal
                              </td>
                              <td className="r num" style={{ fontWeight: 700, fontSize: 11 }}>{fmtMoney(cs.open)}</td>
                              <td className={`r num${week > 0 ? ' rcv-cell' : ''}`} style={{ fontWeight: 700, fontSize: 11, color: 'var(--green-ink)' }}>
                                {cs.rcv > 0 ? `+${cs.rcv}` : '—'}
                              </td>
                              <td className="r num" style={{ fontWeight: 700, fontSize: 11, color: 'var(--amber)' }}>
                                {cs.iss > 0 ? `-${cs.iss}` : '—'}
                              </td>
                              <td className="r num" style={{ fontWeight: 700, fontSize: 11 }}>{fmtMoney(cs.close)}</td>
                              <td></td>
                            </tr>,
                          ];
                        })
                  )}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={5} style={{ fontWeight: 700 }}>Total ({rows.length} items)</td>
                    <td className="r num" style={{ fontWeight: 700 }}>{fmtMoney(sum.open)}</td>
                    <td className={`r num${week > 0 ? ' rcv-cell' : ''}`} style={{ fontWeight: 700, color: 'var(--green-ink)' }}>{fmtMoney(sum.recv)}</td>
                    <td className="r num" style={{ fontWeight: 700, color: 'var(--amber)' }}>{fmtMoney(sum.iss)}</td>
                    <td className="r num" style={{ fontWeight: 700 }}>{fmtMoney(sum.close)}</td>
                    <td></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          {/* ── Invoice register ── */}
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>Invoice register — {MONTHS[m]} {y}</h3>
              <span className="ch-link">
                {invoices.length} invoices · {fmtMoney(invoices.reduce((s: number, i: any) => s + (i.net_total || i.total || 0), 0))}
              </span>
            </div>
            <div className="card-body flush tbl-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Vendor</th><th>Invoice #</th><th>Date</th>
                    <th className="r">Items</th><th className="r">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((iv: any) => (
                    <tr key={iv.id}>
                      <td style={{ fontWeight: 700 }}>{iv.vendor_name || iv.vendor || '—'}</td>
                      <td className="num" style={{ color: 'var(--muted)' }}>{iv.invoice_number || iv.number || '—'}</td>
                      <td style={{ color: 'var(--muted)' }}>{iv.invoice_date ? new Date(iv.invoice_date + 'T12:00:00').toLocaleDateString() : '—'}</td>
                      <td className="r num">{iv.item_count ?? iv.items ?? '—'}</td>
                      <td className="r num">{fmtMoneyFull(iv.net_total ?? iv.subtotal ?? iv.total ?? 0)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      <div className="formbar">
        <div className="formbar-note">
          <span className="formbar-meta">
            Monthly Inventory · {MONTHS[m]} {y} · {WK_LABELS[week]}
          </span>
        </div>
        <div className="formbar-status">
          {saved && savedAt && <span className="formbar-saved">Saved {savedAt.toLocaleTimeString()}</span>}
        </div>
        {canEdit && (
          <button className="btn primary" onClick={handleSave} disabled={saved || saving}>
            {saving ? 'Saving…' : <><I.save /> {lvl >= 30 ? 'Save & commit' : 'Stage changes'}</>}
          </button>
        )}
      </div>
    </div>
  );
}
