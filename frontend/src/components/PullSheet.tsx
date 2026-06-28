import { useState, useEffect, useMemo, useCallback } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL, MONTHS } from '../lib/constants';
import { api } from '../lib/api';
import { useEscapeClose } from '../lib/useEscapeClose';

const t = (msg: string) => (window as any).toast?.(msg);

function fmt(v: number) {
  return '$' + v.toFixed(2);
}

interface PullSheetProps {
  user: User;
  initialMonth?: number; // 1-indexed
  initialYear?: number;
  onStagingDone?: () => void;
}

const now = new Date();
const DEFAULT_MONTH = now.getMonth() + 1; // 1-indexed current month
const DEFAULT_YEAR = now.getFullYear();
const DEFAULT_WEEK = Math.min(Math.ceil(now.getDate() / 7), 4);

export function PullSheet({ user, initialMonth, initialYear, onStagingDone }: PullSheetProps) {
  const lvl = ROLE_LEVEL[user.role];
  const canStage = lvl >= 10;

  const [month, setMonth] = useState(initialMonth ?? DEFAULT_MONTH);
  const [year, setYear] = useState(initialYear ?? DEFAULT_YEAR);
  const [week, setWeek] = useState(DEFAULT_WEEK);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // qty map: sku -> pull qty
  const [qtys, setQtys] = useState<Record<string, number>>({});

  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const [staging, setStaging] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Draft key based on period+week
  const draftKey = `mjcc_pull_${year}_${month}_w${week}`;

  // Load inventory for selected month/year
  const load = useCallback(async () => {
    setLoading(true);
    setLoadErr(null);
    try {
      const data = await api.getInventory(month, year);
      setItems(data?.items || []);
    } catch (e: any) {
      setLoadErr(e?.message || 'Failed to load inventory');
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [month, year]);

  useEffect(() => { load(); }, [load]);

  // Load draft from localStorage when period/week changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setQtys(parsed.items || {});
      } else {
        setQtys({});
      }
    } catch {
      setQtys({});
    }
  }, [draftKey]);

  const setQty = (sku: string, val: number) => {
    setQtys(prev => ({ ...prev, [sku]: Math.max(0, val) }));
  };

  // Filtered rows
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return items.filter(it => {
      const hasDraft = (qtys[it.sku] || 0) > 0;
      if (!showAll && (it.on_hand ?? it.onHand ?? 0) <= 0 && !hasDraft) return false;
      if (lq) {
        const sku = String(it.sku || '').toLowerCase();
        const desc = String(it.desc || it.description || '').toLowerCase();
        if (!sku.includes(lq) && !desc.includes(lq)) return false;
      }
      return true;
    });
  }, [items, qtys, showAll, q]);

  // Pulled items (qty > 0)
  const pulledItems = useMemo(() =>
    items
      .filter(it => (qtys[it.sku] || 0) > 0)
      .map(it => ({
        sku: String(it.sku),
        desc: String(it.desc || it.description || it.sku),
        qty: qtys[it.sku] || 0,
        price: Number(it.price || 0),
        value: (qtys[it.sku] || 0) * Number(it.price || 0),
      })),
    [items, qtys]
  );

  const totalValue = pulledItems.reduce((s, i) => s + i.value, 0);
  const anyPulled = pulledItems.length > 0;

  function saveDraft() {
    localStorage.setItem(draftKey, JSON.stringify({ week, items: qtys }));
    t('Draft saved.');
  }

  async function confirmPull() {
    if (!canStage) { t('Insufficient permissions'); return; }
    setStaging(true);
    try {
      await api.stageWeeklyPull({
        month,
        year,
        week,
        items: pulledItems.map(i => ({ sku: i.sku, desc: i.desc, qty: i.qty, price: i.price })),
        note: `Pull sheet W${week} · ${MONTHS[month - 1]} ${year}`,
      });
      // Clear draft
      localStorage.removeItem(draftKey);
      setQtys({});
      setShowConfirm(false);
      t(`Pull sheet staged — ${pulledItems.length} item${pulledItems.length !== 1 ? 's' : ''}, ${fmt(totalValue)} total.`);
      window.dispatchEvent(new CustomEvent('mjcc:committed'));
      window.dispatchEvent(new CustomEvent('mjcc:staging-changed'));
      onStagingDone?.();
    } catch (e: any) {
      t(`Stage failed: ${e?.message || 'Unknown error'}`);
    } finally {
      setStaging(false);
    }
  }

  useEscapeClose(showConfirm, () => setShowConfirm(false));

  const monthOpts = MONTHS.map((m, i) => ({ value: i + 1, label: m }));
  const yearOpts = [DEFAULT_YEAR - 1, DEFAULT_YEAR, DEFAULT_YEAR + 1].map(y => ({ value: y, label: String(y) }));
  const weekOpts = [1, 2, 3, 4].map(w => ({ value: w, label: `Week ${w}` }));

  return (
    <div className="fade-in" style={{ paddingBottom: anyPulled ? 72 : 0 }}>
      {/* Page head */}
      <div className="page-head">
        <div>
          <h2>Pull Sheet</h2>
          <div className="ph-sub">Record weekly inventory pulls (issued quantities)</div>
        </div>
        <div className="ph-actions" style={{ gap: 8, display: 'flex', alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Period selectors */}
          <select
            className="field"
            style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
            value={month}
            onChange={e => setMonth(Number(e.target.value))}
            aria-label="Month"
          >
            {monthOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            className="field"
            style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
            value={year}
            onChange={e => setYear(Number(e.target.value))}
            aria-label="Year"
          >
            {yearOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          <select
            className="field"
            style={{ width: 'auto', padding: '5px 10px', fontSize: 13 }}
            value={week}
            onChange={e => setWeek(Number(e.target.value))}
            aria-label="Week"
          >
            {weekOpts.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
      </div>

      {/* Filter bar */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          className="field"
          style={{ maxWidth: 260, padding: '6px 10px', fontSize: 13 }}
          placeholder="Search SKU or description…"
          value={q}
          onChange={e => setQ(e.target.value)}
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: 'var(--muted)', cursor: 'pointer' }}>
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show zero-on-hand items
        </label>
      </div>

      {loading && (
        <div className="load-wrap">
          <div className="spinner" />
          <div>Loading inventory…</div>
        </div>
      )}
      {loadErr && (
        <div className="banner warn">
          {I.alert()} <span>{loadErr}</span>
          <span className="bx" onClick={load}>Retry</span>
        </div>
      )}

      {!loading && !loadErr && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-body flush tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>SKU</th>
                  <th>Description</th>
                  <th style={{ textAlign: 'right' }}>Unit Price</th>
                  <th style={{ textAlign: 'right' }}>On Hand</th>
                  <th style={{ textAlign: 'center', width: 110 }}>Pull Qty</th>
                  <th style={{ textAlign: 'right' }}>Value Pulled</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={6} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--faint)', fontSize: 13 }}>
                      No items match — try "Show zero-on-hand items" or clear the search.
                    </td>
                  </tr>
                )}
                {filtered.map(it => {
                  const sku = String(it.sku);
                  const desc = String(it.desc || it.description || sku);
                  const price = Number(it.price || 0);
                  const onHand = Number(it.on_hand ?? it.onHand ?? 0);
                  const qty = qtys[sku] || 0;
                  const rowValue = qty * price;
                  const isDirty = qty > 0;
                  return (
                    <tr key={sku} style={isDirty ? { background: 'var(--accent-soft)' } : undefined}>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{sku}</td>
                      <td>{desc}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(price)}</td>
                      <td style={{ textAlign: 'right', color: onHand <= 0 ? 'var(--faint)' : undefined }}>{onHand}</td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="number"
                          min={0}
                          step={1}
                          value={qty === 0 ? '' : qty}
                          placeholder="0"
                          onChange={e => setQty(sku, Number(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                          style={{
                            width: 80,
                            textAlign: 'center',
                            padding: '4px 6px',
                            border: '1px solid var(--line)',
                            borderRadius: 'var(--radius-sm)',
                            fontSize: 13,
                            background: 'var(--surface)',
                            color: 'var(--ink)',
                          }}
                        />
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: isDirty ? 'var(--green)' : 'var(--faint)' }}>
                        {isDirty ? fmt(rowValue) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fixed bottom toolbar — appears when any qty > 0 */}
      {anyPulled && (
        <div style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          background: 'var(--surface)',
          borderTop: '1px solid var(--line)',
          padding: '12px 24px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          zIndex: 90,
          boxShadow: '0 -2px 12px rgba(15,27,51,.08)',
        }}>
          <span style={{ fontSize: 13, color: 'var(--muted)', marginRight: 'auto' }}>
            {pulledItems.length} item{pulledItems.length !== 1 ? 's' : ''} · {fmt(totalValue)} total value
          </span>
          <button className="btn" onClick={saveDraft}>
            {I.check({ style: { width: 14, height: 14 } })} Save Draft
          </button>
          {canStage && (
            <button className="btn primary" onClick={() => setShowConfirm(true)}>
              {I.branch({ style: { width: 14, height: 14 } })} Stage Pull
            </button>
          )}
        </div>
      )}

      {/* Confirm dialog */}
      {showConfirm && (
        <div className="overlay" onClick={() => setShowConfirm(false)}>
          <div className="modal" style={{ maxWidth: 460 }} onClick={e => e.stopPropagation()}>
            <div className="modal-head">
              <span>Confirm Pull — {MONTHS[month - 1]} {year} W{week}</span>
              <button className="modal-x" onClick={() => setShowConfirm(false)} aria-label="Close">{I.x()}</button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
                The following items will be staged as issued for Week {week}:
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 14 }}>
                {pulledItems.map(it => (
                  <div key={it.sku} style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    padding: '6px 0',
                    borderBottom: '1px solid var(--line-soft)',
                    fontSize: 13,
                    gap: 8,
                  }}>
                    <span style={{ flex: 1, color: 'var(--ink)' }}>
                      {it.desc}
                    </span>
                    <span style={{ color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                      {it.qty} qty × {fmt(it.price)} = <strong style={{ color: 'var(--ink)' }}>{fmt(it.value)}</strong>
                    </span>
                  </div>
                ))}
              </div>
              <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                padding: '10px 0 0',
                borderTop: '2px solid var(--line)',
                fontWeight: 600,
                fontSize: 14,
              }}>
                <span>Total value pulled</span>
                <span style={{ color: 'var(--green)' }}>{fmt(totalValue)}</span>
              </div>
            </div>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', padding: '12px 20px', borderTop: '1px solid var(--line-soft)' }}>
              <button className="btn" onClick={() => setShowConfirm(false)} disabled={staging}>Cancel</button>
              <button className="btn primary" onClick={confirmPull} disabled={staging}>
                {staging ? 'Staging…' : 'Confirm Pull'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
