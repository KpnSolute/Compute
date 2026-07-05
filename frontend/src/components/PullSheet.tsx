import { Fragment, useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL, MONTHS } from '../lib/constants';
import { api } from '../lib/api';
import { useEscapeClose } from '../lib/useEscapeClose';
import { itemTotals } from '../lib/inventoryFormulas';
import { StatusPill } from './ui/StatusPill';

const t = (msg: string) => (window as any).toast?.(msg);

function fmt(v: number) {
  return '$' + v.toFixed(2);
}

const pnum = (v: any) => Number.isFinite(Number(v)) ? Number(v) : 0;
const pcat = (it: any) => String(it.category || it.cat || it.category_name || 'Uncategorized').trim() || 'Uncategorized';
const pdesc = (it: any) => String(it.desc || it.description || it.name || it.sku || '');
const punit = (it: any) => String(it.unit || it.uom || it.unit_of_measure || '-');
const ppar = (it: any) => pnum(it.par ?? it.par_level ?? it.parLevel);
const pprice = (it: any) => pnum(it.price ?? it.unit_price ?? it.unitPrice);
const pavailable = (it: any) => typeof it.closingQty === 'number'
  ? it.closingQty
  : itemTotals(it).ending;

function PullSheetSelect<T extends number | string>({
  value,
  onChange,
  options,
  label,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
  label: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', closeOnOutside);
    window.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('mousedown', closeOnOutside);
      window.removeEventListener('keydown', closeOnEscape);
    };
  }, [open]);

  return (
    <div className="pull-select" ref={ref}>
      <button
        type="button"
        className="pull-select-btn"
        onClick={() => setOpen((current) => !current)}
        aria-label={label}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span>{selected?.label ?? String(value)}</span>
        {I.down({ style: { width: 12, height: 12 } })}
      </button>
      {open && (
        <div className="pull-select-menu" role="listbox" aria-label={label}>
          {options.map((option) => (
            <button
              key={String(option.value)}
              type="button"
              role="option"
              aria-selected={option.value === value}
              className="pull-select-option"
              data-active={option.value === value}
              onClick={() => {
                onChange(option.value);
                setOpen(false);
              }}
            >
              {option.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
const DEFAULT_WEEK = Math.min(Math.ceil(now.getDate() / 7), 3);
const PULL_WEEKS = [1, 2, 3] as const;

export function PullSheet({ user, initialMonth, initialYear, onStagingDone }: PullSheetProps) {
  const lvl = ROLE_LEVEL[user.role];
  const canStage = lvl >= 30;

  const [month, setMonth] = useState(initialMonth ?? DEFAULT_MONTH);
  const [year, setYear] = useState(initialYear ?? DEFAULT_YEAR);
  const [week, setWeek] = useState(DEFAULT_WEEK);

  const [items, setItems] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState<string | null>(null);

  // qty map: sku -> pull qty
  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [compactQtys, setCompactQtys] = useState<Record<number, Record<string, number>>>({});

  const [showAll, setShowAll] = useState(false);
  const [q, setQ] = useState('');
  const [cat, setCat] = useState('');
  const [viewMode, setViewMode] = useState<'regular' | 'compact'>('regular');
  const [staging, setStaging] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Draft key based on period+week
  const draftKey = `mjcc_pull_${year}_${month}_w${week}`;
  const draftKeyForWeek = useCallback((wk: number) => `mjcc_pull_${year}_${month}_w${wk}`, [month, year]);

  useEffect(() => {
    if (initialMonth) setMonth(initialMonth);
  }, [initialMonth]);

  useEffect(() => {
    if (initialYear) setYear(initialYear);
  }, [initialYear]);

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

  useEffect(() => {
    const refresh = () => { void load(); };
    window.addEventListener('mjcc:live-data-changed', refresh);
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('mjcc:live-data-changed', refresh);
      window.removeEventListener('focus', refresh);
    };
  }, [load]);

  // Load draft from localStorage when period/week changes
  useEffect(() => {
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        setQtys(parsed.items || {});
        setCompactQtys(prev => ({ ...prev, [week]: parsed.items || {} }));
      } else {
        setQtys({});
        setCompactQtys(prev => ({ ...prev, [week]: {} }));
      }
    } catch {
      setQtys({});
      setCompactQtys(prev => ({ ...prev, [week]: {} }));
    }
  }, [draftKey, week]);

  useEffect(() => {
    const next: Record<number, Record<string, number>> = {};
    for (const wk of PULL_WEEKS) {
      try {
        const raw = localStorage.getItem(draftKeyForWeek(wk));
        next[wk] = raw ? (JSON.parse(raw).items || {}) : {};
      } catch {
        next[wk] = {};
      }
    }
    setCompactQtys(next);
  }, [draftKeyForWeek]);

  const setQty = (sku: string, val: number) => {
    const qty = Math.max(0, val);
    setQtys(prev => ({ ...prev, [sku]: qty }));
    setCompactQtys(prev => ({ ...prev, [week]: { ...(prev[week] || {}), [sku]: qty } }));
  };

  const setCompactQty = (wk: number, sku: string, val: number) => {
    const qty = Math.max(0, val);
    setCompactQtys(prev => ({ ...prev, [wk]: { ...(prev[wk] || {}), [sku]: qty } }));
    if (wk === week) setQtys(prev => ({ ...prev, [sku]: qty }));
  };

  const existingWeekQty = useCallback((it: any) => pnum(it[`w${week}p`]), [week]);
  const pullQtyFor = useCallback((it: any) => {
    const sku = String(it.sku || '');
    return Object.prototype.hasOwnProperty.call(qtys, sku) ? qtys[sku] || 0 : existingWeekQty(it);
  }, [existingWeekQty, qtys]);
  const pullQtyForWeek = useCallback((it: any, wk: number) => {
    const sku = String(it.sku || '');
    const draft = compactQtys[wk] || {};
    return Object.prototype.hasOwnProperty.call(draft, sku) ? draft[sku] || 0 : pnum(it[`w${wk}p`]);
  }, [compactQtys]);

  const categories = useMemo(() => {
    const names = items
      .map(pcat)
      .filter(name => name !== 'Uncategorized');
    return [...new Set(names)].sort((a, b) => a.localeCompare(b));
  }, [items]);

  // Filtered rows
  const filtered = useMemo(() => {
    const lq = q.toLowerCase();
    return items.filter(it => {
      const itemCat = pcat(it);
      if (cat && itemCat !== cat) return false;
      const hasPull = viewMode === 'compact'
        ? PULL_WEEKS.some(wk => pullQtyForWeek(it, wk) > 0)
        : pullQtyFor(it) > 0;
      if (!showAll && pavailable(it) <= 0 && !hasPull) return false;
      if (lq) {
        const sku = String(it.sku || '').toLowerCase();
        const desc = pdesc(it).toLowerCase();
        const category = itemCat.toLowerCase();
        const price = `$${Number(it.price || 0).toFixed(2)}`.toLowerCase();
        if (!sku.includes(lq) && !desc.includes(lq) && !category.includes(lq) && !price.includes(lq)) return false;
      }
      return true;
    });
  }, [items, pullQtyFor, pullQtyForWeek, showAll, q, cat, viewMode]);

  // Pulled items (qty > 0)
  const pulledItems = useMemo(() =>
    items
      .filter(it => pullQtyFor(it) > 0)
      .map(it => ({
        sku: String(it.sku),
        desc: pdesc(it),
        qty: pullQtyFor(it),
        price: pprice(it),
        category: pcat(it),
        unit: punit(it),
        value: pullQtyFor(it) * pprice(it),
      })),
    [items, pullQtyFor]
  );

  const stagedItems = useMemo(() =>
    items
      .filter(it => {
        const sku = String(it.sku || '');
        return pullQtyFor(it) > 0 || Object.prototype.hasOwnProperty.call(qtys, sku);
      })
      .map(it => ({
        sku: String(it.sku),
        desc: pdesc(it),
        qty: pullQtyFor(it),
        price: pprice(it),
        category: pcat(it),
        unit: punit(it),
        value: pullQtyFor(it) * pprice(it),
      })),
    [items, pullQtyFor, qtys]
  );

  const compactStagedByWeek = useMemo(() =>
    PULL_WEEKS.map(wk => ({
      week: wk,
      items: items
        .filter(it => {
          const sku = String(it.sku || '');
          const draft = compactQtys[wk] || {};
          return pullQtyForWeek(it, wk) > 0 || Object.prototype.hasOwnProperty.call(draft, sku);
        })
        .map(it => {
          const qty = pullQtyForWeek(it, wk);
          const price = pprice(it);
          return {
            sku: String(it.sku),
            desc: pdesc(it),
            qty,
            price,
            category: pcat(it),
            unit: punit(it),
            value: qty * price,
          };
        }),
    })).filter(group => group.items.length > 0),
    [compactQtys, items, pullQtyForWeek]
  );

  const totalValue = pulledItems.reduce((s, i) => s + i.value, 0);
  const compactTotalValue = compactStagedByWeek.reduce((sum, group) =>
    sum + group.items.reduce((groupSum, item) => groupSum + item.value, 0), 0);
  const compactPullQty = compactStagedByWeek.reduce((sum, group) =>
    sum + group.items.reduce((groupSum, item) => groupSum + item.qty, 0), 0);
  const stagedItemCount = viewMode === 'compact'
    ? compactStagedByWeek.reduce((sum, group) => sum + group.items.length, 0)
    : stagedItems.length;
  const actionTotalValue = viewMode === 'compact' ? compactTotalValue : totalValue;
  const anyPulled = pulledItems.length > 0;
  const anyStaged = viewMode === 'compact' ? compactStagedByWeek.length > 0 : stagedItems.length > 0;
  const filteredGroups = useMemo(() => {
    const groups = new Map<string, any[]>();
    filtered.forEach((it) => {
      const name = pcat(it);
      groups.set(name, [...(groups.get(name) || []), it]);
    });
    return [...groups.entries()].map(([name, rows]) => ({ name, rows }));
  }, [filtered]);
  const pullStats = useMemo(() => {
    const availableUnits = filtered.reduce((s, it) => s + pavailable(it), 0);
    return [
      { label: 'Visible Items', value: filtered.length.toLocaleString(), icon: I.box },
      { label: 'Categories', value: filteredGroups.length.toLocaleString(), icon: I.archive },
      { label: 'On Hand Units', value: availableUnits.toLocaleString(), icon: I.database },
      {
        label: viewMode === 'compact' ? 'All Week Pulls' : `Week ${week} Pull`,
        value: (viewMode === 'compact' ? compactPullQty : pulledItems.reduce((s, it) => s + it.qty, 0)).toLocaleString(),
        icon: I.down,
        tone: 'accent',
      },
      { label: 'Value Pulled', value: fmt(actionTotalValue), icon: I.dollar, tone: anyStaged || anyPulled ? 'accent' : 'muted' },
    ];
  }, [actionTotalValue, anyPulled, anyStaged, compactPullQty, filtered, filteredGroups.length, pulledItems, viewMode, week]);

  function saveDraft() {
    if (viewMode === 'compact') {
      for (const wk of PULL_WEEKS) {
        localStorage.setItem(draftKeyForWeek(wk), JSON.stringify({ week: wk, items: compactQtys[wk] || {} }));
      }
      t('All week drafts saved.');
      return;
    }
    localStorage.setItem(draftKey, JSON.stringify({ week, items: qtys }));
    t('Draft saved.');
  }

  async function confirmPull() {
    if (!canStage) { t('Insufficient permissions'); return; }
    if (viewMode === 'compact') {
      if (!compactStagedByWeek.length) { t('Enter or clear at least one pull quantity before staging.'); return; }
      setStaging(true);
      try {
        for (const group of compactStagedByWeek) {
          await api.stageWeeklyPull({
            month,
            year,
            week: group.week,
            items: group.items.map(i => ({
              sku: i.sku,
              desc: i.desc,
              qty: i.qty,
              price: i.price,
              category: i.category,
              unit: i.unit,
            })),
            note: `Pull sheet W${group.week} - ${MONTHS[month - 1]} ${year}`,
          });
          localStorage.removeItem(draftKeyForWeek(group.week));
        }
        setCompactQtys({});
        setQtys({});
        setShowConfirm(false);
        t(`Pull sheet staged - ${stagedItemCount} item${stagedItemCount !== 1 ? 's' : ''} across ${compactStagedByWeek.length} week${compactStagedByWeek.length !== 1 ? 's' : ''}, ${fmt(compactTotalValue)} total.`);
        window.dispatchEvent(new CustomEvent('mjcc:staging-changed'));
        window.dispatchEvent(new CustomEvent('mjcc:open-sc'));
        onStagingDone?.();
      } catch (e: any) {
        t(`Stage failed: ${e?.message || 'Unknown error'}`);
      } finally {
        setStaging(false);
      }
      return;
    }
    if (!stagedItems.length) { t('Enter or clear at least one pull quantity before staging.'); return; }
    setStaging(true);
    try {
      await api.stageWeeklyPull({
        month,
        year,
        week,
        items: stagedItems.map(i => ({
          sku: i.sku,
          desc: i.desc,
          qty: i.qty,
          price: i.price,
          category: i.category,
          unit: i.unit,
        })),
        note: `Pull sheet W${week} · ${MONTHS[month - 1]} ${year}`,
      });
      // Clear draft
      localStorage.removeItem(draftKey);
      setQtys({});
      setShowConfirm(false);
      t(`Pull sheet staged - ${stagedItems.length} item${stagedItems.length !== 1 ? 's' : ''}, ${fmt(totalValue)} total.`);
      window.dispatchEvent(new CustomEvent('mjcc:staging-changed'));
      window.dispatchEvent(new CustomEvent('mjcc:open-sc'));
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
  const weekOpts = [1, 2, 3].map(w => ({ value: w, label: `Week ${w}` }));

  return (
    <div className="fade-in" style={{ paddingBottom: anyStaged ? 72 : 0 }}>
      {/* Page head */}
      <div className="page-head">
        <div>
          <h2>Pull Sheet</h2>
          <div className="ph-sub">Manager weekly pulls · stages to Source Control before live inventory changes</div>
        </div>
        <div className="ph-actions pull-period-actions">
          {anyStaged && (
            <StatusPill ok>{fmt(actionTotalValue)} staged · {stagedItemCount} item{stagedItemCount !== 1 ? 's' : ''}</StatusPill>
          )}
          {/* Period selectors */}
          <PullSheetSelect
            label="Pull sheet month"
            value={month}
            onChange={setMonth}
            options={monthOpts}
          />
          <PullSheetSelect
            label="Pull sheet year"
            value={year}
            onChange={setYear}
            options={yearOpts}
          />
          <PullSheetSelect
            label="Pull sheet week"
            value={week}
            onChange={setWeek}
            options={weekOpts}
          />
        </div>
      </div>

      {/* Filter bar */}
      <div className="pull-filter-bar">
        <div className="pull-search-wrap">
          <span className="pull-search-icon">{I.search({ style: { width: 14, height: 14 } })}</span>
          <input
            className="ipt pull-search-input"
            placeholder="Search SKU or description…"
            value={q}
            onChange={e => setQ(e.target.value)}
          />
        </div>
        <PullSheetSelect
          label="Item category"
          value={cat}
          onChange={setCat}
          options={[
            { value: '', label: 'All categories' },
            ...categories.map((name) => ({ value: name, label: name })),
          ]}
        />
        <label className="pull-zero-toggle">
          <input type="checkbox" checked={showAll} onChange={e => setShowAll(e.target.checked)} />
          Show zero-on-hand items
        </label>
        <div className="view-toggle pull-view-toggle" role="tablist" aria-label="Pull sheet view">
          <button
            type="button"
            className={`vt-btn${viewMode === 'regular' ? ' active' : ''}`}
            onClick={() => setViewMode('regular')}
            role="tab"
            aria-selected={viewMode === 'regular'}
          >
            Regular
          </button>
          <button
            type="button"
            className={`vt-btn${viewMode === 'compact' ? ' active' : ''}`}
            onClick={() => setViewMode('compact')}
            role="tab"
            aria-selected={viewMode === 'compact'}
          >
            Compact
          </button>
        </div>
      </div>

      <div className="pull-kpi-grid">
        {pullStats.map((stat) => {
          const Icon = stat.icon;
          return (
            <div className="pull-kpi-card" data-tone={stat.tone || 'default'} key={stat.label}>
              <div className="pull-kpi-label">
                <Icon />
                <span>{stat.label}</span>
              </div>
              <div className="pull-kpi-value">{stat.value}</div>
            </div>
          );
        })}
      </div>

      {viewMode === 'regular' && (
        <div className="pull-week-tabs">
          {weekOpts.map((o) => (
            <button
              type="button"
              className="pull-week-tab"
              data-on={week === o.value}
              key={o.value}
              onClick={() => setWeek(o.value)}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}

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

      {!loading && !loadErr && viewMode === 'regular' && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-body flush tbl-wrap">
            <table className="data pull-sheet-table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th>UOM</th>
                  <th style={{ textAlign: 'right' }}>Unit Price</th>
                  <th style={{ textAlign: 'right' }}>On Hand</th>
                  <th style={{ textAlign: 'right' }}>Par</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'center', width: 110 }}>Pull Qty</th>
                  <th style={{ textAlign: 'right' }}>Value Pulled</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)', fontSize: 13 }}>
                      No items match — try "Show zero-on-hand items" or clear the search.
                    </td>
                  </tr>
                )}
                {filteredGroups.map(group => (
                  <Fragment key={group.name}>
                    <tr className="pull-category-row">
                      <td colSpan={9}>
                        <span>{group.name}</span>
                        <em>{group.rows.length} item{group.rows.length !== 1 ? 's' : ''}</em>
                      </td>
                    </tr>
                    {group.rows.map(it => {
                      const sku = String(it.sku);
                      const desc = pdesc(it);
                      const price = pprice(it);
                      const onHand = pavailable(it);
                      const par = ppar(it);
                      const qty = pullQtyFor(it);
                      const rowValue = qty * price;
                      const isEdited = Object.prototype.hasOwnProperty.call(qtys, sku);
                      const isDirty = qty > 0 || isEdited;
                      const status = onHand <= 0 ? 'Out' : par > 0 && onHand <= par ? 'Low' : 'OK';
                  return (
                    <tr key={`${group.name}-${sku}`} style={isDirty ? { background: 'var(--accent-soft)' } : undefined}>
                      <td>{desc}</td>
                      <td style={{ fontFamily: 'var(--mono)', fontSize: 12 }}>{sku}</td>
                      <td>{punit(it)}</td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{fmt(price)}</td>
                      <td style={{ textAlign: 'right', color: onHand <= 0 ? 'var(--muted)' : undefined }}>{onHand}</td>
                      <td style={{ textAlign: 'right' }}>{par || '-'}</td>
                      <td><span className="pull-status" data-status={status.toLowerCase()}>{status}</span></td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          className="pull-qty-input"
                          type="number"
                          min={0}
                          step={1}
                          value={qty === 0 ? '' : qty}
                          placeholder="0"
                          onChange={e => setQty(sku, Number(e.target.value) || 0)}
                          onFocus={e => e.target.select()}
                        />
                      </td>
                      <td style={{ textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: isDirty ? 'var(--green)' : 'var(--muted)' }}>
                        {isDirty ? fmt(rowValue) : '—'}
                      </td>
                    </tr>
                  );
                    })}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {!loading && !loadErr && viewMode === 'compact' && (
        <div className="card" style={{ marginBottom: 0 }}>
          <div className="card-body flush tbl-wrap">
            <table className="data compact pull-sheet-compact">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>SKU</th>
                  <th className="r">OH</th>
                  <th className="r">Par</th>
                  <th>Status</th>
                  <th className="r">W1</th>
                  <th className="r">W2</th>
                  <th className="r">W3</th>
                  <th className="r">Value</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ textAlign: 'center', padding: '28px 0', color: 'var(--muted)', fontSize: 13 }}>
                      No items match.
                    </td>
                  </tr>
                )}
                {filtered.map((it) => {
                  const sku = String(it.sku);
                  const desc = pdesc(it);
                  const price = pprice(it);
                  const onHand = pavailable(it);
                  const par = ppar(it);
                  const weekQtys = PULL_WEEKS.map(wk => ({
                    wk,
                    qty: pullQtyForWeek(it, wk),
                    edited: Object.prototype.hasOwnProperty.call(compactQtys[wk] || {}, sku),
                  }));
                  const rowValue = weekQtys.reduce((sum, entry) => sum + entry.qty * price, 0);
                  const isDirty = weekQtys.some(entry => entry.qty > 0 || entry.edited);
                  const status = onHand <= 0 ? 'Out' : par > 0 && onHand <= par ? 'Low' : 'OK';
                  return (
                    <tr key={`compact-${sku}`} className={isDirty ? 'rcvd' : undefined}>
                      <td data-label="Item">{desc}</td>
                      <td data-label="SKU" style={{ fontFamily: 'var(--mono)', fontSize: 11 }}>{sku}</td>
                      <td data-label="OH" className="r num">{onHand}</td>
                      <td data-label="Par" className="r num">{par || '-'}</td>
                      <td data-label="Status"><span className="pull-status" data-status={status.toLowerCase()}>{status}</span></td>
                      {weekQtys.map(({ wk, qty }) => (
                        <td key={`${sku}-w${wk}`} data-label={`W${wk} Pull`} className="r">
                          <input
                            className="cinp pull-qty-input"
                            type="number"
                            min={0}
                            step={1}
                            value={qty === 0 ? '' : qty}
                            placeholder="0"
                            aria-label={`Week ${wk} pull quantity for ${desc}`}
                            onChange={e => setCompactQty(wk, sku, Number(e.target.value) || 0)}
                            onFocus={e => e.target.select()}
                          />
                        </td>
                      ))}
                      <td data-label="Value" className="r num" style={{ color: isDirty ? 'var(--green)' : 'var(--muted)' }}>
                        {isDirty ? fmt(rowValue) : '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Fixed bottom toolbar - appears when any pull quantity is staged or cleared */}
      {anyStaged && (
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
            {stagedItemCount} item{stagedItemCount !== 1 ? 's' : ''} - {fmt(actionTotalValue)} total value - {viewMode === 'compact'
              ? `${compactStagedByWeek.length} week${compactStagedByWeek.length !== 1 ? 's' : ''} staged`
              : `replaces W${week} issued on merge`}
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
              <span>{viewMode === 'compact'
                ? `Confirm Pull - ${MONTHS[month - 1]} ${year} all weeks`
                : `Confirm Pull - ${MONTHS[month - 1]} ${year} W${week}`}
              </span>
              <button className="modal-x" onClick={() => setShowConfirm(false)} aria-label="Close">{I.x()}</button>
            </div>
            <div className="modal-body" style={{ padding: '16px 20px' }}>
              <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--muted)' }}>
                {viewMode === 'compact'
                  ? 'The following week columns will be staged and will replace their issued quantities when Source Control merges:'
                  : `The following items will replace Week ${week} issued quantities when Source Control merges:`}
              </div>
              <div style={{ maxHeight: 260, overflowY: 'auto', marginBottom: 14 }}>
                {viewMode === 'compact' && compactStagedByWeek.map(group => (
                  <div key={`confirm-w${group.week}`} style={{ marginBottom: 12 }}>
                    <div style={{
                      fontSize: 11,
                      fontWeight: 800,
                      textTransform: 'uppercase',
                      color: 'var(--muted)',
                      padding: '8px 0 4px',
                    }}>
                      Week {group.week}
                    </div>
                    {group.items.map(it => (
                      <div key={`${group.week}-${it.sku}`} style={{
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
                          {it.qty} qty x {fmt(it.price)} = <strong style={{ color: 'var(--ink)' }}>{fmt(it.value)}</strong>
                        </span>
                      </div>
                    ))}
                  </div>
                ))}
                {viewMode !== 'compact' && stagedItems.map(it => (
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
                <span style={{ color: 'var(--green)' }}>{fmt(actionTotalValue)}</span>
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
