import { useState, useEffect } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL, MONTHS } from '../lib/constants';
import { catColor, fmtMoney, fmtMoneyFull } from '../lib/supabase';
import { api } from '../lib/api';

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
}: {
  user: User;
  period: [number, number];
  openSC?: () => void;
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
  const [week, setWeek] = useState(0); // 0 = All, 1–5 = W1–W5
  const [maxWeeks, setMaxWeeks] = useState(4); // from API metadata.weeks_in_period

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
          w1r: it.w1r || 0, w2r: it.w2r || 0, w3r: it.w3r || 0, w4r: it.w4r || 0, w5r: it.w5r || 0,
          w1i: it.w1i || 0, w2i: it.w2i || 0, w3i: it.w3i || 0, w4i: it.w4i || 0, w5i: it.w5i || 0,
        }));
        if (alive) { setRows(flat); setInitRows(flat); setMaxWeeks(wip); }
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
    setRows((prev) => prev.map((r: any) => r.id === id ? { ...r, [f]: parseFloat(v) || 0 } : r));
    setSaved(false);
  }
  function setRStr(id: string, f: string, v: string) {
    setRows((prev) => prev.map((r: any) => r.id === id ? { ...r, [f]: v } : r));
    setSaved(false);
  }

  const totalRcv = (r: any) => (r.w1r || 0) + (r.w2r || 0) + (r.w3r || 0) + (r.w4r || 0) + (r.w5r || 0);
  const totalIss = (r: any) => (r.w1i || 0) + (r.w2i || 0) + (r.w3i || 0) + (r.w4i || 0) + (r.w5i || 0);
  const closing = (r: any) => Math.max(0, (r.opening || 0) + totalRcv(r) - totalIss(r));

  // Week-scoped accessors
  const wRcvF = week > 0 ? `w${week}r` : null;
  const wIssF = week > 0 ? `w${week}i` : null;
  const wRcv = (r: any) => week > 0 ? (r[`w${week}r`] || 0) : totalRcv(r);
  const wIss = (r: any) => week > 0 ? (r[`w${week}i`] || 0) : totalIss(r);

  const sum = rows.reduce(
    (a: any, r: any) => ({
      open: a.open + (r.opening || 0) * r.price,
      recv: a.recv + totalRcv(r) * r.price,
      iss: a.iss + totalIss(r) * r.price,
      close: a.close + closing(r) * r.price,
    }),
    { open: 0, recv: 0, iss: 0, close: 0 },
  );

  const filtered = q
    ? rows.filter((r: any) => r.item.toLowerCase().includes(q.toLowerCase()))
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

  async function handleSave() {
    setSaving(true);
    try {
      const notes = `${MONTHS[m]} ${y}`;
      const items = rows.map((r: any) => ({
        sku: r.id, desc: r.item,
        onHand: r.opening,
        par: r.par, price: r.price, category: r.cat, unit: r.unit,
        w1r: r.w1r, w2r: r.w2r, w3r: r.w3r, w4r: r.w4r, w5r: r.w5r,
        w1i: r.w1i, w2i: r.w2i, w3i: r.w3i, w4i: r.w4i, w5i: r.w5i,
      }));

      // Direct write: monthly_inventory (on_hand + weekly cols + price + unit)
      await api.saveInventory({ items, metadata: { month: m + 1, year: y }, notes });

      // par is bypassed in saveInventory to prevent bulk-zeroing — patch changed items only
      const initMap = Object.fromEntries(initRows.map((r: any) => [r.id, r]));
      const parChanged = rows.filter((r: any) => {
        const init = initMap[r.id];
        return init && r.par !== init.par;
      });
      if (parChanged.length) {
        await Promise.all(parChanged.map((r: any) =>
          api.updateInventoryItem(r.id, { par: r.par }),
        ));
      }

      // Source Control audit trail
      await api.stageChange('inventory_save', 'inventory', `batch-moninv-${m + 1}-${y}`,
        { items, month: m + 1, year: y, notes },
        `Monthly inventory — ${notes}`,
      );

      setInitRows([...rows]);
      setSaved(true);
      setSavedAt(new Date());
      openSC?.();
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
          <button className="btn">{I.printer()} Print</button>
          {canEdit && <button className="btn primary">{I.plus()} Add item</button>}
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
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    placeholder="Search items…"
                    style={{ width: '100%', padding: '6px 10px 6px 28px', border: '1px solid var(--line)', borderRadius: 7, fontSize: 12 }}
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
                {invoices.length} invoices · {fmtMoney(invoices.reduce((s: number, i: any) => s + i.total, 0))}
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
                      <td style={{ fontWeight: 700 }}>{iv.vendor}</td>
                      <td className="num" style={{ color: 'var(--muted)' }}>{iv.number}</td>
                      <td style={{ color: 'var(--muted)' }}>{new Date(iv.date + 'T12:00:00').toLocaleDateString()}</td>
                      <td className="r num">{iv.items}</td>
                      <td className="r num">{fmtMoneyFull(iv.total)}</td>
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
            {saving ? 'Saving…' : <><I.save /> Save &amp; sync</>}
          </button>
        )}
      </div>
    </div>
  );
}
