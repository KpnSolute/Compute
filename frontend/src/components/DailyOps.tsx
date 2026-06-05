import { useState, useEffect } from 'react';
import { I } from '../lib/icons';
import { type User, ROLE_LEVEL } from '../lib/constants';
import { api } from '../lib/api';

interface Incident {
  id: string;
  type: string;
  detail: string;
  t: string;
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

const DEFAULT_CHECKLIST = [
  'Turn on & test all cooking equipment',
  'Check walk-in cooler & freezer temperatures',
  'Verify hot-hold & cold-hold temperatures',
  'Prepare & set up serving lines',
  'Check inventory par levels for breakfast',
  'Review menu board & cycle day',
  'Complete HACCP temperature log (AM)',
  'Confirm cleaning supplies stocked',
  'Inspect dining area cleanliness',
  'Verify hand-washing stations stocked',
];

const DEFAULT_MEAL_SCHEDULE: MealScheduleItem[] = [
  { meal: 'Breakfast', hours: '6:30 AM – 8:00 AM', monitor: 'Lead Cook', open: 6, close: 8 },
  { meal: 'Lunch', hours: '11:00 AM – 1:00 PM', monitor: 'Manager', open: 11, close: 13 },
  { meal: 'Dinner', hours: '4:30 PM – 6:00 PM', monitor: 'Suprv Cook', open: 16, close: 18 },
];

const INCIDENT_TYPES = [
  'Food safety',
  'Equipment malfunction',
  'Staff injury',
  'Student conduct',
  'Supply shortage',
  'Fire/safety',
  'Other',
];

function Loading({ label = 'Loading…' }) {
  return <div className="load-wrap"><div className="spinner"></div><div>{label}</div></div>;
}

export function DailyOps({ user }: { user: User }) {
  const lvl = ROLE_LEVEL[user.role] || 0;
  const canEdit = lvl >= 10;
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));

  const [checklist, setChecklist] = useState<string[]>(DEFAULT_CHECKLIST);
  const [checks, setChecks] = useState<Record<number, boolean>>({});
  const [checklistLoading, setChecklistLoading] = useState(true);

  const [mealSchedule, setMealSchedule] = useState<MealScheduleItem[]>(DEFAULT_MEAL_SCHEDULE);
  const [mealLoading, setMealLoading] = useState(true);

  const [cycleDay, setCycleDay] = useState('1');
  const [notes, setNotes] = useState('');
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [saved, setSaved] = useState(true);
  const [savedAt, setSavedAt] = useState<Date | null>(null);

  const [iType, setIType] = useState(INCIDENT_TYPES[0]);
  const [iDetail, setIDetail] = useState('');

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const logs = await api.getDailyLogs(50, 'opening_checklist');
        const items = logs
          .filter((l: any) => l.title)
          .map((l: any) => l.title);
        if (alive && items.length) setChecklist(items);
      } catch {
        if (alive) setChecklist(DEFAULT_CHECKLIST);
      }
      if (alive) setChecklistLoading(false);
    }
    load();
    return () => { alive = false; };
  }, []);

  useEffect(() => {
    let alive = true;
    async function load() {
      try {
        const logs = await api.getDailyLogs(50, 'meal_schedule');
        const items = logs
          .filter((l: any) => l.title)
          .map((l: any) => {
            const parts = l.description ? l.description.split('|') : [];
            return {
              meal: l.title,
              hours: parts[0] || '',
              monitor: parts[1] || '',
              open: parseInt(parts[2]) || 0,
              close: parseInt(parts[3]) || 0,
            };
          });
        if (alive && items.length) setMealSchedule(items);
      } catch {
        if (alive) setMealSchedule(DEFAULT_MEAL_SCHEDULE);
      }
      if (alive) setMealLoading(false);
    }
    load();
    return () => { alive = false; };
  }, []);

  const doneCount = Object.values(checks).filter(Boolean).length;
  const pct = checklist.length ? Math.round((doneCount / checklist.length) * 100) : 0;

  function toggle(i: number) {
    if (!canEdit) return;
    setChecks((prev) => ({ ...prev, [i]: !prev[i] }));
    setSaved(false);
  }

  function addIncident() {
    if (!iDetail.trim()) return;
    const t = new Date().toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
    setIncidents((prev) => [
      ...prev,
      { id: 'i' + Date.now(), type: iType, detail: iDetail.trim(), t },
    ]);
    setIDetail('');
    setSaved(false);
  }

  function delIncident(id: string) {
    setIncidents((prev) => prev.filter((x) => x.id !== id));
    setSaved(false);
  }

  async function handleSave() {
    for (const inc of incidents) {
      try {
        await api.saveDailyLog({
          entry_type: 'incident',
          title: inc.type,
          description: `${inc.detail} [${inc.t}]`,
          severity: 'info',
        });
      } catch {
        // silently continue
      }
    }
    setSaved(true);
    setSavedAt(new Date());
  }

  const h = new Date().getHours();
  const isToday = date === new Date().toISOString().slice(0, 10);
  function mealStatus(s: MealScheduleItem): MealStatus {
    if (!isToday) return { cls: 'off', txt: '—' };
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
            {checklistLoading ? (
              <div className="card-body" style={{ padding: '20px 17px' }}>
                <Loading label="Loading checklist…" />
              </div>
            ) : (
              <>
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
              </>
            )}
          </div>

          <div className="card">
            <div className="card-head">
              <h3>Menu notes — 28-day cycle</h3>
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
                  <span>Cycle day (1–28)</span>
                  <input
                    className="ipt sel"
                    type="number"
                    min="1"
                    max="28"
                    style={{ width: 96 }}
                    value={cycleDay}
                    disabled={!canEdit}
                    onChange={(e) => {
                      setCycleDay(e.target.value);
                      setSaved(false);
                    }}
                  />
                </label>
              </div>
              <label className="ft-field">
                <span>Special notes / ethnic menu</span>
                <textarea
                  className="ipt sel"
                  rows={3}
                  style={{ resize: 'vertical' }}
                  value={notes}
                  disabled={!canEdit}
                  placeholder="e.g. Hispanic Heritage Month — rice and beans, plantains…"
                  onChange={(e) => {
                    setNotes(e.target.value);
                    setSaved(false);
                  }}
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
            {mealLoading ? (
              <div className="card-body" style={{ padding: '20px 17px' }}>
                <Loading label="Loading schedule…" />
              </div>
            ) : (
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
                    {mealSchedule.map((s) => {
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
            )}
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
                      {INCIDENT_TYPES.map((t) => (
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
                      placeholder="Describe the incident…"
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

      <div className="formbar">
        <div className="formbar-l">
          <span className="formbar-meta">
            Daily operations ·{' '}
            {new Date(date + 'T12:00:00').toLocaleDateString()}
          </span>
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
          <button className="btn primary" onClick={handleSave} disabled={saved}>
            {I.save({ style: { width: 15, height: 15 } })} Save
          </button>
        )}
      </div>
    </div>
  );
}
