import { useEffect, useState } from 'react';
import { type User, ROLE_LABEL, ROLE_LEVEL } from '../lib/constants';
import { api, type FlowAssignment } from '../lib/api';
import { statusPill } from './FlowAdmin';

type Priority = 'low' | 'normal' | 'high' | 'urgent';

const toast = (msg: string) => (window as any).toast?.(msg);

export function FlowPanel({ user, onNav, onClose }: { user: User; onNav?: (k: string) => void; onClose: () => void }) {
  const [tasks, setTasks] = useState<FlowAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [showNew, setShowNew] = useState(false);
  const [title, setTitle] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [role, setRole] = useState('staff');
  const [saving, setSaving] = useState(false);

  const canCreate = ROLE_LEVEL[user.role] >= 30;

  async function load() {
    try {
      const rows = await api.getFlowAssignments({ all: true });
      setTasks(rows);
    } catch {
      setTasks([]);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast('Title is required'); return; }
    setSaving(true);
    try {
      await api.createFlowAssignment({ title: title.trim(), priority, assigned_to_role: role });
      setTitle('');
      setPriority('normal');
      setShowNew(false);
      toast(`Task "${title.trim()}" created`);
      load();
    } catch (err: any) {
      toast(err?.message || 'Failed to create task');
    } finally {
      setSaving(false);
    }
  }

  const byStatus = (s: string) =>
    tasks
      .filter((t) => t.status === s)
      .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
      .slice(0, 5);

  const groups = [
    { key: 'open', label: 'Assigned', rows: byStatus('open') },
    { key: 'in_progress', label: 'Started', rows: byStatus('in_progress') },
    { key: 'done', label: 'Completed', rows: byStatus('done') },
  ].filter((g) => g.rows.length > 0);

  return (
    <div className="usermenu flow-panel" onClick={(e) => e.stopPropagation()}>
      <div className="um-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="nm">Flow</div>
        {canCreate && (
          <button className="btn primary" style={{ padding: '4px 10px', fontSize: 11.5 }} onClick={() => setShowNew((v) => !v)}>
            + New Task
          </button>
        )}
      </div>

      {showNew && (
        <form className="flow-panel-new" onSubmit={createTask}>
          <input className="ipt" placeholder="Task title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <select className="ipt sel" value={priority} onChange={(e) => setPriority(e.target.value as Priority)} style={{ flex: 1 }}>
              <option value="low">Low</option>
              <option value="normal">Normal</option>
              <option value="high">High</option>
              <option value="urgent">Urgent</option>
            </select>
            <select className="ipt sel" value={role} onChange={(e) => setRole(e.target.value)} style={{ flex: 1 }}>
              <option value="staff">Staff</option>
              <option value="assistant">Assistant</option>
              <option value="manager">Manager</option>
            </select>
          </div>
          <button className="btn primary" type="submit" disabled={saving} style={{ width: '100%', justifyContent: 'center', marginTop: 8 }}>
            {saving ? 'Creating…' : 'Create'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flow-panel-empty">Loading…</div>
      ) : groups.length === 0 ? (
        <div className="flow-panel-empty">No flow tasks yet.</div>
      ) : (
        groups.map((g) => (
          <div key={g.key} className="flow-panel-group">
            <div className="flow-panel-group-label">{g.label}</div>
            {g.rows.map((t) => {
              const sp = statusPill(t.status);
              return (
                <div key={t.id} className="flow-panel-row">
                  <span className={'flow-priority-chip ' + t.priority} style={{ fontSize: 9 }}>{t.priority[0].toUpperCase()}</span>
                  <span className="flow-panel-title" title={t.title}>{t.title}</span>
                  {t.assigned_to_role && (
                    <span className="flow-panel-assignee">{ROLE_LABEL[t.assigned_to_role as keyof typeof ROLE_LABEL] || t.assigned_to_role}</span>
                  )}
                  <span className={'pill ' + sp.cls} style={{ fontSize: 9.5 }}>{sp.label}</span>
                </div>
              );
            })}
          </div>
        ))
      )}

      <button className="um-item" onClick={() => { onNav?.('dailyops'); onClose(); }}>
        View all in Flow →
      </button>
    </div>
  );
}
