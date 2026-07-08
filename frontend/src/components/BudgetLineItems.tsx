import { useEffect, useState } from 'react';
import { ROLE_LEVEL, type User } from '../lib/constants';
import { fmtMoney } from '../lib/supabase';
import { api, type BudgetLineItem, type BudgetLineItemInput, type BudgetLineType, type BudgetLineAutoSource } from '../lib/api';

const toast = (msg: string) => (window as any).toast?.(msg);

const AUTO_SOURCE_LABEL: Record<BudgetLineAutoSource, string> = {
  pulled: 'Auto: Pulled total',
  renewable: 'Auto: Renewable total',
  snack_bar_revenue: 'Auto: Snack Bar sales',
};

const STATUS_META: Record<string, { cls: string; label: string }> = {
  pending: { cls: 'off', label: 'Pending' },
  on_track: { cls: 'ok', label: 'On Track' },
  over_budget: { cls: 'warn', label: 'Over Budget' },
  under_budget: { cls: 'warn', label: 'Under Budget' },
};

function LineItemForm({
  initial,
  onCancel,
  onSave,
}: {
  initial?: BudgetLineItem | null;
  onCancel: () => void;
  onSave: (body: BudgetLineItemInput) => void;
}) {
  const [taskId, setTaskId] = useState(initial?.task_id ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [lineType, setLineType] = useState<BudgetLineType>(initial?.line_type ?? 'cost');
  const [annual, setAnnual] = useState(initial ? String(initial.annual_budget) : '');
  const [autoSource, setAutoSource] = useState<BudgetLineAutoSource | ''>(initial?.auto_source ?? '');

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const amt = parseFloat(annual);
    if (!description.trim()) { toast('Description is required'); return; }
    if (!amt || amt < 0) { toast('Enter a valid annual budget'); return; }
    onSave({
      task_id: taskId.trim() || undefined,
      description: description.trim(),
      line_type: lineType,
      annual_budget: amt,
      auto_source: autoSource || undefined,
      sort_order: initial?.sort_order ?? 0,
    });
  }

  return (
    <form className="li-form" onSubmit={submit}>
      <input className="ipt" placeholder="Task ID (optional)" value={taskId} onChange={(e) => setTaskId(e.target.value)} style={{ width: 130 }} />
      <input className="ipt" placeholder="Description" value={description} onChange={(e) => setDescription(e.target.value)} style={{ flex: 1, minWidth: 160 }} />
      <select className="ipt sel" value={lineType} onChange={(e) => setLineType(e.target.value as BudgetLineType)} style={{ width: 100 }}>
        <option value="cost">Cost</option>
        <option value="revenue">Revenue</option>
      </select>
      <input className="ipt" type="number" min={0} step="0.01" placeholder="Annual $" value={annual} onChange={(e) => setAnnual(e.target.value)} style={{ width: 110 }} />
      <select className="ipt sel" value={autoSource} onChange={(e) => setAutoSource(e.target.value as BudgetLineAutoSource | '')} style={{ width: 170 }}>
        <option value="">Manual entry</option>
        <option value="pulled">Auto: Pulled total</option>
        <option value="renewable">Auto: Renewable total</option>
        <option value="snack_bar_revenue">Auto: Snack Bar sales</option>
      </select>
      <button className="btn primary" type="submit" style={{ padding: '7px 12px' }}>Save</button>
      <button className="btn" type="button" onClick={onCancel} style={{ padding: '7px 12px' }}>Cancel</button>
    </form>
  );
}

function ActualCell({ item, month, year, onSaved }: { item: BudgetLineItem; month: number; year: number; onSaved: () => void }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(item.monthly_actual != null ? String(item.monthly_actual) : '');

  if (item.auto_source) {
    return <span title={AUTO_SOURCE_LABEL[item.auto_source]}>{item.monthly_actual != null ? fmtMoney(item.monthly_actual) : '—'}</span>;
  }
  if (!editing) {
    return (
      <span className="li-actual-cell" onClick={() => setEditing(true)} title="Click to enter this month's actual">
        {item.monthly_actual != null ? fmtMoney(item.monthly_actual) : 'Set actual'}
      </span>
    );
  }

  async function save() {
    const amt = parseFloat(val);
    if (isNaN(amt) || amt < 0) { toast('Enter a valid amount'); return; }
    try {
      await api.setLineItemActual(item.id, month, year, amt);
      setEditing(false);
      onSaved();
    } catch (err: any) {
      toast(err?.message || 'Failed to save actual');
    }
  }

  return (
    <span style={{ display: 'inline-flex', gap: 4 }}>
      <input
        className="ipt"
        type="number"
        min={0}
        step="0.01"
        value={val}
        onChange={(e) => setVal(e.target.value)}
        style={{ width: 80 }}
        autoFocus
        onKeyDown={(e) => e.key === 'Enter' && save()}
      />
      <button className="btn primary" style={{ padding: '3px 8px', fontSize: 11 }} onClick={save}>✓</button>
      <button className="btn" style={{ padding: '3px 8px', fontSize: 11 }} onClick={() => setEditing(false)}>✕</button>
    </span>
  );
}

function LineItemTable({
  title,
  rows,
  month,
  year,
  canManage,
  onReload,
  onEdit,
}: {
  title: string;
  rows: BudgetLineItem[];
  month: number;
  year: number;
  canManage: boolean;
  onReload: () => void;
  onEdit: (item: BudgetLineItem) => void;
}) {
  const budgetTotal = rows.reduce((s, r) => s + r.monthly_budget, 0);
  const actualTotal = rows.reduce((s, r) => s + (r.monthly_actual ?? 0), 0);

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this line item? This removes its full history.')) return;
    try {
      await api.deleteLineItem(id);
      onReload();
    } catch (err: any) {
      toast(err?.message || 'Failed to delete');
    }
  }

  if (rows.length === 0) return null;

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <div className="card-head">
        <h3>{title}</h3>
        <span style={{ fontSize: 11.5, color: 'var(--muted)' }}>Budget {fmtMoney(budgetTotal)} · Actual {fmtMoney(actualTotal)}</span>
      </div>
      <div className="card-body flush">
        <div className="tbl-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>Task ID</th>
                <th>Description</th>
                <th>Annual</th>
                <th>Month Budget</th>
                <th>Month Actual</th>
                <th>Variance</th>
                <th>Status</th>
                {canManage && <th style={{ width: 40 }}></th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const st = STATUS_META[r.status] || STATUS_META.pending;
                return (
                  <tr key={r.id}>
                    <td style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--muted)' }}>{r.task_id || '—'}</td>
                    <td style={{ fontWeight: 600, cursor: canManage ? 'pointer' : undefined }} onClick={() => canManage && onEdit(r)} title={canManage ? 'Click to edit' : undefined}>
                      {r.description}
                    </td>
                    <td>{fmtMoney(r.annual_budget)}</td>
                    <td>{fmtMoney(r.monthly_budget)}</td>
                    <td><ActualCell item={r} month={month} year={year} onSaved={onReload} /></td>
                    <td style={{ color: r.variance == null ? 'var(--faint)' : r.variance > 0 ? 'var(--red)' : 'var(--green)' }}>
                      {r.variance == null ? '—' : (r.variance > 0 ? '▲ ' : '▼ ') + fmtMoney(Math.abs(r.variance))}
                    </td>
                    <td><span className={'pill ' + st.cls}>{st.label}</span></td>
                    {canManage && (
                      <td>
                        <button className="row-del" onClick={() => handleDelete(r.id)} title="Delete line item">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export function BudgetLineItems({ user, month, year }: { user: User; month: number; year: number }) {
  const canManage = ROLE_LEVEL[user.role] >= 30;
  const [items, setItems] = useState<BudgetLineItem[] | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<BudgetLineItem | null>(null);

  async function load() {
    try {
      const rows = await api.getLineItems(month, year);
      setItems(rows);
    } catch (err: any) {
      toast(err?.message || 'Failed to load budget line items');
      setItems([]);
    }
  }

  useEffect(() => { load(); }, [month, year]);

  async function handleSave(body: BudgetLineItemInput) {
    try {
      if (editing) {
        await api.updateLineItem(editing.id, body);
        toast('Line item updated');
      } else {
        await api.createLineItem(month, year, body);
        toast('Line item created');
      }
      setShowForm(false);
      setEditing(null);
      load();
    } catch (err: any) {
      toast(err?.message || 'Failed to save line item');
    }
  }

  if (items === null) return null;

  const costRows = items.filter((i) => i.line_type === 'cost');
  const revenueRows = items.filter((i) => i.line_type === 'revenue');

  return (
    <div>
      {canManage && (
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
          {!showForm ? (
            <button className="btn" onClick={() => { setEditing(null); setShowForm(true); }}>+ Add line item</button>
          ) : (
            <LineItemForm initial={editing} onCancel={() => { setShowForm(false); setEditing(null); }} onSave={handleSave} />
          )}
        </div>
      )}

      <LineItemTable title="Operating Costs" rows={costRows} month={month} year={year} canManage={canManage} onReload={load} onEdit={(it) => { setEditing(it); setShowForm(true); }} />
      <LineItemTable title="Revenue" rows={revenueRows} month={month} year={year} canManage={canManage} onReload={load} onEdit={(it) => { setEditing(it); setShowForm(true); }} />

      {items.length === 0 && (
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-body" style={{ color: 'var(--muted)', fontSize: 12 }}>
            No budget line items set up for this fiscal year yet.
            {canManage && ' Use "+ Add line item" to start tracking cost and revenue categories, matching the official Department Budget Report.'}
          </div>
        </div>
      )}
    </div>
  );
}
