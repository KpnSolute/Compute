import { useCallback, useEffect, useMemo, useState } from 'react';

import type { Role, User } from '../lib/constants';
import { ROLE_LABEL, ROLE_LEVEL } from '../lib/constants';
import { api } from '../lib/api';
import { I } from '../lib/icons';
import { StatusPill } from './ui/StatusPill';

const toast = (message: string) => (window as Window & { toast?: (text: string) => void }).toast?.(message);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function displayName(user: User) {
  return `${user.display_name || ''} ${user.last_name || ''}`.trim() || user.username;
}

export function Organization({ user: currentUser, go }: { user: User; go: (key: string) => void }) {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<User | null>(null);
  const [position, setPosition] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setUsers(await api.getUsers());
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not load the organization roster'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return users;
    return users.filter((member) => [displayName(member), member.username, member.job_title, member.role]
      .some((value) => (value || '').toLowerCase().includes(query)));
  }, [search, users]);

  const groups = useMemo(() => {
    const byPosition = new Map<string, User[]>();
    filtered.forEach((member) => {
      const key = member.job_title?.trim() || 'Unassigned position';
      byPosition.set(key, [...(byPosition.get(key) || []), member]);
    });
    return [...byPosition.entries()]
      .map(([name, members]) => ({ name, members: members.sort((a, b) => displayName(a).localeCompare(displayName(b))) }))
      .sort((a, b) => a.name === 'Unassigned position' ? 1 : b.name === 'Unassigned position' ? -1 : a.name.localeCompare(b.name));
  }, [filtered]);

  const canEdit = (member: User) => currentUser.role === 'sudo' || (ROLE_LEVEL[currentUser.role] >= 30 && member.role === 'staff');

  const openEdit = (member: User) => {
    setEditing(member);
    setPosition(member.job_title || '');
  };

  const savePosition = async () => {
    if (!editing) return;
    setSaving(true);
    try {
      await api.updateUser(editing.id, { job_title: position.trim() });
      toast(`Updated ${displayName(editing)}'s position`);
      setEditing(null);
      await load();
    } catch (err: unknown) {
      toast(errorMessage(err, 'Position could not be updated'));
    } finally {
      setSaving(false);
    }
  };

  const activeCount = users.filter((member) => member.active !== false).length;

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Organization</h2>
          <div className="ph-sub" style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill>{users.length} identities</StatusPill>
            <StatusPill ok>{activeCount} active</StatusPill>
            <StatusPill>{groups.length} positions</StatusPill>
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn" onClick={() => void load()} disabled={loading}>{I.refresh()} Refresh</button>
          <button className="btn primary" onClick={() => go('users')}>{I.users()} Users &amp; access</button>
        </div>
      </div>

      <div className="org-toolbar card">
        <div className="org-search">{I.search()}<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search people, positions, or roles" /></div>
        <span className="ph-sub">Positions are organizational titles. Roles control system access separately.</span>
      </div>

      {error && <div className="banner warn">{I.alert()}<span>{error}</span></div>}
      {loading && <div className="load-wrap"><div className="spinner" /><div>Loading organization…</div></div>}
      {!loading && !error && groups.length === 0 && <div className="card"><div className="card-body" style={{ textAlign: 'center', color: 'var(--muted)' }}>No staff match this search.</div></div>}

      {!loading && !error && (
        <div className="org-grid">
          {groups.map((group) => (
            <section className="card org-group" key={group.name}>
              <div className="card-head"><h3>{group.name}</h3><span className="ch-link">{group.members.length} {group.members.length === 1 ? 'person' : 'people'}</span></div>
              <div className="card-body flush">
                {group.members.map((member) => (
                  <div className="org-person" key={member.id}>
                    <div className="cert-avatar">{(member.display_name?.[0] || member.username[0] || '?').toUpperCase()}</div>
                    <div className="org-person-main">
                      <div className="ss-name">{displayName(member)}</div>
                      <div className="ss-cert">@{member.username}{member.email ? ` · ${member.email}` : ''}</div>
                    </div>
                    <span className={`pill role-${member.role}`}>{ROLE_LABEL[member.role as Role]}</span>
                    <span className={`pill ${member.active === false ? 'off' : 'ok'}`}>{member.active === false ? 'Disabled' : 'Active'}</span>
                    {canEdit(member) && <button className="btn icon-only" onClick={() => openEdit(member)} title="Edit position">{I.edit()}</button>}
                  </div>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {editing && (
        <div className="overlay" onClick={() => !saving && setEditing(null)}>
          <div className="modal" style={{ maxWidth: 470 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><h3>Edit position</h3><button className="btn" onClick={() => setEditing(null)} disabled={saving}>Close</button></div>
            <div className="form-grid" style={{ padding: 16 }}>
              <label style={{ gridColumn: '1 / -1' }}><span>Staff identity</span><input value={displayName(editing)} disabled /></label>
              <label style={{ gridColumn: '1 / -1' }}><span>Position / job title</span><input value={position} onChange={(event) => setPosition(event.target.value)} placeholder="e.g. Food Service Assistant" autoFocus /></label>
              <div className="banner info" style={{ gridColumn: '1 / -1', margin: 0 }}>{I.alert()}<span>This changes the roster grouping only. Edit the account role and page scopes in Users &amp; Access.</span></div>
            </div>
            <div className="modal-foot"><button className="btn" onClick={() => setEditing(null)} disabled={saving}>Cancel</button><button className="btn primary" onClick={() => void savePosition()} disabled={saving}>{saving ? 'Saving…' : 'Save position'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
