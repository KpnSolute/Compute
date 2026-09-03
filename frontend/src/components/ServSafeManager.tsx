import { useCallback, useEffect, useMemo, useState } from 'react';

import { ROLE_LABEL } from '../lib/constants';
import { api } from '../lib/api';
import { I } from '../lib/icons';
import { StatusPill } from './ui/StatusPill';

type StaffUser = {
  id: string;
  username: string;
  display_name: string;
  last_name?: string;
  role: 'staff' | 'assistant' | 'manager' | 'admin' | 'sudo';
  active?: boolean;
  job_title?: string;
};

interface Certification {
  id: string;
  user_id?: string | null;
  staff_name: string;
  certification: string;
  expiry_date?: string | null;
  is_proctor?: boolean;
}

interface CertForm {
  user_id: string;
  certification: string;
  expiry_date: string;
  is_proctor: boolean;
}

const toast = (message: string) => (window as Window & { toast?: (text: string) => void }).toast?.(message);

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function recommendedCertification(role?: string) {
  return ['manager', 'admin', 'sudo'].includes(role || '')
    ? 'ServSafe Manager'
    : 'ServSafe Food Handler';
}

function statusFor(expiry?: string | null) {
  if (!expiry) return { label: 'Pending', className: 'warn' };
  const today = new Date();
  const expires = new Date(`${expiry}T12:00:00`);
  const days = Math.ceil((expires.getTime() - today.getTime()) / 86_400_000);
  if (days < 0) return { label: 'Expired', className: 'off' };
  if (days <= 60) return { label: `${days}d left`, className: 'warn' };
  return { label: 'Valid', className: 'ok' };
}

function fullName(user: StaffUser) {
  return `${user.display_name || ''} ${user.last_name || ''}`.trim() || user.username;
}

export function ServSafeManager() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [certifications, setCertifications] = useState<Certification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Certification | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<CertForm>({
    user_id: '',
    certification: 'ServSafe Food Handler',
    expiry_date: '',
    is_proctor: false,
  });

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [users, certs] = await Promise.all([api.getUsers(true), api.getServSafe()]);
      setStaff(users.sort((a: StaffUser, b: StaffUser) => fullName(a).localeCompare(fullName(b))));
      setCertifications(certs);
    } catch (err: unknown) {
      setError(errorMessage(err, 'Could not load the certification roster'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const certsByUser = useMemo(() => {
    const grouped = new Map<string, Certification[]>();
    certifications.forEach((cert) => {
      if (!cert.user_id) return;
      grouped.set(cert.user_id, [...(grouped.get(cert.user_id) || []), cert]);
    });
    return grouped;
  }, [certifications]);

  const legacyCerts = certifications.filter((cert) => !cert.user_id);
  const assignedUsers = staff.filter((member) => (certsByUser.get(member.id) || []).length > 0).length;
  const validCerts = certifications.filter((cert) => statusFor(cert.expiry_date).className === 'ok').length;

  const openCreate = () => {
    const first = staff[0];
    setEditing(null);
    setForm({
      user_id: first?.id || '',
      certification: recommendedCertification(first?.role),
      expiry_date: '',
      is_proctor: false,
    });
    setShowForm(true);
  };

  const openEdit = (cert: Certification) => {
    setEditing(cert);
    setForm({
      user_id: cert.user_id || '',
      certification: cert.certification,
      expiry_date: cert.expiry_date || '',
      is_proctor: Boolean(cert.is_proctor),
    });
    setShowForm(true);
  };

  const chooseUser = (userId: string) => {
    const selected = staff.find((member) => member.id === userId);
    setForm((current) => ({
      ...current,
      user_id: userId,
      certification: recommendedCertification(selected?.role),
    }));
  };

  const save = async () => {
    if (!form.user_id || !form.certification.trim()) {
      toast('Choose a staff account and certification');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        user_id: form.user_id,
        certification: form.certification.trim(),
        expiry_date: form.expiry_date || null,
        is_proctor: form.is_proctor,
      };
      if (editing) await api.updateServSafe(editing.id, payload);
      else await api.createServSafe(payload);
      toast(editing ? 'Certification updated' : 'Certification assigned');
      setShowForm(false);
      await load();
    } catch (err: unknown) {
      toast(errorMessage(err, 'Certification could not be saved'));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (cert: Certification) => {
    if (!window.confirm(`Remove ${cert.certification} from ${cert.staff_name}?`)) return;
    try {
      await api.deleteServSafe(cert.id);
      toast('Certification removed');
      await load();
    } catch (err: unknown) {
      toast(errorMessage(err, 'Certification could not be removed'));
    }
  };

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>ServSafe Manager</h2>
          <div className="ph-sub" style={{ display: 'flex', gap: 7, alignItems: 'center', flexWrap: 'wrap' }}>
            <StatusPill>{staff.length} staff accounts</StatusPill>
            <StatusPill ok>{validCerts} valid</StatusPill>
            <StatusPill warn={assignedUsers < staff.length}>{staff.length - assignedUsers} pending assignment</StatusPill>
          </div>
        </div>
        <div className="ph-actions">
          <button className="btn" onClick={() => void load()} disabled={loading}>{I.refresh()} Refresh</button>
          <button className="btn primary" onClick={openCreate} disabled={!staff.length}>{I.plus()} Assign certification</button>
        </div>
      </div>

      {error && <div className="banner warn">{I.alert()}<span>{error}</span></div>}
      {loading && <div className="load-wrap"><div className="spinner" /><div>Loading staff certifications…</div></div>}

      {!loading && !error && (
        <div className="card">
          <div className="card-head"><h3>Certification roster</h3><span className="ch-link">account-linked</span></div>
          <div className="card-body flush">
            {staff.map((member) => {
              const certs = certsByUser.get(member.id) || [];
              return (
                <div className="cert-roster-row" key={member.id}>
                  <div className="cert-person">
                    <div className="cert-avatar">{(member.display_name?.[0] || member.username[0] || '?').toUpperCase()}</div>
                    <div>
                      <div className="ss-name">{fullName(member)}</div>
                      <div className="ss-cert">{member.job_title || 'Position not assigned'} · {ROLE_LABEL[member.role]}</div>
                    </div>
                  </div>
                  <div className="cert-list">
                    {certs.length === 0 ? (
                      <span className="pill warn">Pending</span>
                    ) : certs.map((cert) => {
                      const status = statusFor(cert.expiry_date);
                      return (
                        <div className="cert-entry" key={cert.id}>
                          <div>
                            <div className="cert-title">
                              {cert.certification}
                              {cert.is_proctor && <span className="ss-proctor">{I.award({ style: { width: 11, height: 11 } })} Proctor</span>}
                            </div>
                            <div className="ss-cert">{cert.expiry_date ? `Expires ${cert.expiry_date}` : 'Expiration date pending'}</div>
                          </div>
                          <span className={`pill ${status.className}`}>{status.label}</span>
                          <button className="btn icon-only" onClick={() => openEdit(cert)} title="Edit certification">{I.edit()}</button>
                          <button className="btn icon-only danger" onClick={() => void remove(cert)} title="Remove certification">{I.del()}</button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {!loading && legacyCerts.length > 0 && (
        <div className="card" style={{ marginTop: 14 }}>
          <div className="card-head"><h3>Legacy position records</h3><span className="ch-link">{legacyCerts.length} unlinked</span></div>
          <div className="banner info" style={{ margin: '0 16px 12px' }}>{I.alert()}<span>These older records use position labels instead of staff accounts. Reassign them only after confirming the employee identity.</span></div>
          <div className="card-body flush">
            {legacyCerts.map((cert) => {
              const status = statusFor(cert.expiry_date);
              return (
                <div className="ss-row" key={cert.id}>
                  <div className="ss-info"><div className="ss-name">{cert.staff_name}</div><div className="ss-cert">{cert.certification || 'Certification pending'}{cert.expiry_date ? ` · exp ${cert.expiry_date}` : ''}</div></div>
                  <span className={`pill ${status.className}`}>{status.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {showForm && (
        <div className="overlay" onClick={() => !saving && setShowForm(false)}>
          <div className="modal" style={{ maxWidth: 540 }} onClick={(event) => event.stopPropagation()}>
            <div className="modal-head"><h3>{editing ? 'Edit certification' : 'Assign certification'}</h3><button className="btn" onClick={() => setShowForm(false)} disabled={saving}>Close</button></div>
            <div className="form-grid" style={{ padding: 16 }}>
              <label style={{ gridColumn: '1 / -1' }}><span>Staff account</span><select value={form.user_id} onChange={(event) => chooseUser(event.target.value)}>{staff.map((member) => <option key={member.id} value={member.id}>{fullName(member)} — {member.job_title || ROLE_LABEL[member.role]}</option>)}</select></label>
              <label><span>Certification</span><select value={form.certification} onChange={(event) => setForm((current) => ({ ...current, certification: event.target.value }))}><option>ServSafe Food Handler</option><option>ServSafe Manager</option><option>ServSafe Allergens</option><option>ServSafe Workplace</option></select></label>
              <label><span>Expiration date</span><input type="date" value={form.expiry_date} onChange={(event) => setForm((current) => ({ ...current, expiry_date: event.target.value }))} /></label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input type="checkbox" checked={form.is_proctor} onChange={(event) => setForm((current) => ({ ...current, is_proctor: event.target.checked }))} /><span>Certified proctor</span></label>
            </div>
            <div className="modal-foot"><button className="btn" onClick={() => setShowForm(false)} disabled={saving}>Cancel</button><button className="btn primary" onClick={() => void save()} disabled={saving}>{saving ? 'Saving…' : editing ? 'Save changes' : 'Assign certification'}</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
