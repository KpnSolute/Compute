import { useEffect, useState } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL, MONTHS } from '../lib/constants';
import { fmtMoney } from '../lib/format';
import { api, type CostBudget, type CostSummary, type CostTrendPoint, type CostAverages, type SourceTransaction } from '../lib/api';
import { useEscapeClose } from '../lib/useEscapeClose';
import { SvgLineChart, CategoryDonut } from './ui/Charts';
import { BudgetLineItems } from './BudgetLineItems';

const toast = (msg: string) => (window as any).toast?.(msg);
const num = (v: string) => (v ? parseFloat(v) || 0 : 0);

function Loading() {
  return <div className="load-wrap"><div className="spinner" /><div>Loading…</div></div>;
}

interface Kpi {
  key: string;
  label: string;
  icon: keyof typeof I;
  tint: string;
  bg: string;
  val: string;
  sub?: string;
}

function KpiCard({ k }: { k: Kpi }) {
  return (
    <div className="stat-card kpi-card">
      <div className="sc-top">
        <div className="sc-ic" style={{ background: k.bg, color: k.tint }}>{I[k.icon]()}</div>
      </div>
      <div className="sc-lbl">{k.label}</div>
      <div className="sc-val">{k.val}</div>
      {k.sub && <div className="sc-delta" style={{ color: 'var(--muted)', fontWeight: 600 }}>{k.sub}</div>}
    </div>
  );
}

function WeeklyField({
  label,
  values,
  onChange,
}: {
  label: string;
  values: [string, string, string];
  onChange: (idx: 0 | 1 | 2, v: string) => void;
}) {
  const total = values.reduce((s, v) => s + num(v), 0);
  return (
    <div className="field">
      <label>{label} <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optional per-week target)</span></label>
      <div style={{ display: 'flex', gap: 6 }}>
        {(['Wk1', 'Wk2', 'Wk3'] as const).map((wk, i) => (
          <input
            key={wk}
            className="ipt"
            type="number"
            min={0}
            step="0.01"
            value={values[i]}
            onChange={(e) => onChange(i as 0 | 1 | 2, e.target.value)}
            placeholder={wk}
            aria-label={`${label} ${wk}`}
            style={{ flex: 1 }}
          />
        ))}
      </div>
      {total > 0 && <div className="hint" style={{ marginTop: 3 }}>Total: {fmtMoney(total)}</div>}
    </div>
  );
}

function BudgetWizard({
  month,
  year,
  initial,
  onClose,
  onSaved,
}: {
  month: number;
  year: number;
  initial: CostBudget | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [govAllotment, setGovAllotment] = useState(String(initial?.gov_allotment ?? ''));
  const [pull, setPull] = useState<[string, string, string]>([
    initial?.w1_planned_pull != null ? String(initial.w1_planned_pull) : '',
    initial?.w2_planned_pull != null ? String(initial.w2_planned_pull) : '',
    initial?.w3_planned_pull != null ? String(initial.w3_planned_pull) : '',
  ]);
  const [renewable, setRenewable] = useState<[string, string, string]>([
    initial?.w1_planned_renewable != null ? String(initial.w1_planned_renewable) : '',
    initial?.w2_planned_renewable != null ? String(initial.w2_planned_renewable) : '',
    initial?.w3_planned_renewable != null ? String(initial.w3_planned_renewable) : '',
  ]);
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [averages, setAverages] = useState<CostAverages | null>(null);
  const [saving, setSaving] = useState(false);

  useEscapeClose(true, onClose, saving);

  useEffect(() => {
    api.getCostAverages(6).then(setAverages).catch(() => setAverages(null));
  }, []);

  function useAverages() {
    if (!averages) return;
    const pullWk = Math.round((averages.avg_pull_amount / 3) * 100) / 100;
    const renewWk = Math.round((averages.avg_reviewable_amount / 3) * 100) / 100;
    setPull([String(pullWk), String(pullWk), String(pullWk)]);
    setRenewable([String(renewWk), String(renewWk), String(renewWk)]);
  }

  function setPullWeek(idx: 0 | 1 | 2, v: string) {
    setPull((prev) => { const next = [...prev] as [string, string, string]; next[idx] = v; return next; });
  }
  function setRenewableWeek(idx: 0 | 1 | 2, v: string) {
    setRenewable((prev) => { const next = [...prev] as [string, string, string]; next[idx] = v; return next; });
  }

  async function save() {
    const allotment = parseFloat(govAllotment);
    if (!allotment || allotment <= 0) { toast('Enter a government allotment amount'); return; }
    if (initial && initial.gov_allotment !== allotment) {
      const ok = window.confirm(
        `Change the ${MONTHS[month - 1]} ${year} allotment from ${fmtMoney(initial.gov_allotment)} to ${fmtMoney(allotment)}?`
      );
      if (!ok) return;
    }
    setSaving(true);
    try {
      await api.saveCostBudget({
        month,
        year,
        gov_allotment: allotment,
        w1_planned_pull: pull[0] ? num(pull[0]) : undefined,
        w2_planned_pull: pull[1] ? num(pull[1]) : undefined,
        w3_planned_pull: pull[2] ? num(pull[2]) : undefined,
        w1_planned_renewable: renewable[0] ? num(renewable[0]) : undefined,
        w2_planned_renewable: renewable[1] ? num(renewable[1]) : undefined,
        w3_planned_renewable: renewable[2] ? num(renewable[2]) : undefined,
        notes: notes.trim() || undefined,
      });
      toast(`Budget saved for ${MONTHS[month - 1]} ${year}`);
      onSaved();
      onClose();
    } catch (err: any) {
      toast(err?.message || 'Failed to save budget');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="overlay" onClick={() => !saving && onClose()}>
      <div className="modal mid" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{I.dollar()} {initial ? 'Edit' : 'Create'} Budget — {MONTHS[month - 1]} {year}</h3>
          <button className="modal-x" onClick={onClose} disabled={saving}>{I.x()}</button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label>Fallback allotment <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(only used when this fiscal year has no Revenue line items)</span></label>
            <input
              className="ipt"
              type="number"
              min={0}
              step="0.01"
              value={govAllotment}
              onChange={(e) => setGovAllotment(e.target.value)}
              placeholder="0.00"
              autoFocus
            />
          </div>

          {averages && averages.months_sampled > 0 && (
            <div className="banner" style={{ marginTop: 4, marginBottom: 4 }}>
              <span>
                Trailing {averages.months_sampled}-mo. average: {fmtMoney(averages.avg_pull_amount)} pulls,{' '}
                {fmtMoney(averages.avg_reviewable_amount)} renewable/mo.
              </span>
              <span className="bx" onClick={useAverages}>Use these</span>
            </div>
          )}

          <WeeklyField label="Planned pull spend (stock drawn from inventory)" values={pull} onChange={setPullWeek} />
          <WeeklyField label="Planned renewable spend (fresh purchases)" values={renewable} onChange={setRenewableWeek} />

          <div className="field">
            <label>Notes <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(optional)</span></label>
            <textarea className="ipt" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. includes summer program surge" />
          </div>
        </div>
        <div className="modal-foot">
          <button className="btn" onClick={onClose} disabled={saving}>Cancel</button>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save Budget'}</button>
        </div>
      </div>
    </div>
  );
}

function ActivityFeed({ month, year, onNav }: { month: number; year: number; onNav?: (k: string) => void }) {
  const [rows, setRows] = useState<SourceTransaction[] | null>(null);

  useEffect(() => {
    let alive = true;
    api.getTransactions({ month: month - 1, year, limit: 120 })
      .then((data) => {
        if (!alive) return;
        const filtered = (data || []).filter((r) => r.field === 'pulled_value' || r.field === 'received_value').slice(0, 15);
        setRows(filtered);
      })
      .catch(() => alive && setRows([]));
    return () => { alive = false; };
  }, [month, year]);

  if (rows === null) return <div style={{ color: 'var(--muted)', fontSize: 12 }}>Loading…</div>;
  if (rows.length === 0) {
    return <div style={{ color: 'var(--muted)', fontSize: 12 }}>No pulls or receipts committed through Source Control for this period yet.</div>;
  }

  return (
    <div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        {rows.map((t) => {
          const isReceived = t.field === 'received_value';
          const delta = Math.abs((t.new_value ?? 0) - (t.old_value ?? 0));
          const date = t.created_at ? new Date(t.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—';
          return (
            <div key={t.change_id} className="cm-activity-row">
              <span className="cm-activity-date">{date}</span>
              <span className="cm-activity-desc" title={t.description || t.sku || undefined}>{t.description || t.sku || 'Item'}</span>
              <span className="cm-activity-tag">{isReceived ? 'Received' : 'Pulled'}</span>
              <span className={'cm-activity-amt ' + (isReceived ? 'in' : 'out')}>{isReceived ? '+' : '−'}{fmtMoney(delta)}</span>
            </div>
          );
        })}
      </div>
      <button className="btn" style={{ marginTop: 12 }} onClick={() => onNav?.('sourcectrl')}>View all in Source Control →</button>
    </div>
  );
}

export function CostManager({ user, period, onNav }: { user: User; period: [number, number]; onNav?: (k: string) => void }) {
  const month = period[0] + 1; // Portal keeps period as 0-indexed DB month
  const year = period[1];
  const canManage = ROLE_LEVEL[user.role] >= 30;

  const [summary, setSummary] = useState<CostSummary | null>(null);
  const [trend, setTrend] = useState<CostTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showWizard, setShowWizard] = useState(false);

  async function load() {
    const firstLoad = !summary;
    if (firstLoad) setLoading(true); else setRefreshing(true);
    try {
      const [s, t] = await Promise.all([
        api.getCostSummary(month, year),
        api.getCostTrend(month, year, 6),
      ]);
      setSummary(s);
      setTrend(t);
    } catch (err: any) {
      toast(err?.message || 'Failed to load cost data');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => { load(); }, [month, year]);

  async function createOverBudgetTask() {
    try {
      await api.createFlowAssignment({
        title: `Budget over limit — ${MONTHS[month - 1]} ${year}`,
        description: `Total spend ${fmtMoney(summary?.total_spend || 0)} vs. allotment ${fmtMoney(summary?.gov_allotment || 0)}.`,
        priority: 'high',
        assigned_to_role: 'manager',
        link_type: 'cost_alert',
      });
      toast('Flow task created');
    } catch (err: any) {
      toast(err?.message || 'Failed to create task');
    }
  }

  async function createRevenueReminderTask() {
    try {
      await api.createFlowAssignment({
        title: `Record revenue actuals — ${MONTHS[month - 1]} ${year}`,
        description: `${summary?.revenue_pending_count} of ${summary?.revenue_line_item_count} revenue line items still pending. ${fmtMoney(summary?.total_spend || 0)} spent so far but only ${fmtMoney(summary?.revenue_actual || 0)} recorded.`,
        priority: 'normal',
        assigned_to_role: 'manager',
        link_type: 'cost_alert',
      });
      toast('Flow task created');
    } catch (err: any) {
      toast(err?.message || 'Failed to create task');
    }
  }

  if (loading && !summary) return <Loading />;

  const pctUsed = summary?.pct_used ?? null;
  const overBudget = pctUsed != null && pctUsed >= 100;
  const nearBudget = pctUsed != null && pctUsed >= 90 && pctUsed < 100;
  const govAllotment = summary?.gov_allotment ?? 0;
  const hasAllotment = govAllotment > 0;
  const remaining = hasAllotment ? govAllotment - (summary?.total_spend || 0) : null;
  const budget = summary?.budget;
  const plannedPull = budget ? (budget.w1_planned_pull ?? 0) + (budget.w2_planned_pull ?? 0) + (budget.w3_planned_pull ?? 0) : 0;
  const netPosition = summary?.net_position ?? 0;
  const revenuePendingCount = summary?.revenue_pending_count ?? 0;
  const revenueLineItemCount = summary?.revenue_line_item_count ?? 0;
  const showRevenueAlert = (summary?.total_spend || 0) > 0 && revenuePendingCount > 0;

  // Shared 3-tier budget-health color, used by every KPI tile that reflects spend status.
  const statusColors = overBudget
    ? { tint: 'var(--red)', bg: 'var(--red-bg)' }
    : nearBudget
      ? { tint: 'var(--amber)', bg: 'var(--amber-bg)' }
      : { tint: 'var(--green)', bg: 'var(--green-bg)' };

  const topKpis: Kpi[] = [
    { key: 'allot', label: 'Gov Allotment', icon: 'dollar', tint: '#1D4ED8', bg: '#EFF6FF', val: hasAllotment ? fmtMoney(govAllotment) : '—', sub: 'sum of Revenue line items' },
    {
      key: 'spent', label: 'Total Spent', icon: 'trend', tint: 'var(--amber)', bg: 'var(--amber-bg)',
      val: fmtMoney(summary?.total_spend || 0),
      sub: 'inventory received this period',
    },
    { key: 'remaining', label: 'Remaining', icon: 'checkCircle', ...statusColors, val: remaining != null ? fmtMoney(remaining) : '—' },
    { key: 'pct', label: '% Used', icon: overBudget ? 'up' : 'down', ...statusColors, val: pctUsed != null ? `${pctUsed}%` : '—' },
    {
      key: 'revenue', label: 'Monthly Revenue', icon: 'inbox', tint: 'var(--green)', bg: 'var(--green-bg)',
      val: fmtMoney(summary?.monthly_revenue || 0),
      sub: 'Snack Bar',
    },
    {
      key: 'net', label: 'Net Position', icon: netPosition >= 0 ? 'up' : 'down',
      tint: netPosition >= 0 ? 'var(--green)' : 'var(--red)',
      bg: netPosition >= 0 ? 'var(--green-bg)' : 'var(--red-bg)',
      val: (netPosition >= 0 ? '+' : '−') + fmtMoney(Math.abs(netPosition)),
      sub: 'revenue recorded − spend',
    },
  ];

  // Received is what's actually taken out of the government allotment
  // (Total Spent above = this figure). Pulled only affects inventory value
  // (Current Value = live on-hand value right now, via live_inventory) — it
  // never counts as spend against the allotment.
  const breakdownKpis: Kpi[] = summary ? [
    { key: 'received', label: 'Received', icon: 'inbox', tint: '#0E7490', bg: '#ECFEFF', val: fmtMoney(summary.total_received), sub: 'delivered this period — counts as spend' },
    {
      key: 'pulled', label: 'Pulled', icon: 'box', tint: '#6D28D9', bg: '#EDE9FE',
      val: fmtMoney(summary.total_pulled),
      sub: plannedPull > 0 ? `vs ${fmtMoney(plannedPull)} planned` : 'used from stock — not counted as spend',
    },
    { key: 'current', label: 'Current Value', icon: 'fileText', tint: '#475569', bg: '#F1F5F9', val: fmtMoney(summary.current_inventory_value), sub: 'on-hand inventory right now' },
    { key: 'ending', label: 'Ending Value', icon: 'fileText', tint: '#475569', bg: '#F1F5F9', val: fmtMoney(summary.total_ending), sub: 'closing inventory this period' },
  ] : [];

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Cost Manager {refreshing && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--faint)' }}>· updating…</span>}</h2>
          <div className="ph-sub">
            {MONTHS[month - 1]} {year} · Inventory <b>received</b> this period = spend against the allotment · <b>Pulled</b> only affects on-hand value
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn" onClick={() => window.print()}>Print</button>
          <button className="btn" onClick={() => onNav?.('dataentry')}>Upload existing budget</button>
          {canManage && (
            <button className="btn primary" onClick={() => setShowWizard(true)}>
              {budget ? 'Edit Budget' : 'Create Budget'}
            </button>
          )}
        </div>
      </div>

      {(overBudget || nearBudget) && hasAllotment && (
        <div className={'banner ' + (overBudget ? 'danger' : 'warn')} style={{ marginBottom: 16 }}>
          {I.alert()}
          <span>
            {overBudget ? 'Over budget' : 'Approaching budget limit'} — {pctUsed}% of {fmtMoney(govAllotment)} spent.
          </span>
          {canManage && <span className="bx" onClick={createOverBudgetTask}>Create Flow task</span>}
        </div>
      )}

      {!hasAllotment && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <span>No allotment for {MONTHS[month - 1]} {year} yet — add Revenue line items below, or set a fallback in the budget wizard.</span>
          {canManage && <span className="bx" onClick={() => setShowWizard(true)}>Open budget wizard</span>}
        </div>
      )}

      {showRevenueAlert && (
        <div className="banner warn" style={{ marginBottom: 16 }}>
          {I.alert()}
          <span>
            {revenuePendingCount} of {revenueLineItemCount} revenue line items still pending — {fmtMoney(summary?.total_spend || 0)} spent but only {fmtMoney(summary?.revenue_actual || 0)} recorded. On paper this shows a {fmtMoney(Math.abs(netPosition))} loss until actuals are set below.
          </span>
          {canManage && <span className="bx" onClick={createRevenueReminderTask}>Create Flow task</span>}
        </div>
      )}

      {budget?.notes && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <span>Note: {budget.notes}</span>
        </div>
      )}

      <div className="stat-grid kpi6">
        {topKpis.map((k) => <KpiCard key={k.key} k={k} />)}
      </div>

      {summary && (
        <div className="stat-grid" style={{ marginTop: 12 }}>
          {breakdownKpis.map((k) => <KpiCard key={k.key} k={k} />)}
        </div>
      )}

      <BudgetLineItems user={user} month={month} year={year} />

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Where it went — category breakdown</h3></div>
        <div className="card-body">
          {summary && summary.category_breakdown.length > 0 ? (
            <CategoryDonut
              rows={summary.category_breakdown.map((c) => ({
                key: c.category_id,
                name: c.name,
                icon: c.icon,
                pulled: c.pulled_value,
                received: c.received_value,
                color: c.color,
              }))}
            />
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              No inventory activity for this period yet — pulls and receipts logged in Monthly Inventory will appear here by category.
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Spend trend — trailing 6 months</h3></div>
        <div className="card-body">
          {trend.length > 0 ? (
            <SvgLineChart
              points={trend.map((t) => ({
                label: `${MONTHS[t.month - 1].slice(0, 3)} ${String(t.year).slice(2)}`,
                value: t.total_spend,
                reference: t.gov_allotment,
              }))}
            />
          ) : (
            <div style={{ color: 'var(--muted)', fontSize: 12 }}>
              The trend fills in as budgets and inventory data accumulate across months.
            </div>
          )}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Recent activity</h3></div>
        <div className="card-body">
          <ActivityFeed month={month} year={year} onNav={onNav} />
        </div>
      </div>

      {showWizard && (
        <BudgetWizard
          month={month}
          year={year}
          initial={budget || null}
          onClose={() => setShowWizard(false)}
          onSaved={load}
        />
      )}
    </div>
  );
}
