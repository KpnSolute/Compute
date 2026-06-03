import { useState, useEffect, useRef } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL } from '../lib/constants';
import { DS } from '../lib/services';
import { loadLog, saveLog, fetchLog } from '../lib/supabase';

interface Incident {
  id: string;
  type: string;
  detail: string;
  t: string;
}

interface DailyOpsData {
  checks: Record<number, boolean>;
  cycleDay: string;
  notes: string;
  incidents: Incident[];
}

interface MealScheduleItem {
  meal: string;
  hours: string;
  monitor: string;
  open: number;
  close: number;
}

interface MealStatus {
  cls: string;
  txt: string;
}

function useLog(key: string, initial: DailyOpsData) {
  const [data, setData] = useState<DailyOpsData>(() => loadLog(key, null) ?? initial);
  const [saved, setSaved] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);
  const initialRef = useRef(initial);

  useEffect(() => {
    setData(loadLog(key, null) ?? initialRef.current);
    setSaved(true);
    let alive = true;
    fetchLog(key).then((r) => {
      if (alive && r?.data) setData(r.data as DailyOpsData);
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const update = (u: DailyOpsData | ((d: DailyOpsData) => DailyOpsData)) => {
    setData((d) => (typeof u === 'function' ? u(d) : u));
    setSaved(false);
  };

  const save = async (userName?: string) => {
    const r = await saveLog(key, data, userName);
    setSaved(true);
    setSavedAt(new Date());
    return r;
  };

  return { data, update, saved, save, savedAt };
}

function SaveBar({
  saved,
  savedAt,
  onSave,
  canEdit,
  connected,
  note,
}: {
  saved: boolean;
  savedAt: Date | null;
  onSave: () => void;
  canEdit: boolean;
  connected: boolean;
  note: React.ReactNode;
}) {
  return (
    <div className="formbar">
      <div className="formbar-l">
        {note}
        {!saved && canEdit && (
          <span className="dirty-chip">
            {I.alert({ style: { width: 12, height: 12 } })} Unsaved
          </span>
        )}
        {saved && savedAt && (
          <span className="saved-chip">
            {I.check({ style: { width: 12, height: 12 } })}{' '}
            Saved{' '}
            {savedAt.toLocaleTimeString([], {
              hour: '2-digit',
              minute: '2-digit',
            })}
          </span>
        )}
      </div>
      {canEdit && (
        <button className="btn primary" onClick={onSave} disabled={saved}>
          {I.save({ style: { width: 15, height: 15 } })}{' '}
          {connected ? 'Save to Supabase' : 'Save log'}
        </button>
      )}
    </div>
  );
}

export function DailyOps({
  user,
  connected,
}: {
  user: User;
  connected: boolean;
}) {
  const lvl = ROLE_LEVEL[user.role] || 0;
  const canEdit = lvl >= 10;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const key = `dailyops:${date}`;
  const { data, update, saved, save, savedAt } = useLog(key, {
    checks: {},
    cycleDay: '1',
    notes: '',
    incidents: [],
  });

  const checklist = DS.openingChecklist() as string[];
  const checks = data.checks || {};
  const doneCount = checklist.filter((_, i) => checks[i]).length;
  const pct = Math.round((doneCount / checklist.length) * 100);

  function toggle(i: number) {
    if (!canEdit) return;
    update((d) => ({
      ...d,
      checks: { ...d.checks, [i]: !d.checks?.[i] },
    }));
  }

  const [iType, setIType] = useState(
    (DS.incidentTypes() as string[])[0] || ''
  );
  const [iDetail, setIDetail] = useState('');
  function addIncident() {
    if (!iDetail.trim()) return;
    const t = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    update((d) => ({
      ...d,
      incidents: [
        ...(d.incidents || []),
        { id: 'i' + Date.now(), type: iType, detail: iDetail.trim(), t },
      ],
    }));
    setIDetail('');
  }
  function delIncident(id: string) {
    update((d) => ({
      ...d,
      incidents: (d.incidents || []).filter((x) => x.id !== id),
    }));
  }
  const incidents = data.incidents || [];

  const h = new Date().getHours();
  const isToday = date === new Date().toISOString().slice(0, 10);
  function mealStatus(s: MealScheduleItem): MealStatus {
    if (!isToday) return { cls: 'off', txt: '\u2014' };
    if (h >= s.open && h < s.close) return { cls: 'ok', txt: 'Open now' };
    if (h >= s.close) return { cls: 'off', txt: 'Closed' };
    return { cls: 'warn', txt: 'Upcoming' };
  }

  return (
    <div className="fade-in">
      <div className="page-head">
        <div>
          <h2>Daily Operations</h2>
          <div className="ph-sub">
            Opening checklist, meal schedule &amp; incident log
            {connected ? ' \u00B7 synced' : ' \u00B7 saved on device'}
          </div>
        </div>
        <div className="ph-actions">
          <label className="ft-field">
            <span>Operations date</span>
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
        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>Morning opening checklist</h3>
              <span className="ch-link">
                {doneCount}/{checklist.length} complete
              </span>
            </div>
            <div className="card-body flush">
              {checklist.map((item, i) => (
                <label
                  className={'check-row' + (checks[i] ? ' on' : '')}
                  key={i}
                >
                  <input
                    type="checkbox"
                    className="mealchk"
                    checked={!!checks[i]}
                    disabled={!canEdit}
                    onChange={() => toggle(i)}
                  />
                  <span>{item}</span>
                </label>
              ))}
            </div>
            <div className="card-body" style={{ paddingTop: 12 }}>
              <div className="prog-track">
                <div
                  className="prog-bar2"
                  style={{ width: pct + '%' }}
                ></div>
              </div>
              <div
                style={{
                  fontSize: 11.5,
                  color: 'var(--muted)',
                  marginTop: 7,
                  fontWeight: 600,
                }}
              >
                {pct}% of opening tasks complete
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Menu notes \u2014 28-day cycle</h3>
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              <div
                style={{
                  display: 'flex',
                  gap: 12,
                  alignItems: 'flex-end',
                }}
              >
                <label className="ft-field">
                  <span>Cycle day (1\u201328)</span>
                  <input
                    className="ipt sel"
                    type="number"
                    min="1"
                    max="28"
                    style={{ width: 96 }}
                    value={data.cycleDay || ''}
                    disabled={!canEdit}
                    onChange={(e) =>
                      update((d) => ({ ...d, cycleDay: e.target.value }))
                    }
                  />
                </label>
              </div>
              <label className="ft-field">
                <span>Special notes / ethnic menu</span>
                <textarea
                  className="ipt sel"
                  rows={3}
                  style={{ resize: 'vertical' }}
                  value={data.notes || ''}
                  disabled={!canEdit}
                  placeholder="e.g. Hispanic Heritage Month \u2014 rice and beans, plantains\u2026"
                  onChange={(e) =>
                    update((d) => ({ ...d, notes: e.target.value }))
                  }
                ></textarea>
              </label>
            </div>
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-head">
              <h3>Today&rsquo;s meal schedule</h3>
            </div>
            <div className="card-body flush tbl-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>Meal</th>
                    <th>Hours</th>
                    <th>Lead monitor</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(DS.mealSchedule() as MealScheduleItem[]).map((s) => {
                    const st = mealStatus(s);
                    return (
                      <tr key={s.meal}>
                        <td style={{ fontWeight: 700 }}>{s.meal}</td>
                        <td
                          style={{
                            color: 'var(--muted)',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {s.hours}
                        </td>
                        <td style={{ color: 'var(--muted)' }}>
                          {s.monitor}
                        </td>
                        <td>
                          <span className={'pill ' + st.cls}>{st.txt}</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Incident log</h3>
              {incidents.length > 0 && (
                <span className="ch-link">{incidents.length} logged</span>
              )}
            </div>
            <div
              className="card-body"
              style={{ display: 'flex', flexDirection: 'column', gap: 11 }}
            >
              {canEdit && (
                <>
                  <label className="ft-field">
                    <span>Type</span>
                    <select
                      className="ipt sel"
                      value={iType}
                      onChange={(e) => setIType(e.target.value)}
                    >
                      {(DS.incidentTypes() as string[]).map((t) => (
                        <option key={t}>{t}</option>
                      ))}
                    </select>
                  </label>
                  <label className="ft-field">
                    <span>Details</span>
                    <textarea
                      className="ipt sel"
                      rows={2}
                      style={{ resize: 'vertical' }}
                      value={iDetail}
                      placeholder="Describe the incident\u2026"
                      onChange={(e) => setIDetail(e.target.value)}
                    ></textarea>
                  </label>
                  <div>
                    <button
                      className="btn primary"
                      onClick={addIncident}
                      disabled={!iDetail.trim()}
                    >
                      {I.plus({ style: { width: 14, height: 14 } })}{' '}
                      Log incident
                    </button>
                  </div>
                </>
              )}
              {incidents.length === 0 ? (
                <div
                  style={{
                    fontSize: 12,
                    color: 'var(--faint)',
                    padding: '4px 0',
                  }}
                >
                  No incidents logged for this day.
                </div>
              ) : (
                <div className="incident-list">
                  {incidents.map((r) => (
                    <div className="incident-item" key={r.id}>
                      <div className="ii-body">
                        <div className="ii-top">
                          <span className="pill warn">{r.type}</span>
                          <span className="ii-time">{r.t}</span>
                        </div>
                        <div className="ii-detail">{r.detail}</div>
                      </div>
                      {canEdit && (
                        <button
                          className="row-del"
                          onClick={() => delIncident(r.id)}
                        >
                          {I.del({ style: { width: 14, height: 14 } })}
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <SaveBar
        saved={saved}
        savedAt={savedAt}
        onSave={() => save(user.display_name)}
        canEdit={canEdit}
        connected={connected}
        note={
          <span className="formbar-meta">
            Daily operations \u00B7{' '}
            {new Date(date + 'T12:00:00').toLocaleDateString()}
          </span>
        }
      />
    </div>
  );
}
