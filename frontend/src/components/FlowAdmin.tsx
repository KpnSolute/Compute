import { useState, useEffect } from 'react';
import { type User, ROLE_LABEL, NAV } from '../lib/constants';
import { api, type FlowAssignment } from '../lib/api';

type Priority = 'low' | 'normal' | 'high' | 'urgent';

interface DraftTask {
  tempId: string;
  title: string;
  description: string;
  priority: Priority;
  due_date: string;
  link_type: string;
  link_key: string;
}

const VALID_ROLES = new Set(['staff', 'assistant', 'manager', 'admin', 'sudo']);
const ROLE_ORDER = ['sudo', 'admin', 'manager', 'assistant', 'staff'] as const;
const navItems = NAV.flatMap(g => g.items);

function genId(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
  return Math.random().toString(36).substring(2, 11);
}

function initials(u: { display_name?: string; last_name?: string; username?: string } | undefined): string {
  if (!u) return '?';
  return ((u.display_name?.[0] || '') + (u.last_name?.[0] || '')).toUpperCase()
    || (u.username || '?').slice(0, 2).toUpperCase();
}

function statusPill(s: string): { cls: string; label: string } {
  switch (s) {
    case 'open': return { cls: 'warn', label: 'Open' };
    case 'in_progress': return { cls: 'ok', label: 'In Progress' };
    case 'done': return { cls: 'ok', label: 'Done' };
    case 'cancelled': return { cls: 'off', label: 'Cancelled' };
    default: return { cls: 'off', label: s };
  }
}

export function FlowAdmin({ user: _user }: { user: User }) {
  const [users, setUsers] = useState<User[]>([]);
  const [assignments, setAssignments] = useState<FlowAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('normal');
  const [dueDate, setDueDate] = useState('');
  const [linkType, setLinkType] = useState('none');
  const [linkKey, setLinkKey] = useState('');

  const [drafts, setDrafts] = useState<DraftTask[]>([]);
  const [toastMsg, setToastMsg] = useState<string | null>(null);
  const [dragOverRole, setDragOverRole] = useState<string | null>(null);
  const [dragOverPerson, setDragOverPerson] = useState<string | null>(null);

  const toast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 2600);
  };

  async function loadData() {
    setLoading(true);
    try {
      const [usersData, assignmentsData] = await Promise.all([
        api.getUsers(),
        api.getFlowAssignments({ all: true }),
      ]);
      setUsers(usersData);
      setAssignments(assignmentsData);

      const affected = usersData.filter(
        (u: User) => !u.role || !VALID_ROLES.has(u.role)
      );
      if (affected.length > 0) {
        const existingOpen = assignmentsData.filter(
          (a: FlowAssignment) => a.link_type === 'user_missing_role' && a.status === 'open'
        );
        const existingIds = new Set(existingOpen.map((a: FlowAssignment) => a.link_key));
        const created: FlowAssignment[] = [];
        for (const u of affected) {
          if (!existingIds.has(u.id)) {
            const c = await api.createFlowAssignment({
              title: `${u.display_name || u.username} has no role assigned`,
              description: 'Assign a role in Users & Access.',
              assigned_to_role: 'sudo',
              priority: 'urgent',
              link_type: 'user_missing_role',
              link_key: u.id,
            });
            created.push(c);
          }
        }
        if (created.length > 0) {
          setAssignments(prev => [...prev, ...created]);
          toast(`Auto-created ${created.length} missing-role task(s) for sudo`);
        }
      }
    } catch (e: any) {
      toast(e?.message || 'Failed to load team data');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { loadData(); }, []);

  const userMap = new Map(users.map(u => [u.id, u]));

  const missingRoleUsers = users.filter(
    (u: User) => !u.role || !VALID_ROLES.has(u.role)
  );

  const usersByRole: Record<string, User[]> = {};
  for (const u of users) {
    if (u.role && VALID_ROLES.has(u.role)) {
      (usersByRole[u.role] ??= []).push(u);
    }
  }

  function handleAddDraft(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) { toast('Title is required'); return; }
    const draft: DraftTask = {
      tempId: genId(),
      title: title.trim(),
      description,
      priority,
      due_date: dueDate,
      link_type: linkType === 'none' ? '' : linkType,
      link_key: linkKey,
    };
    setDrafts(prev => [...prev, draft]);
    setTitle('');
    setDescription('');
    setPriority('normal');
    setDueDate('');
    setLinkType('none');
    setLinkKey('');
    toast('Draft added — drag onto a person or role to assign');
  }

  function buildBody(d: DraftTask, extra: Record<string, string>): Record<string, unknown> {
    const body: Record<string, unknown> = { title: d.title };
    if (d.description) body.description = d.description;
    body.priority = d.priority;
    if (d.due_date) body.due_date = d.due_date;
    if (d.link_type) {
      body.link_type = d.link_type;
      if (d.link_key) body.link_key = d.link_key;
    }
    Object.assign(body, extra);
    return body;
  }

  async function handleRoleDrop(e: React.DragEvent, roleKey: string) {
    e.preventDefault();
    setDragOverRole(null);
    const tempId = e.dataTransfer.getData('text/plain');
    const draft = drafts.find(d => d.tempId === tempId);
    if (!draft) return;
    try {
      const created = await api.createFlowAssignment(buildBody(draft, { assigned_to_role: roleKey }) as any);
      setAssignments(prev => [created, ...prev]);
      setDrafts(prev => prev.filter(d => d.tempId !== tempId));
      toast(`Assigned "${draft.title}" to ${ROLE_LABEL[roleKey as keyof typeof ROLE_LABEL] || roleKey}`);
    } catch (err: any) {
      toast(err?.message || 'Failed to create assignment');
    }
  }

  async function handlePersonDrop(e: React.DragEvent, userId: string) {
    e.preventDefault();
    setDragOverPerson(null);
    const tempId = e.dataTransfer.getData('text/plain');
    const draft = drafts.find(d => d.tempId === tempId);
    if (!draft) return;
    const person = userMap.get(userId);
    try {
      const created = await api.createFlowAssignment(buildBody(draft, { assigned_to: userId }) as any);
      setAssignments(prev => [created, ...prev]);
      setDrafts(prev => prev.filter(d => d.tempId !== tempId));
      toast(`Assigned "${draft.title}" to ${person?.display_name || userId}`);
    } catch (err: any) {
      toast(err?.message || 'Failed to create assignment');
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('Delete this assignment?')) return;
    try {
      await api.deleteFlowAssignment(id);
      setAssignments(prev => prev.filter(a => a.id !== id));
      toast('Assignment deleted');
    } catch (err: any) {
      toast(err?.message || 'Failed to delete');
    }
  }

  async function handleApprove(a: FlowAssignment) {
    try {
      await api.deleteFlowAssignment(a.id);
      setAssignments(prev => prev.filter(x => x.id !== a.id));
      toast(`Approved "${a.title}" — removed from queue`);
    } catch (err: any) {
      toast(err?.message || 'Failed to approve');
    }
  }

  const pendingReview = assignments.filter(a => a.status === 'done');
  const activeAssignments = assignments.filter(a => a.status !== 'done');

  if (loading) {
    return (
      <div className="load-wrap">
        <div className="spinner" />
        <span>Loading team data…</span>
      </div>
    );
  }

  return (
    <>
      {toastMsg && <div className="flow-toast">{toastMsg}</div>}

      {missingRoleUsers.length > 0 && (
        <div className="banner warn">
          <span>{missingRoleUsers.length} user(s) have no role assigned — see below</span>
        </div>
      )}

      <div className="flow-admin-grid">
        <div>
          <div className="card" style={{ marginBottom: 12 }}>
            <div className="card-head"><h3>Create Task</h3></div>
            <div className="card-body">
              <form onSubmit={handleAddDraft}>
                <div className="field">
                  <label>Title *</label>
                  <input className="ipt" value={title} onChange={e => setTitle(e.target.value)} placeholder="e.g. Check freezer temps" />
                </div>
                <div className="field">
                  <label>Description</label>
                  <textarea className="ipt" rows={3} value={description} onChange={e => setDescription(e.target.value)} />
                </div>
                <div className="field">
                  <label>Priority</label>
                  <select className="ipt sel" value={priority} onChange={e => setPriority(e.target.value as Priority)}>
                    <option value="low">Low</option>
                    <option value="normal">Normal</option>
                    <option value="high">High</option>
                    <option value="urgent">Urgent</option>
                  </select>
                </div>
                <div className="field">
                  <label>Due Date</label>
                  <input type="date" className="ipt" value={dueDate} onChange={e => setDueDate(e.target.value)} />
                </div>
                <div className="field">
                  <label>Link Type</label>
                  <select className="ipt sel" value={linkType} onChange={e => { setLinkType(e.target.value); setLinkKey(''); }}>
                    <option value="none">None</option>
                    <option value="nav_page">Page</option>
                    <option value="inventory_item">Inventory Item</option>
                    <option value="daily_log">Daily Log</option>
                    <option value="haccp_log">HACCP Log</option>
                  </select>
                </div>
                {linkType !== 'none' && (
                  <div className="field">
                    <label>{linkType === 'nav_page' ? 'Page' : 'Key (SKU or log ID)'}</label>
                    {linkType === 'nav_page' ? (
                      <select className="ipt sel" value={linkKey} onChange={e => setLinkKey(e.target.value)}>
                        <option value="">Select a page…</option>
                        {navItems.map(ni => (
                          <option key={ni.key} value={ni.key}>{ni.label}</option>
                        ))}
                      </select>
                    ) : (
                      <input className="ipt" value={linkKey} onChange={e => setLinkKey(e.target.value)} placeholder={linkType === 'inventory_item' ? 'SKU-…' : 'Log ID'} />
                    )}
                  </div>
                )}
                <button className="btn primary" type="submit" style={{ width: '100%', justifyContent: 'center', marginTop: 4 }}>
                  Add to Tray
                </button>
              </form>
            </div>
          </div>

          <div className="card">
            <div className="card-head"><h3>Unassigned Drafts ({drafts.length})</h3></div>
            <div className="card-body">
              {drafts.length === 0 ? (
                <div className="flow-empty-drafts">
                  No drafts yet.<br />Create a task above and drag it onto a person or role group.
                </div>
              ) : (
                drafts.map(d => (
                  <div
                    key={d.tempId}
                    className="flow-draft-card"
                    draggable
                    onDragStart={e => e.dataTransfer.setData('text/plain', d.tempId)}
                  >
                    <span className={'flow-priority-chip ' + d.priority} style={{ fontSize: 9, textTransform: 'uppercase' }}>
                      {d.priority}
                    </span>
                    <span style={{ flex: 1, fontSize: 12, fontWeight: 600 }}>{d.title}</span>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card-head"><h3>Team</h3></div>
          <div className="card-body" style={{ paddingBottom: 4 }}>
            <div className="flow-org-rows">
              {missingRoleUsers.length > 0 && (
                <div className="flow-role-col">
                  <div className="flow-no-role-header">
                    <h4>⚠ No Role</h4>
                    <span className="count">{missingRoleUsers.length} user(s)</span>
                  </div>
                  {missingRoleUsers.map(u => (
                    <div key={u.id} className="flow-person-card flow-no-role-card">
                      <div className="avatar">{initials(u)}</div>
                      <span style={{ fontSize: 12, fontWeight: 600 }}>{u.display_name || u.username} {u.last_name}</span>
                    </div>
                  ))}
                </div>
              )}
              {ROLE_ORDER.map(rk => {
                const roleUsers = usersByRole[rk] || [];
                if (roleUsers.length === 0) return null;
                return (
                  <div key={rk} className="flow-role-col">
                    <div
                      className={'flow-role-header' + (dragOverRole === rk ? ' drag-over' : '')}
                      onDragOver={e => { e.preventDefault(); setDragOverRole(rk); }}
                      onDragLeave={() => setDragOverRole(null)}
                      onDrop={e => handleRoleDrop(e, rk)}
                    >
                      <h4>{ROLE_LABEL[rk as keyof typeof ROLE_LABEL] || rk}</h4>
                      <span className="count">{roleUsers.length} member{roleUsers.length !== 1 ? 's' : ''}</span>
                    </div>
                    {roleUsers.map(p => (
                      <div
                        key={p.id}
                        className={'flow-person-card' + (dragOverPerson === p.id ? ' drag-over' : '')}
                        onDragOver={e => { e.preventDefault(); setDragOverPerson(p.id); }}
                        onDragLeave={() => setDragOverPerson(null)}
                        onDrop={e => handlePersonDrop(e, p.id)}
                      >
                        <div className="avatar">{initials(p)}</div>
                        <span style={{ fontSize: 12, fontWeight: 600 }}>{p.display_name} {p.last_name}</span>
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {pendingReview.length > 0 && (
        <div className="card" style={{ marginBottom: 12, borderColor: 'var(--green-chip)' }}>
          <div className="card-head">
            <h3>Completed — Pending Review ({pendingReview.length})</h3>
          </div>
          <div className="card-body flush">
            <div className="tbl-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Title</th>
                    <th>Completed by</th>
                    <th>Priority</th>
                    <th style={{ width: 90 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingReview.map(a => {
                    const completer = a.completed_by ? userMap.get(a.completed_by) : null;
                    return (
                      <tr key={a.id}>
                        <td><span className="flow-table-title" title={a.title}>{a.title}</span></td>
                        <td>
                          {completer ? (
                            <div className="user-cell">
                              <div className="avatar">{initials(completer)}</div>
                              {completer.display_name} {completer.last_name}
                            </div>
                          ) : (
                            <span style={{ color: 'var(--faint)' }}>—</span>
                          )}
                        </td>
                        <td><span className={'flow-priority-chip ' + a.priority}>{a.priority}</span></td>
                        <td style={{ display: 'flex', gap: 6 }}>
                          <button className="btn primary" onClick={() => handleApprove(a)} title="Approve completion & remove from queue">
                            ✓ Approve
                          </button>
                          <button className="row-del" onClick={() => handleDelete(a.id)} title="Delete without approving">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="3 6 5 6 21 6" />
                              <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h3>Active Assignments ({activeAssignments.length})</h3></div>
        <div className="card-body flush">
          <div className="tbl-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Assignee</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Due</th>
                  <th style={{ width: 40 }}></th>
                </tr>
              </thead>
              <tbody>
                {activeAssignments.map(a => {
                  const sp = statusPill(a.status);
                  const assignee = a.assigned_to ? userMap.get(a.assigned_to) : null;
                  return (
                    <tr key={a.id}>
                      <td><span className="flow-table-title" title={a.title}>{a.title}</span></td>
                      <td>
                        {assignee ? (
                          <div className="user-cell">
                            <div className="avatar">{initials(assignee)}</div>
                            {assignee.display_name} {assignee.last_name}
                          </div>
                        ) : a.assigned_to_role ? (
                          <span className={'pill role-' + a.assigned_to_role}>
                            {ROLE_LABEL[a.assigned_to_role as keyof typeof ROLE_LABEL] || a.assigned_to_role}
                          </span>
                        ) : (
                          <span style={{ color: 'var(--faint)' }}>—</span>
                        )}
                      </td>
                      <td><span className={'pill ' + sp.cls}>{sp.label}</span></td>
                      <td>
                        <span className={'flow-priority-chip ' + a.priority}>{a.priority}</span>
                      </td>
                      <td style={{ color: 'var(--muted)', fontSize: 11.5 }}>{a.due_date ? new Date(a.due_date).toLocaleDateString() : '—'}</td>
                      <td>
                        <button className="row-del" onClick={() => handleDelete(a.id)} title="Delete assignment">
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                          </svg>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {activeAssignments.length === 0 && (
              <div className="flow-empty-assignments">No active assignments.</div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
