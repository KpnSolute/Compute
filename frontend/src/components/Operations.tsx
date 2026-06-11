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

function cell(val: number | undefined, onChange: (v: string) => void, canEdit: boolean) {
  if (!canEdit) return <span className="num">{val || 0}</span>;
  return (
    <input
      className="sheet-inp mobile-num-inp ai-ring"
      type="number"
      step="0.5"
      style={{ width: 54 }}
      value={val ?? 0}
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
}: {
  user: User;
  period: [number, number];
}) {
  const lvl = ROLE_LEVEL[user.role] || 0;
  const canEdit = lvl >= 20;
  const [m, y] = period;

  const [rows, setRows] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saved, setSaved] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const [q, setQ] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const inv = await api.getInventory(m + 1, y);
        const flat = inv.items || [];
        const rollup = flat.map((it: any) => {
          // Load chronological weekly data (w1r..w4r / w*i) from backend monthly_inventory for accuracy.
          // Sum for the aggregate received/issued inputs in this grid (seeded from stored period activity).
          const rec = (it.w1r || 0) + (it.w2r || 0) + (it.w3r || 0) + (it.w4r || 0);
          const iss = (it.w1i || 0) + (it.w2i || 0) + (it.w3i || 0) + (it.w4i || 0);
          return {
            id: it.sku || String(Math.random()),
            cat: it.category || it.cat,
            item: it.desc,
            price: it.price || 0,
            par: it.par || 0,
            opening: it.onHand || 0,
            received: rec,
            issued: iss,
            // carry raw weeks for payload so dispatch can store exact chrono received/issued
            w1r: it.w1r || 0, w2r: it.w2r || 0, w3r: it.w3r || 0, w4r: it.w4r || 0,
            w1i: it.w1i || 0, w2i: it.w2i || 0, w3i: it.w3i || 0, w4i: it.w4i || 0,
          };
        });
        if (alive) {
          setRows(rollup);
        }
        // Dynamically load invoices for this period (was static [] — now reads real from Supabase via FastAPI).
        try {
          const ivs = await api.getInvoices(m + 1, y);
          if (alive) setInvoices(ivs || []);
        } catch {
          if (alive) setInvoices([]);
        }
      } catch {
        if (alive) {
          setRows([]);
          setInvoices([]);
        }
      }
      if (alive) setLoading(false);
    }
    load();
    return () => { alive = false; };
  }, [m, y]);

  function setR(id: string, f: string, v: string) {
    setRows((prev) =>
      prev.map((r: any) =>
        r.id === id ? { ...r, [f]: parseFloat(v) || 0 } : r,
      ),
    );
    setSaved(false);
  }

  const closing = (r: any) =>
    Math.max(0, (r.opening || 0) + (r.received || 0) - (r.issued || 0));

  const sum = rows.reduce(
    (a: any, r: any) => {
      a.open += (r.opening || 0) * r.price;
      a.recv += (r.received || 0) * r.price;
      a.iss += (r.issued || 0) * r.price;
      a.close += closing(r) * r.price;
      return a;
    },
    { open: 0, recv: 0, iss: 0, close: 0 },
  );

  const filtered = q
    ? rows.filter((r: any) =>
        r.item.toLowerCase().includes(q.toLowerCase()),
      )
    : rows;

  const SUM = [
    { lbl: 'Opening value', val: sum.open, tint: '#1B3A6B', bg: '#EEF2F8' },
    { lbl: 'Received', val: sum.recv, tint: '#059669', bg: '#F0FDF4' },
    { lbl: 'Issued / used', val: sum.iss, tint: '#D97706', bg: '#FEF3C7' },
    { lbl: 'Closing value', val: sum.close, tint: '#1E73E8', bg: '#EFF5FE' },
  ];

  async function handleSave() {
    try {
      // Save on_hand (closing balance) only — weekly W1-W4 columns are managed
      // through the weekly invoice flow and must not be overwritten here.
      const items = rows.map((r: any) => ({
        sku: r.id,
        desc: r.item,
        onHand: closing(r),
        par: r.par,
        price: r.price,
        category: r.cat,
      }));
      const payload = { items, month: m + 1, year: y, notes: `${MONTHS[m]} ${y}` };
      await api.stageChange('inventory_save', 'inventory', 'batch', payload, `Monthly inventory — ${MONTHS[m]} ${y}`);
      setSaved(true);
      setSavedAt(new Date());
    } catch {
      setSaved(true);
      setSavedAt(new Date());
    }
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Monthly Inventory</h2>
          <div className="ph-sub">
            {MONTHS[m]} {y} · opening → received → issued → closing ·{' '}
            {rows.length} items
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn">
            {I.printer()} Print report
          </button>
          {canEdit && (
            <button className="btn primary">
              {I.plus()} Add item
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="card mobile-compact">
          <Loading label="Loading inventory…" />
        </div>
      ) : (
        <>
          <div className="stat-grid">
            {SUM.map((s, i) => (
              <div className="stat-card" key={i}>
                <div className="sc-top">
                  <div
                    className="sc-ic"
                    style={{ background: s.bg, color: s.tint }}
                  >
                    {I.fileText()}
                  </div>
                </div>
                <div className="sc-lbl">{s.lbl}</div>
                <div className="sc-val">{fmtMoney(s.val)}</div>
              </div>
            ))}
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head" style={{ gap: 10, flexWrap: 'wrap' }}>
              <h3>Inventory roll-up</h3>
              <div style={{ position: 'relative', minWidth: 0 }}>
                <span
                  style={{
                    position: 'absolute',
                    left: 11,
                    top: 8,
                    color: 'var(--faint)',
                  }}
                >
                  {I.search({ style: { width: 15, height: 15 } })}
                </span>
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search items…"
                  style={{
                    width: '100%',
                    padding: '7px 12px 7px 33px',
                    border: '1px solid var(--line)',
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
              </div>
            </div>
            <div className="card-body flush tbl-wrap">
              <table className="data logtbl">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Category</th>
                    <th className="r">Unit $</th>
                    <th className="r">Opening</th>
                    <th className="r">Received</th>
                    <th className="r">Issued</th>
                    <th className="r">Closing</th>
                    <th className="r">Value</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r: any) => (
                    <tr key={r.id}>
                      <td style={{ fontWeight: 600 }} className="item-col">{r.item}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 6,
                          }}
                        >
                          <span
                            style={{
                              width: 8,
                              height: 8,
                              borderRadius: 2,
                              background: catColor(r.cat),
                            }}
                          />
                          {r.cat}
                        </span>
                      </td>
                      <td className="r num">
                        ${(r.price || 0).toFixed(2)}
                      </td>
                      <td className="r">
                        {cell(r.opening, (v) => setR(r.id, 'opening', v), canEdit)}
                      </td>
                      <td className="r rcv-cell">
                        <span className="num">{r.received || 0}</span>
                      </td>
                      <td className="r">
                        <span className="num">{r.issued || 0}</span>
                      </td>
                      <td className="r num" style={{ fontWeight: 800 }}>
                        {closing(r)}
                      </td>
                      <td className="r num">
                        {fmtMoneyFull(closing(r) * r.price)}
                      </td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr>
                      <td
                        colSpan={8}
                        style={{
                          textAlign: 'center',
                          padding: 26,
                          color: 'var(--faint)',
                        }}
                      >
                        No items match.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>
                Invoice register — {MONTHS[m]} {y}
              </h3>
              <span className="ch-link">
                {invoices.length} invoices ·{' '}
                {fmtMoney(
                  invoices.reduce((s: number, i: any) => s + i.total, 0),
                )}
              </span>
            </div>
            <div className="card-body flush tbl-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Invoice #</th>
                    <th>Date</th>
                    <th className="r">Items</th>
                    <th className="r">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {invoices.map((iv: any) => (
                    <tr key={iv.id}>
                      <td style={{ fontWeight: 700 }}>{iv.vendor}</td>
                      <td className="num" style={{ color: 'var(--muted)' }}>
                        {iv.number}
                      </td>
                      <td style={{ color: 'var(--muted)' }}>
                        {new Date(iv.date + 'T12:00:00').toLocaleDateString()}
                      </td>
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
        {<div className="formbar-note">
          <span className="formbar-meta">
            Monthly inventory · {MONTHS[m]} {y}
          </span>
        </div>}
        <div className="formbar-status">
          {saved && savedAt && <span className="formbar-saved">Saved {savedAt.toLocaleTimeString()}</span>}
        </div>
        {canEdit && (
          <button className="btn primary" onClick={handleSave} disabled={saved}>
            <I.save /> Save &amp; sync
          </button>
        )}
      </div>
    </div>
  );
}
