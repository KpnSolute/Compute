import { useEffect, useState } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL, MONTHS } from '../lib/constants';
import { fmtMoney } from '../lib/supabase';
import { api, type CostBudget, type CostSummary, type CostTrendPoint, type CostAverages } from '../lib/api';
import { useEscapeClose } from '../lib/useEscapeClose';
import { SvgLineChart, CategoryBars } from './ui/Charts';

const toast = (msg: string) => (window as any).toast?.(msg);

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
  const [plannedPull, setPlannedPull] = useState(initial?.planned_pull_amount != null ? String(initial.planned_pull_amount) : '');
  const [plannedReviewable, setPlannedReviewable] = useState(
    initial?.planned_reviewable_amount != null ? String(initial.planned_reviewable_amount) : ''
  );
  const [notes, setNotes] = useState(initial?.notes ?? '');
  const [averages, setAverages] = useState<CostAverages | null>(null);
  const [saving, setSaving] = useState(false);

  useEscapeClose(true, onClose, saving);

  useEffect(() => {
    api.getCostAverages(6).then(setAverages).catch(() => setAverages(null));
  }, []);

  function useAverages() {
    if (!averages) return;
    setPlannedPull(String(averages.avg_pull_amount));
    setPlannedReviewable(String(averages.avg_reviewable_amount));
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
        planned_pull_amount: plannedPull ? parseFloat(plannedPull) : undefined,
        planned_reviewable_amount: plannedReviewable ? parseFloat(plannedReviewable) : undefined,
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
            <label>Government allotment (total monthly ceiling) *</label>
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
                {fmtMoney(averages.avg_reviewable_amount)} reviewable/mo.
              </span>
              <span className="bx" onClick={useAverages}>Use these</span>
            </div>
          )}

          <div className="field">
            <label>Planned pull spend <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(stock drawn from inventory — optional target)</span></label>
            <input className="ipt" type="number" min={0} step="0.01" value={plannedPull} onChange={(e) => setPlannedPull(e.target.value)} placeholder="0.00" />
          </div>
          <div className="field">
            <label>Planned reviewable spend <span style={{ fontWeight: 400, color: 'var(--faint)' }}>(fresh purchases — optional target)</span></label>
            <input className="ipt" type="number" min={0} step="0.01" value={plannedReviewable} onChange={(e) => setPlannedReviewable(e.target.value)} placeholder="0.00" />
          </div>
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
        description: `Total spend ${fmtMoney(summary?.total_spend || 0)} vs. allotment ${fmtMoney(summary?.budget?.gov_allotment || 0)}.`,
        priority: 'high',
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
  const remaining = summary?.budget ? summary.budget.gov_allotment - (summary?.total_spend || 0) : null;
  const budget = summary?.budget;

  // Shared 3-tier budget-health color, used by every KPI tile that reflects spend status.
  const statusColors = overBudget
    ? { tint: 'var(--red)', bg: 'var(--red-bg)' }
    : nearBudget
      ? { tint: 'var(--amber)', bg: 'var(--amber-bg)' }
      : { tint: 'var(--green)', bg: 'var(--green-bg)' };

  const topKpis: Kpi[] = [
    { key: 'allot', label: 'Gov Allotment', icon: 'dollar', tint: '#1D4ED8', bg: '#EFF6FF', val: budget ? fmtMoney(budget.gov_allotment) : '—' },
    {
      key: 'spent', label: 'Total Spent', icon: 'trend', tint: 'var(--amber)', bg: 'var(--amber-bg)',
      val: fmtMoney(summary?.total_spend || 0),
      sub: summary ? `${fmtMoney(summary.total_pulled)} pulled + ${fmtMoney(summary.reviewable_spend)} reviewable` : undefined,
    },
    { key: 'remaining', label: 'Remaining', icon: 'checkCircle', ...statusColors, val: remaining != null ? fmtMoney(remaining) : '—' },
    { key: 'pct', label: '% Used', icon: overBudget ? 'up' : 'down', ...statusColors, val: pctUsed != null ? `${pctUsed}%` : '—' },
  ];

  const breakdownKpis: Kpi[] = summary ? [
    {
      key: 'pulled', label: 'Pulled', icon: 'box', tint: '#6D28D9', bg: '#EDE9FE',
      val: fmtMoney(summary.total_pulled),
      sub: budget?.planned_pull_amount != null ? `vs ${fmtMoney(budget.planned_pull_amount)} planned` : 'stock drawn from inventory',
    },
    {
      key: 'reviewable', label: 'Reviewable', icon: 'inbox', tint: '#0E7490', bg: '#ECFEFF',
      val: fmtMoney(summary.reviewable_spend),
      sub: budget?.planned_reviewable_amount != null ? `vs ${fmtMoney(budget.planned_reviewable_amount)} planned` : 'fresh purchases this period',
    },
    { key: 'starting', label: 'Starting Value', icon: 'fileText', tint: '#475569', bg: '#F1F5F9', val: fmtMoney(summary.total_starting), sub: 'opening inventory' },
    { key: 'ending', label: 'Ending Value', icon: 'fileText', tint: '#475569', bg: '#F1F5F9', val: fmtMoney(summary.total_ending), sub: 'closing inventory' },
  ] : [];

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Cost Manager {refreshing && <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--faint)' }}>· updating…</span>}</h2>
          <div className="ph-sub">
            {MONTHS[month - 1]} {year} · <b>Pulled</b> = stock drawn from inventory · <b>Reviewable</b> = fresh purchases against the allotment
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

      {(overBudget || nearBudget) && budget && (
        <div className={'banner ' + (overBudget ? 'danger' : 'warn')} style={{ marginBottom: 16 }}>
          {I.alert()}
          <span>
            {overBudget ? 'Over budget' : 'Approaching budget limit'} — {pctUsed}% of {fmtMoney(budget.gov_allotment)} spent.
          </span>
          {canManage && <span className="bx" onClick={createOverBudgetTask}>Create Flow task</span>}
        </div>
      )}

      {!budget && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <span>No budget set for {MONTHS[month - 1]} {year} yet.</span>
          {canManage && <span className="bx" onClick={() => setShowWizard(true)}>Create one</span>}
        </div>
      )}

      {budget?.notes && (
        <div className="banner" style={{ marginBottom: 16 }}>
          <span>Note: {budget.notes}</span>
        </div>
      )}

      <div className="stat-grid">
        {topKpis.map((k) => <KpiCard key={k.key} k={k} />)}
      </div>

      {summary && (
        <div className="stat-grid" style={{ marginTop: 12 }}>
          {breakdownKpis.map((k) => <KpiCard key={k.key} k={k} />)}
        </div>
      )}

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card-head"><h3>Category breakdown</h3></div>
        <div className="card-body">
          {summary && summary.category_breakdown.length > 0 ? (
            <CategoryBars
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
